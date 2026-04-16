// ScoreCrux Intelligence Benchmark — CHC Factor Scoring
//
// Groups item scores by CHC cognitive factor and estimates
// per-factor ability (theta).

import type { CHCFactor, ItemScore, CHCFactorScore } from "./types.js";
import { CHC_FACTOR_LABELS, CHC_FACTOR_MAP } from "./types.js";
import { estimateTheta, type ItemResponse } from "./irt.js";
import { thetaToIQ, iqConfidenceInterval } from "./iq-conversion.js";
import type { NormTable } from "./types.js";
import { DEFAULT_NORM } from "./types.js";

/** A weighted item contribution to a single CHC factor. */
interface FactorItem {
  taskId: string;
  correct: boolean;
  partialCredit: number;
  irt: ItemScore["irt"];
  weight: number;
}

/**
 * Group item scores by CHC factor, handling cross-loading.
 * Items that load on two factors contribute to both with their declared weights.
 */
export function groupByFactor(itemScores: ItemScore[]): Map<CHCFactor, FactorItem[]> {
  const groups = new Map<CHCFactor, FactorItem[]>();

  for (const item of itemScores) {
    // Primary factor
    if (!groups.has(item.chcFactor)) groups.set(item.chcFactor, []);
    groups.get(item.chcFactor)!.push({
      taskId: item.taskId,
      correct: item.correct,
      partialCredit: item.partialCredit,
      irt: item.irt,
      weight: item.chcPrimaryWeight,
    });

    // Secondary factor (cross-loading)
    if (item.chcSecondaryFactor && item.chcSecondaryWeight) {
      if (!groups.has(item.chcSecondaryFactor)) groups.set(item.chcSecondaryFactor, []);
      groups.get(item.chcSecondaryFactor)!.push({
        taskId: item.taskId,
        correct: item.correct,
        partialCredit: item.partialCredit,
        irt: item.irt,
        weight: item.chcSecondaryWeight,
      });
    }
  }

  return groups;
}

/**
 * Compute per-factor CHC scores with IQ equivalents.
 */
export function computeFactorScores(
  itemScores: ItemScore[],
  norm: NormTable = DEFAULT_NORM,
): CHCFactorScore[] {
  const groups = groupByFactor(itemScores);
  const results: CHCFactorScore[] = [];

  for (const [factor, items] of groups) {
    // Build IRT response vector for theta estimation
    const responses: ItemResponse[] = items.map(item => ({
      correct: item.correct,
      irt: item.irt,
    }));

    const theta = estimateTheta(responses);
    const iq = thetaToIQ(theta.theta, norm);
    const ci = iqConfidenceInterval(iq, theta.se, norm, 0.95);

    results.push({
      factor,
      factorLabel: CHC_FACTOR_LABELS[factor],
      theta,
      itemCount: items.length,
      iqEquivalent: iq,
      confidenceInterval: {
        lower: ci.lower,
        upper: ci.upper,
        level: 0.95,
      },
      itemBreakdown: items.map(i => ({
        taskId: i.taskId,
        correct: i.correct,
        partialCredit: i.partialCredit,
      })),
    });
  }

  // Sort by factor name for deterministic output
  results.sort((a, b) => a.factor.localeCompare(b.factor));

  return results;
}

/**
 * Get the canonical CHC factor mapping for a reasoning category.
 */
export function getFactorMapping(category: string) {
  return CHC_FACTOR_MAP.find(m => m.category === category);
}
