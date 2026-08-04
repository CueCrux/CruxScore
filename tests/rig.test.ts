import { describe, it, expect } from "vitest";
import {
  EFFORT_TIERS,
  isEffortTier,
  VENDOR_NATIVE,
  rigKey,
  baselineKey,
  computeLift,
  ARM_TO_BACKEND,
  backendForArm,
  type Rig,
  type RigResult,
} from "../src/rig.js";

const rig = (
  model: string,
  memory_backend: string,
  effort_tier: Rig["effort_tier"] = "high",
): Rig => ({ model, memory_backend, effort_tier });

describe("isEffortTier", () => {
  it("accepts every declared tier", () => {
    for (const t of EFFORT_TIERS) expect(isEffortTier(t)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isEffortTier("extreme")).toBe(false);
    expect(isEffortTier("")).toBe(false);
    expect(isEffortTier(null)).toBe(false);
    expect(isEffortTier(3)).toBe(false);
    expect(isEffortTier(undefined)).toBe(false);
  });
});

describe("rigKey", () => {
  it("distinguishes rigs on every axis", () => {
    const base = rig("opus-5", "crux", "high");
    expect(rigKey(base)).not.toBe(rigKey(rig("fable-5", "crux", "high")));
    expect(rigKey(base)).not.toBe(rigKey(rig("opus-5", "none", "high")));
    expect(rigKey(base)).not.toBe(rigKey(rig("opus-5", "crux", "low")));
  });

  it("is stable for equal rigs", () => {
    expect(rigKey(rig("opus-5", "crux", "max"))).toBe(rigKey(rig("opus-5", "crux", "max")));
  });

  it("keys unknown effort separately rather than folding it into a tier", () => {
    // Historical runs have no declared effort. They must not silently join the
    // "low" bucket and distort that tier's numbers.
    const unknown = rigKey(rig("opus-5", "crux", null));
    expect(unknown).toContain("unknown");
    for (const t of EFFORT_TIERS) {
      expect(unknown).not.toBe(rigKey(rig("opus-5", "crux", t)));
    }
  });
});

describe("baselineKey", () => {
  it("swaps the backend for vendor-native, holding model and effort", () => {
    expect(baselineKey(rig("opus-5", "crux", "high"))).toBe(
      rigKey(rig("opus-5", VENDOR_NATIVE, "high")),
    );
  });
});

describe("computeLift", () => {
  const population: RigResult[] = [
    { rig: rig("opus-5", VENDOR_NATIVE, "high"), Cx_em: 100 },
    { rig: rig("opus-5", "crux", "high"), Cx_em: 138 },
    { rig: rig("opus-5", "crux", "low"), Cx_em: 60 },
    { rig: rig("fable-5", "crux", "high"), Cx_em: 90 },
    { rig: rig("opus-5", VENDOR_NATIVE, "low"), Cx_em: null },
  ];

  it("returns the delta against the matched baseline", () => {
    expect(computeLift(rig("opus-5", "crux", "high"), 138, population)).toBe(38);
  });

  it("reports a negative lift when the memory system hurts", () => {
    // A memory system that costs more than it returns must be visible as such.
    expect(computeLift(rig("opus-5", "crux", "high"), 80, population)).toBe(-20);
  });

  it("returns null for the baseline itself", () => {
    expect(computeLift(rig("opus-5", VENDOR_NATIVE, "high"), 100, population)).toBeNull();
  });

  it("returns null when no baseline exists for that model", () => {
    // fable-5 has no vendor-native row — not comparable, not zero lift.
    expect(computeLift(rig("fable-5", "crux", "high"), 90, population)).toBeNull();
  });

  it("returns null when the baseline exists at a different effort", () => {
    // opus-5 vendor-native exists at high, but a max-effort rig must not borrow it.
    expect(computeLift(rig("opus-5", "crux", "max"), 150, population)).toBeNull();
  });

  it("returns null when the baseline's Em is null", () => {
    expect(computeLift(rig("opus-5", "crux", "low"), 60, population)).toBeNull();
  });

  it("returns null when the rig's own Em is null", () => {
    expect(computeLift(rig("opus-5", "crux", "high"), null, population)).toBeNull();
  });

  it("returns null against an empty population", () => {
    expect(computeLift(rig("opus-5", "crux", "high"), 138, [])).toBeNull();
  });
});

describe("backendForArm", () => {
  it("maps every known Top Floor arm", () => {
    expect(backendForArm("C0")).toBe("none");
    expect(backendForArm("T1")).toBe("none");
    expect(backendForArm("T2")).toBe("crux");
    expect(backendForArm("T3")).toBe("crux");
    expect(Object.keys(ARM_TO_BACKEND)).toHaveLength(4);
  });

  it("returns null for an unrecognised arm rather than guessing", () => {
    expect(backendForArm("T9")).toBeNull();
    expect(backendForArm("")).toBeNull();
  });
});
