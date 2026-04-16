// ScoreCrux Intelligence Benchmark — Task Loader
//
// Loads task bank manifest and individual task packets from fixtures/.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  IntelligenceTask,
  TaskBankManifest,
  ReasoningCategory,
  DifficultyTier,
} from "./types.js";

const FIXTURES_DIR = new URL("../fixtures", import.meta.url).pathname;
const CATEGORIES_DIR = join(FIXTURES_DIR, "categories");

const CATEGORY_DIRS: Record<ReasoningCategory, string> = {
  A: "A-deduction",
  B: "B-stateful",
  C: "C-rule-application",
  D: "D-causal",
  E: "E-abstraction",
  F: "F-planning",
};

const TIER_DIRS: Record<DifficultyTier, string> = {
  1: "tier-1",
  2: "tier-2",
  3: "tier-3",
};

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
  for (const tier of [1, 2, 3] as DifficultyTier[]) {
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
  /** Number of items per category (default: 3). */
  itemsPerCategory?: number;
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
    categories = ["A", "B", "C", "D", "E", "F"] as ReasoningCategory[],
    itemsPerCategory = 3,
    excludeHoldouts = true,
    excludeTaskIds = [],
  } = config;

  const allTasks = await loadAllTasks(fixturesDir);

  const selected: IntelligenceTask[] = [];

  for (const cat of categories) {
    let catTasks = allTasks.filter(t => t.category === cat);

    if (excludeHoldouts) {
      catTasks = catTasks.filter(t => !t.isHoldout);
    }

    if (excludeTaskIds.length > 0) {
      catTasks = catTasks.filter(t => !excludeTaskIds.includes(t.taskId));
    }

    // Sort by tier for even distribution
    catTasks.sort((a, b) => a.tier - b.tier);

    // Take up to itemsPerCategory
    selected.push(...catTasks.slice(0, itemsPerCategory));
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
