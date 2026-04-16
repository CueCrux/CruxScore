// ScoreCrux Intelligence Benchmark — IQ Reporter
//
// Assembles the complete IntelligenceScore from item scores,
// including composite IQ-equivalent with confidence interval.

import type {
  ItemScore,
  CHCFactorScore,
  CategoryScore,
  CompositeIQ,
  IntelligenceScore,
  NormTable,
} from "../lib/types.js";
import { DEFAULT_NORM } from "../lib/types.js";
import { computeCategoryScores, computeFactorAggregates } from "./chc-aggregator.js";
import { estimateAbility } from "./irt-estimator.js";
import { thetaToIQ, iqConfidenceInterval, iqToPercentile, iqClassification } from "../lib/iq-conversion.js";

/**
 * Compute the composite IQ from factor scores.
 * Uses item-count-weighted average of per-factor IQ equivalents.
 */
export function computeCompositeIQ(
  factorScores: CHCFactorScore[],
  overallTheta: { theta: number; se: number },
  norm: NormTable = DEFAULT_NORM,
): CompositeIQ {
  if (factorScores.length === 0) {
    return {
      fullScaleIQ: 100,
      confidenceInterval: { lower: 70, upper: 130, level: 0.95 },
      percentile: 50,
      classification: "Average",
    };
  }

  // Use overall theta for composite IQ (more stable than averaging factor IQs)
  const iq = thetaToIQ(overallTheta.theta, norm);
  const ci = iqConfidenceInterval(iq, overallTheta.se, norm, 0.95);

  return {
    fullScaleIQ: Math.round(iq),
    confidenceInterval: {
      lower: ci.lower,
      upper: ci.upper,
      level: 0.95,
    },
    percentile: iqToPercentile(Math.round(iq)),
    classification: iqClassification(Math.round(iq)),
  };
}

/**
 * Generate the complete intelligence score report.
 */
export function generateReport(
  itemScores: ItemScore[],
  norm: NormTable = DEFAULT_NORM,
): IntelligenceScore {
  const categoryScores = computeCategoryScores(itemScores);
  const factorScores = computeFactorAggregates(itemScores, norm);
  const overallTheta = estimateAbility(itemScores);
  const compositeIQ = computeCompositeIQ(factorScores, overallTheta, norm);

  return {
    itemScores,
    categoryScores,
    factorScores,
    compositeIQ,
  };
}
