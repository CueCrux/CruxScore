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
    // 1.2 = 36 items across 7 categories (G added 2026-07-25). Scores are not
    // comparable across bank versions, so these numbers are load-bearing.
    expect(manifest.version).toBe("1.2");
    expect(manifest.totalTasks).toBe(36);
    expect(Object.keys(manifest.categories)).toHaveLength(7);
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
  it("loads all 36 bank items (A-F x 5 tiers, plus 6 in category G)", async () => {
    const tasks = await loadAllTasks(FIXTURES_DIR);
    expect(tasks.length).toBe(36);
  });

  it("has 5 tasks per reasoning category; G carries 6 across its two hard tiers", async () => {
    const tasks = await loadAllTasks(FIXTURES_DIR);
    const byCat = new Map<string, number>();
    for (const t of tasks) {
      byCat.set(t.category, (byCat.get(t.category) ?? 0) + 1);
    }
    for (const [cat, count] of byCat) {
      // G is the evidence-sufficiency family: 3 items each at tiers 4 and 5,
      // mixing undetermined, convergent and fully-specified cases.
      expect(count).toBe(cat === "G" ? 6 : 5);
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
  it("selects 28 items by default — tiers 2-5 across A-F, plus 4 from G", async () => {
    const selected = await selectTaskSet({}, FIXTURES_DIR);
    expect(selected.length).toBe(28);
    // Tier 1 is excluded by default: every current model passes it, so it
    // costs a call and contributes no information.
    expect(selected.some(t => t.tier === 1)).toBe(false);
    expect(selected.some(t => t.tier === 5)).toBe(true);
  });

  it("selects only the requested tiers", async () => {
    const hard = await selectTaskSet({ tiers: [4, 5] }, FIXTURES_DIR);
    expect(hard.length).toBe(14);   // 2 each from A-F, 2 from G
    expect(hard.every(t => t.tier === 4 || t.tier === 5)).toBe(true);
  });

  it("honours the legacy tier-1-to-3 selection for comparability with old runs", async () => {
    const legacy = await selectTaskSet({ tiers: [1, 2, 3], itemsPerCategory: 3 }, FIXTURES_DIR);
    expect(legacy.length).toBe(18);
    expect(legacy.every(t => t.tier <= 3)).toBe(true);
  });

  it("filters by category", async () => {
    const selected = await selectTaskSet(
      { categories: ["A", "B"] },
      FIXTURES_DIR,
    );
    expect(selected.length).toBe(8);
    expect(selected.every(t => t.category === "A" || t.category === "B")).toBe(true);
  });

  it("limits items per category", async () => {
    const selected = await selectTaskSet(
      { itemsPerCategory: 2 },
      FIXTURES_DIR,
    );
    expect(selected.length).toBe(14);   // 2 from each of the 7 categories
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

  it("validates every item in the bank", async () => {
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
