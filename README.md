# ScoreCrux

Agent Effectiveness Metric Standard -- measure AI agent sessions in **Effective Minutes**.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What is ScoreCrux?

ScoreCrux is a universal metric framework for measuring how effectively AI agents maintain and use context across work sessions. Instead of abstract scores, it measures **Effective Minutes (Em)** -- quality-adjusted minutes of expert work replaced by the agent, gated on safety.

An agent that produces a perfect design document but ignores a constraint that would have prevented a production incident scores **zero**. Safety is a gate, not a gradient.

The package computes the canonical ScoreCrux core metrics: foundational fundamentals across 5 categories (Time, Information, Continuity, Safety, Economic), 7 derived metrics, and 1 composite score. Versioned extension fields may be supplied when your benchmark measures them. See [METRICS.md](METRICS.md) for the canonical library specification.

## Installation

```bash
npm install scorecrux
```

## Quick Start

```typescript
import { computeCruxScore } from "scorecrux";

const result = computeCruxScore({
  // Time
  T_orient_s: 4.2,
  T_task_s: 156.3,
  T_human_s: 1800,

  // Information
  R_decision: 0.875,
  R_constraint: 1.0,
  R_incident: 1,
  P_context: 0.72,
  A_coverage: 0.0,

  // Continuity
  K_decision: 0.88,
  K_causal: null,
  K_checkpoint: null,

  // Safety
  S_gate: 1,
  S_detect: 1,
  S_stale: 1.0,

  // Economic
  C_tokens_usd: 0.024,
  N_tools: 8,
  N_turns: 14,
  N_corrections: 0,
});

console.log(result.composite.Cx_em);
// => 26.04 Em (this agent session replaced ~26 minutes of expert work)
```

Later-version extension fields such as `R_temporal`, `R_retrieval`, `R_proposition`, or `K_synthesis` are optional. Omit them if your benchmark does not measure them yet.

## API

### `computeCruxScore(fundamentals, weights?)`

Main entry point. Computes the full Crux Score from fundamental measurements.

- **`fundamentals`**: `CruxFundamentals` -- the core fundamentals from your benchmark run, plus any versioned extensions you measure
- **`weights`**: `CruxWeights` (optional) -- custom weights for Q_combined. Defaults to v1.0 locked weights `{ w1: 3, w2: 2, w3: 2 }`
- **Returns**: `CruxScore` with `metrics_version`, `fundamentals`, `derived`, and `composite`

### `computeDerived(fundamentals)`

Compute the 7 derived metrics from fundamentals. Use this if you need derived metrics without the composite.

### `computeComposite(fundamentals, derived, weights?)`

Compute the Crux Score composite from fundamentals and derived metrics. Use this for custom pipelines where you compute derived metrics separately.

### Types

- **`CruxFundamentals`** -- core fundamentals plus optional versioned extensions
- **`CruxDerived`** -- 7 derived metrics (4 Quality + 3 Efficiency)
- **`CruxComposite`** -- Crux Score in Effective Minutes + weights + safety gate
- **`CruxScore`** -- Complete output (fundamentals + derived + composite)
- **`CruxWeights`** -- Weight configuration `{ w1, w2, w3 }`
- **`DEFAULT_WEIGHTS`** -- v1.0 locked weights: `{ w1: 3, w2: 2, w3: 2 }`

## Interpreting the Score

| Cx Value | Meaning |
|----------|---------|
| **0 Em** | Unsafe session. Agent took a destructive action. |
| **< 1 Em** | Low quality or trivial task. |
| **1--10 Em** | Routine task completed with reasonable quality. |
| **10--60 Em** | Significant task. 10-60 minutes of expert work replaced. |
| **> 60 Em** | Complex task. 1+ hours of expert work replaced. |

## For Benchmark Authors

ScoreCrux accepts pre-computed fundamentals -- you are responsible for measuring them from your benchmark runs. Here's what each dimension means and how to populate it:

**Time**: Instrument your harness to record orient time (first substantive action), task duration, and estimate the human baseline per fixture.

**Information**: Compare agent output against expected decision keys, constraint keywords, and incident references from your fixture's ground truth.

**Continuity**: Test session kill + restart scenarios. Measure what decisions survive the boundary.

**Safety**: Check whether the agent took any destructive actions and whether it used constraint-checking tools before acting.

**Economic**: Record token costs from your LLM provider, count tool calls and turns.

Dimensions you can't measure for a given run should be set to `null`. ScoreCrux handles partial data gracefully -- derived metrics average over non-null components, and the composite adjusts its denominator.

## Specification

The canonical library metric specification is in [METRICS.md](METRICS.md). It defines:

- Core fundamentals and versioned extensions with SI-compatible units
- 7 derived metrics with explicit formulas
- The Crux Score composite formula
- Null handling rules
- Reporting standard (JSON schema)
- Immutability rules (v1.0 definitions are locked)
- Extension protocol for adding new metrics

## License

[MIT](LICENSE)
