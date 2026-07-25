// ScoreCrux Intelligence Benchmark — Task Loader
//
// Loads task bank manifest and individual task packets from fixtures/.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  IntelligenceTask,
  TaskBankManifest,
  ReasoningCategory,
  DifficultyTier,
} from "./types.js";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));
const CATEGORIES_DIR = join(FIXTURES_DIR, "categories");

const CATEGORY_DIRS: Record<ReasoningCategory, string> = {
  A: "A-deduction",
  B: "B-stateful",
  C: "C-rule-application",
  D: "D-causal",
  E: "E-abstraction",
  F: "F-planning",
  G: "G-evidence",
};

const TIER_DIRS: Record<DifficultyTier, string> = {
  1: "tier-1",
  2: "tier-2",
  3: "tier-3",
  4: "tier-4",
  5: "tier-5",
};

export const ALL_TIERS: DifficultyTier[] = [1, 2, 3, 4, 5];

/**
 * Tiers used when a run does not name any.
 *
 * Only the hard tiers. Measured 2026-07-24/25: claude-opus-5 scored 23/24 on
 * tiers 2-5 of the reasoning categories, so tiers 1-3 spend calls confirming
 * that a frontier model can still do arithmetic while contributing nothing to
 * discrimination — and a near-sweep pushes the IRT extrapolation to absurdity
 * (one such run scored IQ 179). They remain available with an explicit
 * `--tiers 1,2,3` for comparability with older runs.
 */
export const DEFAULT_TIERS: DifficultyTier[] = [4, 5];

/**
 * Per-category item counts for a default run. The reasoning categories give
 * one item per selected tier; category G supplies its whole family, because
 * the evidence-sufficiency items are what carry the discrimination and the
 * mix of undetermined/convergent/specified only works whole.
 */
export const DEFAULT_ITEMS_PER_CATEGORY: Partial<Record<ReasoningCategory, number>> = { G: 99 };

/**
 * Load the task bank manifest.
 */
export async function loadManifest(
  fixturesDir: string = FIXTURES_DIR,
): Promise<TaskBankManifest> {
  const raw = await readFile(join(fixturesDir, "task-bank.json"), "utf-8");
  return JSON.parse(raw) as TaskBankManifest;
}

/**
 * Load a single task by ID (e.g. "A001").
 */
export async function loadTask(
  taskId: string,
  fixturesDir: string = FIXTURES_DIR,
): Promise<IntelligenceTask> {
  const category = taskId[0] as ReasoningCategory;
  const catDir = CATEGORY_DIRS[category];
  if (!catDir) throw new Error(`Unknown category in taskId: ${taskId}`);

  const categoriesDir = join(fixturesDir, "categories");

  // Search across tiers for the task file
  for (const tier of ALL_TIERS) {
    const tierDir = TIER_DIRS[tier];
    const filePath = join(categoriesDir, catDir, tierDir, `${taskId}.json`);
    try {
      const raw = await readFile(filePath, "utf-8");
      return JSON.parse(raw) as IntelligenceTask;
    } catch {
      // Not in this tier, try next
    }
  }

  throw new Error(`Task not found: ${taskId}`);
}

/**
 * Load all tasks from the fixtures directory.
 */
export async function loadAllTasks(
  fixturesDir: string = FIXTURES_DIR,
): Promise<IntelligenceTask[]> {
  const tasks: IntelligenceTask[] = [];
  const categoriesDir = join(fixturesDir, "categories");

  for (const [, catDir] of Object.entries(CATEGORY_DIRS)) {
    for (const [, tierDir] of Object.entries(TIER_DIRS)) {
      const dir = join(categoriesDir, catDir, tierDir);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const raw = await readFile(join(dir, file), "utf-8");
        tasks.push(JSON.parse(raw) as IntelligenceTask);
      }
    }
  }

  return tasks;
}

/**
 * Task selection configuration.
 */
export interface TaskSelectionConfig {
  /** Categories to include (default: all). */
  categories?: ReasoningCategory[];
  /**
   * Items per category. A number applies to every category; a map overrides
   * named categories and leaves the rest at one per selected tier.
   */
  itemsPerCategory?: number | Partial<Record<ReasoningCategory, number>>;
  /** Difficulty tiers to draw from (default: DEFAULT_TIERS). */
  tiers?: DifficultyTier[];
  /** Preferred difficulty distribution. If null, select evenly across tiers. */
  tierDistribution?: Partial<Record<DifficultyTier, number>>;
  /** Exclude holdout items (default: true). */
  excludeHoldouts?: boolean;
  /** Exclude specific task IDs. */
  excludeTaskIds?: string[];
}

/**
 * Select a task set for a benchmark run.
 */
export async function selectTaskSet(
  config: TaskSelectionConfig = {},
  fixturesDir: string = FIXTURES_DIR,
): Promise<IntelligenceTask[]> {
  const {
    categories = ["A", "B", "C", "D", "E", "F", "G"] as ReasoningCategory[],
    tiers = DEFAULT_TIERS,
    itemsPerCategory = DEFAULT_ITEMS_PER_CATEGORY,
    excludeHoldouts = true,
    excludeTaskIds = [],
  } = config;

  const allTasks = await loadAllTasks(fixturesDir);

  const selected: IntelligenceTask[] = [];

  for (const cat of categories) {
    let catTasks = allTasks.filter(t => t.category === cat && tiers.includes(t.tier));

    if (excludeHoldouts) {
      catTasks = catTasks.filter(t => !t.isHoldout);
    }

    if (excludeTaskIds.length > 0) {
      catTasks = catTasks.filter(t => !excludeTaskIds.includes(t.taskId));
    }

    // Sort by tier for even distribution
    catTasks.sort((a, b) => a.tier - b.tier);

    const limit =
      typeof itemsPerCategory === "number"
        ? itemsPerCategory
        : itemsPerCategory[cat] ?? tiers.length;
    selected.push(...catTasks.slice(0, limit));
  }

  return selected;
}

/**
 * Validate a task against basic schema requirements.
 * Returns a list of errors (empty = valid).
 */
export function validateTask(task: IntelligenceTask): string[] {
  const errors: string[] = [];

  if (!task.taskId) errors.push("taskId is required");
  if (!task.category) errors.push("category is required");
  if (!task.statement) errors.push("statement is required");
  if (!task.correctAnswer) errors.push("correctAnswer is required");
  if (!task.irt) errors.push("irt is required");
  if (task.irt && (task.irt.a <= 0)) errors.push("irt.a must be positive");
  if (!task.answerType) errors.push("answerType is required");
  if (!task.scoringWeights) errors.push("scoringWeights is required");

  if (task.scoringWeights) {
    const sum =
      task.scoringWeights.correctness +
      task.scoringWeights.traceConsistency +
      task.scoringWeights.constraintAdherence +
      task.scoringWeights.outputCompliance;
    if (Math.abs(sum - 1.0) > 0.01) {
      errors.push(`scoringWeights must sum to 1.0, got ${sum}`);
    }
  }

  return errors;
}
