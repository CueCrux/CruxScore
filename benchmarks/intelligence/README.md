# ScoreCrux Intelligence Benchmark

A psychometric intelligence benchmark for AI models, built on Item Response Theory (IRT) with Cattell-Horn-Carroll (CHC) cognitive factor mapping and IQ-equivalent composite scoring.

## What it measures

The benchmark tests **reasoning** — the ability to transform inputs into correct conclusions when all required information is in the task. It does not reward factual recall, retrieval, web access, or memorised benchmark answers.

Six reasoning categories map to four CHC broad cognitive factors:

The bank holds **46 items**: six reasoning categories × five difficulty tiers,
plus a 16-item evidence-sufficiency family (category G).

A default run is **28 items**: the 12 hard-tier reasoning items (tiers 4–5) plus
the whole G family. Tiers 1–3 are retired from default runs — claude-opus-5
scored 23/24 across tiers 2–5, so they spend calls confirming a frontier model
can still do arithmetic while contributing nothing to discrimination, and a
near-sweep pushes the IRT extrapolation to absurdity (one such run scored
IQ 179). They remain available with `--tiers 1,2,3` for comparability with
older runs.

| Tier | IRT difficulty `b` | Intent |
|---|---|---|
| 1 | −1.0 | warm-up — excluded from default runs |
| 2 | 0.0 | routine |
| 3 | +1.5 | hard for older models |
| 4 | +2.5 | added 2026-07-24 — separates frontier models |
| 5 | +3.5 | added 2026-07-24 — most models fail these |

Tier 4 and 5 answer keys are derived by exhaustive solve
(`tools/generate-hard-items.py`), which refuses to emit an item unless its
solver finds exactly one solution.

Those tiers are built from what *measurably* defeats frontier models, not from
intuition. A first attempt failed calibration — claude-opus-5 scored 6/6 on
tier 4 and 5/6 on tier 5, because long mechanical work (simulating a state
machine, list-scheduling, inferring a Caesar variant) is not hard for these
models. Pooling every judged run showed only three items had ever beaten one:
C003 (11/11 failures), D003 (9/11) and C002 (3/11). What they share is now the
design rule for tiers 4-5:

1. **Rule interaction** — a later clause retroactively changes an earlier
   computation, or an exception overrides an exception, so applying the rules in
   the obvious order yields a different and plausible answer.
2. **Completeness** — the answer is wrong if anything is omitted.
3. **Negative or global claims** — what never happens, what the true minimum is.
   Planning items assert at generation time that the optimum strictly exceeds
   the critical path, the load average and any single machine's workload, so a
   model that quotes a bound is wrong.

| Category | Label | CHC Factor | Description |
|---|---|---|---|
| G | Evidence Sufficiency | Gc / Gf (cross-loaded) | Rulebooks whose conditions are sometimes unstated — see below |
| A | Deduction & Elimination | Gf (Fluid Reasoning) | Logic grids, process of elimination |
| B | Stateful Process Reasoning | Gwm (Working Memory) | Variables updating each round, state tracking |
| C | Rule Application | Gc / Gf (cross-loaded) | Apply a policy or rulebook to a scenario |
| D | Causal & Counterfactual | Gf (Fluid Reasoning) | What happens next, what changes if X is removed |
| E | Abstraction & Transformation | Gf (Fluid Reasoning) | Symbol transforms, sequence rules (Raven's-like) |
| F | Planning Under Constraints | Gs / Gf (cross-loaded) | Schedule tasks under dependencies and limits |

## Scoring methodology

### Per-item scoring (§2.9 of master plan)

| Component | Weight |
|---|---|
| Correctness | 70% |
| Trace consistency | 15% |
| Constraint adherence | 10% |
| Output compliance | 5% |

### IRT ability estimation

Each item has calibrated IRT parameters (2PL model). After scoring, the benchmark estimates a latent ability parameter (theta) using Maximum Likelihood Estimation (MLE), with Expected A Posteriori (EAP) fallback for degenerate response patterns.

### CHC factor scores

Items are grouped by their CHC factor loading. Cross-loaded items (categories C, F) contribute fractionally to both their primary and secondary factors. Per-factor theta estimates produce per-factor IQ equivalents.

### Composite IQ-equivalent

Overall theta is converted to an IQ-equivalent score:

```
IQ = 100 + 15 × (theta - normMean) / normSD
```

Scored on M=100, SD=15 (Wechsler convention). Normed against model populations. Classification bands: Very Low (<70), Low (70-79), Low Average (80-89), Average (90-109), High Average (110-119), Superior (120-129), Very Superior (130+).

The 95% confidence interval is computed from the standard error of the theta estimate.

## What this bank can and cannot resolve

Measured 2026-07-24 on the Claude 5 generation, judged scoring, four repeat runs
each of `claude-opus-5` and `claude-sonnet-5` under one configuration:

| | |
|---|---|
| Repeat runs, same model, same config | 15/18 or 16/18 — the score oscillates by one item |
| One item at the top of the scale | **8 IQ points** (15/18 = 132, 16/18 = 140) |
| Within-model SD across repeats | **4.3 IQ points** |
| Gap a *single* run can resolve | **~12 IQ points** (~1.5 items) |
| Gap 3 runs can resolve | ~7 points |
| Observed opus-5 vs sonnet-5 difference | **2 IQ points** — indistinguishable |

Every model, on every run, misses the same two items (C003, D003) and passes the
other sixteen. The bank's hardest items sit at IRT difficulty `b = +1.5` while
the current frontier scores 15–16/18, so these models are **above its ceiling**:
there is roughly one item of genuine signal separating them, and one item is
inside the noise.

Consequences for anyone reading a score from this bank:

- **Do not rank models whose intervals overlap.** On single runs, anything under
  a ~12-point gap is a tie.
- **Three runs minimum** before treating a difference as real. `--runs 3` does
  this in one command; the board averages repeat runs (`?avg=1|3|5|all`) and
  marks anything built from fewer than three runs *provisional*, with no rank.
- **Per-factor IQ equivalents are not usable** for Gc, Gs and Gwm — three items
  each, SE 0.8–1.4 logits (±25–40 IQ).
- The fix is harder items (roughly `b ≥ +2.5`), not more runs of the same ones.
  **Done 2026-07-24**: tiers 4 and 5 added, bank 18 → 30 items, default run 24.
  The numbers in this table were measured on the old 18-item bank (v1.0); runs
  on the current bank (v1.1) carry their version and are stacked separately.

## Run modes

| Mode | Tools | Internet | Memory |
|---|---|---|---|
| `closed_prompt_only` | None | No | No |
| `local_tooling` | Local execution | No | No |
| `open_tooling` | Tools + web | Yes | Optional |
| `custom_harness` | Entrant-declared | Declared | Declared |

Results must always declare the run mode. Different modes are not directly comparable.

## Category G — evidence sufficiency

Every well-posed deterministic category is at the frontier ceiling: two design
passes and six probe designs produced **zero** failures for claude-opus-5. What
did beat it was a rulebook containing a conditional clause whose trigger is
never stated — it silently assumed the condition did not apply and returned a
confident number.

G turns that into items of three kinds, so it cannot be gamed:

| Kind | Situation | Correct answer |
|---|---|---|
| MISSING | a condition gates a rule and the branches differ | `UNDETERMINED` |
| CONVERGENT | a condition is unstated, but a cap or floor makes both branches agree | the number |
| SPECIFIED | nothing is missing | the number |

Roughly two thirds are MISSING. A model that always answers `UNDETERMINED`
scores ~38% on a default run — worse than answering honestly — because it then
fails every convergent, specified and reasoning item.

Two rules the generator enforces, both learned the hard way:

- **The property is asserted, not assumed.** MISSING items must have branches
  that differ; CONVERGENT items must have branches that agree. G005 was refused
  until its floor actually bound in both branches.
- **The instructions must not prime.** An early draft told the model "some of
  these problems are not fully determined" and it then answered both probe items
  correctly. Priming it to look for a missing fact removes the very thing being
  measured, so G's wording is neutral and identical across all three kinds.

**Category G needs judged scoring.** A model that correctly reports the answer
is not determined phrases it in its own words, which the string scorer cannot
recognise.

## Scoring modes

| Mode | How correctness is decided | Reproducible without network |
|---|---|---|
| `deterministic` (default) | String match against the fixture answer, normalised for case and whitespace | Yes |
| `judged` (`--judge`) | Deterministic first; a judge panel is then asked about the misses only | Passing items yes, rescued items no |

The deterministic scorer normalises case and whitespace but not punctuation,
key style, or prose-vs-list phrasing, so a response that states exactly the
fixture's answer in its own words is scored wrong:

| Fixture | Response | Deterministic |
|---|---|---|
| `a: 8, b: 12, c: 20` | `A=8, B=12, C=20` | miss |
| `worker 1: task a (0-3), worker 2: task b (0-2)…` | same schedule, worker labels transposed | miss |

That measures answer formatting, and it penalises verbose models hardest. The
judge panel exists to remove that penalty **without** loosening the string
scorer for everyone.

Rules the panel operates under (`scoring/judge.ts`):

1. **Rescue-only** — judges see an item only if the deterministic scorer already
   marked it wrong, and can only flip wrong → right. A passing item never
   depends on a model call.
2. **Equivalence, not correctness** — the question is "does this state the same
   answer as the reference", never "is this a good answer".
3. **Final answer only** — judges never see the `working` array, so an answer
   that contradicts its own reasoning stays wrong.
4. **Unanimity** — every judge must agree; a split verdict leaves the miss
   standing and is recorded as split.
5. **Auditable** — every verdict and its one-line reason is written into the run
   JSON under `judging`, alongside the deterministic score for the same
   responses.

```bash
# default panel: one Claude + one GPT, neither of them the model under test
npx tsx run-intelligence.ts --model claude-opus-5 --judge

# or name your own
npx tsx run-intelligence.ts --model claude-opus-5 \
  --judge-model claude-opus-4-8@http://127.0.0.1:10010 \
  --judge-model gpt-5.6@http://127.0.0.1:9992
```

A judged run prints both numbers, and both are stored:

```
Judged scoring: 4 miss(es) rescued as equivalent, 0 split verdict(s) kept as misses
  Deterministic (string match only): IQ 89, 2/6 correct
  Judged:                            IQ 123, 6/6 correct
```

**Only compare like with like.** A judged score and a deterministic score are
different measurements; publishing them in one ranking without labelling the
mode makes the ranking meaningless.

### Re-scoring a stored run

A run record keeps every response verbatim, so a scoring fix can be applied to
runs that already happened without paying for the model again:

```bash
npx tsx tools/rescore-run.ts results/run.json --judge          # show the delta
npx tsx tools/rescore-run.ts results/run.json --judge --write  # rewrite the file
```

It prints the stored score next to the re-scored one. Submitting is opt-in
(`--submit --claim-code …`), and the board keeps the run id, so withdraw the
stale record first or the submit endpoint skips it as a duplicate.

### Calibrating the panel

`tools/validate-judge.ts` runs the panel over two populations: answers that
*should* be rescued (real formatting variants) and answers that must *not* be
(genuine misses, plus fabricated near-misses — one value changed, a dropped
task, a swapped assignment, one letter different).

```bash
npx tsx tools/validate-judge.ts [run.json]
```

Re-run it whenever the judge prompt, the panel, or a judge model changes. A
panel that stops rejecting the control cases will silently inflate every score
that follows.

## CLI usage

```bash
# Basic run (18 items, all categories)
npx tsx run-intelligence.ts --model claude-sonnet-4-20250514

# Specific categories, fewer items
npx tsx run-intelligence.ts --model gpt-5.4 --categories A,D,E --items-per-category 2

# Dry run (no API calls)
npx tsx run-intelligence.ts --dry-run --verbose

# Custom output path
npx tsx run-intelligence.ts --model claude-opus-5 --output results/opus-run.json

# Judged scoring (formatting-tolerant; see Scoring modes)
npx tsx run-intelligence.ts --model claude-opus-5 --judge

# Hard tiers only, three repeat runs, stacked
npx tsx run-intelligence.ts --model claude-opus-5 --tiers 4,5 --runs 3 --judge
```

### Flags

| Flag | Default | Description |
|---|---|---|
| `--model` | `claude-sonnet-4-20250514` | Model identifier |
| `--mode` | `closed_prompt_only` | Run mode |
| `--categories` | `A,B,C,D,E,F` | Comma-separated category filter |
| `--items-per-category` | one per selected tier | Items per category |
| `--tiers` | `2,3,4,5` | Difficulty tiers to draw from. `--tiers 1,2,3 --items-per-category 3` reproduces the original 18-item bank |
| `--runs` | `1` | Repeat the whole run N times and print the stack (per-run scores, mean, SD, SE, 95% CI). Three runs is the floor for comparing models |
| `--dry-run` | `false` | Skip API calls |
| `--verbose` | `false` | Print per-item details |
| `--output` | `results/intelligence-<id>.json` | Output file path |
| `--max-tokens` | 4096, or 16000 for models whose thinking is on by default | Output budget. `max_tokens` caps thinking *and* the answer, so a small budget can truncate the JSON on a thinking model |
| `--allow-truncated` | `false` | Submit even when items hit the output budget. Without it, a truncated run is scored and saved but not published |
| `--no-system-prompt` | `false` | Drop the harness system prompt (it restates the response contract already in the user turn). Needed on subscription backends that deliver it via the Claude CLI's `--append-system-prompt` — see the note in `run-intelligence.ts`. Declare it alongside any score |
| `--judge` | `false` | Score misses with the default judge panel (see Scoring modes) |
| `--judge-model` | — | Add a judge as `model@base`; repeatable |

## Anti-contamination

- Tasks use synthetic names and domains (no real-world knowledge)
- Variant families support rotation across runs
- Holdout pool for hidden validation items
- Task set hashing for reproducibility auditing
- Procedurally generated tasks reduce training contamination

## Directory structure

```
benchmarks/intelligence/
  run-intelligence.ts           # CLI harness
  README.md
  lib/
    types.ts                    # All type definitions
    irt.ts                      # 2PL/3PL IRT math
    chc.ts                      # CHC factor scoring
    iq-conversion.ts            # Theta-to-IQ conversion
    task-loader.ts              # Fixture I/O
    anti-contamination.ts       # Variant rotation, hashing
  fixtures/
    task-bank.json              # Master manifest
    categories/{A-F}/tier-{1-3}/*.json
    holdouts/
  scoring/
    item-scorer.ts              # Per-item scoring
    irt-estimator.ts            # Theta estimation pipeline
    chc-aggregator.ts           # Factor aggregation
    iq-reporter.ts              # Composite IQ report
    crux-integration.ts         # CruxFundamentals mapping
  tests/
  results/
```

## Integration with ScoreCrux

The benchmark maps its scores to ScoreCrux `CruxFundamentals` via `scoring/crux-integration.ts`, enabling cross-benchmark comparison with Top Floor and other ScoreCrux benchmarks.
