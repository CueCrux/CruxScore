import { describe, it, expect } from "vitest";
import { computeDerived, YIELD_ACCURACY_FLOOR } from "../src/derived.js";
import type { CruxFundamentals } from "../src/types.js";

/** Fundamentals with a given information quality and cost. */
function rig(qInfo: number, cost: number): CruxFundamentals {
  return {
    T_orient_s: 1, T_task_s: 10, T_human_s: 600,
    // Q_info averages the non-null information components, so setting them all
    // to the same value makes Q_info exactly that value.
    R_decision: qInfo, R_constraint: qInfo, R_incident: null,
    P_context: qInfo, A_coverage: null,
    K_decision: null, K_causal: null, K_checkpoint: null,
    S_gate: 1, S_detect: null, S_stale: null,
    C_tokens_usd: cost, N_tools: 0, N_turns: 1, N_corrections: 0,
  };
}

describe("V_yield — accuracy and cost in one number", () => {
  it("rewards the accurate rig over the cheap-but-wrong one", () => {
    // The exact inversion V_cost gets wrong: on V_cost the bad rig scores
    // 0.200 against 1.053 and "wins". V_yield must not reproduce that.
    const good = computeDerived(rig(0.95, 1.0));
    const bad = computeDerived(rig(0.10, 0.02));
    expect(bad.V_yield).toBeNull();
    expect(good.V_yield).toBeCloseTo(0.95, 5);

    // V_cost still ranks the bad one better — documenting why V5 exists.
    expect(bad.V_cost!).toBeLessThan(good.V_cost!);
  });

  it("is null below the accuracy floor, not merely small", () => {
    // "Ineligible" and "inefficient" are different claims.
    expect(computeDerived(rig(YIELD_ACCURACY_FLOOR - 0.001, 1)).V_yield).toBeNull();
    expect(computeDerived(rig(YIELD_ACCURACY_FLOOR, 1)).V_yield).not.toBeNull();
  });

  it("falls as cost rises at equal accuracy", () => {
    // The probe's actual shape: 19/20 at every tier, cost 0.65 -> 0.69 -> 2.43.
    const cheap = computeDerived(rig(0.95, 0.647)).V_yield!;
    const mid = computeDerived(rig(0.95, 0.687)).V_yield!;
    const dear = computeDerived(rig(0.95, 2.428)).V_yield!;
    expect(cheap).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(dear);
    expect(cheap / dear).toBeCloseTo(2.428 / 0.647, 3);
  });

  it("rises with accuracy at equal cost", () => {
    expect(computeDerived(rig(1.0, 1)).V_yield!)
      .toBeGreaterThan(computeDerived(rig(0.8, 1)).V_yield!);
  });

  it("is null when nothing was spent, rather than infinite", () => {
    // Yield per dollar is undefined at zero dollars. A subscription run that
    // records no cost must not top the efficiency board.
    expect(computeDerived(rig(1.0, 0)).V_yield).toBeNull();
  });

  it("is null when Q_info could not be computed", () => {
    const f = rig(0.95, 1);
    f.R_decision = null; f.R_constraint = null; f.P_context = null;
    expect(computeDerived(f).Q_info).toBeNull();
    expect(computeDerived(f).V_yield).toBeNull();
  });
});
