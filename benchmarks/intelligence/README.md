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

## CLI usage

```bash
# Basic run (18 items, all categories)
npx tsx run-intelligence.ts --model claude-sonnet-4-20250514

# Specific categories, fewer items
npx tsx run-intelligence.ts --model gpt-5.4 --categories A,D,E --items-per-category 2

# Dry run (no API calls)
npx tsx run-intelligence.ts --dry-run --verbose

# Custom output path
npx tsx run-intelligence.ts --model claude-opus-4-20250514 --output results/opus-run.json
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
