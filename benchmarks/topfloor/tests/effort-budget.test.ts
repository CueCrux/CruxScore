import { describe, it, expect } from "vitest";
import {
  EffortLedger,
  EFFORT_ALLOWANCE,
  DEFAULT_FLOOR_SHARE,
  suggestedAllocation,
  ALLOCATE_EFFORT_TOOL,
} from "../lib/effort-budget.js";

describe("EffortLedger — declared effort", () => {
  it("takes its allowance from the declared tier", () => {
    expect(new EffortLedger("low").total).toBe(EFFORT_ALLOWANCE.low);
    expect(new EffortLedger("max").total).toBe(EFFORT_ALLOWANCE.max);
  });

  it("grants the default share when a floor is opened without an allocation", () => {
    const l = new EffortLedger("medium");
    const b = l.openFloor(1);
    expect(b.granted).toBe(Math.floor(EFFORT_ALLOWANCE.medium * DEFAULT_FLOOR_SHARE));
  });

  it("honours an explicit allocation over the default share", () => {
    const l = new EffortLedger("medium");
    l.allocate(1, 1000)
    expect(l.openFloor(1).granted).toBe(1000);
  });

  it("lets an agent hoard through easy floors for a hard one", () => {
    const l = new EffortLedger("high");
    l.allocate(1, 1_000)
    l.allocate(2, 1_000)
    l.openFloor(1)
    l.openFloor(2)
    // Nearly the whole allowance is still available for the hard floor.
    expect(l.unallocated).toBe(EFFORT_ALLOWANCE.high - 2_000);
  });

  it("refuses to conjure budget that does not exist", () => {
    const l = new EffortLedger("low");
    expect(() => l.allocate(1, EFFORT_ALLOWANCE.low + 1)).toThrow(/only .* remain/);
  });

  it("rejects nonsensical allocations rather than clamping", () => {
    const l = new EffortLedger("low");
    expect(() => l.allocate(1, -5)).toThrow(/non-negative/);
    expect(() => l.allocate(1, NaN)).toThrow(/non-negative/);
  });
});

describe("EffortLedger — spending", () => {
  it("tracks spend and flags overspend", () => {
    const l = new EffortLedger("low");
    l.allocate(1, 100)
    l.openFloor(1)
    expect(l.spend(1, 60).overspent).toBe(false);
    expect(l.spend(1, 60).overspent).toBe(true);
    expect(l.spent).toBe(120);
  });

  it("throws when spending on a floor that was never opened", () => {
    expect(() => new EffortLedger("low").spend(9, 10)).toThrow(/never opened/);
  });

  it("gives full credit within budget", () => {
    const l = new EffortLedger("low");
    l.allocate(1, 100)
    l.openFloor(1)
    l.spend(1, 100)
    expect(l.creditFor(1)).toBe(1);
  });

  it("degrades credit proportionally on overspend rather than zeroing it", () => {
    // One bad allocation should cost what it cost, not erase the climb.
    const l = new EffortLedger("low");
    l.allocate(1, 100)
    l.openFloor(1)
    l.spend(1, 200)
    expect(l.creditFor(1)).toBe(0.5);
  });

  it("gives full credit for an unopened floor", () => {
    expect(new EffortLedger("low").creditFor(42)).toBe(1);
  });
});

describe("EffortLedger — undeclared effort", () => {
  it("does not model effort as a resource at all", () => {
    // Assigning an allowance a run never agreed to would invent the constraint.
    const l = new EffortLedger(null);
    expect(l.enforced).toBe(false);
    expect(l.total).toBe(Infinity);
    expect(l.openFloor(1).granted).toBe(Infinity);
  });

  it("never flags overspend", () => {
    const l = new EffortLedger(null);
    l.openFloor(1)
    expect(l.spend(1, 10_000_000).overspent).toBe(false);
    expect(l.creditFor(1)).toBe(1);
  });

  it("reports a null total in the snapshot", () => {
    expect(new EffortLedger(null).snapshot().total).toBeNull();
  });
});

describe("suggestedAllocation", () => {
  it("offers budget in proportion to floor difficulty", () => {
    const l = new EffortLedger("high");
    // D4 (2h) against a remaining D2 (15m): D4 should get the large majority.
    const d4 = suggestedAllocation(l, "D4", ["D2"]);
    const d2 = suggestedAllocation(l, "D2", ["D4"]);
    expect(d4).toBeGreaterThan(d2);
    expect(d4 + d2).toBeLessThanOrEqual(l.total);
  });

  it("splits evenly between equal tiers", () => {
    const l = new EffortLedger("high");
    expect(suggestedAllocation(l, "D3", ["D3"])).toBe(Math.floor(l.total / 2));
  });

  it("is unbounded when effort is not enforced", () => {
    expect(suggestedAllocation(new EffortLedger(null), "D4", ["D2"])).toBe(Infinity);
  });
});

describe("snapshot", () => {
  it("publishes how the budget was actually used", () => {
    const l = new EffortLedger("medium");
    l.allocate(1, 500)
    l.openFloor(1)
    l.spend(1, 400)
    const s = l.snapshot();
    expect(s.effort_tier).toBe("medium");
    expect(s.total).toBe(EFFORT_ALLOWANCE.medium);
    expect(s.spent).toBe(400);
    expect(s.floors).toEqual([{ floor: 1, granted: 500, spent: 400, overspent: false }]);
  });

  it("returns copies, so a caller cannot rewrite the ledger", () => {
    const l = new EffortLedger("low");
    l.openFloor(1)
    l.snapshot().floors[0]!.spent = 999_999
    expect(l.spent).toBe(0);
  });
});

describe("ALLOCATE_EFFORT_TOOL", () => {
  it("declares the schema the orchestrator exposes", () => {
    expect(ALLOCATE_EFFORT_TOOL.name).toBe("allocate_effort");
    expect(ALLOCATE_EFFORT_TOOL.input_schema.required).toEqual(["floor", "tokens"]);
  });
});
