import { describe, expect, it } from "vitest";
import { loadAllTasks, loadManifest } from "../lib/task-loader.js";

const FIXTURES_DIR = new URL("../fixtures", import.meta.url).pathname;

const MISSING_IDS = [
  "G001",
  "G004",
  "G007",
  "G008",
  "G009",
  "G010",
  "G011",
  "G012",
  "G013",
  "G014",
  "G015",
];

const CONTROL_ANSWERS: Record<string, string> = {
  G002: "36.00",
  G003: "43.20",
  G005: "110.00",
  G006: "57.75",
  G016: "74.00",
};

const NEUTRAL_CONSTRAINTS = [
  "Apply the rules exactly as written",
  "Answer with the total to two decimal places",
];

describe("task bank fixture contract", () => {
  it("keeps manifest category and tier counts aligned with the fixture corpus", async () => {
    const [manifest, tasks] = await Promise.all([
      loadManifest(FIXTURES_DIR),
      loadAllTasks(FIXTURES_DIR),
    ]);
    const taskIds = tasks.map(task => task.taskId);

    expect(tasks).toHaveLength(manifest.totalTasks);
    expect(new Set(taskIds).size).toBe(taskIds.length);

    for (const [category, entry] of Object.entries(manifest.categories)) {
      const categoryTasks = tasks.filter(task => task.category === category);
      const actualTiers = categoryTasks.reduce<Record<string, number>>((counts, task) => {
        counts[task.tier] = (counts[task.tier] ?? 0) + 1;
        return counts;
      }, {});

      expect(categoryTasks, `${category} task count`).toHaveLength(entry.taskCount);
      expect(actualTiers, `${category} tier composition`).toEqual(entry.tiers);
    }
  });
});

describe("category G evidence-sufficiency contract", () => {
  it("preserves the discriminating and anti-gaming composition", async () => {
    const tasks = (await loadAllTasks(FIXTURES_DIR))
      .filter(task => task.category === "G")
      .sort((a, b) => a.taskId.localeCompare(b.taskId));
    const missing = tasks.filter(task => task.correctAnswer === "UNDETERMINED");
    const controls = tasks.filter(task => task.correctAnswer !== "UNDETERMINED");

    expect(missing.map(task => task.taskId)).toEqual(MISSING_IDS);
    expect(Object.fromEntries(
      controls.map(task => [task.taskId, task.correctAnswer]),
    )).toEqual(CONTROL_ANSWERS);
    expect(tasks.filter(task => task.tier === 4)).toHaveLength(7);
    expect(tasks.filter(task => task.tier === 5)).toHaveLength(9);
  });

  it("keeps instructions neutral and answer variants confined to missing cases", async () => {
    const tasks = (await loadAllTasks(FIXTURES_DIR))
      .filter(task => task.category === "G");

    for (const task of tasks) {
      expect(task.constraints, task.taskId).toEqual(NEUTRAL_CONSTRAINTS);
      expect(task.constraints.join(" "), task.taskId).not.toMatch(
        /missing|undetermined|insufficient/i,
      );

      if (task.correctAnswer === "UNDETERMINED") {
        expect(task.acceptableVariants, task.taskId).toEqual([
          "undetermined",
          "cannot be determined",
          "insufficient information",
          "not determinable",
          "cannot be computed",
        ]);
      } else {
        expect(task.acceptableVariants, task.taskId).toEqual([]);
      }
    }
  });
});
