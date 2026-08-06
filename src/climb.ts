// ScoreCrux — The climb: run a bench upward until it stops clearing
//
// A fixed fixture set produces a percentage, and a percentage saturates. Once a
// model scores 1.0 on every fundamental, as claude-haiku-4-5 does on smoke-1,
// the bench has stopped measuring: nothing better can register. The Intelligence
// suite already hit this and responded by hand-abandoning three of its five
// tiers.
//
// A climb reports the highest tier a rig CLEARED instead. That number cannot
// saturate, because the answer to a rig beating the top tier is to add another
// tier — and since Cx scales with T_human, the tier above is worth
// proportionally more Em without rescaling anything below it.

import {
  knobsFor,
  nextTier,
  validateProfile,
  type DifficultyProfile,
  type TierKnobs,
} from "./difficulty-profile.js";
import { tierIndex, type DifficultyTier } from "./tiers.js";

/** Weighted task score at or above which a tier counts as cleared. */
export const CLEAR_THRESHOLD = 0.7;

/** Consecutive genuine failures that end a climb. */
export const FAILURE_STOP = 2;

/** How many times a void tier is retried before the climb gives up on it. */
export const VOID_RETRIES = 1;

/**
 * What happened at one tier.
 *
 *  cleared — score >= CLEAR_THRESHOLD
 *  failed  — the rig ran and scored below threshold. A real capability signal.
 *  void    — the rig never got to answer: quota exhausted, endpoint down,
 *            model identity unresolved. Carries NO capability information and
 *            must never be read as a failure.
 */
export type TierOutcome = "cleared" | "failed" | "void";

/** One rung's result, as reported by the bench. */
export interface TierRun {
  /** Weighted task score in [0,1]. Null when the tier is void. */
  score: number | null;
  /** Canonical Effective Minutes for the rung, if scored. */
  Cx_em?: number | null;
  cost_usd?: number | null;
  wall_s?: number | null;
  turns?: number | null;
  tokens?: number | null;
  /** Set when the rig never actually ran — quota, transport, unresolved model. */
  void?: boolean;
  /** Free-text reason, surfaced on the record when void. */
  voidReason?: string;
}

export interface TierResult extends TierRun {
  tier: DifficultyTier;
  outcome: TierOutcome;
  /** Attempt number for this tier (>1 when a void tier was retried). */
  attempt: number;
}

export type StopReason =
  | "two-failures"
  | "ceiling-reached"
  | "budget-exhausted"
  | "void-exhausted";

export interface ClimbResult {
  bench: string;
  /** Highest tier cleared. Null when the rig cleared nothing. */
  frontier: DifficultyTier | null;
  /** Every rung attempted, ascending — this is what the climb plot draws. */
  curve: TierResult[];
  stopped: StopReason;
  /**
   * True when the climb ended for a reason that is NOT a statement about the
   * rig: budget or quota rather than capability. A partial frontier is a lower
   * bound, not a measurement.
   */
  partial: boolean;
  /**
   * True when the rig cleared the bench's top tier. The frontier is then bounded
   * by the fixture set, not the rig — the signal to extend the ladder.
   */
  ceilingReached: boolean;
  spend_usd: number;
}

export interface ClimbOptions {
  /** Abort once cumulative spend crosses this. Omit for no ceiling. */
  budgetUsd?: number;
  /** Override the clear threshold. Recorded on the result by the caller. */
  clearThreshold?: number;
}

/** Runs one tier. Supplied by the bench; the runner never inspects the knobs. */
export type TierRunner = (
  tier: DifficultyTier,
  knobs: TierKnobs,
  attempt: number,
) => Promise<TierRun>;

function outcomeOf(run: TierRun, threshold: number): TierOutcome {
  if (run.void || run.score === null || run.score === undefined) return "void";
  return run.score >= threshold ? "cleared" : "failed";
}

/**
 * Climb a bench until it stops clearing.
 *
 * Rules, and why:
 *
 *  - Stop after FAILURE_STOP *consecutive* failures, not one. These models are
 *    nondeterministic; a single unlucky rung would truncate the climb and
 *    understate the frontier.
 *  - A void rung does not count toward that stop, and does not reset it either.
 *    It carries no information about the rig, so it must not end a climb early
 *    (which would understate) nor rescue one (which would overstate).
 *  - Budget is checked BEFORE each rung, so the ceiling is never breached rather
 *    than merely detected afterwards.
 */
export async function climb(
  profile: DifficultyProfile,
  runTier: TierRunner,
  options: ClimbOptions = {},
): Promise<ClimbResult> {
  validateProfile(profile);

  const threshold = options.clearThreshold ?? CLEAR_THRESHOLD;
  const curve: TierResult[] = [];

  let tier: DifficultyTier | null = profile.floorTier;
  let frontier: DifficultyTier | null = null;
  let consecutiveFailures = 0;
  let spend = 0;
  let stopped: StopReason = "ceiling-reached";
  let partial = false;

  while (tier !== null) {
    if (options.budgetUsd !== undefined && spend >= options.budgetUsd) {
      stopped = "budget-exhausted";
      partial = true;
      break;
    }

    let outcome: TierOutcome = "void";
    let attempt = 0;

    // Retry a void rung: quota and transport faults are transient, and treating
    // one as a failure would misattribute an outage to the model.
    while (attempt <= VOID_RETRIES) {
      attempt++;
      const run = await runTier(tier, knobsFor(profile, tier), attempt);
      spend += run.cost_usd ?? 0;
      outcome = outcomeOf(run, threshold);
      curve.push({ ...run, tier, outcome, attempt });
      if (outcome !== "void") break;
    }

    if (outcome === "void") {
      stopped = "void-exhausted";
      partial = true;
      break;
    }

    if (outcome === "cleared") {
      frontier = tier;
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
      if (consecutiveFailures >= FAILURE_STOP) {
        stopped = "two-failures";
        break;
      }
    }

    const next: DifficultyTier | null = nextTier(profile, tier);
    if (next === null) {
      stopped = "ceiling-reached";
      break;
    }
    tier = next;
  }

  return {
    bench: profile.bench,
    frontier,
    curve,
    stopped,
    partial,
    ceilingReached:
      frontier !== null && tierIndex(frontier) === tierIndex(profile.ceilingTier),
    spend_usd: Math.round(spend * 1e6) / 1e6,
  };
}

/**
 * Whether a published climb should prompt extending the ladder.
 *
 * A rig that cleared the top tier is bounded by the fixture set rather than by
 * its own ability, so the frontier understates it. Surfacing this is the
 * anti-saturation guard: it is exactly the state the Intelligence suite sat in
 * before someone noticed by hand.
 */
export function needsLadderExtension(result: ClimbResult): boolean {
  return result.ceilingReached && !result.partial;
}
