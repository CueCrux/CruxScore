// Convenience entry point — METRICS.md full computation in one call.

import type { CruxFundamentals, CruxWeights, CruxScore, CruxRunMetadata } from "./types.js";
import { computeDerived } from "./derived.js";
import { computeComposite } from "./composite.js";

/**
 * Compute the full Crux Score from fundamentals.
 *
 * This is the main entry point. Provide the core fundamentals plus any
 * versioned extensions you measure and receive the complete ScoreCrux
 * object with fundamentals, derived metrics, and composite score.
 *
 * @param fundamentals - The core fundamentals and any versioned extensions from your benchmark run.
 * @param weights - Optional custom weights for Q_combined. Defaults to v1.0 (3, 2, 2).
 * @param metadata - Optional run metadata. If metadata.safety_context is "ungated",
 *   S_detect is excluded from Q_safety (no constraint tools were available).
 * @returns Complete ScoreCrux result.
 */
export function computeCruxScore(
  fundamentals: CruxFundamentals,
  weights?: CruxWeights,
  metadata?: CruxRunMetadata,
): CruxScore {
  const derived = computeDerived(fundamentals, metadata?.safety_context);
  const composite = computeComposite(fundamentals, derived, weights);

  return {
    metrics_version: "1.2",
    fundamentals,
    derived,
    composite,
    metadata,
  };
}
