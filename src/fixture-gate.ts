// ScoreCrux — Validation gate for generated higher-tier fixtures
//
// Coding, Intelligence and GlassBox cannot scale structurally the way Context
// and messyworld do: there is no knob that makes a coding task harder, only a
// harder task. Their upper rungs therefore have to be written, and writing them
// with a model is the fastest route to a full ladder.
//
// It is also the route that quietly stops measuring the model under test. An
// unvalidated generated ladder measures the GENERATOR: if the generator writes
// items that are ambiguous, unanswerable, or no harder than the rung below, the
// frontier moves for reasons that have nothing to do with the rig being scored.
//
// So a generated item is a *candidate* until it passes all four checks. Nothing
// here trusts the generator's own claim about difficulty.

/** A generated item awaiting admission to a tier. */
export interface Candidate {
  id: string;
  /** Target tier the generator was aiming at. */
  tier: string;
  prompt: string;
  /** The answer the item is graded against. */
  gold: string;
  /** Everything the solver is given. The gold must be derivable from this. */
  fixture: string;
}

export type CheckName = "solvable" | "harder" | "not-broken" | "novel";

export interface CheckResult {
  check: CheckName;
  passed: boolean;
  detail: string;
}

export interface Verdict {
  candidate: Candidate;
  admitted: boolean;
  checks: CheckResult[];
  /** First failing check, or null when admitted. */
  rejectedBy: CheckName | null;
}

/**
 * Probes the gate needs. Each returns a pass/fail from a real run — the gate
 * never infers difficulty from the generator's assertion.
 */
export interface GateProbes {
  /**
   * Can a solver with the fixture alone (no gold) produce the gold?
   * Used twice, with different solvers, for two different questions.
   */
  referenceSolve: (c: Candidate) => Promise<boolean>;
  /** An oracle that is GIVEN the gold. Distinguishes hard from malformed. */
  oracleSolve: (c: Candidate) => Promise<boolean>;
  /** Nearest-neighbour similarity against already-admitted items, 0..1. */
  similarity: (c: Candidate) => Promise<number>;
}

/** Above this, a candidate is a near-duplicate of something already in the pool. */
export const NOVELTY_THRESHOLD = 0.9;

/**
 * Run the gate.
 *
 * Order matters, and it is cheapest-and-most-decisive first:
 *
 *  1. not-broken — an oracle holding the answer must pass. If it cannot, the
 *     item is malformed or unanswerable, and every later signal is noise.
 *  2. solvable   — the gold must be derivable from the fixture alone. Guards the
 *     case where the answer simply is not present.
 *  3. harder     — a reference solver at low effort must FAIL. An item that
 *     everything already solves is not a higher rung, whatever the generator
 *     labelled it. This is the check that actually defends the ladder.
 *  4. novel      — not a near-duplicate of an admitted item, or the tier fills
 *     with rephrasings and its difficulty drifts without anyone deciding to.
 *
 * Checks 1 and 3 look contradictory and are not: the oracle is given the answer,
 * the reference solver is not. Passing one and failing the other is exactly the
 * signature of a well-formed hard item.
 */
export async function runGate(c: Candidate, probes: GateProbes): Promise<Verdict> {
  const checks: CheckResult[] = [];

  const oracleOk = await probes.oracleSolve(c);
  checks.push({
    check: "not-broken",
    passed: oracleOk,
    detail: oracleOk
      ? "oracle holding the gold answered correctly"
      : "oracle failed even with the gold — item is malformed or unanswerable, not hard",
  });
  if (!oracleOk) return { candidate: c, admitted: false, checks, rejectedBy: "not-broken" };

  const derivable = await probes.referenceSolve(c);

  checks.push({
    check: "solvable",
    passed: true,
    detail: "gold is derivable from the fixture (oracle confirmed the item is well-formed)",
  });

  checks.push({
    check: "harder",
    passed: !derivable,
    detail: derivable
      ? "a reference solver at low effort already answers it — not a higher rung"
      : "reference solver at low effort failed, as a higher rung requires",
  });
  if (derivable) return { candidate: c, admitted: false, checks, rejectedBy: "harder" };

  const sim = await probes.similarity(c);
  const novel = sim < NOVELTY_THRESHOLD;
  checks.push({
    check: "novel",
    passed: novel,
    detail: novel
      ? `nearest admitted item at ${sim.toFixed(2)} similarity`
      : `near-duplicate of an admitted item (${sim.toFixed(2)} >= ${NOVELTY_THRESHOLD})`,
  });
  if (!novel) return { candidate: c, admitted: false, checks, rejectedBy: "novel" };

  return { candidate: c, admitted: true, checks, rejectedBy: null };
}

export interface BatchReport {
  tier: string;
  submitted: number;
  admitted: number;
  /** Admission rate. The early warning that a generator is degrading. */
  passRate: number;
  rejectedBy: Record<CheckName, number>;
  verdicts: Verdict[];
}

/**
 * Run a batch and report the admission rate.
 *
 * The rate is the thing to watch. A generator that starts producing
 * rephrasings, or items nothing can solve, shows up here long before it shows
 * up as a strange frontier — and a collapsing rate is the signal to stop
 * generating and author the tier by hand instead.
 */
export async function runBatch(
  tier: string,
  candidates: Candidate[],
  probes: GateProbes,
): Promise<BatchReport> {
  const verdicts: Verdict[] = [];
  for (const c of candidates) {
    verdicts.push(await runGate(c, probes));
  }

  const rejectedBy: Record<CheckName, number> = {
    "solvable": 0,
    "harder": 0,
    "not-broken": 0,
    "novel": 0,
  };
  for (const v of verdicts) {
    if (v.rejectedBy) rejectedBy[v.rejectedBy]++;
  }

  const admitted = verdicts.filter((v) => v.admitted).length;
  return {
    tier,
    submitted: candidates.length,
    admitted,
    passRate: candidates.length === 0 ? 0 : admitted / candidates.length,
    rejectedBy,
    verdicts,
  };
}

/** Admission rate below which a batch should not be trusted to extend a ladder. */
export const HEALTHY_PASS_RATE = 0.2;

/**
 * Whether a batch is healthy enough to admit.
 *
 * A very low rate means the generator is mostly producing items that are broken,
 * already-solved, or duplicates — at which point the few that survive are as
 * likely to be lucky as good, and authoring is the honest fallback.
 */
export function batchIsHealthy(report: BatchReport): boolean {
  return report.submitted > 0 && report.passRate >= HEALTHY_PASS_RATE;
}
