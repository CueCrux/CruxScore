import { describe, it, expect } from "vitest";
import {
  probability,
  logLikelihood,
  fisherInformation,
  testInformation,
  standardError,
  mleTheta,
  eapTheta,
  estimateTheta,
  type ItemResponse,
} from "../lib/irt.js";
import type { IRTParameters } from "../lib/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const item2PL: IRTParameters = { model: "2PL", a: 1.0, b: 0.0, c: 0 };
const easyItem: IRTParameters = { model: "2PL", a: 1.0, b: -1.5, c: 0 };
const hardItem: IRTParameters = { model: "2PL", a: 1.0, b: 1.5, c: 0 };
const item3PL: IRTParameters = { model: "3PL", a: 1.2, b: 0.5, c: 0.2 };

// ---------------------------------------------------------------------------
// probability()
// ---------------------------------------------------------------------------

describe("probability", () => {
  it("returns 0.5 when theta equals difficulty (2PL)", () => {
    expect(probability(0, item2PL)).toBeCloseTo(0.5, 10);
  });

  it("returns higher P for higher theta (2PL)", () => {
    expect(probability(2, item2PL)).toBeGreaterThan(0.5);
    expect(probability(2, item2PL)).toBeCloseTo(1 / (1 + Math.exp(-2)), 6);
  });

  it("returns lower P for lower theta (2PL)", () => {
    expect(probability(-2, item2PL)).toBeLessThan(0.5);
  });

  it("floors at guessing parameter for 3PL", () => {
    // Even at very low theta, P >= c
    expect(probability(-10, item3PL)).toBeGreaterThanOrEqual(item3PL.c - 1e-10);
  });

  it("3PL approaches 1 for very high theta", () => {
    expect(probability(10, item3PL)).toBeCloseTo(1.0, 3);
  });

  it("matches hand-calculated 3PL value", () => {
    // P = 0.2 + 0.8 / (1 + exp(-1.2 * (1.0 - 0.5)))
    // = 0.2 + 0.8 / (1 + exp(-0.6))
    const exp = Math.exp(-0.6);
    const expected = 0.2 + 0.8 / (1 + exp);
    expect(probability(1.0, item3PL)).toBeCloseTo(expected, 10);
  });
});

// ---------------------------------------------------------------------------
// logLikelihood()
// ---------------------------------------------------------------------------

describe("logLikelihood", () => {
  it("is negative", () => {
    const responses: ItemResponse[] = [
      { correct: true, irt: item2PL },
      { correct: false, irt: hardItem },
    ];
    expect(logLikelihood(0, responses)).toBeLessThan(0);
  });

  it("is maximised near the true theta for consistent responses", () => {
    // All correct on easy items → LL should be higher at positive theta
    const responses: ItemResponse[] = [
      { correct: true, irt: easyItem },
      { correct: true, irt: item2PL },
      { correct: true, irt: hardItem },
    ];
    const llHigh = logLikelihood(1.5, responses);
    const llLow = logLikelihood(-1.5, responses);
    expect(llHigh).toBeGreaterThan(llLow);
  });
});

// ---------------------------------------------------------------------------
// fisherInformation() / testInformation() / standardError()
// ---------------------------------------------------------------------------

describe("Fisher information", () => {
  it("is maximal near item difficulty for 2PL", () => {
    const atDifficulty = fisherInformation(0, item2PL);
    const awayFromDifficulty = fisherInformation(3, item2PL);
    expect(atDifficulty).toBeGreaterThan(awayFromDifficulty);
  });

  it("scales with discrimination squared", () => {
    const lowA: IRTParameters = { model: "2PL", a: 0.5, b: 0, c: 0 };
    const highA: IRTParameters = { model: "2PL", a: 2.0, b: 0, c: 0 };
    const infoLow = fisherInformation(0, lowA);
    const infoHigh = fisherInformation(0, highA);
    // Ratio should be ~ (2.0/0.5)^2 = 16
    expect(infoHigh / infoLow).toBeCloseTo(16, 0);
  });
});

describe("testInformation", () => {
  it("sums item informations", () => {
    const items = [item2PL, easyItem, hardItem];
    const total = testInformation(0, items);
    const sum = items.reduce((s, i) => s + fisherInformation(0, i), 0);
    expect(total).toBeCloseTo(sum, 10);
  });
});

describe("standardError", () => {
  it("decreases with more items", () => {
    const se1 = standardError(0, [item2PL]);
    const se3 = standardError(0, [item2PL, easyItem, hardItem]);
    expect(se3).toBeLessThan(se1);
  });
});

// ---------------------------------------------------------------------------
// mleTheta()
// ---------------------------------------------------------------------------

describe("mleTheta", () => {
  it("returns null for all-correct responses", () => {
    const responses: ItemResponse[] = [
      { correct: true, irt: item2PL },
      { correct: true, irt: easyItem },
    ];
    expect(mleTheta(responses)).toBeNull();
  });

  it("returns null for all-incorrect responses", () => {
    const responses: ItemResponse[] = [
      { correct: false, irt: item2PL },
      { correct: false, irt: easyItem },
    ];
    expect(mleTheta(responses)).toBeNull();
  });

  it("recovers theta near 0 for balanced responses on symmetric items", () => {
    // Items symmetric around 0, mixed correct/incorrect
    const responses: ItemResponse[] = [
      { correct: true, irt: easyItem },   // b = -1.5
      { correct: true, irt: item2PL },     // b = 0
      { correct: false, irt: hardItem },   // b = 1.5
    ];
    const result = mleTheta(responses);
    expect(result).not.toBeNull();
    // With only 3 items, MLE can drift up to ~1 logit from expected
    expect(Math.abs(result!.theta)).toBeLessThan(1.5);
    expect(result!.converged).toBe(true);
    expect(result!.method).toBe("MLE");
  });

  it("recovers high theta from mostly-correct responses on hard items", () => {
    const veryHard: IRTParameters = { model: "2PL", a: 1.0, b: 2.0, c: 0 };
    const responses: ItemResponse[] = [
      { correct: true, irt: hardItem },
      { correct: true, irt: veryHard },
      { correct: true, irt: item2PL },
      { correct: false, irt: veryHard },
    ];
    const result = mleTheta(responses);
    expect(result).not.toBeNull();
    expect(result!.theta).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// eapTheta()
// ---------------------------------------------------------------------------

describe("eapTheta", () => {
  it("always converges", () => {
    const responses: ItemResponse[] = [
      { correct: true, irt: item2PL },
      { correct: true, irt: easyItem },
    ];
    const result = eapTheta(responses);
    expect(result.converged).toBe(true);
    expect(result.method).toBe("EAP");
  });

  it("handles all-correct (where MLE fails)", () => {
    const responses: ItemResponse[] = [
      { correct: true, irt: item2PL },
      { correct: true, irt: easyItem },
    ];
    const result = eapTheta(responses);
    expect(result.theta).toBeGreaterThan(0);
    expect(isFinite(result.se)).toBe(true);
  });

  it("returns prior mean for empty responses", () => {
    const result = eapTheta([], 0.5, 1.0);
    // With no data, posterior = prior → theta ≈ priorMean
    expect(result.theta).toBeCloseTo(0.5, 0);
  });

  it("produces theta close to MLE when MLE converges", () => {
    const responses: ItemResponse[] = [
      { correct: true, irt: easyItem },
      { correct: true, irt: item2PL },
      { correct: false, irt: hardItem },
    ];
    const mle = mleTheta(responses);
    const eap = eapTheta(responses);
    expect(mle).not.toBeNull();
    // EAP should be close to MLE (within ~1 logit for short tests with prior shrinkage)
    expect(Math.abs(eap.theta - mle!.theta)).toBeLessThan(1.0);
  });
});

// ---------------------------------------------------------------------------
// estimateTheta() — unified estimator
// ---------------------------------------------------------------------------

describe("estimateTheta", () => {
  it("uses MLE when possible", () => {
    const responses: ItemResponse[] = [
      { correct: true, irt: easyItem },
      { correct: false, irt: hardItem },
    ];
    const result = estimateTheta(responses);
    expect(result.method).toBe("MLE");
  });

  it("falls back to EAP for all-correct", () => {
    const responses: ItemResponse[] = [
      { correct: true, irt: easyItem },
      { correct: true, irt: item2PL },
    ];
    const result = estimateTheta(responses);
    expect(result.method).toBe("EAP");
  });

  it("returns zero theta and infinite SE for empty responses", () => {
    const result = estimateTheta([]);
    expect(result.theta).toBe(0);
    expect(result.se).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// Theta Recovery (synthetic data)
// ---------------------------------------------------------------------------

describe("theta recovery from synthetic data", () => {
  it("recovers theta=1.0 from generated responses", () => {
    const trueTheta = 1.0;
    const items: IRTParameters[] = [
      { model: "2PL", a: 1.0, b: -1.0, c: 0 },
      { model: "2PL", a: 1.0, b: -0.5, c: 0 },
      { model: "2PL", a: 1.0, b: 0.0, c: 0 },
      { model: "2PL", a: 1.0, b: 0.5, c: 0 },
      { model: "2PL", a: 1.0, b: 1.0, c: 0 },
      { model: "2PL", a: 1.0, b: 1.5, c: 0 },
      { model: "2PL", a: 1.0, b: 2.0, c: 0 },
      { model: "2PL", a: 1.0, b: 2.5, c: 0 },
    ];

    // Deterministic: correct if P(theta, item) > 0.5
    const responses: ItemResponse[] = items.map(irt => ({
      correct: probability(trueTheta, irt) > 0.5,
      irt,
    }));

    const result = estimateTheta(responses);
    // Should recover within ~0.5 logits of true theta
    expect(Math.abs(result.theta - trueTheta)).toBeLessThan(0.5);
  });

  it("recovers theta=-1.0 from generated responses", () => {
    const trueTheta = -1.0;
    const items: IRTParameters[] = [
      { model: "2PL", a: 1.2, b: -2.0, c: 0 },
      { model: "2PL", a: 1.2, b: -1.0, c: 0 },
      { model: "2PL", a: 1.2, b: 0.0, c: 0 },
      { model: "2PL", a: 1.2, b: 1.0, c: 0 },
      { model: "2PL", a: 1.2, b: 2.0, c: 0 },
    ];

    const responses: ItemResponse[] = items.map(irt => ({
      correct: probability(trueTheta, irt) > 0.5,
      irt,
    }));

    const result = estimateTheta(responses);
    // With deterministic thresholding on 5 items, recovery within 1 logit is acceptable
    expect(Math.abs(result.theta - trueTheta)).toBeLessThan(1.0);
  });
});

// Need to import probability for synthetic data generation
import { probability } from "../lib/irt.js";
