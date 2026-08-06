import { describe, it, expect } from "vitest";
import {
  runGate,
  runBatch,
  batchIsHealthy,
  NOVELTY_THRESHOLD,
  HEALTHY_PASS_RATE,
  type Candidate,
  type GateProbes,
} from "../src/fixture-gate.js";

const candidate = (id = "c1"): Candidate => ({
  id,
  tier: "D5",
  prompt: "What port did the migration settle on?",
  gold: "2711",
  fixture: "…a corpus…",
});

/** A well-formed hard item: oracle passes, reference solver fails, novel. */
function probes(over: Partial<GateProbes> = {}): GateProbes {
  return {
    oracleSolve: async () => true,
    referenceSolve: async () => false,
    similarity: async () => 0.1,
    ...over,
  };
}

describe("runGate", () => {
  it("admits a well-formed hard novel item", async () => {
    const v = await runGate(candidate(), probes());
    expect(v.admitted).toBe(true);
    expect(v.rejectedBy).toBeNull();
    expect(v.checks.every(c => c.passed)).toBe(true);
  });

  it("rejects an item the oracle cannot solve even holding the gold", async () => {
    // Malformed or unanswerable, not hard. Every later signal would be noise.
    const v = await runGate(candidate(), probes({ oracleSolve: async () => false }));
    expect(v.admitted).toBe(false);
    expect(v.rejectedBy).toBe("not-broken");
  });

  it("stops at the first failure rather than reporting downstream noise", async () => {
    let referenceCalls = 0;
    const v = await runGate(candidate(), probes({
      oracleSolve: async () => false,
      referenceSolve: async () => { referenceCalls++; return false },
    }));
    expect(v.rejectedBy).toBe("not-broken");
    expect(referenceCalls).toBe(0);
    expect(v.checks).toHaveLength(1);
  });

  it("rejects an item a low-effort reference solver already answers", async () => {
    // THE defending check: an item everything already solves is not a higher
    // rung, whatever the generator labelled it.
    const v = await runGate(candidate(), probes({ referenceSolve: async () => true }));
    expect(v.admitted).toBe(false);
    expect(v.rejectedBy).toBe("harder");
    expect(v.checks.find(c => c.check === "harder")!.detail).toMatch(/already answers/);
  });

  it("rejects a near-duplicate of an admitted item", async () => {
    const v = await runGate(candidate(), probes({ similarity: async () => NOVELTY_THRESHOLD }));
    expect(v.admitted).toBe(false);
    expect(v.rejectedBy).toBe("novel");
  });

  it("admits an item just below the novelty threshold", async () => {
    const v = await runGate(candidate(), probes({ similarity: async () => NOVELTY_THRESHOLD - 0.001 }));
    expect(v.admitted).toBe(true);
  });

  it("treats oracle-pass and reference-fail as the signature of a good hard item", async () => {
    // These two look contradictory and are not: the oracle is given the answer,
    // the reference solver is not.
    const v = await runGate(candidate(), probes());
    expect(v.checks.find(c => c.check === "not-broken")!.passed).toBe(true);
    expect(v.checks.find(c => c.check === "harder")!.passed).toBe(true);
  });
});

describe("runBatch", () => {
  it("reports the admission rate and what did the rejecting", async () => {
    const cands = [candidate("a"), candidate("b"), candidate("c"), candidate("d")];
    let n = 0;
    const report = await runBatch("D5", cands, probes({
      // a: admitted, b: too easy, c: broken, d: duplicate
      oracleSolve: async () => { n++; return n !== 3 },
      referenceSolve: async (c) => c.id === "b",
      similarity: async (c) => (c.id === "d" ? 0.99 : 0.1),
    }));

    expect(report.submitted).toBe(4);
    expect(report.admitted).toBe(1);
    expect(report.passRate).toBeCloseTo(0.25);
    expect(report.rejectedBy.harder).toBe(1);
    expect(report.rejectedBy["not-broken"]).toBe(1);
    expect(report.rejectedBy.novel).toBe(1);
  });

  it("handles an empty batch without dividing by zero", async () => {
    const report = await runBatch("D5", [], probes());
    expect(report.passRate).toBe(0);
    expect(batchIsHealthy(report)).toBe(false);
  });
});

describe("batchIsHealthy", () => {
  it("flags a collapsing generator", async () => {
    // A very low rate means the survivors are as likely lucky as good, and
    // authoring is the honest fallback.
    const cands = Array.from({ length: 10 }, (_, i) => candidate(`c${i}`));
    const report = await runBatch("D6", cands, probes({ referenceSolve: async () => true }));
    expect(report.admitted).toBe(0);
    expect(batchIsHealthy(report)).toBe(false);
  });

  it("passes a batch at the healthy threshold", async () => {
    const cands = Array.from({ length: 10 }, (_, i) => candidate(`c${i}`));
    const report = await runBatch("D6", cands, probes({
      referenceSolve: async (c) => Number(c.id.slice(1)) >= HEALTHY_PASS_RATE * 10,
    }));
    expect(report.passRate).toBeCloseTo(HEALTHY_PASS_RATE);
    expect(batchIsHealthy(report)).toBe(true);
  });
});
