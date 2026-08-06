#!/usr/bin/env python3
"""CDB-v1 seeded case generator (Protocol §4, §6).

Deterministic: the same (section, seed) yields byte-identical gold via
random.Random(stable_hash). Fresh instances per seed so no backend can overfit.

A case is: {section, seed, corpus, prior[], probes[], files{}} where
  prior[]  = knowledge a backend may store; S5 entries carry a 2-step history
             (same info to every backend; only the *resolution* differs downstream)
  probes[] = {id, question, must_contain}  (must_contain matches the CURRENT gold)
  files{}  = sandbox files (S1 only: makes the answer rederivable => the control)
"""
import hashlib, json, os, random, re, sys

CORPUS = "CDB-synthetic-v1"

# deterministic word pools (arbitrary, non-rederivable values)
ADJ = ["saltmarsh", "obsidian", "cobalt", "harrier", "meridian", "tessellate",
       "lodestar", "quillon", "verdigris", "halcyon", "cinnabar", "wolfram"]
NOUN = ["relay", "ledger", "beacon", "conduit", "harbor", "lattice", "foundry",
        "quorum", "cistern", "aperture", "gantry", "moorland"]
ROTATION = ["lighthouse-keepers", "night-wardens", "tide-callers", "ember-guild",
            "salt-riggers", "fen-rangers"]


def rng(section, seed):
    h = int(hashlib.sha256(f"{section}:{seed}".encode()).hexdigest(), 16)
    return random.Random(h)


def _codename(r):
    return f"Project {r.choice(ADJ).capitalize()}"


def gen_case(section, seed, version="v1", tier=None):
    """Dispatch on suite version. v1 (default) is byte-identical to CDB-v1 so the
    62 published v1 records still verify; v1.1 uses the expanded /100 banks below.
    `version` accepts "v1"/"v1.1" or a full suite id ("CDB-v1.1")."""
    if str(version).replace("CDB-", "").replace("_", ".") in ("v1.1", "1.1"):
        case = gen_case_v11(section, seed, tier=tier)
        return _apply_tier(case, section, seed, tier)
    r = rng(section, seed)
    cn = _codename(r)
    slug = cn.split()[1].lower()
    port = r.randint(2000, 9999)
    prefix = (slug[:5]).upper()
    flag = f"ff_{slug}_v{r.randint(2,6)}"
    rot = r.choice(ROTATION)
    budget = f"{r.choice([1.5,2.0,2.5,3.0,5.0])}"

    if section == "S1":  # rederivable CONTROL — answers live in a file
        prior = [{"key": "codename", "value": cn},
                 {"key": "internal_port", "value": str(port)},
                 {"key": "log_prefix", "value": prefix}]
        files = {"config/service.yaml":
                 f"# service config (committed)\ncodename: {cn}\n"
                 f"internal_port: {port}\nlog_prefix: {prefix}\n"}
        probes = [
            {"id": "P1", "question": "What is the service's internal codename? (check the repo)",
             "must_contain": slug},
            {"id": "P2", "question": "What internal port is configured?",
             "must_contain": str(port)},
            {"id": "P3", "question": "What log-line prefix is set?",
             "must_contain": prefix}]

    elif section == "S2":  # arbitrary, non-rederivable
        prior = [{"key": "codename", "value": cn},
                 {"key": "internal_port", "value": str(port)},
                 {"key": "log_prefix", "value": prefix},
                 {"key": "oncall_rotation", "value": rot},
                 {"key": "feature_flag", "value": flag},
                 {"key": "error_budget_pct", "value": budget}]
        files = {}
        probes = [
            {"id": "P1", "question": "Internal codename decided by the prior team?", "must_contain": slug},
            {"id": "P2", "question": "Internal port assigned (no derivable pattern)?", "must_contain": str(port)},
            {"id": "P3", "question": "Log-line prefix standardised on?", "must_contain": prefix},
            {"id": "P4", "question": "On-call rotation name?", "must_contain": rot.replace('-', '[- ]?')},
            {"id": "P5", "question": "Feature flag gating the new path?", "must_contain": flag},
            {"id": "P6", "question": "Agreed monthly error budget (percent)?", "must_contain": budget.replace('.', '\\.')}]

    elif section == "S3":  # cross-session continuity
        db = r.choice(["postgres-15", "sqlite-wal", "duckdb-embedded"])
        fmt = r.choice(["msgpack", "cbor", "protobuf"])
        prior = [{"key": "session_a_decision_store", "value": db},
                 {"key": "session_a_decision_wire", "value": fmt},
                 {"key": "session_a_codename", "value": cn}]
        files = {}
        probes = [
            {"id": "P1", "question": "In the prior session, which storage engine was chosen?", "must_contain": db.replace('-', '[- ]?')},
            {"id": "P2", "question": "Which wire format did the prior session standardise on?", "must_contain": fmt},
            {"id": "P3", "question": "What codename does this work continue?", "must_contain": slug}]

    elif section == "S4":  # causal / why-chains
        chosen = r.choice(["msgpack", "cbor", "protobuf"])
        rejected = r.choice([x for x in ["msgpack", "cbor", "protobuf"] if x != chosen])
        reason = r.choice(["zero-copy", "self-describing", "schema-evolution", "smaller-frames"])
        prior = [{"key": "wire_choice", "value": chosen},
                 {"key": "wire_rejected", "value": rejected},
                 {"key": "wire_reason", "value": reason}]
        files = {}
        probes = [
            {"id": "P1", "question": f"Which wire format was chosen over {rejected}?", "must_contain": chosen},
            {"id": "P2", "question": f"What was the stated reason {chosen} was chosen over {rejected}?", "must_contain": reason},
            {"id": "P3", "question": "Which format was explicitly rejected?", "must_contain": rejected}]

    elif section == "S5":  # supersession CONTROL — current value is gold
        old_port, new_port = port, port + r.randint(11, 99)
        old_flag = flag
        new_flag = f"ff_{slug}_v{int(flag.split('v')[1]) + 1}"
        # history: SAME info given to every backend; only resolution differs.
        prior = [
            {"key": "internal_port", "history": [str(old_port), str(new_port)], "value": str(new_port)},
            {"key": "feature_flag", "history": [old_flag, new_flag], "value": new_flag},
            {"key": "codename", "history": [cn], "value": cn}]
        files = {}
        probes = [
            {"id": "P1", "question": "What is the CURRENT internal port (it was changed)?", "must_contain": str(new_port)},
            {"id": "P2", "question": "What is the CURRENT feature flag (it was renamed)?", "must_contain": new_flag},
            {"id": "P3", "question": "What is the service codename?", "must_contain": slug}]
    elif section == "S6":  # scale / needle-in-haystack
        # N distractors + a few needles; vendor dumps all (O(N)), crux retrieves (O(1)).
        n = int(os.environ.get("CDB_S6_N", "300"))
        needle_port = r.randint(2000, 9999)
        prior = []
        for i in range(n):
            prior.append({"key": f"note_{i:04d}",
                          "value": f"routine operational note {i}: nightly batch, log rotation, cache warm, healthcheck ok"})
        prior.append({"key": "needle_codename", "value": cn})
        prior.append({"key": "needle_port", "value": str(needle_port)})
        prior.append({"key": "needle_rotation", "value": rot})
        # shuffle so the needle isn't at a fixed position
        r.shuffle(prior)
        files = {}
        probes = [
            {"id": "P1", "question": f"Among the notes, what internal codename was recorded?",
             "must_contain": slug, "query": "codename project recorded"},
            {"id": "P2", "question": "What internal port was recorded in the notes?",
             "must_contain": str(needle_port), "query": "internal port recorded"},
            {"id": "P3", "question": "What on-call rotation name was recorded?",
             "must_contain": rot.replace('-', '[- ]?'), "query": "on-call rotation name"}]
        return {"section": section, "seed": seed, "corpus": f"{CORPUS}-N{n}",
                "prior": prior, "probes": probes, "files": files, "haystack_n": n}
    else:
        raise SystemExit(f"unknown section {section}")

    return {"section": section, "seed": seed, "corpus": CORPUS,
            "prior": prior, "probes": probes, "files": files}


# ---------------------------------------------------------------------------
# CDB-v1.1 — expanded seeded probe banks for the /100 composite.
#
# The v1 code above is frozen (byte-identical) so CDB-v1 records still verify.
# v1.1 scores 20 probes per section for S2-S6 => 5 x 20 = /100. S1 stays a
# pass/fail LEAK GATE (its own 5 probes, EXCLUDED from the composite): any
# real-backend lift over `none` on S1 fails the build. Determinism is preserved
# — every value is drawn from random.Random(hash(section, seed)).
# ---------------------------------------------------------------------------

N_SCORED = 20  # scored probes per section (S2-S6)

# --- difficulty ladder -------------------------------------------------------
# The tier changes ONLY how deeply the signal is buried. Every scored section
# keeps the same 20 probes at every tier, so a higher tier is not a different
# question — it is the same question under more noise. That keeps the ladder a
# single axis; mixing in new sections per tier would change the KIND of
# difficulty and make frontiers across tiers incomparable.
_PROFILE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "difficulty-profile.json")


def load_profile():
    with open(_PROFILE_PATH) as fh:
        return json.load(fh)


def tier_knobs(tier):
    """Knobs for a tier. Raises rather than defaulting: a silent fallback would
    publish a run at a difficulty nobody selected."""
    prof = load_profile()
    knobs = prof["tiers"].get(tier)
    if knobs is None:
        raise SystemExit(
            f"unknown tier {tier!r} for bench {prof['bench']} "
            f"(range {prof['floorTier']}..{prof['ceilingTier']})")
    return knobs


def _distractors(r, n, offset=0):
    """Filler notes that are plausible but never answer a probe."""
    return [{"key": f"note_{i + offset:06d}",
             "value": (f"routine operational note {i + offset}: nightly batch, log rotation, "
                       f"cache warm, healthcheck ok")}
            for i in range(n)]


def _apply_tier(case, section, seed, tier):
    """Apply the tier to a freshly built case: bury the signal and stamp the
    corpus.

    Done centrally rather than in each section branch so a new section cannot
    silently opt out of the ladder. S6 buries itself (the haystack IS its
    subject), so it is skipped here to avoid double-burying.
    """
    if tier is None:
        return case
    knobs = tier_knobs(tier)
    if section != "S6":
        _bury(case, rng(f"{section}-haystack", seed), int(knobs["haystack_n"]))
    # Corpus identity must carry the tier: the same probes at D3 and D6 are NOT
    # the same measurement, and a number reported against the wrong one is not
    # recoverable after the fact.
    case["corpus"] = f"{CORPUS}-{tier}"
    case["difficulty_tier"] = tier
    case["haystack_n"] = int(knobs["haystack_n"])
    return case


def _bury(case, r, haystack_n):
    """Inject `haystack_n` distractors around a case's prior, in place.

    Applied to every scored section, not just S6. Scaling only the needle
    section would leave four fifths of the bench flat, so a climb would measure
    one section's difficulty and call it the bench's.
    """
    if haystack_n <= 0 or not case.get("scored"):
        return case
    prior = case.get("prior") or []
    prior = prior + _distractors(r, haystack_n)
    r.shuffle(prior)
    case["prior"] = prior
    case["haystack_n"] = haystack_n
    return case

N_LEAK = 5     # S1 leak-gate probes (not in the composite)

REGION = ["us-fen-1", "eu-moor-2", "ap-tide-3", "sa-salt-4", "us-gantry-5", "eu-cistern-6"]
WINDOW = ["02:00-04:00 UTC", "23:00-01:00 UTC", "06:00-07:30 UTC", "14:00-15:30 UTC"]

# S4 causal bank: (topic, options, reasons). chosen/rejected/reason drawn per seed.
DECISIONS = [
    ("wire format", ["cbor", "protobuf", "msgpack", "flatbuffers"], ["zero-copy", "self-describing", "schema-evolution", "smaller-frames"]),
    ("storage engine", ["postgres", "mysql", "duckdb", "sqlite"], ["mvcc", "column-store", "embeddability", "wal-durability"]),
    ("cache layer", ["redis", "memcached", "hazelcast"], ["persistence", "pubsub", "lru-eviction"]),
    ("message queue", ["kafka", "nats", "rabbitmq", "sqs"], ["log-compaction", "at-least-once", "low-latency", "managed-ops"]),
    ("rpc framework", ["grpc", "rest", "graphql", "thrift"], ["streaming", "codegen", "backpressure", "schema-first"]),
    ("auth scheme", ["oidc", "mtls", "hmac", "paseto"], ["revocation", "mutual-trust", "stateless", "no-alg-confusion"]),
    ("hash function", ["blake3", "sha256", "xxhash"], ["speed", "fips-compliance", "simd"]),
    ("lb strategy", ["ewma", "round-robin", "least-conn"], ["tail-latency", "simplicity", "even-load"]),
    ("columnar format", ["arrow", "parquet", "avro"], ["in-memory", "predicate-pushdown", "row-append"]),
    ("compression", ["zstd", "lz4", "gzip", "snappy"], ["ratio", "decode-speed", "ubiquity", "low-cpu"]),
    ("container base", ["chainguard", "alpine", "distroless", "ubuntu"], ["zero-cve", "small-size", "no-shell", "familiarity"]),
    ("migration tool", ["sqlx", "flyway", "goose", "atlas"], ["compile-checked", "versioned", "embedded", "declarative"]),
    ("id scheme", ["uuidv7", "ulid", "ksuid", "snowflake"], ["time-sortable", "lexical-sort", "compactness", "coordination-free"]),
    ("tracing", ["otel", "jaeger", "zipkin"], ["vendor-neutral", "adaptive-sampling", "span-links"]),
    ("secrets store", ["vault", "sops", "kms"], ["dynamic-leases", "gitops", "envelope-encryption"]),
    ("search index", ["tantivy", "lucene", "meilisearch"], ["rust-native", "maturity", "typo-tolerance"]),
    ("vector store", ["qdrant", "pgvector", "milvus"], ["filtering", "single-db", "scale-out"]),
    ("build system", ["bazel", "nx", "turbo"], ["hermetic", "graph-cache", "js-first"]),
    ("proxy", ["envoy", "nginx", "haproxy"], ["xds-api", "config-simplicity", "raw-throughput"]),
    ("runtime", ["wasmtime", "v8-isolates", "firecracker"], ["sandboxing", "fast-cold-start", "microvm-isolation"]),
]


def _num_mc(v):
    """Word-boundaried numeric match so '42' doesn't hit inside '426'."""
    return rf"(?<!\d){re.escape(str(v))}(?!\d)"


def _recall_bank(r):
    """20 arbitrary, non-rederivable facts. Each: {key, value, q, mc}. rng is
    consumed in list order => deterministic."""
    cn = _codename(r); slug = cn.split()[1].lower()
    a = [r.choice(ADJ) for _ in range(4)]
    n = [r.choice(NOUN) for _ in range(4)]
    prefix = slug[:5].upper()
    flagv = r.randint(2, 6)
    facts = [
        {"key": "codename", "value": cn, "q": "Internal service codename decided by the prior team?", "mc": slug},
        {"key": "internal_port", "value": str(r.randint(2000, 9999)), "q": "Internal port assigned (no derivable pattern)?", "mc": None},
        {"key": "log_prefix", "value": prefix, "q": "Log-line prefix standardised on?", "mc": None},
        {"key": "oncall_rotation", "value": r.choice(ROTATION), "q": "On-call rotation name agreed?", "mc": None},
        {"key": "feature_flag", "value": f"ff_{slug}_v{flagv}", "q": "Feature flag gating the new path?", "mc": None},
        {"key": "error_budget_pct", "value": str(r.choice([1.5, 2.0, 2.5, 3.0, 5.0])), "q": "Agreed monthly error budget (percent)?", "mc": None},
        {"key": "cache_ttl_seconds", "value": str(r.randint(30, 3600)), "q": "Cache TTL in seconds configured?", "mc": None},
        {"key": "shard_count", "value": str(r.randint(3, 64)), "q": "Number of shards provisioned?", "mc": None},
        {"key": "api_version", "value": f"v{r.randint(2, 9)}", "q": "Internal API version pinned?", "mc": None},
        {"key": "retry_limit", "value": str(r.randint(2, 10)), "q": "Maximum retry attempts set?", "mc": None},
        {"key": "region_code", "value": r.choice(REGION), "q": "Primary region code chosen?", "mc": None},
        {"key": "rate_limit_rps", "value": str(r.randint(50, 5000)), "q": "Rate limit in requests-per-second?", "mc": None},
        {"key": "grpc_port", "value": str(r.randint(2000, 9999)), "q": "gRPC port assigned?", "mc": None},
        {"key": "lock_ttl_ms", "value": str(r.randint(100, 9000)), "q": "Distributed-lock TTL in milliseconds?", "mc": None},
        {"key": "canary_pct", "value": str(r.choice([1, 5, 10, 25])), "q": "Canary rollout percentage?", "mc": None},
        {"key": "metrics_namespace", "value": f"{slug}_{n[0]}", "q": "Metrics namespace prefix?", "mc": None},
        {"key": "backup_bucket", "value": f"{a[1]}-{n[1]}-bkp", "q": "Backup bucket name?", "mc": None},
        {"key": "queue_name", "value": f"{a[2]}.{n[2]}.q", "q": "Work queue name?", "mc": None},
        {"key": "alert_channel", "value": f"#{a[3]}-{n[3]}", "q": "Alert channel decided?", "mc": None},
        {"key": "deploy_window", "value": r.choice(WINDOW), "q": "Approved deploy window (start time)?", "mc": None},
    ]
    for f in facts:
        if f["mc"] is not None:
            continue
        v = f["value"]
        if f["key"] == "oncall_rotation":
            f["mc"] = re.escape(v).replace("\\-", "[- ]?")
        elif f["key"] == "deploy_window":
            f["mc"] = re.escape(v.split()[0])          # match the "02:00-04:00" span
        elif v.lstrip("v").split(".")[0].isdigit():
            f["mc"] = _num_mc(v.split()[0])            # bare/prefixed number -> word-boundaried
        else:
            f["mc"] = re.escape(v)
    return facts[:N_SCORED]


def _probes(facts):
    return [{"id": f"P{i+1}", "question": f["q"], "must_contain": f["mc"],
             "gold": f.get("gold", f.get("value")),
             **({"query": f.get("query")} if f.get("query") else {})}
            for i, f in enumerate(facts)]


def gen_case_v11(section, seed, tier=None):
    r = rng(section, seed)

    if section == "S1":  # rederivable LEAK GATE (excluded from the /100 composite)
        cn = _codename(r); slug = cn.split()[1].lower()
        port = r.randint(2000, 9999); prefix = slug[:5].upper()
        ttl = r.randint(30, 3600); shards = r.randint(3, 64)
        prior = [{"key": "codename", "value": cn}, {"key": "internal_port", "value": str(port)},
                 {"key": "log_prefix", "value": prefix}, {"key": "cache_ttl_seconds", "value": str(ttl)},
                 {"key": "shard_count", "value": str(shards)}]
        files = {"config/service.yaml":
                 f"# service config (committed)\ncodename: {cn}\ninternal_port: {port}\n"
                 f"log_prefix: {prefix}\ncache_ttl_seconds: {ttl}\nshard_count: {shards}\n"}
        probes = [
            {"id": "P1", "question": "Service internal codename? (check the repo)", "must_contain": slug, "gold": cn},
            {"id": "P2", "question": "Internal port configured? (check the repo)", "must_contain": _num_mc(port), "gold": str(port)},
            {"id": "P3", "question": "Log-line prefix set? (check the repo)", "must_contain": re.escape(prefix), "gold": prefix},
            {"id": "P4", "question": "Cache TTL seconds? (check the repo)", "must_contain": _num_mc(ttl), "gold": str(ttl)},
            {"id": "P5", "question": "Shard count? (check the repo)", "must_contain": _num_mc(shards), "gold": str(shards)}]
        return {"section": section, "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": False, "prior": prior, "probes": probes, "files": files}

    if section == "S2":  # arbitrary decisions — direct recall
        facts = _recall_bank(r)
        prior = [{"key": f["key"], "value": f["value"]} for f in facts]
        return {"section": section, "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": True, "prior": prior, "probes": _probes(facts), "files": {}}

    if section == "S3":  # cross-session continuity — prior-session decisions govern
        facts = _recall_bank(r)
        prior = [{"key": f"session_a_{f['key']}", "value": f["value"]} for f in facts]
        for f in facts:
            f["q"] = f"Continuing the prior session — {f['q'][0].lower() + f['q'][1:]}"
        return {"section": section, "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": True, "prior": prior, "probes": _probes(facts), "files": {}}

    if section == "S4":  # causal / why-chains — 20 decisions, gold = the reason
        facts = []
        for i, (topic, opts, reasons) in enumerate(DECISIONS[:N_SCORED]):
            chosen = r.choice(opts)
            rejected = r.choice([o for o in opts if o != chosen])
            reason = r.choice(reasons)
            facts.append({"key": f"decision_{i:02d}",
                          "value": f"chose {chosen} over {rejected}: {reason}", "gold": reason,
                          "q": f"Why was {chosen} chosen over {rejected} for the {topic}?",
                          "mc": re.escape(reason)})
        prior = [{"key": f["key"], "value": f["value"]} for f in facts]
        return {"section": section, "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": True, "prior": prior, "probes": _probes(facts), "files": {}}

    if section == "S5":  # supersession CONTROL — only the CURRENT value is gold
        keys = ["internal_port", "grpc_port", "cache_ttl_seconds", "rate_limit_rps",
                "lock_ttl_ms", "shard_count", "retry_limit", "max_connections",
                "batch_size", "poll_interval_ms", "session_ttl_seconds", "backlog_limit",
                "worker_count", "flush_bytes", "read_timeout_ms", "write_timeout_ms",
                "heartbeat_ms", "prefetch_count", "keepalive_ms", "circuit_threshold"]
        facts = []
        for k in keys[:N_SCORED]:
            old = r.randint(1000, 9000); new = old + r.randint(11, 900)
            facts.append({"key": k, "history": [str(old), str(new)], "value": str(new),
                          "q": f"What is the CURRENT {k.replace('_', ' ')} (it was changed)?",
                          "mc": _num_mc(new)})
        prior = [{"key": f["key"], "history": f["history"], "value": f["value"]} for f in facts]
        return {"section": section, "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": True, "prior": prior, "probes": _probes(facts), "files": {}}

    if section == "S6":  # scale / needle — 20 needles among N distractors
        # Tier wins over the legacy env var; the env var stays so pre-ladder
        # callers keep working rather than silently changing difficulty.
        n = (int(tier_knobs(tier)["haystack_n"]) if tier
             else int(os.environ.get("CDB_S6_N", "300")))
        facts = _recall_bank(r)
        for f in facts:
            f["query"] = f["key"].replace("_", " ")
        prior = [{"key": f"note_{i:04d}",
                  "value": f"routine operational note {i}: nightly batch, log rotation, cache warm, healthcheck ok"}
                 for i in range(n)]
        prior += [{"key": f"needle_{f['key']}", "value": f["value"]} for f in facts]
        r.shuffle(prior)
        return {"section": section, "seed": seed, "corpus": f"{CORPUS}-N{n}", "suite_version": "CDB-v1.1",
                "scored": True, "prior": prior, "probes": _probes(facts), "files": {}, "haystack_n": n}

    if section == "S9":  # drift / longitudinal supersession — SEPARATE axis (not in /100)
        # Each key is updated K times over the session (v1 → … → vK); only vK is
        # current. A backend that RESOLVES to current (crux, or a retriever that
        # stores the current value) tracks the latest and stays cheap. A backend
        # that dumps the full ACCUMULATED, INTERLEAVED log (vendor-native) makes the
        # model find the latest among K×20 stale values and drifts — worse the
        # longer the session runs. Arbitrary values ⇒ no prior. This is the drift
        # Crux is meant to stop.
        KEYS = ["api_endpoint", "db_dsn", "cache_ttl", "feature_flag", "rollout_pct",
                "retry_budget", "rate_limit", "shard_count", "region_code", "queue_depth",
                "timeout_ms", "batch_size", "worker_pool", "log_level", "sample_rate",
                "circuit_threshold", "lease_ttl", "prefetch_count", "compaction_window", "gc_interval"]

        def _dval():
            return f"{r.choice(ADJ)}-{r.randint(100, 999)}"

        prior = []; probes = []
        for i, key in enumerate(KEYS[:N_SCORED]):
            k_updates = r.randint(4, 8)
            hist = []
            for _ in range(k_updates):
                v = _dval()
                while v in hist:
                    v = _dval()
                hist.append(v)
            prior.append({"key": key, "history": hist, "value": hist[-1]})
            probes.append({"id": f"P{i+1}",
                           "question": f"The {key} was updated {k_updates} times this session. "
                                       f"What is its CURRENT (latest) value?",
                           "must_contain": re.escape(hist[-1]), "gold": hist[-1], "query": key})
        return {"section": "S9", "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": True, "in_composite": False, "axis": "drift",
                "prior": prior, "probes": probes, "files": {}}

    if section == "S8":  # provenance / trust arbitration — SEPARATE axis (not in /100)
        # Two sources disagree on each topic; only the CONFIDENCE tells you which
        # to trust. Values are arbitrary (no model prior), so guessing = 50%. A
        # backend that carries confidence (crux-prov / crux-auto) can pick the
        # trusted value; one that drops it (none / vendor-native / lean crux /
        # rag-bm25 / compaction / sqlite-fts) can only guess. This is where
        # provenance EARNS its tokens.
        TOPICS = ["primary datacenter", "cache backend", "wire codec", "auth mode",
                  "queue engine", "hash algo", "lb policy", "id scheme", "edge proxy",
                  "sandbox runtime", "object store", "compression codec", "search index",
                  "secret store", "trace sink", "cdn", "dns provider", "tls posture",
                  "rollout ring", "shard key"]

        def _aval():
            return f"{r.choice(ADJ)}-{r.randint(10, 99)}"

        prior = []; probes = []
        for i, topic in enumerate(TOPICS[:N_SCORED]):
            v_trust = _aval(); v_other = _aval()
            while v_other == v_trust:
                v_other = _aval()
            c_trust = round(r.uniform(0.85, 0.98), 2)
            c_other = round(r.uniform(0.30, 0.60), 2)
            slug = topic.replace(" ", "_")
            pair = [{"key": f"{slug}_srcA", "value": v_trust, "confidence": c_trust},
                    {"key": f"{slug}_srcB", "value": v_other, "confidence": c_other}]
            r.shuffle(pair)  # trusted source isn't always first
            prior += pair
            probes.append({"id": f"P{i+1}",
                           "question": f"Two sources disagree on the {topic}. Use ONLY the value from the "
                                       f"MORE CONFIDENT source (higher confidence). What is that value?",
                           "must_contain": re.escape(v_trust), "gold": v_trust, "query": topic})
        return {"section": "S8", "seed": seed, "corpus": CORPUS, "suite_version": "CDB-v1.1",
                "scored": True, "in_composite": False, "axis": "provenance",
                "prior": prior, "probes": probes, "files": {}}

    if section == "S7":  # coordination / multi-agent SCAFFOLD (not in the /100)
        # A deterministic 2-agent-on-a-shared-repo scenario: tasks touch files
        # from a shared pool; without coordination the agents' file-sets overlap
        # (collisions). Consumed by coord.py, which computes the conflict metrics
        # for a no-coordination floor vs a coordination-backend arm. See SCAFFOLD.md.
        pool = [f"mod_{i:02d}.rs" for i in range(8)]
        tasks = []
        for i in range(12):
            touched = sorted(set(r.choice(pool) for _ in range(r.choice([1, 1, 2]))))
            tasks.append({"id": f"T{i:02d}", "files": touched, "desc": f"edit {', '.join(touched)}"})
        agents = {"A": [t["id"] for t in tasks[0::2]], "B": [t["id"] for t in tasks[1::2]]}
        return {"section": "S7", "seed": seed, "corpus": "CDB-coord-v1", "suite_version": "CDB-v1.1",
                "scored": False, "prior": [], "probes": [], "files": {},
                "scenario": {"files": pool, "tasks": tasks, "agents": agents}}

    raise SystemExit(f"unknown section {section}")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Generate one CDB case.")
    ap.add_argument("section", nargs="?", default="S2")
    ap.add_argument("seed", nargs="?", type=int, default=1)
    ap.add_argument("version", nargs="?", default="v1")
    ap.add_argument("--tier", default=None,
                    help="Difficulty tier (D2..D6). Scales the haystack the signal is "
                         "buried in; the probes are identical at every tier. Omit for "
                         "legacy behaviour (CDB_S6_N env, untiered corpus id).")
    ap.add_argument("--profile", action="store_true",
                    help="Print the difficulty profile and exit.")
    a = ap.parse_args()
    if a.profile:
        print(json.dumps(load_profile(), indent=2)); raise SystemExit(0)
    print(json.dumps(gen_case(a.section, a.seed, a.version, tier=a.tier), indent=2))
