// ScoreCrux Top Floor — Effort as a spendable resource
//
// Effort plays two roles, and they compose rather than duplicate:
//
//   As a *reported axis*, the declared effort tier is part of the rig identity.
//   A model at low effort and the same model at max effort are different rigs
//   and are never averaged together.
//
//   As an *in-game resource*, that tier sets the size of a reasoning-token
//   allowance for the whole climb. The tower hands out a default share per
//   floor, and the agent may move budget between floors before spending it.
//
// The second role is the lever that shapes how agents work. Hoarding budget
// through easy floors to spend it on a hard split is a strategy, and because
// the ledger is published, it is a visible one. An agent that burns its
// allowance on floor 2 arrives at the Lazarus wipe with nothing left.

import { tierToHumanSeconds, type EffortTier } from "../../../src/index.js";

/**
 * Total reasoning-token allowance per declared effort tier.
 *
 * Deliberately coarse: these are budget classes, not a continuous dial. A
 * finer scale would invite tuning the number rather than the agent.
 */
export const EFFORT_ALLOWANCE: Readonly<Record<EffortTier, number>> = Object.freeze({
  low: 50_000,
  medium: 200_000,
  high: 600_000,
  max: 2_000_000,
});

/**
 * Fraction of the remaining allowance a floor may spend without an explicit
 * allocation. Below this, an agent that never calls `allocate_effort` still
 * finishes the climb; above it, hoarding has to be deliberate.
 */
export const DEFAULT_FLOOR_SHARE = 0.6;

export interface FloorBudget {
  floor: number;
  /** Tokens this floor may spend. */
  granted: number;
  /** Tokens actually consumed. */
  spent: number;
  /** True when the floor spent more than it was granted. */
  overspent: boolean;
}

export class EffortLedger {
  readonly total: number;
  private readonly floors: FloorBudget[] = [];
  private allocations = new Map<number, number>();

  /**
   * @param effortTier declared effort, or null when the run did not declare one
   *   — in which case effort is not modelled as a resource at all rather than
   *   being assigned an allowance the run never agreed to.
   */
  constructor(readonly effortTier: EffortTier | null) {
    this.total = effortTier === null ? Infinity : EFFORT_ALLOWANCE[effortTier];
  }

  /** Whether effort is being enforced. False for undeclared-effort runs. */
  get enforced(): boolean {
    return Number.isFinite(this.total);
  }

  /** Tokens not yet granted to any floor. */
  get unallocated(): number {
    const granted = this.floors.reduce((s, f) => s + f.granted, 0);
    return this.total - granted;
  }

  get spent(): number {
    return this.floors.reduce((s, f) => s + f.spent, 0);
  }

  /**
   * Reserve budget for an upcoming floor.
   *
   * Throws on a negative or non-finite request, and on a request exceeding what
   * remains — an agent must not be able to conjure budget by asking for it.
   */
  allocate(floor: number, tokens: number): void {
    if (!Number.isFinite(tokens) || tokens < 0) {
      throw new Error(`allocate_effort: tokens must be a non-negative number, got ${tokens}`);
    }
    if (this.enforced && tokens > this.unallocated) {
      throw new Error(
        `allocate_effort: requested ${tokens} but only ${this.unallocated} remain unallocated`,
      );
    }
    this.allocations.set(floor, tokens);
  }

  /**
   * Open a floor, granting either its explicit allocation or the default share
   * of what is left.
   */
  openFloor(floor: number): FloorBudget {
    const explicit = this.allocations.get(floor);
    const granted = explicit ?? (
      this.enforced ? Math.floor(this.unallocated * DEFAULT_FLOOR_SHARE) : Infinity
    );
    const budget: FloorBudget = { floor, granted, spent: 0, overspent: false };
    this.floors.push(budget);
    return budget;
  }

  /** Record consumption on the currently open floor. */
  spend(floor: number, tokens: number): FloorBudget {
    const budget = this.floors.find((f) => f.floor === floor);
    if (!budget) throw new Error(`spend: floor ${floor} was never opened`);
    budget.spent += tokens;
    budget.overspent = budget.spent > budget.granted;
    return budget;
  }

  /**
   * Credit multiplier for a floor's score.
   *
   * An overspent floor still counts, at the ratio of what it was granted to
   * what it burned. Zeroing it would make one bad allocation erase a whole
   * climb, which punishes the mistake far past its cost.
   */
  creditFor(floor: number): number {
    const budget = this.floors.find((f) => f.floor === floor);
    if (!budget || !budget.overspent || budget.spent === 0) return 1;
    return budget.granted / budget.spent;
  }

  /** Published ledger — how the budget was actually used. */
  snapshot(): {
    effort_tier: EffortTier | null;
    total: number | null;
    spent: number;
    floors: FloorBudget[];
  } {
    return {
      effort_tier: this.effortTier,
      total: this.enforced ? this.total : null,
      spent: this.spent,
      floors: this.floors.map((f) => ({ ...f })),
    };
  }
}

/**
 * Suggested opening allocation for a floor, proportional to its difficulty.
 *
 * A D5 floor is worth three times a D4 in Em, so it is offered three times the
 * budget. Agents are free to ignore this — that is the decision being measured.
 */
export function suggestedAllocation(
  ledger: EffortLedger,
  floorTier: string,
  remainingTiers: string[],
): number {
  if (!ledger.enforced) return Infinity;
  const weight = tierToHumanSeconds(floorTier);
  const totalWeight = [floorTier, ...remainingTiers].reduce(
    (s, t) => s + tierToHumanSeconds(t),
    0,
  );
  return Math.floor(ledger.unallocated * (weight / totalWeight));
}

/** Tool schema exposed to the agent. */
export const ALLOCATE_EFFORT_TOOL = {
  name: "allocate_effort",
  description:
    "Reserve part of your remaining reasoning budget for a specific floor. Budget not "
    + "allocated is granted floor-by-floor at a default share, so hoarding for a hard floor "
    + "must be deliberate. You cannot allocate more than remains.",
  input_schema: {
    type: "object" as const,
    properties: {
      floor: { type: "number", description: "Floor number to reserve budget for" },
      tokens: { type: "number", description: "Reasoning tokens to reserve" },
    },
    required: ["floor", "tokens"],
  },
};
