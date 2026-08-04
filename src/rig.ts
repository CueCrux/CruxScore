// ScoreCrux — Rig identity and memory lift
//
// A *rig* is the full configuration under test: which model, backed by which
// memory system, at which reasoning effort. Runs are ranked as rigs rather than
// as models, so "vendor-only" and "no memory" are ordinary rows rather than
// special cases, and a memory system's contribution is a derived delta against
// the matched vendor-native rig instead of a separate scoring system.
//
// Effort is part of the identity, not an averaged-over detail: a model at low
// effort and the same model at high effort are different rigs, and collapsing
// them hides the cost/quality trade-off that makes the comparison useful.

/**
 * Declared reasoning effort. `null` means the run predates effort tracking —
 * never a guess, because inferring effort from token counts would fabricate the
 * axis the field exists to measure.
 */
export type EffortTier = "low" | "medium" | "high" | "max";

export const EFFORT_TIERS: readonly EffortTier[] = Object.freeze([
  "low",
  "medium",
  "high",
  "max",
]);

export function isEffortTier(value: unknown): value is EffortTier {
  return typeof value === "string" && (EFFORT_TIERS as readonly string[]).includes(value);
}

/**
 * Memory backend vocabulary, shared with the Context Dependence suite
 * (`benchmarks/context/BACKENDS.md`). One taxonomy, not two.
 *
 *  none          — empty context, the floor
 *  vendor-native — the vendor's own context handling, full rules dump
 *  compaction    — current-value-only summary
 *  rag-bm25      — in-process BM25 retrieval
 *  sqlite-fts    — SQLite FTS5 retrieval (reference implementation)
 *  crux          — freshness-resolved daemon retrieval
 *
 * Other identifiers are permitted — third parties submit their own systems —
 * but `vendor-native` is reserved as the lift baseline.
 */
export const VENDOR_NATIVE = "vendor-native";

export interface Rig {
  /** Canonical model identifier. */
  model: string;
  /** Memory backend identifier. `none` when no memory system was used. */
  memory_backend: string;
  /** Declared reasoning effort, or null if the run predates effort tracking. */
  effort_tier: EffortTier | null;
}

/**
 * Stable key for a rig. Used to group runs and to match a rig against its
 * baseline. `null` effort keys as "unknown" so it groups with itself rather
 * than silently joining the `low` bucket.
 */
export function rigKey(rig: Rig): string {
  return `${rig.model}::${rig.memory_backend}::${rig.effort_tier ?? "unknown"}`;
}

/** Key identifying the vendor-native baseline for a rig: same model, same effort. */
export function baselineKey(rig: Rig): string {
  return rigKey({ ...rig, memory_backend: VENDOR_NATIVE });
}

/** A rig paired with the Em it scored. */
export interface RigResult {
  rig: Rig;
  Cx_em: number | null;
}

/**
 * Memory lift: Em(rig) − Em(same model, same effort, vendor-native).
 *
 * Returns null when there is no matched baseline, when either Em is null, or
 * when the rig *is* the baseline. A missing baseline must read as "not
 * comparable", never as zero lift — zero is a measurement, null is its absence.
 */
export function computeLift(rig: Rig, Cx_em: number | null, population: RigResult[]): number | null {
  if (Cx_em === null) return null;
  if (rig.memory_backend === VENDOR_NATIVE) return null;

  const wanted = baselineKey(rig);
  const baseline = population.find(
    (r) => rigKey(r.rig) === wanted && r.Cx_em !== null,
  );
  if (!baseline) return null;

  return Cx_em - baseline.Cx_em!;
}

/**
 * Top Floor treatment arms expressed as rig presets.
 *
 * The arms predate the rig model and describe the same axis in a parallel
 * vocabulary. Mapping them here keeps one taxonomy without invalidating the
 * arm labels on historical records.
 */
export const ARM_TO_BACKEND: Readonly<Record<string, string>> = Object.freeze({
  C0: "none", // flat context stuffing, no tools, no memory
  T1: "none", // navigation tools, still no persistent memory
  T2: "crux", // navigation + memory tools
  T3: "crux", // + code execution sandbox
});

/** Memory backend for a Top Floor arm, or null if the arm is unrecognised. */
export function backendForArm(arm: string): string | null {
  return ARM_TO_BACKEND[arm] ?? null;
}
