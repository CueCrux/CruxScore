import { describe, it, expect } from "vitest";
import {
  thetaToIQ,
  iqToTheta,
  iqConfidenceInterval,
  iqToPercentile,
  iqClassification,
} from "../lib/iq-conversion.js";
import type { NormTable } from "../lib/types.js";
import { DEFAULT_NORM } from "../lib/types.js";

// ---------------------------------------------------------------------------
// thetaToIQ / iqToTheta round-trip
// ---------------------------------------------------------------------------

describe("thetaToIQ", () => {
  it("maps theta=0 to IQ=100 with default norm", () => {
    expect(thetaToIQ(0)).toBe(100);
  });

  it("maps theta=1 to IQ=115 with default norm (sd=1)", () => {
    expect(thetaToIQ(1)).toBe(115);
  });

  it("maps theta=-1 to IQ=85 with default norm", () => {
    expect(thetaToIQ(-1)).toBe(85);
  });

  it("uses custom norm mean and sd", () => {
    const norm: NormTable = { ...DEFAULT_NORM, mean: 0.5, sd: 2.0 };
    // IQ = 100 + 15 * (0.5 - 0.5) / 2.0 = 100
    expect(thetaToIQ(0.5, norm)).toBe(100);
    // IQ = 100 + 15 * (2.5 - 0.5) / 2.0 = 100 + 15 = 115
    expect(thetaToIQ(2.5, norm)).toBe(115);
  });
});

describe("iqToTheta", () => {
  it("is the inverse of thetaToIQ", () => {
    const thetas = [-2, -1, 0, 0.5, 1, 2];
    for (const theta of thetas) {
      const iq = thetaToIQ(theta);
      const recovered = iqToTheta(iq);
      expect(recovered).toBeCloseTo(theta, 6);
    }
  });

  it("round-trips with custom norm", () => {
    const norm: NormTable = { ...DEFAULT_NORM, mean: 1.0, sd: 1.5 };
    const theta = 2.5;
    const iq = thetaToIQ(theta, norm);
    const recovered = iqToTheta(iq, norm);
    expect(recovered).toBeCloseTo(theta, 6);
  });
});

// ---------------------------------------------------------------------------
// iqConfidenceInterval
// ---------------------------------------------------------------------------

describe("iqConfidenceInterval", () => {
  it("produces symmetric interval around IQ", () => {
    const ci = iqConfidenceInterval(100, 0.5);
    expect(ci.lower).toBeLessThan(100);
    expect(ci.upper).toBeGreaterThan(100);
    expect(100 - ci.lower).toBeCloseTo(ci.upper - 100, 0);
  });

  it("widens with larger SE", () => {
    const narrow = iqConfidenceInterval(100, 0.3);
    const wide = iqConfidenceInterval(100, 1.0);
    expect(wide.upper - wide.lower).toBeGreaterThan(narrow.upper - narrow.lower);
  });

  it("returns exact IQ when SE is 0", () => {
    const ci = iqConfidenceInterval(120, 0);
    expect(ci.lower).toBe(120);
    expect(ci.upper).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// iqToPercentile
// ---------------------------------------------------------------------------

describe("iqToPercentile", () => {
  it("returns 50th percentile for IQ=100", () => {
    expect(iqToPercentile(100)).toBeCloseTo(50, 0);
  });

  it("returns ~84th percentile for IQ=115", () => {
    const p = iqToPercentile(115);
    expect(p).toBeGreaterThan(80);
    expect(p).toBeLessThan(90);
  });

  it("returns ~16th percentile for IQ=85", () => {
    const p = iqToPercentile(85);
    expect(p).toBeGreaterThan(10);
    expect(p).toBeLessThan(20);
  });

  it("returns ~98th percentile for IQ=130", () => {
    const p = iqToPercentile(130);
    expect(p).toBeGreaterThan(96);
    expect(p).toBeLessThan(100);
  });

  it("returns ~2nd percentile for IQ=70", () => {
    const p = iqToPercentile(70);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// iqClassification
// ---------------------------------------------------------------------------

describe("iqClassification", () => {
  it("classifies boundary values correctly", () => {
    expect(iqClassification(69)).toBe("Very Low");
    expect(iqClassification(70)).toBe("Low");
    expect(iqClassification(79)).toBe("Low");
    expect(iqClassification(80)).toBe("Low Average");
    expect(iqClassification(89)).toBe("Low Average");
    expect(iqClassification(90)).toBe("Average");
    expect(iqClassification(100)).toBe("Average");
    expect(iqClassification(109)).toBe("Average");
    expect(iqClassification(110)).toBe("High Average");
    expect(iqClassification(119)).toBe("High Average");
    expect(iqClassification(120)).toBe("Superior");
    expect(iqClassification(129)).toBe("Superior");
    expect(iqClassification(130)).toBe("Very Superior");
    expect(iqClassification(145)).toBe("Very Superior");
  });
});
