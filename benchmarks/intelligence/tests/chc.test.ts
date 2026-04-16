import { describe, it, expect } from "vitest";
import { groupByFactor, computeFactorScores, getFactorMapping } from "../lib/chc.js";
import type { ItemScore } from "../lib/types.js";
import type { IRTParameters } from "../lib/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItemScore(overrides: Partial<ItemScore> & { taskId: string }): ItemScore {
  return {
    category: "A",
    chcFactor: "Gf",
    chcPrimaryWeight: 1.0,
    tier: 1,
    correct: true,
    partialCredit: 1.0,
    weightedScore: 0.7,
    traceConsistencyScore: 1.0,
    constraintAdherenceScore: 1.0,
    outputComplianceScore: 1.0,
    irt: { model: "2PL", a: 1.0, b: 0.0, c: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// groupByFactor()
// ---------------------------------------------------------------------------

describe("groupByFactor", () => {
  it("groups items by primary CHC factor", () => {
    const items: ItemScore[] = [
      makeItemScore({ taskId: "A001", category: "A", chcFactor: "Gf" }),
      makeItemScore({ taskId: "B001", category: "B", chcFactor: "Gwm" }),
      makeItemScore({ taskId: "D001", category: "D", chcFactor: "Gf" }),
    ];

    const groups = groupByFactor(items);
    expect(groups.get("Gf")?.length).toBe(2);
    expect(groups.get("Gwm")?.length).toBe(1);
    expect(groups.has("Gc")).toBe(false);
  });

  it("handles cross-loading (secondary factor)", () => {
    const items: ItemScore[] = [
      makeItemScore({
        taskId: "C001",
        category: "C",
        chcFactor: "Gc",
        chcSecondaryFactor: "Gf",
        chcPrimaryWeight: 0.6,
        chcSecondaryWeight: 0.4,
      }),
    ];

    const groups = groupByFactor(items);
    expect(groups.get("Gc")?.length).toBe(1);
    expect(groups.get("Gf")?.length).toBe(1);
    expect(groups.get("Gc")![0].weight).toBe(0.6);
    expect(groups.get("Gf")![0].weight).toBe(0.4);
  });

  it("returns empty map for empty input", () => {
    const groups = groupByFactor([]);
    expect(groups.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeFactorScores()
// ---------------------------------------------------------------------------

describe("computeFactorScores", () => {
  it("produces scores for each factor present", () => {
    const items: ItemScore[] = [
      makeItemScore({ taskId: "A001", chcFactor: "Gf", correct: true, irt: { model: "2PL", a: 1.0, b: -1.0, c: 0 } }),
      makeItemScore({ taskId: "A002", chcFactor: "Gf", correct: true, irt: { model: "2PL", a: 1.0, b: 0.0, c: 0 } }),
      makeItemScore({ taskId: "A003", chcFactor: "Gf", correct: false, irt: { model: "2PL", a: 1.0, b: 1.5, c: 0 } }),
      makeItemScore({ taskId: "B001", chcFactor: "Gwm", correct: true, irt: { model: "2PL", a: 1.0, b: -0.5, c: 0 } }),
      makeItemScore({ taskId: "B002", chcFactor: "Gwm", correct: false, irt: { model: "2PL", a: 1.0, b: 0.5, c: 0 } }),
    ];

    const scores = computeFactorScores(items);
    expect(scores.length).toBe(2);

    const gf = scores.find(s => s.factor === "Gf");
    const gwm = scores.find(s => s.factor === "Gwm");
    expect(gf).toBeDefined();
    expect(gwm).toBeDefined();
    expect(gf!.itemCount).toBe(3);
    expect(gwm!.itemCount).toBe(2);
  });

  it("produces IQ-equivalent within plausible range", () => {
    const items: ItemScore[] = [
      makeItemScore({ taskId: "A001", chcFactor: "Gf", correct: true, irt: { model: "2PL", a: 1.0, b: -1.0, c: 0 } }),
      makeItemScore({ taskId: "A002", chcFactor: "Gf", correct: true, irt: { model: "2PL", a: 1.0, b: 0.0, c: 0 } }),
      makeItemScore({ taskId: "A003", chcFactor: "Gf", correct: false, irt: { model: "2PL", a: 1.0, b: 1.5, c: 0 } }),
    ];

    const scores = computeFactorScores(items);
    const gf = scores.find(s => s.factor === "Gf")!;
    // IQ should be in a reasonable range (50-150)
    expect(gf.iqEquivalent).toBeGreaterThan(50);
    expect(gf.iqEquivalent).toBeLessThan(150);
    expect(gf.confidenceInterval.lower).toBeLessThan(gf.iqEquivalent);
    expect(gf.confidenceInterval.upper).toBeGreaterThan(gf.iqEquivalent);
  });

  it("returns sorted results by factor name", () => {
    const items: ItemScore[] = [
      makeItemScore({ taskId: "B001", chcFactor: "Gwm", correct: true, irt: { model: "2PL", a: 1.0, b: 0.0, c: 0 } }),
      makeItemScore({ taskId: "B002", chcFactor: "Gwm", correct: false, irt: { model: "2PL", a: 1.0, b: 1.0, c: 0 } }),
      makeItemScore({ taskId: "A001", chcFactor: "Gf", correct: true, irt: { model: "2PL", a: 1.0, b: 0.0, c: 0 } }),
      makeItemScore({ taskId: "A002", chcFactor: "Gf", correct: false, irt: { model: "2PL", a: 1.0, b: 1.0, c: 0 } }),
    ];

    const scores = computeFactorScores(items);
    expect(scores[0].factor).toBe("Gf");
    expect(scores[1].factor).toBe("Gwm");
  });
});

// ---------------------------------------------------------------------------
// getFactorMapping()
// ---------------------------------------------------------------------------

describe("getFactorMapping", () => {
  it("returns the mapping for category A", () => {
    const mapping = getFactorMapping("A");
    expect(mapping?.primaryFactor).toBe("Gf");
    expect(mapping?.primaryWeight).toBe(1.0);
  });

  it("returns cross-loading for category C", () => {
    const mapping = getFactorMapping("C");
    expect(mapping?.primaryFactor).toBe("Gc");
    expect(mapping?.secondaryFactor).toBe("Gf");
    expect(mapping?.primaryWeight).toBe(0.6);
    expect(mapping?.secondaryWeight).toBe(0.4);
  });

  it("returns undefined for unknown category", () => {
    expect(getFactorMapping("Z")).toBeUndefined();
  });
});
