// ScoreCrux Intelligence Benchmark — IQ Conversion
//
// Converts IRT theta estimates to IQ-equivalent scores (M=100, SD=15).
// Uses Wechsler convention for classification bands.

import type { IQClassification, NormTable } from "./types.js";
import { DEFAULT_NORM } from "./types.js";

/**
 * Convert theta to IQ-equivalent score.
 * IQ = 100 + 15 * (theta - normMean) / normSD
 */
export function thetaToIQ(theta: number, norm: NormTable = DEFAULT_NORM): number {
  const sd = norm.sd > 1e-15 ? norm.sd : 1;
  return 100 + 15 * (theta - norm.mean) / sd;
}

/**
 * Convert IQ back to theta (inverse).
 */
export function iqToTheta(iq: number, norm: NormTable = DEFAULT_NORM): number {
  const sd = norm.sd > 1e-15 ? norm.sd : 1;
  return norm.mean + sd * (iq - 100) / 15;
}

/**
 * Confidence interval for an IQ score given theta SE.
 */
export function iqConfidenceInterval(
  iq: number,
  thetaSE: number,
  norm: NormTable = DEFAULT_NORM,
  level: number = 0.95,
): { lower: number; upper: number } {
  const z = level === 0.95 ? 1.96 : level === 0.99 ? 2.576 : 1.96;
  const sd = norm.sd > 1e-15 ? norm.sd : 1;
  const iqSE = 15 * thetaSE / sd;
  return {
    lower: Math.round(iq - z * iqSE),
    upper: Math.round(iq + z * iqSE),
  };
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 26.2.17).
 * Accurate to ~1.5e-7.
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Convert IQ to percentile rank.
 */
export function iqToPercentile(iq: number): number {
  const z = (iq - 100) / 15;
  return Math.round(normalCDF(z) * 1000) / 10; // one decimal place
}

/**
 * Classify IQ using Wechsler convention bands.
 */
export function iqClassification(iq: number): IQClassification {
  if (iq < 70) return "Very Low";
  if (iq < 80) return "Low";
  if (iq < 90) return "Low Average";
  if (iq < 110) return "Average";
  if (iq < 120) return "High Average";
  if (iq < 130) return "Superior";
  return "Very Superior";
}
