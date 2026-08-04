// ScoreCrux Top Floor — Labyrinth splits
//
// Above Act I the tower stops being a staircase. At a *split*, the agent
// chooses one of several routes upward; the routes reconverge on a *landing*
// floor that every path must pass through.
//
// The constraint that makes this work with a single unified score: branches at
// a split are difficulty-equivalent. They differ in the skill they demand, not
// in how hard they are. An agent's Em depends on how high it climbed, never on
// which route it took — otherwise two runs at the same height would not be
// comparable, and the whole point of one number is lost.
//
// Two things fall out of branching for free:
//
//   Contamination resistance — a memorised transcript of one route does not
//   transfer to its siblings, so a leaked run degrades rather than solves.
//
//   Rotation — branches can be retired and replaced the way LiveBench rotates
//   questions, without touching the scale. A rotated branch is a new fixture at
//   the same tier, so historical Em stays comparable.

import { deriveTier, type DifficultyTier, type TierDerivationParams } from "../../../src/index.js";

/**
 * The three routes upward. Each demands a different skill; none is the
 * "intended" path.
 *
 *  service-risers  — plant rooms, maintenance ducts, contractor paperwork.
 *                    Retrieval under noise: the signal is buried in volume.
 *  executive-lifts — meetings, minutes, hallway politics. Social inference:
 *                    sources conflict and testimony is self-interested.
 *  archive-stacks  — records, backups, legacy systems. Code and exploitation:
 *                    the answer must be extracted, not read.
 */
export const BRANCH_ARCHETYPES = ["service-risers", "executive-lifts", "archive-stacks"] as const;

export type BranchArchetype = (typeof BRANCH_ARCHETYPES)[number];

export interface BranchSkill {
  archetype: BranchArchetype;
  label: string;
  /** What the route actually tests. */
  emphasis: string;
  /** Which Crux dimension the route loads most heavily. */
  primaryDimension: string;
}

export const BRANCH_SKILLS: Readonly<Record<BranchArchetype, BranchSkill>> = Object.freeze({
  "service-risers": {
    archetype: "service-risers",
    label: "Service Risers",
    emphasis: "Retrieval under noise — the signal is buried in volume, not hidden",
    primaryDimension: "P_context",
  },
  "executive-lifts": {
    archetype: "executive-lifts",
    label: "Executive Lifts",
    emphasis: "Social inference — sources conflict and testimony is self-interested",
    primaryDimension: "I_premise_rejection",
  },
  "archive-stacks": {
    archetype: "archive-stacks",
    label: "Archive Stacks",
    emphasis: "Code and exploitation — the answer must be extracted, not read",
    primaryDimension: "K_causal",
  },
});

export interface Branch {
  /** Stable identifier, e.g. "S2A-service-risers". */
  id: string;
  archetype: BranchArchetype;
  /** Floors belonging to this branch, in ascending order. */
  floors: number[];
  /** Structural difficulty of the branch, used to prove equivalence. */
  difficulty: TierDerivationParams;
  /** Whether this branch is currently live. Retired branches stay for replay. */
  active: boolean;
}

export interface Split {
  /** Stable identifier, e.g. "split-act2-a". */
  id: string;
  act: number;
  /** Floor the agent departs from. */
  entryFloor: number;
  /** Floor every branch reconverges on. */
  landingFloor: number;
  branches: Branch[];
}

export class SplitValidationError extends Error {}

/**
 * Assert that a split preserves comparability.
 *
 * Every active branch must derive the same difficulty tier, occupy the same
 * number of floors, and land on the shared landing floor. A split that fails
 * this makes route choice worth Em, which would silently turn the leaderboard
 * into a ranking of route luck.
 */
export function validateSplit(split: Split): void {
  const active = split.branches.filter((b) => b.active);

  if (active.length < 2) {
    throw new SplitValidationError(
      `Split ${split.id} has ${active.length} active branch(es); a split needs at least 2`,
    );
  }

  if (split.landingFloor <= split.entryFloor) {
    throw new SplitValidationError(
      `Split ${split.id}: landing floor ${split.landingFloor} must be above entry floor ${split.entryFloor}`,
    );
  }

  const seen = new Set<BranchArchetype>();
  for (const b of active) {
    if (seen.has(b.archetype)) {
      throw new SplitValidationError(
        `Split ${split.id}: duplicate archetype ${b.archetype} — branches must test different skills`,
      );
    }
    seen.add(b.archetype);
  }

  const tiers = active.map((b) => ({ id: b.id, tier: deriveTier(b.difficulty) }));
  const distinct = [...new Set(tiers.map((t) => t.tier))];
  if (distinct.length > 1) {
    const detail = tiers.map((t) => `${t.id}=${t.tier}`).join(", ");
    throw new SplitValidationError(
      `Split ${split.id}: branches must be difficulty-equivalent, got ${detail}. `
        + `Route choice must never change what a floor is worth.`,
    );
  }

  const lengths = [...new Set(active.map((b) => b.floors.length))];
  if (lengths.length > 1) {
    throw new SplitValidationError(
      `Split ${split.id}: branches span different floor counts (${lengths.join(", ")}); `
        + `a longer route would earn more Em for the same climb`,
    );
  }

  for (const b of active) {
    if (b.floors.length === 0) {
      throw new SplitValidationError(`Split ${split.id}: branch ${b.id} has no floors`);
    }
    if (b.floors.some((f) => f <= split.entryFloor || f >= split.landingFloor)) {
      throw new SplitValidationError(
        `Split ${split.id}: branch ${b.id} has floors outside `
          + `(${split.entryFloor}, ${split.landingFloor})`,
      );
    }
  }
}

/** The tier every branch of a split resolves to. Throws if the split is invalid. */
export function splitTier(split: Split): DifficultyTier {
  validateSplit(split);
  return deriveTier(split.branches.find((b) => b.active)!.difficulty);
}

/**
 * Pick a branch for a run.
 *
 * Selection is seeded rather than random so a run is reproducible from its
 * manifest — the same (split, seed) always yields the same route, which is what
 * lets a published result be replayed.
 */
export function selectBranch(split: Split, seed: number): Branch {
  validateSplit(split);
  const active = split.branches.filter((b) => b.active);
  const index = Math.abs(Math.trunc(seed)) % active.length;
  return active[index]!;
}

/** Look up a branch by the floor an agent is standing on. */
export function branchForFloor(split: Split, floor: number): Branch | null {
  return split.branches.find((b) => b.floors.includes(floor)) ?? null;
}

/**
 * The floors a run visits, given a route through the splits.
 *
 * Floors outside any split are trunk floors and are always visited; floors
 * inside a split are visited only on the chosen branch.
 */
export function routeFloors(
  trunk: number[],
  splits: Split[],
  seed: number,
): number[] {
  const inAnySplit = new Set<number>();
  for (const s of splits) {
    for (const b of s.branches) for (const f of b.floors) inAnySplit.add(f);
  }

  const chosen = new Set<number>();
  for (const s of splits) {
    for (const f of selectBranch(s, seed).floors) chosen.add(f);
  }

  return trunk
    .filter((f) => !inAnySplit.has(f) || chosen.has(f))
    .sort((a, b) => a - b);
}
