// ScoreCrux Intelligence Benchmark — CHC Aggregator
//
// Aggregates item scores into CHC factor scores and category scores.

import type {
  ItemScore,
  CHCFactorScore,
  CategoryScore,
  ReasoningCategory,
} from "../lib/types.js";
import { CATEGORY_LABELS } from "../lib/types.js";
import { computeFactorScores } from "../lib/chc.js";
import type { NormTable } from "../lib/types.js";
import { DEFAULT_NORM } from "../lib/types.js";

/**
 * Compute per-category aggregate scores.
 */
export function computeCategoryScores(itemScores: ItemScore[]): CategoryScore[] {
  const byCategory = new Map<ReasoningCategory, ItemScore[]>();

  for (const item of itemScores) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  const results: CategoryScore[] = [];

  for (const [category, items] of byCategory) {
    const correctCount = items.filter(i => i.correct).length;
    const totalWeighted = items.reduce((s, i) => s + i.weightedScore, 0);

    results.push({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      itemCount: items.length,
      correctCount,
      accuracy: items.length > 0 ? correctCount / items.length : 0,
      weightedScore: items.length > 0 ? totalWeighted / items.length : 0,
    });
  }

  results.sort((a, b) => a.category.localeCompare(b.category));
  return results;
}

/**
 * Compute CHC factor scores from item scores.
 */
export function computeFactorAggregates(
  itemScores: ItemScore[],
  norm?: NormTable,
): CHCFactorScore[] {
  return computeFactorScores(itemScores, norm);
}
