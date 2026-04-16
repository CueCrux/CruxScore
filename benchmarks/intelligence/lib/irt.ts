// ScoreCrux Intelligence Benchmark — IRT Math Library
//
// Pure-TypeScript implementation of 2PL/3PL Item Response Theory.
// No external dependencies.

import type { IRTParameters, ThetaEstimate, ThetaMethod } from "./types.js";

// ---------------------------------------------------------------------------
// Item Response Probability
// ---------------------------------------------------------------------------

/**
 * Probability of a correct response given ability theta and item parameters.
 *
 * 2PL: P = 1 / (1 + exp(-a * (theta - b)))
 * 3PL: P = c + (1 - c) / (1 + exp(-a * (theta - b)))
 */
export function probability(theta: number, irt: IRTParameters): number {
  const exp = Math.exp(-irt.a * (theta - irt.b));
  const p2 = 1 / (1 + exp);
  return irt.c + (1 - irt.c) * p2;
}

// ---------------------------------------------------------------------------
// Log-Likelihood
// ---------------------------------------------------------------------------

/** Item response: 1 = correct, 0 = incorrect. */
export interface ItemResponse {
  correct: boolean;
  irt: IRTParameters;
}

/**
 * Log-likelihood of a response vector given ability theta.
 */
export function logLikelihood(theta: number, responses: ItemResponse[]): number {
  let ll = 0;
  for (const r of responses) {
    const p = probability(theta, r.irt);
    const pClamped = Math.max(1e-15, Math.min(1 - 1e-15, p));
    ll += r.correct
      ? Math.log(pClamped)
      : Math.log(1 - pClamped);
  }
  return ll;
}

// ---------------------------------------------------------------------------
// Fisher Information
// ---------------------------------------------------------------------------

/**
 * Fisher information for a single item at given theta.
 * I(theta) = a^2 * (P - c)^2 * Q / ((1 - c)^2 * P)
 * where Q = 1 - P.
 */
export function fisherInformation(theta: number, irt: IRTParameters): number {
  const p = probability(theta, irt);
  const q = 1 - p;
  if (p < 1e-15 || q < 1e-15) return 0;
  const numerator = irt.a ** 2 * (p - irt.c) ** 2 * q;
  const denominator = (1 - irt.c) ** 2 * p;
  return denominator < 1e-15 ? 0 : numerator / denominator;
}

/**
 * Total test information at given theta (sum of item informations).
 */
export function testInformation(theta: number, items: IRTParameters[]): number {
  let info = 0;
  for (const item of items) {
    info += fisherInformation(theta, item);
  }
  return info;
}

/**
 * Standard error of theta estimate from inverse Fisher information.
 */
export function standardError(theta: number, items: IRTParameters[]): number {
  const info = testInformation(theta, items);
  return info > 1e-15 ? 1 / Math.sqrt(info) : Infinity;
}

// ---------------------------------------------------------------------------
// First and second derivatives of log-likelihood
// ---------------------------------------------------------------------------

function dldt(theta: number, responses: ItemResponse[]): number {
  let d = 0;
  for (const r of responses) {
    const { a, b, c } = r.irt;
    const exp = Math.exp(-a * (theta - b));
    const p = c + (1 - c) / (1 + exp);
    const pStar = 1 / (1 + exp); // 2PL component
    const w = a * (1 - c) * exp / ((1 + exp) ** 2);
    if (r.correct) {
      d += p > 1e-15 ? w / p : 0;
    } else {
      d -= (1 - p) > 1e-15 ? w / (1 - p) : 0;
    }
  }
  return d;
}

function d2ldt2(theta: number, responses: ItemResponse[]): number {
  let d2 = 0;
  for (const r of responses) {
    const { a, b, c } = r.irt;
    const exp = Math.exp(-a * (theta - b));
    const denom = (1 + exp) ** 2;
    const p = c + (1 - c) / (1 + exp);
    const w = a * (1 - c) * exp / denom;
    const dwdt = -a * w * (1 - exp) / (1 + exp);

    if (r.correct) {
      if (p > 1e-15) {
        d2 += (dwdt * p - w * w) / (p * p);
      }
    } else {
      const q = 1 - p;
      if (q > 1e-15) {
        d2 -= (dwdt * q + w * w) / (q * q);
      }
    }
  }
  return d2;
}

// ---------------------------------------------------------------------------
// Maximum Likelihood Estimation (Newton-Raphson)
// ---------------------------------------------------------------------------

const MLE_MAX_ITER = 100;
const MLE_TOLERANCE = 1e-6;
const THETA_BOUNDS = [-6, 6] as const;

/**
 * MLE theta estimation via Newton-Raphson.
 * Returns null if it fails to converge (use EAP fallback).
 */
export function mleTheta(responses: ItemResponse[]): ThetaEstimate | null {
  // All correct or all incorrect → MLE diverges
  const allCorrect = responses.every(r => r.correct);
  const allIncorrect = responses.every(r => !r.correct);
  if (allCorrect || allIncorrect) return null;

  let theta = 0;
  let converged = false;
  let iterations = 0;

  for (let i = 0; i < MLE_MAX_ITER; i++) {
    iterations = i + 1;
    const d1 = dldt(theta, responses);
    const d2 = d2ldt2(theta, responses);

    if (Math.abs(d2) < 1e-15) break;

    const step = d1 / d2;
    theta -= step;

    // Clamp to bounds
    theta = Math.max(THETA_BOUNDS[0], Math.min(THETA_BOUNDS[1], theta));

    if (Math.abs(step) < MLE_TOLERANCE) {
      converged = true;
      break;
    }
  }

  if (!converged) return null;

  const items = responses.map(r => r.irt);
  const info = testInformation(theta, items);
  const se = info > 1e-15 ? 1 / Math.sqrt(info) : Infinity;

  return {
    theta,
    se,
    information: info,
    method: "MLE",
    converged: true,
    iterations,
  };
}

// ---------------------------------------------------------------------------
// Expected A Posteriori (EAP) Estimation
// ---------------------------------------------------------------------------

const EAP_QUADRATURE_POINTS = 41;
const EAP_RANGE = [-4, 4] as const;

/**
 * EAP theta estimation with normal prior.
 * Always converges — use as fallback when MLE fails.
 */
export function eapTheta(
  responses: ItemResponse[],
  priorMean: number = 0,
  priorSD: number = 1,
): ThetaEstimate {
  const step = (EAP_RANGE[1] - EAP_RANGE[0]) / (EAP_QUADRATURE_POINTS - 1);
  let numerator = 0;
  let denominator = 0;
  let varianceNumerator = 0;

  for (let i = 0; i < EAP_QUADRATURE_POINTS; i++) {
    const q = EAP_RANGE[0] + i * step;

    // Prior density (normal)
    const priorDensity = Math.exp(-0.5 * ((q - priorMean) / priorSD) ** 2)
      / (priorSD * Math.sqrt(2 * Math.PI));

    // Likelihood at this quadrature point
    let ll = 0;
    for (const r of responses) {
      const p = probability(q, r.irt);
      const pClamped = Math.max(1e-15, Math.min(1 - 1e-15, p));
      ll += r.correct ? Math.log(pClamped) : Math.log(1 - pClamped);
    }
    const likelihood = Math.exp(ll);

    const weight = likelihood * priorDensity;
    numerator += q * weight;
    denominator += weight;
  }

  const theta = denominator > 1e-15 ? numerator / denominator : 0;

  // Compute posterior variance for SE
  for (let i = 0; i < EAP_QUADRATURE_POINTS; i++) {
    const q = EAP_RANGE[0] + i * step;
    const priorDensity = Math.exp(-0.5 * ((q - priorMean) / priorSD) ** 2)
      / (priorSD * Math.sqrt(2 * Math.PI));
    let ll = 0;
    for (const r of responses) {
      const p = probability(q, r.irt);
      const pClamped = Math.max(1e-15, Math.min(1 - 1e-15, p));
      ll += r.correct ? Math.log(pClamped) : Math.log(1 - pClamped);
    }
    const weight = Math.exp(ll) * priorDensity;
    varianceNumerator += (q - theta) ** 2 * weight;
  }

  const variance = denominator > 1e-15 ? varianceNumerator / denominator : 1;
  const se = Math.sqrt(variance);
  const items = responses.map(r => r.irt);
  const info = testInformation(theta, items);

  return {
    theta,
    se,
    information: info,
    method: "EAP",
    converged: true,
    iterations: EAP_QUADRATURE_POINTS,
  };
}

// ---------------------------------------------------------------------------
// Unified Estimator
// ---------------------------------------------------------------------------

/**
 * Estimate theta: tries MLE first, falls back to EAP.
 */
export function estimateTheta(
  responses: ItemResponse[],
  priorMean: number = 0,
  priorSD: number = 1,
): ThetaEstimate {
  if (responses.length === 0) {
    return { theta: 0, se: Infinity, information: 0, method: "EAP", converged: true, iterations: 0 };
  }

  const mle = mleTheta(responses);
  if (mle) return mle;

  return eapTheta(responses, priorMean, priorSD);
}
