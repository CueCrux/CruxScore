// ScoreCrux Intelligence Benchmark — CruxFundamentals Integration
//
// Maps intelligence benchmark scores to the ScoreCrux CruxFundamentals
// for cross-benchmark comparison.

import type { IntelligenceScore } from "../lib/types.js";

/** Subset of CruxFundamentals relevant to the intelligence benchmark. */
export interface IntelligenceCruxMapping {
  fundamental: string;
  value: number;
  weight: number;
}

/** Intelligence benchmark custom weights. Must sum to 1.0. */
export const INTELLIGENCE_WEIGHTS: Record<string, number> = {
  R_decision: 0.25,       // Overall accuracy (correctness)
  R_constraint: 0.10,     // Constraint adherence
  P_context: 0.15,        // Trace consistency (reasoning quality)
  R_completeness: 0.15,   // Partial credit / completeness
  I_provenance: 0.10,     // Working step quality
  I_premise_rejection: 0.05, // Not directly measured, placeholder
  S_detect: 0.05,         // Output compliance (format correctness)
  T_task_s: 0.05,         // Latency efficiency
  K_synthesis: 0.10,      // Cross-category consistency
};

// Sanity check at module load
const weightSum = Object.values(INTELLIGENCE_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(weightSum - 1.0) > 0.001) {
  throw new Error(`INTELLIGENCE_WEIGHTS sum to ${weightSum}, expected 1.0`);
}

/**
 * Map intelligence score to CruxFundamentals values.
 */
export function mapToCruxFundamentals(
  score: IntelligenceScore,
  totalLatencyMs: number = 0,
): IntelligenceCruxMapping[] {
  const { categoryScores, itemScores } = score;

  // R_decision: overall accuracy across all items
  const totalItems = itemScores.length;
  const correctItems = itemScores.filter(i => i.correct).length;
  const accuracy = totalItems > 0 ? correctItems / totalItems : 0;

  // R_constraint: average constraint adherence
  const avgConstraint = totalItems > 0
    ? itemScores.reduce((s, i) => s + i.constraintAdherenceScore, 0) / totalItems
    : 0;

  // P_context: average trace consistency
  const avgTrace = totalItems > 0
    ? itemScores.reduce((s, i) => s + i.traceConsistencyScore, 0) / totalItems
    : 0;

  // R_completeness: average partial credit
  const avgPartial = totalItems > 0
    ? itemScores.reduce((s, i) => s + i.partialCredit, 0) / totalItems
    : 0;

  // I_provenance: average weighted score (composite quality)
  const avgWeighted = totalItems > 0
    ? itemScores.reduce((s, i) => s + i.weightedScore, 0) / totalItems
    : 0;

  // S_detect: average output compliance
  const avgCompliance = totalItems > 0
    ? itemScores.reduce((s, i) => s + i.outputComplianceScore, 0) / totalItems
    : 0;

  // T_task_s: normalize latency (lower is better; cap at 1.0 for <60s per item)
  const avgLatencyS = totalItems > 0 ? (totalLatencyMs / 1000) / totalItems : 0;
  const latencyScore = Math.max(0, Math.min(1, 1 - avgLatencyS / 60));

  // K_synthesis: cross-category consistency (std dev of category accuracies)
  const catAccuracies = categoryScores.map(c => c.accuracy);
  const meanAcc = catAccuracies.length > 0
    ? catAccuracies.reduce((s, a) => s + a, 0) / catAccuracies.length
    : 0;
  const variance = catAccuracies.length > 0
    ? catAccuracies.reduce((s, a) => s + (a - meanAcc) ** 2, 0) / catAccuracies.length
    : 0;
  // Higher consistency = lower variance = higher score
  const consistencyScore = Math.max(0, 1 - Math.sqrt(variance));

  return [
    { fundamental: "R_decision", value: accuracy, weight: INTELLIGENCE_WEIGHTS.R_decision },
    { fundamental: "R_constraint", value: avgConstraint, weight: INTELLIGENCE_WEIGHTS.R_constraint },
    { fundamental: "P_context", value: avgTrace, weight: INTELLIGENCE_WEIGHTS.P_context },
    { fundamental: "R_completeness", value: avgPartial, weight: INTELLIGENCE_WEIGHTS.R_completeness },
    { fundamental: "I_provenance", value: avgWeighted, weight: INTELLIGENCE_WEIGHTS.I_provenance },
    { fundamental: "I_premise_rejection", value: 0, weight: INTELLIGENCE_WEIGHTS.I_premise_rejection },
    { fundamental: "S_detect", value: avgCompliance, weight: INTELLIGENCE_WEIGHTS.S_detect },
    { fundamental: "T_task_s", value: latencyScore, weight: INTELLIGENCE_WEIGHTS.T_task_s },
    { fundamental: "K_synthesis", value: consistencyScore, weight: INTELLIGENCE_WEIGHTS.K_synthesis },
  ];
}

/**
 * Compute the weighted CruxScore composite from intelligence mappings.
 */
export function computeIntelligenceCruxComposite(
  mappings: IntelligenceCruxMapping[],
): number {
  return mappings.reduce((s, m) => s + m.value * m.weight, 0);
}
