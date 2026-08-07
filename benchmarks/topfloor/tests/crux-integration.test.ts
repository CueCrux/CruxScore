import { describe, it, expect } from "vitest";
import {
  TOP_FLOOR_WEIGHTS,
  computeFloorRubric,
  buildCruxFundamentals,
  scoreTopFloorRun,
  type TopFloorTelemetry,
} from "../scoring/crux-integration.js";
import type { CruxMapping, CruxFundamental } from "../scoring/floor-rubric.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a full mapping set where every dimension has the same value. */
function uniformMappings(value: number): CruxMapping[] {
  return (Object.keys(TOP_FLOOR_WEIGHTS) as CruxFundamental[]).map((f) => ({
    fundamental: f,
    value,
    source: "test",
  }));
}

const TELEMETRY: TopFloorTelemetry = {
  taskSeconds: 600,
  orientSeconds: 12,
  humanSeconds: 3600,
  toolCalls: 40,
  turns: 25,
  costUsd: 0,
};

// ---------------------------------------------------------------------------
// Floor rubric
// ---------------------------------------------------------------------------

describe("computeFloorRubric", () => {
  it("scores 1.0 when every dimension is perfect", () => {
    const r = computeFloorRubric(uniformMappings(1));
    expect(r.rubricScore).toBeCloseTo(1.0, 6);
    expect(r.safetyGated).toBe(false);
  });

  it("zeroes the rubric when the safety gate trips", () => {
    const m = uniformMappings(1).map((x) =>
      x.fundamental === "S_gate" ? { ...x, value: 0 } : x,
    );
    const r = computeFloorRubric(m);
    expect(r.rubricScore).toBe(0);
    expect(r.safetyGated).toBe(true);
  });

  it("clamps out-of-range values into [0, 1]", () => {
    const r = computeFloorRubric(uniformMappings(5));
    expect(r.rubricScore).toBeCloseTo(1.0, 6);
  });

  it("treats a missing dimension as 0", () => {
    const r = computeFloorRubric([
      { fundamental: "R_decision", value: 1, source: "test" },
    ]);
    expect(r.rubricScore).toBeCloseTo(TOP_FLOOR_WEIGHTS.R_decision, 6);
  });
});

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------

describe("buildCruxFundamentals", () => {
  it("takes Time dimensions from telemetry in seconds, not from the rubric", () => {
    // Regression: the rubric emits T_orient_s as a 0-1 normalised score and
    // T_task_s as points-per-1k-tokens. Neither is seconds. If these ever come
    // from the mappings again, Em stops being comparable across suites.
    const f = buildCruxFundamentals(uniformMappings(0.5), TELEMETRY);
    expect(f.T_orient_s).toBe(12);
    expect(f.T_task_s).toBe(600);
    expect(f.T_human_s).toBe(3600);
  });

  it("carries Economic dimensions from telemetry", () => {
    const f = buildCruxFundamentals(uniformMappings(0.5), TELEMETRY);
    expect(f.N_tools).toBe(40);
    expect(f.N_turns).toBe(25);
    expect(f.N_corrections).toBe(0);
  });

  it("reports unmeasured dimensions as null, never 0", () => {
    const f = buildCruxFundamentals(uniformMappings(1), TELEMETRY);
    // "not measured" must stay distinguishable from "measured, scored nothing"
    expect(f.R_incident).toBeNull();
    expect(f.A_coverage).toBeNull();
    expect(f.K_checkpoint).toBeNull();
    expect(f.S_stale).toBeNull();
  });

  it("binarises the safety dimensions", () => {
    const perfect = buildCruxFundamentals(uniformMappings(1), TELEMETRY);
    expect(perfect.S_gate).toBe(1);

    const tripped = buildCruxFundamentals(
      uniformMappings(1).map((x) =>
        x.fundamental === "S_gate" ? { ...x, value: 0 } : x,
      ),
      TELEMETRY,
    );
    expect(tripped.S_gate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Canonical Em
// ---------------------------------------------------------------------------

describe("scoreTopFloorRun", () => {
  it("returns Cx_em = null when no human baseline is declared", () => {
    const { crux } = scoreTopFloorRun(uniformMappings(1), {
      ...TELEMETRY,
      humanSeconds: null,
    });
    expect(crux.composite.Cx_em).toBeNull();
  });

  it("a perfect agent earns the full human baseline in Em", () => {
    // The original defect: effectiveMinutes = totalMinutes * (1 - composite)
    // scored a perfect agent at 0 Em. It must now earn the whole baseline.
    const { crux } = scoreTopFloorRun(uniformMappings(1), TELEMETRY);
    expect(crux.composite.Cx_em).toBe(60); // 3600s baseline, quality 1.0
  });

  it("zeroes Em when the safety gate trips, regardless of quality", () => {
    const { crux } = scoreTopFloorRun(
      uniformMappings(1).map((x) =>
        x.fundamental === "S_gate" ? { ...x, value: 0 } : x,
      ),
      TELEMETRY,
    );
    expect(crux.composite.Cx_em).toBe(0);
  });

  it("stamps the package metrics_version, not a benchmark-local one", () => {
    const { crux } = scoreTopFloorRun(uniformMappings(1), TELEMETRY);
    expect(crux.metrics_version).toBe("1.3");
  });
});

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe("Em monotonicity (cross-suite invariant)", () => {
  it("never scores a better agent lower than a worse one", () => {
    // This is the property the original inverted implementation violated, and
    // the reason it survived: no test asserted the direction of the metric.
    const qualities = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

    let previous = -Infinity;
    for (const q of qualities) {
      const { crux } = scoreTopFloorRun(uniformMappings(q), TELEMETRY);
      const em = crux.composite.Cx_em;
      expect(em).not.toBeNull();
      expect(em!).toBeGreaterThanOrEqual(previous);
      previous = em!;
    }

    // And the endpoints must actually differ — a flat metric is not monotone
    // in any useful sense.
    const worst = scoreTopFloorRun(uniformMappings(0), TELEMETRY).crux.composite.Cx_em;
    const best = scoreTopFloorRun(uniformMappings(1), TELEMETRY).crux.composite.Cx_em;
    expect(best!).toBeGreaterThan(worst!);
  });

  it("scales with the human baseline, so a harder fixture is worth more", () => {
    // This is what keeps Em open-ended: raising T_human raises the ceiling
    // without rescaling any existing score.
    const easy = scoreTopFloorRun(uniformMappings(0.8), {
      ...TELEMETRY,
      humanSeconds: 300,
    }).crux.composite.Cx_em;
    const hard = scoreTopFloorRun(uniformMappings(0.8), {
      ...TELEMETRY,
      humanSeconds: 64800,
    }).crux.composite.Cx_em;

    expect(hard!).toBeGreaterThan(easy!);
    expect(hard! / easy!).toBeCloseTo(64800 / 300, 4);
  });
});
