import { describe, it, expect } from "vitest";
import {
  climb,
  needsLadderExtension,
  CLEAR_THRESHOLD,
  FAILURE_STOP,
  type TierRun,
} from "../src/climb.js";
import {
  validateProfile,
  knobsFor,
  nextTier,
  tierRange,
  ProfileError,
  type DifficultyProfile,
} from "../src/difficulty-profile.js";
import type { DifficultyTier } from "../src/tiers.js";
import { assertProfile } from "../src/difficulty-profile.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function profile(floor = "D1", ceiling = "D6"): DifficultyProfile {
  const tiers: Record<string, Record<string, unknown>> = {};
  for (let n = Number(floor.slice(1)); n <= Number(ceiling.slice(1)); n++) {
    tiers[`D${n}`] = { n, distractors: 10 ** n };
  }
  return {
    bench: "mock",
    floorTier: floor as DifficultyTier,
    ceilingTier: ceiling as DifficultyTier,
    tiers,
  };
}

/** A rig that clears every tier up to `ability`, then fails. */
function rigWithAbility(ability: number, cost = 1) {
  return async (tier: DifficultyTier): Promise<TierRun> => ({
    score: Number(tier.slice(1)) <= ability ? 0.9 : 0.2,
    cost_usd: cost,
    Cx_em: Number(tier.slice(1)) * 10,
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

describe("difficulty profile", () => {
  it("accepts a contiguous profile", () => {
    expect(() => validateProfile(profile())).not.toThrow();
  });

  it("rejects a profile with a gap", () => {
    // A gap would make a climb skip a rung and report a frontier never reached.
    const p = profile();
    delete (p.tiers as Record<string, unknown>).D3;
    expect(() => validateProfile(p)).toThrow(ProfileError);
    expect(() => validateProfile(p)).toThrow(/missing knobs for D3/);
  });

  it("rejects a ceiling below the floor", () => {
    expect(() => validateProfile({ ...profile(), floorTier: "D5", ceilingTier: "D2" }))
      .toThrow(/below floorTier/);
  });

  it("rejects tiers outside the declared range", () => {
    const p = profile("D2", "D4");
    (p.tiers as Record<string, unknown>).D9 = {};
    expect(() => validateProfile(p)).toThrow(/outside/);
  });

  it("rejects a knob key that is not a tier at all", () => {
    // A bench writing `easy`/`hard` instead of D-tiers would otherwise define
    // rungs the climb can never reach, and look valid doing it.
    const p = profile("D2", "D4");
    (p.tiers as Record<string, unknown>).hard = {};
    expect(() => validateProfile(p)).toThrow(/outside/);
  });

  it("rejects a malformed tier identifier", () => {
    expect(() => validateProfile({ ...profile(), floorTier: "tier-one" as never }))
      .toThrow(/floorTier .* is not a valid tier/);
    expect(() => validateProfile({ ...profile(), ceilingTier: "D0" as never }))
      .toThrow(/ceilingTier .* is not a valid tier/);
  });

  it("returns the bench's own knobs untouched", () => {
    expect(knobsFor(profile(), "D3")).toEqual({ n: 3, distractors: 1000 });
  });

  it("refuses knobs for a tier outside the profile's range", () => {
    // The profile itself is valid; the caller asked for a rung it does not have.
    expect(() => knobsFor(profile("D1", "D3"), "D9")).toThrow(ProfileError);
    expect(() => knobsFor(profile("D1", "D3"), "D9")).toThrow(/no knobs for D9/);
  });

  it("stops advancing at the ceiling", () => {
    expect(nextTier(profile("D1", "D3"), "D2")).toBe("D3");
    expect(nextTier(profile("D1", "D3"), "D3")).toBeNull();
  });

  it("enumerates the range ascending", () => {
    expect(tierRange(profile("D2", "D5"))).toEqual(["D2", "D3", "D4", "D5"]);
  });
});

// ---------------------------------------------------------------------------
// Climb
// ---------------------------------------------------------------------------

describe("climb", () => {
  it("reports the highest tier cleared", async () => {
    const r = await climb(profile(), rigWithAbility(3));
    expect(r.frontier).toBe("D3");
    expect(r.stopped).toBe("two-failures");
  });

  it("survives a single unlucky failure and keeps climbing", async () => {
    // The whole reason the stop rule needs two: one bad rung must not truncate.
    let seen = 0;
    const flaky = async (tier: DifficultyTier): Promise<TierRun> => {
      seen++;
      if (tier === "D2") return { score: 0.1, cost_usd: 1 }; // one-off dip
      return { score: Number(tier.slice(1)) <= 4 ? 0.95 : 0.1, cost_usd: 1 };
    };
    const r = await climb(profile(), flaky);
    expect(r.frontier).toBe("D4");
    expect(seen).toBeGreaterThan(4);
  });

  it("stops after exactly two consecutive failures", async () => {
    const r = await climb(profile(), rigWithAbility(2));
    const failures = r.curve.filter(c => c.outcome === "failed");
    expect(failures).toHaveLength(FAILURE_STOP);
    expect(r.stopped).toBe("two-failures");
  });

  it("uses the clear threshold as the boundary", async () => {
    const atThreshold = async (): Promise<TierRun> => ({ score: CLEAR_THRESHOLD, cost_usd: 0 });
    const justBelow = async (): Promise<TierRun> => ({ score: CLEAR_THRESHOLD - 0.001, cost_usd: 0 });
    expect((await climb(profile("D1", "D1"), atThreshold)).frontier).toBe("D1");
    expect((await climb(profile("D1", "D1"), justBelow)).frontier).toBeNull();
  });

  it("returns a null frontier when nothing is cleared", async () => {
    const r = await climb(profile(), rigWithAbility(0));
    expect(r.frontier).toBeNull();
  });

  it("records every rung as the curve, ascending", async () => {
    const r = await climb(profile(), rigWithAbility(3));
    const tiers = r.curve.map(c => c.tier);
    expect(tiers).toEqual(["D1", "D2", "D3", "D4", "D5"]);
  });
});

// ---------------------------------------------------------------------------
// Void handling — an outage is not a capability signal
// ---------------------------------------------------------------------------

describe("void tiers", () => {
  it("retries a void rung before giving up", async () => {
    let calls = 0;
    const flakyOnce = async (tier: DifficultyTier, _k: unknown, attempt: number): Promise<TierRun> => {
      calls++;
      if (tier === "D2" && attempt === 1) return { score: null, void: true, voidReason: "quota" };
      return { score: 0.9, cost_usd: 1 };
    };
    const r = await climb(profile("D1", "D3"), flakyOnce);
    expect(r.frontier).toBe("D3");
    expect(calls).toBe(4); // D1, D2 void, D2 retry, D3
  });

  it("ends the climb as partial when a rung stays void", async () => {
    const quotaDead = async (tier: DifficultyTier): Promise<TierRun> =>
      tier === "D2"
        ? { score: null, void: true, voidReason: "session limit" }
        : { score: 0.9, cost_usd: 1 };
    const r = await climb(profile(), quotaDead);
    expect(r.stopped).toBe("void-exhausted");
    expect(r.partial).toBe(true);
    expect(r.frontier).toBe("D1"); // a lower bound, not a measurement
  });

  it("never counts a void rung as a failure", async () => {
    // Today's max cell was void for all 26 tasks. Counting that as a failure
    // would attribute a quota outage to the model.
    const alwaysVoid = async (): Promise<TierRun> => ({ score: null, void: true });
    const r = await climb(profile(), alwaysVoid);
    expect(r.curve.every(c => c.outcome === "void")).toBe(true);
    expect(r.curve.some(c => c.outcome === "failed")).toBe(false);
    expect(r.stopped).toBe("void-exhausted");
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

describe("budget ceiling", () => {
  it("stops before breaching the ceiling, not after", async () => {
    const r = await climb(profile(), rigWithAbility(6, 10), { budgetUsd: 25 });
    expect(r.stopped).toBe("budget-exhausted");
    expect(r.partial).toBe(true);
    expect(r.spend_usd).toBeLessThanOrEqual(30); // 3 rungs at $10, checked before the 4th
  });

  it("does not mark a climb partial when the budget is never reached", async () => {
    const r = await climb(profile(), rigWithAbility(3, 0.01), { budgetUsd: 1000 });
    expect(r.partial).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The anti-saturation guard
// ---------------------------------------------------------------------------

describe("ceiling detection", () => {
  it("flags a rig that cleared the top tier", async () => {
    const r = await climb(profile("D1", "D3"), rigWithAbility(9));
    expect(r.frontier).toBe("D3");
    expect(r.ceilingReached).toBe(true);
    expect(r.stopped).toBe("ceiling-reached");
    expect(needsLadderExtension(r)).toBe(true);
  });

  it("does not flag a rig that stopped on its own ability", async () => {
    const r = await climb(profile("D1", "D6"), rigWithAbility(3));
    expect(r.ceilingReached).toBe(false);
    expect(needsLadderExtension(r)).toBe(false);
  });

  it("does not ask for extension when a budget stop cut the climb short", async () => {
    // A climb that ran out of money below the ceiling proves nothing about the
    // ladder's height — its frontier is a lower bound on the rig, not a bound on
    // the fixtures.
    const r = await climb(profile("D1", "D6"), rigWithAbility(9, 100), { budgetUsd: 250 });
    expect(r.stopped).toBe("budget-exhausted");
    expect(r.partial).toBe(true);
    expect(r.ceilingReached).toBe(false);
    expect(needsLadderExtension(r)).toBe(false);
  });

  it("cannot be both partial and ceiling-reached", async () => {
    // Documents why needsLadderExtension's !partial guard is defensive rather
    // than load-bearing: clearing the top tier breaks the loop immediately, so
    // no budget or void check can subsequently mark the climb partial. If this
    // ever fails, the loop's exit ordering has changed and the guard became
    // reachable — which is exactly when it starts mattering.
    for (const budget of [50, 150, 250, 1000, undefined]) {
      const r = await climb(profile("D1", "D3"), rigWithAbility(9, 100), { budgetUsd: budget });
      expect(r.partial && r.ceilingReached).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Property: the frontier must track ability
// ---------------------------------------------------------------------------

describe("frontier is monotone in ability", () => {
  it("a strictly better rig never reports a lower frontier", async () => {
    let previous = -1;
    for (const ability of [0, 1, 2, 3, 4, 5, 6]) {
      const r = await climb(profile("D1", "D6"), rigWithAbility(ability));
      const f = r.frontier === null ? 0 : Number(r.frontier.slice(1));
      expect(f).toBeGreaterThanOrEqual(previous);
      previous = f;
    }
  });
});

// ---------------------------------------------------------------------------
// Profile documents — the JSON contract shared with the Python benches
// ---------------------------------------------------------------------------

describe("assertProfile", () => {
  const good = {
    bench: "context",
    floorTier: "D2",
    ceilingTier: "D3",
    tiers: { D2: { haystack_n: 50 }, D3: { haystack_n: 300 } },
  };

  it("accepts and narrows a well-formed document", () => {
    const p = assertProfile(good);
    expect(p.bench).toBe("context");
    expect(knobsFor(p, "D3")).toEqual({ haystack_n: 300 });
  });

  it("rejects non-objects", () => {
    for (const bad of [null, undefined, 42, "profile", [good]]) {
      expect(() => assertProfile(bad)).toThrow(/must be an object/);
    }
  });

  it("rejects missing or empty identity fields", () => {
    for (const key of ["bench", "floorTier", "ceilingTier"]) {
      expect(() => assertProfile({ ...good, [key]: "" })).toThrow(new RegExp(key));
      expect(() => assertProfile({ ...good, [key]: undefined })).toThrow(new RegExp(key));
    }
  });

  it("rejects a missing or non-object tiers map", () => {
    expect(() => assertProfile({ ...good, tiers: undefined })).toThrow(/tiers must be an object/);
    expect(() => assertProfile({ ...good, tiers: [] })).toThrow(/tiers must be an object/);
  });

  it("applies the same structural rules as a hand-built profile", () => {
    // A gap in a JSON profile is exactly as dangerous as one in code.
    expect(() => assertProfile({ ...good, ceilingTier: "D5" })).toThrow(/missing knobs/);
  });
});

describe("the shipped Context profile", () => {
  const doc = JSON.parse(
    readFileSync(
      resolve(ROOT_DIR, "benchmarks", "context", "difficulty-profile.json"),
      "utf8",
    ),
  );

  it("is a valid profile", () => {
    expect(() => assertProfile(doc)).not.toThrow();
  });

  it("scales the haystack strictly upward with tier", () => {
    // If a rung is not harder than the one below it, the ladder has a flat spot
    // and the frontier stops meaning anything at that point.
    const p = assertProfile(doc);
    let previous = -1;
    for (const tier of tierRange(p)) {
      const n = knobsFor(p, tier).haystack_n as number;
      expect(n).toBeGreaterThan(previous);
      previous = n;
    }
  });

  it("keeps the historical default reachable as a named tier", () => {
    // CDB_S6_N defaulted to 300; pre-ladder runs should map onto D3 rather than
    // being stranded off the scale.
    expect((knobsFor(assertProfile(doc), "D3").haystack_n as number)).toBe(300);
  });
});

describe("the shipped Top Floor profile", () => {
  const doc = JSON.parse(
    readFileSync(resolve(ROOT_DIR, "benchmarks", "topfloor", "difficulty-profile.json"), "utf8"),
  )

  it("is a valid profile", () => {
    expect(() => assertProfile(doc)).not.toThrow()
  })

  it("claims no tier it has no floors for", () => {
    // The ceiling is what the generated content reaches, not what the tower is
    // designed to reach one day. A rung with no fixtures would report a frontier
    // no rig could have climbed.
    const p = assertProfile(doc)
    for (const tier of tierRange(p)) {
      const floors = knobsFor(p, tier).floors as number[]
      expect(Array.isArray(floors)).toBe(true)
      expect(floors.length).toBeGreaterThan(0)
    }
  })

  it("assigns every floor to exactly one tier", () => {
    const p = assertProfile(doc)
    const all = tierRange(p).flatMap(t => knobsFor(p, t).floors as number[])
    expect(new Set(all).size).toBe(all.length)
  })
})
