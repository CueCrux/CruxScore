// ScoreCrux — Difficulty profiles: how a bench turns a tier into its own knobs
//
// The tier vocabulary (D1, D2, …) is shared across every bench; the knobs are
// not. What makes a retrieval bench hard — distractor volume, supersession
// depth — has nothing to do with what makes a coding bench hard. Forcing one
// knob set on all of them would either flatten the differences or bolt fake
// parameters onto benches that do not have them.
//
// So a bench ships a *profile*: a table from tier to whatever that bench needs,
// plus the range of tiers it can actually produce. The climb runner reads only
// the tier and the range; the knobs are opaque to it and handed straight back to
// the bench.

import { isDifficultyTier, tierIndex, type DifficultyTier } from "./tiers.js";

/**
 * Bench-specific difficulty settings for one tier.
 *
 * Deliberately untyped beyond a string key: Context needs a distractor count and
 * a section list, Top Floor needs a floor range, Coding needs an item pool id.
 * The runner never inspects these.
 */
export type TierKnobs = Record<string, unknown>;

export interface DifficultyProfile {
  /** Bench identifier, e.g. "context", "messyworld", "topfloor". */
  bench: string;
  /** Lowest tier this bench can produce. */
  floorTier: DifficultyTier;
  /**
   * Highest tier this bench can currently produce.
   *
   * A rig that clears this is NOT reported as having topped out at its ability —
   * it has hit the bench's ceiling, which is a fact about the fixture set and a
   * signal to extend it. The two are different and the climb records which.
   */
  ceilingTier: DifficultyTier;
  /** Tier -> knobs. Must cover every tier from floor to ceiling inclusive. */
  tiers: Readonly<Record<string, TierKnobs>>;
}

export class ProfileError extends Error {}

/**
 * Validate a profile: contiguous tiers from floor to ceiling, no gaps.
 *
 * A gap would make a climb silently skip a rung and report a frontier the rig
 * never actually reached.
 */
export function validateProfile(profile: DifficultyProfile): void {
  const { bench, floorTier, ceilingTier, tiers } = profile;

  for (const [label, t] of [["floorTier", floorTier], ["ceilingTier", ceilingTier]] as const) {
    if (!isDifficultyTier(t)) {
      throw new ProfileError(`${bench}: ${label} ${JSON.stringify(t)} is not a valid tier`);
    }
  }

  const lo = tierIndex(floorTier);
  const hi = tierIndex(ceilingTier);
  if (hi < lo) {
    throw new ProfileError(`${bench}: ceilingTier ${ceilingTier} is below floorTier ${floorTier}`);
  }

  const missing: string[] = [];
  for (let n = lo; n <= hi; n++) {
    const key = `D${n}`;
    if (!tiers[key]) missing.push(key);
  }
  if (missing.length > 0) {
    throw new ProfileError(
      `${bench}: profile has gaps — missing knobs for ${missing.join(", ")}. `
        + `A gap makes a climb skip a rung and report a frontier it never reached.`,
    );
  }

  const stray = Object.keys(tiers).filter((k) => {
    if (!isDifficultyTier(k)) return true;
    const n = tierIndex(k);
    return n < lo || n > hi;
  });
  if (stray.length > 0) {
    throw new ProfileError(
      `${bench}: profile defines tiers outside [${floorTier}, ${ceilingTier}]: ${stray.join(", ")}`,
    );
  }
}

/** Knobs for a tier. Throws if the tier is outside the profile's range. */
export function knobsFor(profile: DifficultyProfile, tier: DifficultyTier): TierKnobs {
  validateProfile(profile);
  const knobs = profile.tiers[tier];
  if (!knobs) {
    throw new ProfileError(
      `${profile.bench}: no knobs for ${tier} (range ${profile.floorTier}..${profile.ceilingTier})`,
    );
  }
  return knobs;
}

/** The tier above `tier`, or null when that would exceed the profile's ceiling. */
export function nextTier(
  profile: DifficultyProfile,
  tier: DifficultyTier,
): DifficultyTier | null {
  const n = tierIndex(tier) + 1;
  return n > tierIndex(profile.ceilingTier) ? null : (`D${n}` as DifficultyTier);
}

/** Every tier in the profile, ascending. */
export function tierRange(profile: DifficultyProfile): DifficultyTier[] {
  validateProfile(profile);
  const out: DifficultyTier[] = [];
  for (let n = tierIndex(profile.floorTier); n <= tierIndex(profile.ceilingTier); n++) {
    out.push(`D${n}` as DifficultyTier);
  }
  return out;
}
