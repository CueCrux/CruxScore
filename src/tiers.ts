// ScoreCrux — Difficulty tier ladder (METRICS.md §4.3.1)
//
// T_human is the most sensitive input to the Crux Score, and was previously a
// per-fixture free-text estimate. Author discretion is where drift lives: two
// fixtures of equal difficulty could carry baselines an order of magnitude
// apart, making Em incomparable across suites.
//
// A fixture now declares a difficulty *tier*, and the tier maps to a published
// T_human anchor. Two properties follow:
//
//   Standardised — tier -> T_human is a lookup, not a judgement, so a D4
//   context fixture and a D4 coding fixture are worth the same Em.
//
//   Open-ended — Cx scales linearly with T_human, so adding D7, D8, ... raises
//   the ceiling forever without rescaling any existing score. This is what
//   removes the need to reset the benchmark every 12-18 months.

/** A difficulty tier identifier: "D1", "D2", ... Unbounded above. */
export type DifficultyTier = `D${number}`;

/**
 * Published human-baseline anchors, in seconds.
 *
 * Anchors are rounded to human-legible durations (5m, 15m, 45m, 2h, 6h, 18h)
 * because that is how a calibration panel is actually briefed. The ratio
 * between adjacent tiers is approximately 3.
 *
 * PROVISIONAL: these are expert estimates, not yet panel-measured. Any result
 * computed from them must be labelled provisional. Replacing an anchor with a
 * measured value is a new fixture version, never an in-place edit — see
 * METRICS.md §4.3 rule 3.
 */
export const TIER_ANCHORS_S: Readonly<Record<string, number>> = Object.freeze({
  D1: 300, //  5 minutes — single-hop lookup in a known location
  D2: 900, // 15 minutes — 2-3 hops within one document set
  D3: 2700, // 45 minutes — 3-5 hops, cross-document synthesis
  D4: 7200, //  2 hours   — 5-7 hops plus one adversarial control
  D5: 21600, //  6 hours   — 8-12 hops, conflicting sources
  D6: 64800, // 18 hours   — 13-20 hops, multi-session continuity
});

/** Highest tier with an explicit published anchor. */
export const HIGHEST_ANCHORED_TIER = 6;

/** Ratio between adjacent tiers, used to extend the ladder above D6. */
export const TIER_RATIO = 3;

/** True if `value` is a well-formed tier identifier (D followed by a positive integer). */
export function isDifficultyTier(value: string): value is DifficultyTier {
  return /^D[1-9][0-9]*$/.test(value);
}

/** Numeric index of a tier: "D4" -> 4. Throws on a malformed identifier. */
export function tierIndex(tier: string): number {
  if (!isDifficultyTier(tier)) {
    throw new Error(`Malformed difficulty tier: ${JSON.stringify(tier)} (expected "D<n>")`);
  }
  return Number(tier.slice(1));
}

/**
 * Human baseline in seconds for a tier.
 *
 * Tiers above the anchored range extend by TIER_RATIO. The ladder is
 * deliberately unbounded: a new frontier tier is an addition, never a rescale.
 */
export function tierToHumanSeconds(tier: string): number {
  const n = tierIndex(tier);
  const anchored = TIER_ANCHORS_S[tier];
  if (anchored !== undefined) return anchored;
  return TIER_ANCHORS_S[`D${HIGHEST_ANCHORED_TIER}`] * TIER_RATIO ** (n - HIGHEST_ANCHORED_TIER);
}

/** Structural difficulty parameters a fixture declares. */
export interface TierDerivationParams {
  /** Reasoning hops required to reach the answer. */
  reasoningHops: number;
  /** Whether the fixture requires writing or exploiting code. */
  requiresCoding?: boolean;
  /** Whether the fixture requires recovering state after a context wipe. */
  requiresMemoryRecovery?: boolean;
  /** Whether the fixture spans more than one session. */
  requiresMultiSession?: boolean;
}

/**
 * Derive a tier from structural parameters.
 *
 * Hop count sets the base tier; each additional capability demand adds one.
 * Deriving rather than hand-assigning is the point — a hand-assigned tier is
 * the same author discretion the ladder exists to remove.
 */
export function deriveTier(params: TierDerivationParams): DifficultyTier {
  const { reasoningHops } = params;
  if (!Number.isFinite(reasoningHops) || reasoningHops < 0) {
    throw new Error(`reasoningHops must be a non-negative finite number, got ${reasoningHops}`);
  }

  // Base tier from hop count, matching the anchor descriptions above.
  let tier: number;
  if (reasoningHops <= 1) tier = 1;
  else if (reasoningHops <= 3) tier = 2;
  else if (reasoningHops <= 5) tier = 3;
  else if (reasoningHops <= 7) tier = 4;
  else if (reasoningHops <= 12) tier = 5;
  else tier = 6;

  if (params.requiresCoding) tier += 1;
  if (params.requiresMemoryRecovery) tier += 1;
  if (params.requiresMultiSession) tier += 1;

  return `D${tier}`;
}
