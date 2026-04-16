import { describe, it, expect } from "vitest";
import {
  loadManifest,
  loadTask,
  loadAllTasks,
  selectTaskSet,
  validateTask,
} from "../lib/task-loader.js";
import { hashTaskSet, applyVariantRotation, groupByVariantFamily } from "../lib/anti-contamination.js";
import type { IntelligenceTask } from "../lib/types.js";
import { join } from "node:path";

const FIXTURES_DIR = new URL("../fixtures", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// loadManifest
// ---------------------------------------------------------------------------

describe("loadManifest", () => {
  it("loads the task bank manifest", async () => {
    const manifest = await loadManifest(FIXTURES_DIR);
    expect(manifest.version).toBe("1.0");
    expect(manifest.totalTasks).toBe(18);
    expect(Object.keys(manifest.categories)).toHaveLength(6);
  });

  it("has correct category structure", async () => {
    const manifest = await loadManifest(FIXTURES_DIR);
    expect(manifest.categories.A.label).toBe("Deduction & Elimination");
    expect(manifest.categories.A.chcPrimary).toBe("Gf");
    expect(manifest.categories.B.chcPrimary).toBe("Gwm");
    expect(manifest.categories.C.chcPrimary).toBe("Gc");
  });
});

// ---------------------------------------------------------------------------
// loadTask
// ---------------------------------------------------------------------------

describe("loadTask", () => {
  it("loads a task by ID", async () => {
    const task = await loadTask("A001", FIXTURES_DIR);
    expect(task.taskId).toBe("A001");
    expect(task.category).toBe("A");
    expect(task.tier).toBe(1);
  });

  it("loads tasks from different categories", async () => {
    const tasks = await Promise.all([
      loadTask("A001", FIXTURES_DIR),
      loadTask("B001", FIXTURES_DIR),
      loadTask("C001", FIXTURES_DIR),
    ]);
    expect(tasks.map(t => t.category)).toEqual(["A", "B", "C"]);
  });

  it("throws for unknown task ID", async () => {
    await expect(loadTask("Z999", FIXTURES_DIR)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadAllTasks
// ---------------------------------------------------------------------------

describe("loadAllTasks", () => {
  it("loads all 18 seed tasks", async () => {
    const tasks = await loadAllTasks(FIXTURES_DIR);
    expect(tasks.length).toBe(18);
  });

  it("has 3 tasks per category", async () => {
    const tasks = await loadAllTasks(FIXTURES_DIR);
    const byCat = new Map<string, number>();
    for (const t of tasks) {
      byCat.set(t.category, (byCat.get(t.category) ?? 0) + 1);
    }
    for (const count of byCat.values()) {
      expect(count).toBe(3);
    }
  });

  it("all tasks have valid IRT parameters", async () => {
    const tasks = await loadAllTasks(FIXTURES_DIR);
    for (const t of tasks) {
      expect(t.irt.a).toBeGreaterThan(0);
      expect(t.irt.model).toBe("2PL");
    }
  });
});

// ---------------------------------------------------------------------------
// selectTaskSet
// ---------------------------------------------------------------------------

describe("selectTaskSet", () => {
  it("selects all 18 tasks with default config", async () => {
    const selected = await selectTaskSet({}, FIXTURES_DIR);
    expect(selected.length).toBe(18);
  });

  it("filters by category", async () => {
    const selected = await selectTaskSet(
      { categories: ["A", "B"] },
      FIXTURES_DIR,
    );
    expect(selected.length).toBe(6);
    expect(selected.every(t => t.category === "A" || t.category === "B")).toBe(true);
  });

  it("limits items per category", async () => {
    const selected = await selectTaskSet(
      { itemsPerCategory: 2 },
      FIXTURES_DIR,
    );
    expect(selected.length).toBe(12);
  });

  it("excludes specific task IDs", async () => {
    const selected = await selectTaskSet(
      { excludeTaskIds: ["A001", "B001"] },
      FIXTURES_DIR,
    );
    expect(selected.find(t => t.taskId === "A001")).toBeUndefined();
    expect(selected.find(t => t.taskId === "B001")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateTask
// ---------------------------------------------------------------------------

describe("validateTask", () => {
  it("returns no errors for a valid task", async () => {
    const task = await loadTask("A001", FIXTURES_DIR);
    const errors = validateTask(task);
    expect(errors).toHaveLength(0);
  });

  it("catches missing fields", () => {
    const bad = { taskId: "", category: "", statement: "" } as unknown as IntelligenceTask;
    const errors = validateTask(bad);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("validates all 18 seed tasks", async () => {
    const tasks = await loadAllTasks(FIXTURES_DIR);
    for (const task of tasks) {
      const errors = validateTask(task);
      expect(errors).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Anti-contamination
// ---------------------------------------------------------------------------

describe("hashTaskSet", () => {
  it("produces deterministic hash", () => {
    const h1 = hashTaskSet(["A001", "B001", "C001"]);
    const h2 = hashTaskSet(["A001", "B001", "C001"]);
    expect(h1).toBe(h2);
  });

  it("is order-independent", () => {
    const h1 = hashTaskSet(["C001", "A001", "B001"]);
    const h2 = hashTaskSet(["A001", "B001", "C001"]);
    expect(h1).toBe(h2);
  });

  it("changes with different task sets", () => {
    const h1 = hashTaskSet(["A001", "B001"]);
    const h2 = hashTaskSet(["A001", "C001"]);
    expect(h1).not.toBe(h2);
  });
});

describe("groupByVariantFamily", () => {
  it("groups tasks with same variantFamily", () => {
    const tasks = [
      { taskId: "A001", variantFamily: "A-group" } as IntelligenceTask,
      { taskId: "A001-v2", variantFamily: "A-group" } as IntelligenceTask,
      { taskId: "B001" } as IntelligenceTask,
    ];
    const groups = groupByVariantFamily(tasks);
    expect(groups.get("A-group")?.length).toBe(2);
    expect(groups.get("B001")?.length).toBe(1);
  });
});

describe("applyVariantRotation", () => {
  it("selects unused variants", () => {
    const tasks = [
      { taskId: "A001", variantFamily: "A-group" } as IntelligenceTask,
      { taskId: "A001-v2", variantFamily: "A-group" } as IntelligenceTask,
    ];
    const used = new Set(["A001"]);
    const selected = applyVariantRotation(tasks, used);
    expect(selected.length).toBe(1);
    expect(selected[0].taskId).toBe("A001-v2");
  });

  it("falls back to first variant if all used", () => {
    const tasks = [
      { taskId: "A001", variantFamily: "A-group" } as IntelligenceTask,
    ];
    const used = new Set(["A001"]);
    const selected = applyVariantRotation(tasks, used);
    expect(selected[0].taskId).toBe("A001");
  });
});
