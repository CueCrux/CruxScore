import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BRANCH_ARCHETYPES,
  BRANCH_SKILLS,
  validateSplit,
  splitTier,
  selectBranch,
  branchForFloor,
  routeFloors,
  SplitValidationError,
  type Split,
  type Branch,
} from "../lib/labyrinth.js";

const branch = (over: Partial<Branch> = {}): Branch => ({
  id: "b1",
  archetype: "service-risers",
  floors: [16, 17, 18],
  active: true,
  difficulty: { reasoningHops: 4, requiresCoding: true },
  ...over,
});

const split = (over: Partial<Split> = {}): Split => ({
  id: "split-test",
  act: 2,
  entryFloor: 15,
  landingFloor: 19,
  branches: [
    branch({ id: "a", archetype: "service-risers" }),
    branch({ id: "b", archetype: "executive-lifts" }),
    branch({ id: "c", archetype: "archive-stacks" }),
  ],
  ...over,
});

describe("branch archetypes", () => {
  it("defines a skill for every archetype", () => {
    for (const a of BRANCH_ARCHETYPES) {
      expect(BRANCH_SKILLS[a]).toBeDefined();
      expect(BRANCH_SKILLS[a].emphasis.length).toBeGreaterThan(0);
    }
  });

  it("gives each archetype a distinct primary dimension", () => {
    const dims = BRANCH_ARCHETYPES.map(a => BRANCH_SKILLS[a].primaryDimension);
    expect(new Set(dims).size).toBe(dims.length);
  });
});

describe("validateSplit — comparability", () => {
  it("accepts a well-formed split", () => {
    expect(() => validateSplit(split())).not.toThrow();
  });

  it("rejects branches of unequal difficulty", () => {
    // The core constraint. If route choice changed difficulty, two runs at the
    // same height would not be comparable and the single Em would be a lie.
    const bad = split({
      branches: [
        branch({ id: "a", archetype: "service-risers", difficulty: { reasoningHops: 4 } }),
        branch({ id: "b", archetype: "executive-lifts", difficulty: { reasoningHops: 13 } }),
      ],
    });
    expect(() => validateSplit(bad)).toThrow(SplitValidationError);
    expect(() => validateSplit(bad)).toThrow(/difficulty-equivalent/);
  });

  it("rejects branches spanning different floor counts", () => {
    const bad = split({
      branches: [
        branch({ id: "a", archetype: "service-risers", floors: [16, 17, 18] }),
        branch({ id: "b", archetype: "executive-lifts", floors: [16, 17] }),
      ],
    });
    expect(() => validateSplit(bad)).toThrow(/floor counts/);
  });

  it("rejects duplicate archetypes", () => {
    const bad = split({
      branches: [
        branch({ id: "a", archetype: "service-risers" }),
        branch({ id: "b", archetype: "service-risers" }),
      ],
    });
    expect(() => validateSplit(bad)).toThrow(/different skills/);
  });

  it("rejects a split with fewer than two active branches", () => {
    const bad = split({
      branches: [
        branch({ id: "a", archetype: "service-risers" }),
        branch({ id: "b", archetype: "executive-lifts", active: false }),
      ],
    });
    expect(() => validateSplit(bad)).toThrow(/at least 2/);
  });

  it("ignores retired branches when checking equivalence", () => {
    // Rotation: a retired branch stays for replay but must not gate the split.
    const rotated = split({
      branches: [
        branch({ id: "a", archetype: "service-risers" }),
        branch({ id: "b", archetype: "executive-lifts" }),
        branch({
          id: "old",
          archetype: "archive-stacks",
          active: false,
          difficulty: { reasoningHops: 20 },
        }),
      ],
    });
    expect(() => validateSplit(rotated)).not.toThrow();
  });

  it("rejects a landing at or below the entry floor", () => {
    expect(() => validateSplit(split({ landingFloor: 15 }))).toThrow(/must be above/);
  });

  it("rejects floors outside the split's span", () => {
    const bad = split({
      branches: [
        branch({ id: "a", archetype: "service-risers", floors: [16, 17, 25] }),
        branch({ id: "b", archetype: "executive-lifts", floors: [16, 17, 18] }),
      ],
    });
    expect(() => validateSplit(bad)).toThrow(/outside/);
  });
});

describe("splitTier", () => {
  it("returns the shared tier", () => {
    // 4 hops + coding -> D3 base bumped once -> D4
    expect(splitTier(split())).toBe("D4");
  });
});

describe("selectBranch", () => {
  it("is deterministic for a given seed", () => {
    const s = split();
    expect(selectBranch(s, 7).id).toBe(selectBranch(s, 7).id);
  });

  it("reaches every active branch across seeds", () => {
    const s = split();
    const ids = new Set([0, 1, 2].map(seed => selectBranch(s, seed).id));
    expect(ids.size).toBe(3);
  });

  it("never selects a retired branch", () => {
    const s = split({
      branches: [
        branch({ id: "a", archetype: "service-risers" }),
        branch({ id: "b", archetype: "executive-lifts" }),
        branch({ id: "old", archetype: "archive-stacks", active: false }),
      ],
    });
    for (let seed = 0; seed < 12; seed++) {
      expect(selectBranch(s, seed).id).not.toBe("old");
    }
  });
});

describe("branchForFloor", () => {
  it("finds the branch owning a floor", () => {
    expect(branchForFloor(split(), 17)?.id).toBe("a");
  });

  it("returns null for a trunk floor", () => {
    expect(branchForFloor(split(), 3)).toBeNull();
  });
});

describe("routeFloors", () => {
  const trunk = [14, 15, 16, 17, 18, 19, 20];

  it("keeps trunk floors and only the chosen branch's floors", () => {
    const floors = routeFloors(trunk, [split()], 0);
    expect(floors).toEqual([14, 15, 16, 17, 18, 19, 20]);
  });

  it("yields the same floor count whichever route is taken", () => {
    // Equal climb, equal Em — independent of the route.
    const counts = [0, 1, 2].map(seed => routeFloors(trunk, [split()], seed).length);
    expect(new Set(counts).size).toBe(1);
  });

  it("passes through a trunk with no splits unchanged", () => {
    expect(routeFloors(trunk, [], 0)).toEqual(trunk);
  });
});

describe("shipped Act II split fixture", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname!, "..", "fixtures", "splits", "act2-a.json"),
      "utf-8",
    ),
  ) as Split;

  it("validates", () => {
    expect(() => validateSplit(fixture)).not.toThrow();
  });

  it("sits at D4, matching the Act II floors it follows", () => {
    expect(splitTier(fixture)).toBe("D4");
  });

  it("branches from the Lazarus wipe floor onto a shared landing", () => {
    expect(fixture.entryFloor).toBe(15);
    expect(fixture.landingFloor).toBe(19);
    expect(fixture.branches).toHaveLength(3);
  });
});
