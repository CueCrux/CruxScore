// ScoreCrux Intelligence Benchmark — Anti-Contamination
//
// Task rotation, variant selection, holdout management, and task set hashing.

import { createHash } from "node:crypto";
import type { IntelligenceTask } from "./types.js";

/**
 * Select a variant from a family that hasn't been used in previous runs.
 * Returns the selected task, or the first task if all have been used.
 */
export function selectVariant(
  familyTasks: IntelligenceTask[],
  usedTaskIds: Set<string>,
): IntelligenceTask {
  const unused = familyTasks.filter(t => !usedTaskIds.has(t.taskId));
  if (unused.length > 0) return unused[0];
  return familyTasks[0];
}

/**
 * Group tasks by variant family.
 * Tasks without a variantFamily are each their own group.
 */
export function groupByVariantFamily(
  tasks: IntelligenceTask[],
): Map<string, IntelligenceTask[]> {
  const families = new Map<string, IntelligenceTask[]>();

  for (const task of tasks) {
    const key = task.variantFamily ?? task.taskId;
    if (!families.has(key)) families.set(key, []);
    families.get(key)!.push(task);
  }

  return families;
}

/**
 * Produce a deterministic SHA-256 hash of a task set for reproducibility auditing.
 */
export function hashTaskSet(taskIds: string[]): string {
  const sorted = [...taskIds].sort();
  const payload = sorted.join(",");
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Filter tasks to exclude holdout items.
 */
export function filterHoldouts(
  tasks: IntelligenceTask[],
  includeHoldouts: boolean = false,
): IntelligenceTask[] {
  if (includeHoldouts) return tasks;
  return tasks.filter(t => !t.isHoldout);
}

/**
 * Apply variant rotation: for each variant family, select one variant
 * that hasn't been used before.
 */
export function applyVariantRotation(
  tasks: IntelligenceTask[],
  usedTaskIds: Set<string> = new Set(),
): IntelligenceTask[] {
  const families = groupByVariantFamily(tasks);
  const selected: IntelligenceTask[] = [];

  for (const [, familyTasks] of families) {
    selected.push(selectVariant(familyTasks, usedTaskIds));
  }

  return selected;
}
