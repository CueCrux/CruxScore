# ScoreCrux Intelligence Benchmark

A psychometric intelligence benchmark for AI models, built on Item Response Theory (IRT) with Cattell-Horn-Carroll (CHC) cognitive factor mapping and IQ-equivalent composite scoring.

## What it measures

The benchmark tests **reasoning** — the ability to transform inputs into correct conclusions when all required information is in the task. It does not reward factual recall, retrieval, web access, or memorised benchmark answers.

Six reasoning categories map to four CHC broad cognitive factors:

| Category | Label | CHC Factor | Description |
|---|---|---|---|
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

## Run modes

| Mode | Tools | Internet | Memory |
|---|---|---|---|
| `closed_prompt_only` | None | No | No |
| `local_tooling` | Local execution | No | No |
| `open_tooling` | Tools + web | Yes | Optional |
| `custom_harness` | Entrant-declared | Declared | Declared |

Results must always declare the run mode. Different modes are not directly comparable.

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
```

### Flags

| Flag | Default | Description |
|---|---|---|
| `--model` | `claude-sonnet-4-20250514` | Model identifier |
| `--mode` | `closed_prompt_only` | Run mode |
| `--categories` | `A,B,C,D,E,F` | Comma-separated category filter |
| `--items-per-category` | `3` | Items per category |
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
