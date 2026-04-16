// ScoreCrux Intelligence Benchmark — IRT Estimator
//
// Full theta estimation pipeline from scored item responses.

import type { ItemScore, ThetaEstimate } from "../lib/types.js";
import { estimateTheta, type ItemResponse } from "../lib/irt.js";

/**
 * Estimate overall ability from a set of item scores.
 */
export function estimateAbility(itemScores: ItemScore[]): ThetaEstimate {
  const responses: ItemResponse[] = itemScores.map(item => ({
    correct: item.correct,
    irt: item.irt,
  }));

  return estimateTheta(responses);
}

/**
 * Estimate ability for a subset of items (e.g., one category or factor).
 */
export function estimateSubsetAbility(
  itemScores: ItemScore[],
  filter: (item: ItemScore) => boolean,
): ThetaEstimate {
  const subset = itemScores.filter(filter);
  return estimateAbility(subset);
}
