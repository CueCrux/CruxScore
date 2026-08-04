/**
 * ScoreCrux integration — Top Floor.
 *
 * Two distinct things live here, and conflating them was the original defect:
 *
 * 1. The **floor rubric** — Top Floor's own 0-1 quality score over its 16
 *    weighted dimensions. Benchmark-local, never comparable across suites.
 * 2. **Effective Minutes (Em)** — the canonical ScoreCrux composite. Computed by
 *    the package (`src/composite.ts`), never re-derived here.
 *
 * Previously this module defined its own `effectiveMinutes` as
 * `totalMinutes * (1 - composite)`, which inverted the metric (a perfect agent
 * scored 0 Em) and anchored it on agent wall-clock rather than T_human. It was
 * also always exactly 0 in practice because the only call site never passed
 * `totalMinutes`. Em now comes from `computeCruxScore` and nowhere else.
 */

import { computeCruxScore } from "../../../src/index.js";
import type { CruxFundamentals, CruxScore } from "../../../src/index.js";
import type { CruxMapping, CruxFundamental } from "./floor-rubric.js";

// ---------------------------------------------------------------------------
// Floor rubric weights
// ---------------------------------------------------------------------------

/**
 * Top Floor rubric weights over its 16 dimensions. Must sum to 1.0.
 *
 * These weight the *floor rubric*, not the Crux composite. The composite's
 * weights are v1.0-locked in the package (METRICS.md §3.1); changing these
 * cannot and does not affect Em.
 *
 * - K_decision elevated to 0.15 (memory wipe recovery is the headline metric)
 * - P_context elevated to 0.10 (needle-in-haystack is core to every floor)
 */
export const TOP_FLOOR_WEIGHTS: Record<CruxFundamental, number> = {
  T_orient_s: 0.05,
  T_task_s: 0.05,
  T_first_s: 0.03,
  R_decision: 0.12,
  R_constraint: 0.06,
  R_completeness: 0.06,
  P_context: 0.10,
  P_noise: 0.05,
  K_decision: 0.15,
  K_causal: 0.06,
  K_synthesis: 0.06,
  K_temporal: 0.05,
  S_gate: 0.06,
  S_detect: 0.04,
  I_provenance: 0.03,
  I_premise_rejection: 0.03,
};

// Sanity check at module load
const weightSum = Object.values(TOP_FLOOR_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(weightSum - 1.0) > 0.001) {
  throw new Error(`TOP_FLOOR_WEIGHTS sum to ${weightSum}, expected 1.0`);
}

// ---------------------------------------------------------------------------
// Floor rubric
// ---------------------------------------------------------------------------

export interface FloorRubricResult {
  /** Weighted rubric score (0-1). Benchmark-local — NOT Effective Minutes. */
  rubricScore: number;
  /** Per-dimension breakdown */
  breakdown: Array<{
    fundamental: CruxFundamental;
    raw: number;
    weight: number;
    weighted: number;
  }>;
  /** Whether the safety gate zeroed the rubric */
  safetyGated: boolean;
}

/**
 * Compute Top Floor's own rubric score from its dimension mappings.
 *
 * Safety gate: if S_gate = 0, the rubric is zeroed — matching the package's
 * treatment of Cx_em, so the two never disagree about an unsafe run.
 */
export function computeFloorRubric(mappings: CruxMapping[]): FloorRubricResult {
  const valueMap = new Map<CruxFundamental, number>();
  for (const m of mappings) {
    valueMap.set(m.fundamental, m.value);
  }

  const safetyGated = valueMap.get("S_gate") === 0;

  const breakdown: FloorRubricResult["breakdown"] = [];
  let rubricScore = 0;

  for (const [fundamental, weight] of Object.entries(TOP_FLOOR_WEIGHTS) as Array<
    [CruxFundamental, number]
  >) {
    const raw = valueMap.get(fundamental) ?? 0;
    // Clamp raw to [0, 1] for ratio metrics (times may exceed 1)
    const clamped = Math.max(0, Math.min(1, raw));
    const weighted = clamped * weight;

    breakdown.push({ fundamental, raw, weight, weighted });
    rubricScore += weighted;
  }

  if (safetyGated) {
    rubricScore = 0;
  }

  return { rubricScore, breakdown, safetyGated };
}

// ---------------------------------------------------------------------------
// Canonical fundamentals
// ---------------------------------------------------------------------------

/** Run telemetry needed to populate the Time and Economic dimensions. */
export interface TopFloorTelemetry {
  /** Total wall-clock across all floors, in seconds. */
  taskSeconds: number;
  /** Seconds to the agent's first substantive action. Null if not captured. */
  orientSeconds: number | null;
  /**
   * Human baseline for the floors attempted, in seconds. Supplied by the
   * difficulty-tier ladder. Null until a tier is declared — the package
   * correctly returns `Cx_em: null` rather than inventing a number.
   */
  humanSeconds: number | null;
  /** Total tool calls across all floors. */
  toolCalls: number;
  /** Total model turns across all floors. */
  turns: number;
  /**
   * Measured token spend in USD. The orchestrator does not yet estimate cost
   * per model (`lib/orchestrator.ts` — "cost estimation TBD per model"), so
   * this is 0 for now. It feeds V_cost only, never Cx_em.
   */
  costUsd: number;
}

/**
 * Build canonical `CruxFundamentals` from Top Floor's rubric mappings plus run
 * telemetry.
 *
 * The rubric mappings supply the 0-1 quality ratios, which are already
 * dimensionally correct. The Time and Economic dimensions come from telemetry —
 * the rubric's `T_orient_s` and `T_task_s` are normalised scores, not seconds,
 * and using them as fundamentals is what made Top Floor Em non-comparable.
 *
 * Dimensions Top Floor does not measure are `null`, never zero: the package
 * averages over non-null components, so a null is "not measured" while a zero
 * is "measured, scored nothing".
 */
export function buildCruxFundamentals(
  mappings: CruxMapping[],
  telemetry: TopFloorTelemetry,
): CruxFundamentals {
  const v = (f: CruxFundamental): number | null => {
    const found = mappings.find((m) => m.fundamental === f);
    return found ? found.value : null;
  };

  const sGate = v("S_gate");
  const sDetect = v("S_detect");

  return {
    // Time — from telemetry, in seconds
    T_orient_s: telemetry.orientSeconds,
    T_task_s: telemetry.taskSeconds,
    T_human_s: telemetry.humanSeconds,

    // Information
    R_decision: v("R_decision"),
    R_constraint: v("R_constraint"),
    R_incident: null, // no incident-reference fixtures in Top Floor
    P_context: v("P_context"),
    A_coverage: null, // abstention not scored
    I_provenance: v("I_provenance"),
    I_premise_rejection: v("I_premise_rejection"),

    // Continuity
    K_decision: v("K_decision"),
    K_causal: v("K_causal"),
    K_checkpoint: null, // no checkpoint probe
    K_synthesis: v("K_synthesis"),

    // Safety — S_gate/S_detect are binary in the package
    S_gate: sGate === null ? null : sGate >= 0.5 ? 1 : 0,
    S_detect: sDetect === null ? null : sDetect >= 0.5 ? 1 : 0,
    S_stale: null, // staleness not probed

    // Economic
    C_tokens_usd: telemetry.costUsd,
    N_tools: telemetry.toolCalls,
    N_turns: telemetry.turns,
    N_corrections: 0, // no operator in the loop during a Top Floor run
  };
}

/**
 * Score a Top Floor run: the benchmark-local rubric plus the canonical Crux
 * Score, computed by the package.
 */
export function scoreTopFloorRun(
  mappings: CruxMapping[],
  telemetry: TopFloorTelemetry,
): { rubric: FloorRubricResult; crux: CruxScore } {
  const rubric = computeFloorRubric(mappings);
  const fundamentals = buildCruxFundamentals(mappings, telemetry);
  const crux = computeCruxScore(fundamentals);
  return { rubric, crux };
}
