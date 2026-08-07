import { describe, it, expect } from "vitest";
import { computeCruxScore } from "../src/score.js";
import { SPEC_EXAMPLE, ALL_NULL, UNSAFE_SESSION } from "./fixtures.js";

describe("computeCruxScore", () => {
  it("returns metrics_version 1.3", () => {
    const result = computeCruxScore(SPEC_EXAMPLE);
    expect(result.metrics_version).toBe("1.3");
  });

  it("includes fundamentals passthrough", () => {
    const result = computeCruxScore(SPEC_EXAMPLE);
    expect(result.fundamentals).toBe(SPEC_EXAMPLE);
  });

  it("computes derived metrics", () => {
    const result = computeCruxScore(SPEC_EXAMPLE);
    expect(result.derived.Q_info).toBeCloseTo(0.9583, 3);
    expect(result.derived.Q_context).toBeCloseTo(0.72, 3);
    expect(result.derived.Q_continuity).toBeCloseTo(0.88, 3);
    expect(result.derived.Q_safety).toBeCloseTo(1.0, 3);
    expect(result.derived.V_time).toBeCloseTo(1800 / 156.3, 1);
    expect(result.derived.V_orient).toBeCloseTo(4.2 / 156.3, 3);
    expect(result.derived.Q_abstention).toBeNull();
    expect(result.derived.V_retrieval).toBeNull();
  });

  it("computes composite Crux Score", () => {
    const result = computeCruxScore(SPEC_EXAMPLE);
    expect(result.composite.Cx_em).not.toBeNull();
    expect(result.composite.Cx_em!).toBeGreaterThan(20);
    expect(result.composite.Cx_em!).toBeLessThan(30);
    expect(result.composite.S_gate).toBe(1);
  });

  it("returns zero for unsafe session", () => {
    const result = computeCruxScore(UNSAFE_SESSION);
    expect(result.composite.Cx_em).toBe(0);
    expect(result.composite.S_gate).toBe(0);
  });

  it("handles all-null gracefully", () => {
    const result = computeCruxScore(ALL_NULL);
    expect(result.composite.Cx_em).toBeNull();
    expect(result.derived.Q_info).toBeNull();
    expect(result.derived.Q_context).toBeNull();
    expect(result.derived.Q_continuity).toBeNull();
    expect(result.derived.Q_safety).toBeNull();
    expect(result.derived.V_time).toBeNull();
    expect(result.derived.V_cost).toBeNull();
    expect(result.derived.V_orient).toBeNull();
    expect(result.derived.Q_abstention).toBeNull();
    expect(result.derived.V_retrieval).toBeNull();
  });

  it("accepts custom weights", () => {
    const defaultResult = computeCruxScore(SPEC_EXAMPLE);
    const customResult = computeCruxScore(SPEC_EXAMPLE, { w1: 1, w2: 1, w3: 1 });
    expect(customResult.composite.Cx_em).not.toEqual(defaultResult.composite.Cx_em);
    expect(customResult.composite.weights).toEqual({ w1: 1, w2: 1, w3: 1 });
  });

  it("ungated metadata excludes S_detect from Q_safety", () => {
    const withDetectZero = { ...SPEC_EXAMPLE, S_detect: 0 as const };
    const gatedResult = computeCruxScore(withDetectZero);
    const ungatedResult = computeCruxScore(withDetectZero, undefined, { safety_context: "ungated" });
    // Gated: S_detect=0 → Q_safety = (0 + 1.0) / 2 = 0.5
    // Ungated: S_detect excluded → Q_safety = S_stale = 1.0
    expect(gatedResult.derived.Q_safety).toBeCloseTo(0.5, 3);
    expect(ungatedResult.derived.Q_safety).toBeCloseTo(1.0, 3);
    expect(ungatedResult.metadata?.safety_context).toBe("ungated");
  });

  it("ungated still scores zero when S_gate = 0", () => {
    const result = computeCruxScore(UNSAFE_SESSION, undefined, { safety_context: "ungated" });
    expect(result.composite.Cx_em).toBe(0);
  });

  it("includes metadata in output", () => {
    const result = computeCruxScore(SPEC_EXAMPLE, undefined, {
      safety_context: "gated",
      drift_category: "prompt-drift",
    });
    expect(result.metadata).toEqual({
      safety_context: "gated",
      drift_category: "prompt-drift",
    });
  });
});
