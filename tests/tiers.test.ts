import { describe, it, expect } from "vitest";
import {
  TIER_ANCHORS_S,
  HIGHEST_ANCHORED_TIER,
  TIER_RATIO,
  isDifficultyTier,
  tierIndex,
  tierToHumanSeconds,
  deriveTier,
} from "../src/tiers.js";

describe("isDifficultyTier", () => {
  it("accepts well-formed tiers", () => {
    expect(isDifficultyTier("D1")).toBe(true);
    expect(isDifficultyTier("D6")).toBe(true);
    expect(isDifficultyTier("D12")).toBe(true);
  });

  it("rejects malformed tiers", () => {
    expect(isDifficultyTier("D0")).toBe(false);
    expect(isDifficultyTier("D")).toBe(false);
    expect(isDifficultyTier("4")).toBe(false);
    expect(isDifficultyTier("d4")).toBe(false);
    expect(isDifficultyTier("D4x")).toBe(false);
    expect(isDifficultyTier("D04")).toBe(false);
  });
});

describe("tierIndex", () => {
  it("extracts the numeric index", () => {
    expect(tierIndex("D1")).toBe(1);
    expect(tierIndex("D9")).toBe(9);
    expect(tierIndex("D10")).toBe(10);
  });

  it("throws on a malformed tier rather than guessing", () => {
    expect(() => tierIndex("D0")).toThrow(/Malformed difficulty tier/);
    expect(() => tierIndex("nonsense")).toThrow(/Malformed difficulty tier/);
  });
});

describe("tierToHumanSeconds", () => {
  it("returns the published anchor for every anchored tier", () => {
    expect(tierToHumanSeconds("D1")).toBe(300);
    expect(tierToHumanSeconds("D2")).toBe(900);
    expect(tierToHumanSeconds("D3")).toBe(2700);
    expect(tierToHumanSeconds("D4")).toBe(7200);
    expect(tierToHumanSeconds("D5")).toBe(21600);
    expect(tierToHumanSeconds("D6")).toBe(64800);
  });

  it("is total over the anchor table", () => {
    for (const [tier, seconds] of Object.entries(TIER_ANCHORS_S)) {
      expect(tierToHumanSeconds(tier)).toBe(seconds);
    }
    expect(Object.keys(TIER_ANCHORS_S)).toHaveLength(HIGHEST_ANCHORED_TIER);
  });

  it("extends above the anchored range without a rescale", () => {
    // This is the open-endedness property: adding a tier raises the ceiling,
    // it never changes what an existing tier is worth.
    expect(tierToHumanSeconds("D7")).toBe(64800 * TIER_RATIO);
    expect(tierToHumanSeconds("D8")).toBe(64800 * TIER_RATIO ** 2);
    expect(tierToHumanSeconds("D10")).toBe(64800 * TIER_RATIO ** 4);
  });

  it("is strictly increasing across the ladder", () => {
    let previous = 0;
    for (let n = 1; n <= 12; n++) {
      const seconds = tierToHumanSeconds(`D${n}`);
      expect(seconds).toBeGreaterThan(previous);
      previous = seconds;
    }
  });

  it("throws on a malformed tier", () => {
    expect(() => tierToHumanSeconds("D0")).toThrow(/Malformed difficulty tier/);
  });
});

describe("deriveTier", () => {
  it("maps hop count to the base tier", () => {
    expect(deriveTier({ reasoningHops: 0 })).toBe("D1");
    expect(deriveTier({ reasoningHops: 1 })).toBe("D1");
    expect(deriveTier({ reasoningHops: 2 })).toBe("D2");
    expect(deriveTier({ reasoningHops: 3 })).toBe("D2");
    expect(deriveTier({ reasoningHops: 4 })).toBe("D3");
    expect(deriveTier({ reasoningHops: 5 })).toBe("D3");
    expect(deriveTier({ reasoningHops: 6 })).toBe("D4");
    expect(deriveTier({ reasoningHops: 7 })).toBe("D4");
    expect(deriveTier({ reasoningHops: 8 })).toBe("D5");
    expect(deriveTier({ reasoningHops: 12 })).toBe("D5");
    expect(deriveTier({ reasoningHops: 13 })).toBe("D6");
    expect(deriveTier({ reasoningHops: 20 })).toBe("D6");
  });

  it("adds a tier per additional capability demand", () => {
    expect(deriveTier({ reasoningHops: 4, requiresCoding: true })).toBe("D4");
    expect(deriveTier({ reasoningHops: 4, requiresMemoryRecovery: true })).toBe("D4");
    expect(deriveTier({ reasoningHops: 4, requiresMultiSession: true })).toBe("D4");
    expect(
      deriveTier({
        reasoningHops: 4,
        requiresCoding: true,
        requiresMemoryRecovery: true,
        requiresMultiSession: true,
      }),
    ).toBe("D6");
  });

  it("treats absent capability flags as false", () => {
    expect(deriveTier({ reasoningHops: 2, requiresCoding: false })).toBe("D2");
    expect(deriveTier({ reasoningHops: 2 })).toBe("D2");
  });

  it("rejects nonsensical hop counts rather than defaulting", () => {
    expect(() => deriveTier({ reasoningHops: -1 })).toThrow(/non-negative/);
    expect(() => deriveTier({ reasoningHops: NaN })).toThrow(/non-negative/);
    expect(() => deriveTier({ reasoningHops: Infinity })).toThrow(/non-negative/);
  });

  it("reproduces the shipped Top Floor blueprints", () => {
    // Floors 1 and 5: 2 hops, no extra demands -> D2 (15 min baseline).
    expect(deriveTier({ reasoningHops: 2 })).toBe("D2");
    // Floor 12: 4 hops + SQL injection challenge -> D4 (2 h).
    expect(deriveTier({ reasoningHops: 4, requiresCoding: true })).toBe("D4");
    // Floor 15: 5 hops + first memory wipe -> D4 (2 h).
    expect(deriveTier({ reasoningHops: 5, requiresMemoryRecovery: true })).toBe("D4");
  });
});
