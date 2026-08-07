#!/usr/bin/env python3
"""CDB-v1 matrix runner + grader + ScoreCrux emitter (Protocol §5-§8).

Runs {section x backend x seed}, grades deterministically, computes deltas vs
none & vendor-native, McNemar cells, cost, safety gate, integrity manifest, and
emits ScoreCrux public-data/context records + an aggregate fingerprint.

usage: run_matrix.py --sections S1,S2,S5 --backends none,vendor-native,crux,oracle,random
                     --seeds 1 --model sonnet [--emit] [--out runs/<date>]
"""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, sys, datetime
import gen, adapters

HERE = pathlib.Path(__file__).resolve().parent
PRICES = {  # USD per 1e6 tokens
    "claude-sonnet-5":   {"input": 3.0, "cache_write": 3.75, "cache_read": 0.30, "output": 15.0},  # sonnet-tier default; confirm list price
    "claude-sonnet-4-6": {"input": 3.0, "cache_write": 3.75, "cache_read": 0.30, "output": 15.0},
    "claude-sonnet-4-5": {"input": 3.0, "cache_write": 3.75, "cache_read": 0.30, "output": 15.0},
    "claude-haiku-4-5":  {"input": 1.0, "cache_write": 1.25, "cache_read": 0.10, "output": 5.0},
}
T_HUMAN_S = 900  # expert-minutes baseline per probe-set (Em scaling; 15 min)

PROBE_TMPL = """You are answering factual probes for a benchmark task (section {section}).
Some answers may be knowable only from context provided above; others may be in repo files here.

1. If a context block or repo files are present, use them to find the SPECIFIC decided value.
2. Answer every probe below into `artifacts/answers.json` as one JSON object mapping probe id
   to a short answer string, e.g. {{"P1":"...","P2":"..."}}.
3. If you genuinely do not know a value, answer with the exact string "UNKNOWN". DO NOT guess —
   these values are arbitrary and only knowable if provided.

Work autonomously; do not ask questions; stay in this directory.

PROBES:
{probes}
"""


def sha(s):
    return hashlib.sha256(s.encode() if isinstance(s, str) else s).hexdigest()


def read_usage(path):
    keys = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
    usage = dict.fromkeys(keys, 0); model = ""
    if not path.exists():
        return usage, model
    for line in path.read_text().splitlines():
        try:
            j = json.loads(line)
        except Exception:
            continue
        u = (j.get("message") or {}).get("usage")
        if isinstance(u, dict):
            for k in keys:
                usage[k] += u.get(k) or 0
            if (j.get("message") or {}).get("model"):
                model = j["message"]["model"]
    return usage, model


def usd(u, model):
    p = PRICES.get(model)
    if not p:
        for name, pp in PRICES.items():
            if model.startswith(name):
                p = pp; break
    if not p:
        return None
    return (u["input_tokens"]*p["input"] + u["cache_creation_input_tokens"]*p["cache_write"]
            + u["cache_read_input_tokens"]*p["cache_read"] + u["output_tokens"]*p["output"]) / 1e6


def count_tokens(text):
    """Context-block token count as a first-class CDB axis.

    Portable: tiktoken cl100k (a real BPE count) if installed, else a
    ~4-chars/token estimate. Every backend's block is measured the same way, so
    the cross-backend comparison ('same accuracy, different token bill') is fair
    regardless of which tokenizer is available.
    """
    try:
        import tiktoken
        return len(tiktoken.get_encoding("cl100k_base").encode(text)), "tiktoken-cl100k"
    except Exception:
        return (len(text) + 3) // 4, "char4-estimate"


def read_latency(result_json):
    """Wall latency (ms) for a session, from the claude CLI result.json."""
    if not result_json.exists():
        return None
    try:
        j = json.loads(result_json.read_text())
    except Exception:
        return None
    return j.get("duration_ms") or j.get("duration") or None


def read_result(result_json):
    """Usage + real cost + model + latency from the claude CLI result.json — the
    reliable source (the transcript-path guess in run_cell.sh can miss). Returns
    (usage_dict, model, cost_usd_or_None, latency_ms_or_None)."""
    keys = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
    usage = dict.fromkeys(keys, 0); model = ""; cost = None; lat = None
    if not result_json.exists():
        return usage, model, cost, lat
    try:
        j = json.loads(result_json.read_text())
    except Exception:
        return usage, model, cost, lat
    u = j.get("usage") or {}
    for k in keys:
        usage[k] = u.get(k) or 0
    model = next(iter(j.get("modelUsage") or {}), "") or j.get("model", "")
    cost = j.get("total_cost_usd")
    lat = j.get("duration_ms") or j.get("duration")
    return usage, model, cost, lat


def score(answers, probes):
    out = {}
    for pr in probes:
        a = str(answers.get(pr["id"], "")).strip()
        ok = bool(a) and a.upper() != "UNKNOWN" and re.search(pr["must_contain"], a, re.IGNORECASE) is not None
        out[pr["id"]] = 1 if ok else 0
    return out


def build_sandbox(run_cell_dir, case, block):
    sb = run_cell_dir / "sandbox"
    if sb.exists():
        shutil.rmtree(sb)
    (sb / "artifacts").mkdir(parents=True)
    for rel, content in case["files"].items():
        f = sb / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(content)
    probes_txt = "\n".join(f'- {p["id"]}: {p["question"]}' for p in case["probes"])
    body = PROBE_TMPL.format(section=case["section"], probes=probes_txt)
    prompt = (f"<context-block>\n{block}\n</context-block>\n\n" + body) if block.strip() else body
    (run_cell_dir / "prompt.md").write_text(prompt)
    # parity guard: strip block => equals the no-context body
    stripped = re.sub(r"<context-block>.*?</context-block>\n\n", "", prompt, flags=re.S)
    assert stripped == body, "PARITY FAIL: prompt differs beyond the context block"
    return sb, prompt, body


def run_one_session(sb_root, case, block, body_probes, model):
    """One cold session over a probe subset. Returns (answers, usage, model_id, latency_ms).
    The parity guard holds per session: the prompt differs from the no-context body
    only by the injected block."""
    sb = sb_root / "sandbox"
    if sb.exists():
        shutil.rmtree(sb)
    (sb / "artifacts").mkdir(parents=True)
    for rel, content in case["files"].items():
        f = sb / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(content)
    probes_txt = "\n".join(f'- {p["id"]}: {p["question"]}' for p in body_probes)
    body = PROBE_TMPL.format(section=case["section"], probes=probes_txt)
    prompt = (f"<context-block>\n{block}\n</context-block>\n\n" + body) if block.strip() else body
    (sb_root / "prompt.md").write_text(prompt)
    stripped = re.sub(r"<context-block>.*?</context-block>\n\n", "", prompt, flags=re.S)
    assert stripped == body, "PARITY FAIL: prompt differs beyond the context block"
    subprocess.run(["bash", str(HERE / "run_cell.sh"), str(sb), str(sb_root / "prompt.md"),
                    str(sb_root / "session"), model], check=True)
    af = sb / "artifacts" / "answers.json"
    try:
        answers = json.loads(af.read_text())
    except Exception:
        answers = {}
    # result.json is the reliable source for usage/cost/latency; fall back to the
    # transcript only if it's absent (the transcript-path guess can miss).
    u, model_id, cost, lat = read_result(sb_root / "session" / "result.json")
    if not any(u.values()):
        u2, m2 = read_usage(sb_root / "session" / "transcript.jsonl")
        if any(u2.values()):
            u, model_id = u2, (m2 or model_id)
    return answers, u, model_id, cost, lat


def run_cell(section, seed, backend, model, out_root, version="v1", batch_size=5, tier=None):
    case = gen.gen_case(section, seed, version, tier=tier)
    suite_version = case.get("suite_version", "CDB-v1")
    scored = case.get("scored", section != "S1")
    # Tier belongs in the path: without it a ladder writes every rung to one
    # directory and keeps only the last.
    cell = out_root / (f"{section}-{backend}-s{seed}" + (f"-{tier}" if tier else ""))
    cell.mkdir(parents=True, exist_ok=True)
    gold_sha = sha(json.dumps(case, sort_keys=True))

    # assemble the backend's context block
    if backend.startswith("crux"):  # crux / crux-prov / crux-auto — all plant to the daemon
        adapters.crux_teardown(case); adapters.crux_plant(case)
        block = adapters.ASSEMBLERS[backend](case)
    elif backend in adapters.ASSEMBLERS:
        block = adapters.ASSEMBLERS[backend](case)
    else:
        block = ""  # oracle/random: synthetic, block unused
    (cell / "block.md").write_text(block)
    ctx_tokens, ctx_method = count_tokens(block)

    if backend == "oracle":
        answers = adapters.synth_oracle_answers(case); model_id = "synthetic"; cost = 0.0; lat = None
    elif backend == "random":
        answers = adapters.synth_random_answers(case); model_id = "synthetic"; cost = 0.0; lat = None
    else:
        # Batch the probes into cold sessions of <= batch_size so a 20-probe
        # section is not one interference-prone mega-prompt. Same block each batch.
        probes = case["probes"]
        batches = [probes[i:i + batch_size] for i in range(0, len(probes), batch_size)] or [[]]
        answers = {}
        agg = dict.fromkeys(("input_tokens", "cache_creation_input_tokens",
                             "cache_read_input_tokens", "output_tokens"), 0)
        model_id = model
        lat = 0
        cost_sum = 0.0; cost_seen = False
        for bi, bp in enumerate(batches):
            ba, bu, bmid, bcost, blat = run_one_session(cell / f"batch_{bi:02d}", case, block, bp, model)
            answers.update(ba)
            for k in agg:
                agg[k] += bu.get(k, 0)
            if bmid:
                model_id = bmid
            if blat:
                lat += blat
            if bcost is not None:
                cost_sum += bcost; cost_seen = True
        # prefer the real total_cost_usd (summed across batches); else price tokens
        cost = round(cost_sum, 6) if cost_seen else usd(agg, model_id)
        if backend.startswith("crux"):
            adapters.crux_teardown(case)

    (cell / "answers.json").write_text(json.dumps(answers, indent=2))
    sc = score(answers, case["probes"])
    probes_detail = [{"id": p["id"], "question": p["question"],
                      "gold": p.get("gold") or adapters._gold_literal(case, p),
                      "gold_pattern": p["must_contain"],
                      "answer": str(answers.get(p["id"], "")), "correct": sc[p["id"]]}
                     for p in case["probes"]]
    manifest = {"suite_version": suite_version, "section": section, "backend": backend,
                "seed": seed, "corpus": case["corpus"], "model": model_id,
                "block_sha256": sha(block), "gold_sha256": gold_sha,
                "answers_sha256": sha(json.dumps(answers, sort_keys=True))}
    (cell / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return {"section": section, "seed": seed, "backend": backend, "model": model_id,
            "corpus": case["corpus"], "n_probes": len(case["probes"]),
            "correct": sum(sc.values()), "per_probe": sc, "probes_detail": probes_detail,
            "cost_usd": cost, "context_tokens": ctx_tokens, "context_tokens_method": ctx_method,
            "latency_ms": lat, "suite_version": suite_version, "scored": scored,
            "in_composite": case.get("in_composite", scored and section != "S1"),
            "axis": case.get("axis"), "s_gate": 1, "manifest": manifest}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sections", default="S1,S2,S5")
    ap.add_argument("--backends", default="none,vendor-native,crux,oracle,random")
    ap.add_argument("--seeds", default="1")
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--out", default=None)
    ap.add_argument("--suite-version", default="v1", help='"v1" (frozen) or "v1.1" (/100 banks)')
    ap.add_argument("--tier", default=None,
                    help="Difficulty tier (D2..D6). Scales the haystack the probes are buried "
                         "in; the probes themselves are identical at every tier. Omit for legacy "
                         "untiered behaviour.")
    ap.add_argument("--batch-size", type=int, default=5, help="probes per cold session")
    ap.add_argument("--emit", action="store_true")
    a = ap.parse_args()
    sections = a.sections.split(","); backends = a.backends.split(",")
    seeds = [int(s) for s in a.seeds.split(",")]
    date = os.environ.get("CDB_DATE", "2026-07-03")
    out_root = pathlib.Path(a.out) if a.out else HERE / "runs" / date
    out_root.mkdir(parents=True, exist_ok=True)

    cells = []
    for section in sections:
        for seed in seeds:
            # counterbalance backend order per seed
            order = backends if seed % 2 else list(reversed(backends))
            for backend in order:
                print(f"### {section} / {backend} / seed {seed}")
                cells.append(run_cell(section, seed, backend, a.model, out_root,
                                      version=a.suite_version, batch_size=a.batch_size,
                                      tier=a.tier))

    # deltas + McNemar vs none & vendor-native, per (section, seed)
    idx = {(c["section"], c["seed"], c["backend"]): c for c in cells}
    for c in cells:
        base_none = idx.get((c["section"], c["seed"], "none"))
        base_vn = idx.get((c["section"], c["seed"], "vendor-native"))
        c["delta_vs_none"] = c["correct"] - base_none["correct"] if base_none else None
        c["delta_vs_vendor_native"] = c["correct"] - base_vn["correct"] if base_vn else None
        if base_none:
            b = sum(1 for p in c["per_probe"] if c["per_probe"][p] == 1 and base_none["per_probe"].get(p, 0) == 0)
            cc = sum(1 for p in c["per_probe"] if c["per_probe"][p] == 0 and base_none["per_probe"].get(p, 0) == 1)
            c["mcnemar_vs_none"] = {"b": b, "c": cc}

    (out_root / "cells.json").write_text(json.dumps(cells, indent=2))

    # fairness invariants
    invariants = check_invariants(cells)
    (out_root / "invariants.json").write_text(json.dumps(invariants, indent=2))
    print("\n=== FAIRNESS INVARIANTS ===")
    for k, v in invariants.items():
        print(f"  {k}: {v}")

    # fingerprint table
    print("\n=== FINGERPRINT (correct/n per section x backend) ===")
    secs = sorted(set(c["section"] for c in cells)); bks = backends
    print("section     " + "  ".join(f"{b[:12]:>12}" for b in bks))
    for s in secs:
        row = []
        for b in bks:
            cs = [c for c in cells if c["section"] == s and c["backend"] == b]
            tot = sum(c["correct"] for c in cs); n = sum(c["n_probes"] for c in cs)
            row.append(f"{tot}/{n:>2}")
        print(f"  {s:<9} " + "  ".join(f"{r:>12}" for r in row))

    # /100 composite over the scored sections (S1 leak-control excluded)
    composite = compute_composite(cells)
    (out_root / "composite.json").write_text(json.dumps(composite, indent=2))
    if composite["rows"]:
        print(f"\n=== COMPOSITE (scored: {','.join(composite['sections'])}; S1 excluded) ===")
        for row in composite["rows"]:
            eff = f"{row['correct_per_1k_ctx']}/1k-ctx" if row["correct_per_1k_ctx"] is not None else "—"
            print(f"  {row['backend']:<14} {row['model']:<22} {row['score']:>3}/{row['max']:<3}"
                  f"  ctx~{row['context_tokens']:>6}tok  ${row['cost_usd']}  {eff}")

    if a.emit:
        emit_scorecrux(cells, date)
    return 0 if invariants["ALL_PASS"] else 1


def compute_composite(cells):
    """Sum `correct` over SCORED sections, excluding the S1 leak control, per
    (backend, model). Also rolls up context tokens + cost and an accuracy-per-1k-
    context-token efficiency figure — the 'same accuracy, different token bill'
    axis. oracle/random are calibration arms and are omitted from the ranking."""
    def in_comp(c):
        return c.get("scored") and c.get("in_composite", c["section"] != "S1")
    scored_secs = sorted({c["section"] for c in cells if in_comp(c)})
    prov_secs = sorted({c["section"] for c in cells if c.get("axis") == "provenance"})
    rows = []
    for backend, model in sorted({(c["backend"], c["model"]) for c in cells
                                  if c["backend"] not in ("oracle", "random")}):
        sub = {}; ct = 0; cost = 0.0
        for s in scored_secs:
            cs = [c for c in cells if c["section"] == s and c["backend"] == backend and c["model"] == model]
            if cs:
                sub[s] = {"correct": sum(c["correct"] for c in cs), "n": sum(c["n_probes"] for c in cs)}
                ct += sum(c.get("context_tokens") or 0 for c in cs)
                cost += sum(c.get("cost_usd") or 0 for c in cs)
        if not sub:
            continue
        score_ = sum(v["correct"] for v in sub.values()); mx = sum(v["n"] for v in sub.values())
        # separate provenance axis (S8) — not in the /100
        pcs = [c for c in cells if c["section"] in prov_secs and c["backend"] == backend and c["model"] == model]
        prov = {"correct": sum(c["correct"] for c in pcs), "n": sum(c["n_probes"] for c in pcs)} if pcs else None
        rows.append({"backend": backend, "model": model, "score": score_, "max": mx,
                     "per_section": sub, "context_tokens": ct, "cost_usd": round(cost, 5),
                     "correct_per_1k_ctx": round(score_ / (ct / 1000), 3) if ct else None,
                     "provenance": prov})
    rows.sort(key=lambda r: (-r["score"], r["context_tokens"]))
    return {"sections": scored_secs, "provenance_sections": prov_secs, "rows": rows}


def check_invariants(cells):
    inv = {}
    # no-leak: on S1, crux & vendor-native lift over none within +1 (allow tiny noise)
    s1 = {c["backend"]: c for c in cells if c["section"] == "S1" and c["seed"] == cells[0]["seed"]}
    leak = None
    if "none" in s1:
        leak = {b: s1[b]["correct"] - s1["none"]["correct"] for b in s1 if b in ("crux", "vendor-native")}
        inv["S1_no_leak"] = all(v <= 1 for v in leak.values())
        inv["S1_lift_detail"] = leak
    # calibration: oracle ceilings, random floors, every section
    orc = [c for c in cells if c["backend"] == "oracle"]
    rnd = [c for c in cells if c["backend"] == "random"]
    inv["oracle_ceilings"] = all(c["correct"] == c["n_probes"] for c in orc) if orc else "n/a"
    inv["random_floors"] = all(c["correct"] == 0 for c in rnd) if rnd else "n/a"
    inv["ALL_PASS"] = bool(inv.get("S1_no_leak", True)) and \
        (inv["oracle_ceilings"] in (True, "n/a")) and (inv["random_floors"] in (True, "n/a"))
    return inv


def em(correct, n, cost, s_gate):
    if not s_gate:
        return 0.0
    recall = correct / n if n else 0
    return round(recall * (T_HUMAN_S / 60.0), 2)  # recall-weighted expert minutes


def emit_scorecrux(cells, date):
    dest = HERE.parents[1] / "public-data" / "context"
    dest.mkdir(parents=True, exist_ok=True)
    section_names = {"S1": "Rederivable (control)", "S2": "Arbitrary decisions",
                     "S3": "Cross-session continuity", "S4": "Causal / why-chains",
                     "S5": "Supersession (control)", "S6": "Scale / needle",
                     "S7": "Coordination / multi-agent", "S8": "Provenance / trust",
                     "S9": "Drift / longitudinal"}
    hyp = {"S1": "no-lift-control", "S2": "high-lift", "S3": "high-lift",
           "S4": "high-lift", "S5": "naive-fails-control",
           "S6": "retrieval-vs-stuffing", "S7": "coordination-cuts-collisions",
           "S8": "provenance-earns-tokens", "S9": "resolve-vs-drift"}
    for c in cells:
        suite = c.get("suite_version", "CDB-v1")
        # v1.1 records get a -v11 filename suffix so they never overwrite the
        # frozen v1 records (same section/backend/model/seed otherwise collides).
        suffix = "" if suite == "CDB-v1" else "-v11"
        rid = f"cdb-{c['section']}-{c['backend']}-{c['model'].replace('.','-')}-s{c['seed']}{suffix}"
        rec = {
            "id": rid, "type": "context", "suite_version": suite,
            "benchmark_name": f"Context Dependence — {section_names.get(c['section'], c['section'])}",
            "section": c["section"], "section_hypothesis": hyp.get(c["section"]),
            "scored": c.get("scored", c["section"] != "S1"),
            "in_composite": c.get("in_composite", c.get("scored", True) and c["section"] != "S1"),
            "axis": c.get("axis"),
            "backend": c["backend"], "memory_system": {"used": c["backend"] not in ("none", "random")},
            "model": c["model"], "reportedModel": c["model"],
            "corpus": c["corpus"], "seed": c["seed"],
            "n_probes": c["n_probes"], "correct": c["correct"],
            "recall": round(c["correct"] / c["n_probes"], 4) if c["n_probes"] else 0,
            "delta_vs_none": c.get("delta_vs_none"),
            "delta_vs_vendor_native": c.get("delta_vs_vendor_native"),
            "mcnemar_vs_none": c.get("mcnemar_vs_none"),
            "cx_em": em(c["correct"], c["n_probes"], c["cost_usd"], c["s_gate"]),
            "s_gate": c["s_gate"], "c_tokens_usd": c["cost_usd"],
            "probes": c.get("probes_detail"),
            "context_tokens": c.get("context_tokens"),
            "context_tokens_method": c.get("context_tokens_method"),
            "correct_per_1k_ctx": (round(c["correct"] / (c["context_tokens"] / 1000), 3)
                                   if c.get("context_tokens") else None),
            "latency_ms": c.get("latency_ms"),
            "submitter": "Myles Bryning", "organization": "CueCrux Labs",
            "githubLogin": "CueCrux-Myles",
            "gold_sha256": c["manifest"].get("gold_sha256"),
            "block_sha256": c["manifest"].get("block_sha256"),
            "manifest_sha256": sha(json.dumps(c["manifest"], sort_keys=True)),
            "cost_basis": "measured" if c.get("cost_usd") is not None else "unmeasured-subagent",
            "date": date, "metrics_version": "1.6",
            "submittedAt": f"{date}T00:00:00.000Z",
        }
        (dest / f"{rid}.json").write_text(json.dumps(rec, indent=2))
    print(f"\nemitted {len(cells)} records -> {dest}")


if __name__ == "__main__":
    sys.exit(main())
