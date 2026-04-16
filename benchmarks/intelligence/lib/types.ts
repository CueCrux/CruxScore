// ScoreCrux Intelligence Benchmark — Core Types
//
// Psychometric intelligence benchmark with CHC factor mapping,
// IRT calibration, and IQ-equivalent composite scoring.

// ---------------------------------------------------------------------------
// CHC (Cattell-Horn-Carroll) Factor Taxonomy
// ---------------------------------------------------------------------------

/** Broad stratum-II CHC cognitive factors measured by this benchmark. */
export type CHCFactor = "Gf" | "Gwm" | "Gc" | "Gs";

/** Human-readable labels for CHC factors. */
export const CHC_FACTOR_LABELS: Record<CHCFactor, string> = {
  Gf: "Fluid Reasoning",
  Gwm: "Working Memory",
  Gc: "Comprehension-Knowledge",
  Gs: "Processing Speed",
};

/** The six reasoning categories from the master plan (Part 2, §2.6). */
export type ReasoningCategory = "A" | "B" | "C" | "D" | "E" | "F";

/** Human-readable labels for reasoning categories. */
export const CATEGORY_LABELS: Record<ReasoningCategory, string> = {
  A: "Deduction & Elimination",
  B: "Stateful Process Reasoning",
  C: "Rule Application",
  D: "Causal & Counterfactual",
  E: "Abstraction & Transformation",
  F: "Planning Under Constraints",
};

/** How a reasoning category loads onto CHC factors. */
export interface CHCFactorMapping {
  category: ReasoningCategory;
  categoryLabel: string;
  primaryFactor: CHCFactor;
  secondaryFactor?: CHCFactor;
  primaryWeight: number;
  secondaryWeight?: number;
}

/** Canonical mapping: categories -> CHC factors. */
export const CHC_FACTOR_MAP: readonly CHCFactorMapping[] = Object.freeze([
  { category: "A", categoryLabel: "Deduction & Elimination", primaryFactor: "Gf", primaryWeight: 1.0 },
  { category: "B", categoryLabel: "Stateful Process Reasoning", primaryFactor: "Gwm", primaryWeight: 1.0 },
  { category: "C", categoryLabel: "Rule Application", primaryFactor: "Gc", secondaryFactor: "Gf", primaryWeight: 0.6, secondaryWeight: 0.4 },
  { category: "D", categoryLabel: "Causal & Counterfactual", primaryFactor: "Gf", primaryWeight: 1.0 },
  { category: "E", categoryLabel: "Abstraction & Transformation", primaryFactor: "Gf", primaryWeight: 1.0 },
  { category: "F", categoryLabel: "Planning Under Constraints", primaryFactor: "Gs", secondaryFactor: "Gf", primaryWeight: 0.6, secondaryWeight: 0.4 },
]);

// ---------------------------------------------------------------------------
// IRT (Item Response Theory) Parameters
// ---------------------------------------------------------------------------

/** Supported IRT models. */
export type IRTModel = "2PL" | "3PL";

/** Item-level IRT parameters. */
export interface IRTParameters {
  model: IRTModel;
  /** Discrimination (slope). Typical range: 0.5-2.5. */
  a: number;
  /** Difficulty (location on logit scale). */
  b: number;
  /** Pseudo-guessing parameter. 0 for 2PL. */
  c: number;
}

// ---------------------------------------------------------------------------
// Difficulty Tiers
// ---------------------------------------------------------------------------

/** 1 = easy, 2 = medium, 3 = hard. */
export type DifficultyTier = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Task Definition
// ---------------------------------------------------------------------------

/** Answer matching strategy. */
export type AnswerType = "exact" | "structured" | "set" | "ordered_list";

/** Partial credit rule for non-binary scoring. */
export interface PartialCreditRule {
  condition: "contains_correct_subset" | "correct_except_order" | "within_tolerance";
  credit: number;
  tolerance?: number;
}

/** Required response format enforced on the model. */
export interface ResponseSchema {
  type: "object";
  properties: {
    final_answer: { type: "string" | "array" };
    confidence: { type: "number"; minimum: 0; maximum: 1 };
    working: { type: "array"; items: { type: "string" } };
  };
  required: string[];
}

/** Default scoring weights from master plan §2.9. */
export const DEFAULT_SCORING_WEIGHTS: Readonly<ScoringWeights> = Object.freeze({
  correctness: 0.70,
  traceConsistency: 0.15,
  constraintAdherence: 0.10,
  outputCompliance: 0.05,
});

export interface ScoringWeights {
  correctness: number;
  traceConsistency: number;
  constraintAdherence: number;
  outputCompliance: number;
}

/** Reasoning benchmark track. R1 = closed-world, R2 = context-bounded. */
export type ReasoningTrack = "R1" | "R2";

/** A single intelligence benchmark task. */
export interface IntelligenceTask {
  taskId: string;
  version: number;
  category: ReasoningCategory;
  categoryLabel: string;
  tier: DifficultyTier;
  chcPrimaryFactor: CHCFactor;
  chcSecondaryFactor?: CHCFactor;
  irt: IRTParameters;
  track: ReasoningTrack;

  // Task content
  statement: string;
  constraints: string[];
  contextPack?: string;
  allowedLibraries?: string[];

  // Expected answer
  answerType: AnswerType;
  correctAnswer: string | string[];
  acceptableVariants?: string[];
  partialCreditRules?: PartialCreditRule[];

  // Output schema enforced on the model
  responseSchema: ResponseSchema;

  // Anti-contamination
  variantFamily?: string;
  isHoldout: boolean;

  // Scoring weights
  scoringWeights: ScoringWeights;
}

// ---------------------------------------------------------------------------
// Run Modes (master plan §1.2.B)
// ---------------------------------------------------------------------------

export type RunMode =
  | "closed_prompt_only"
  | "local_tooling"
  | "open_tooling"
  | "custom_harness";

// ---------------------------------------------------------------------------
// Model Response
// ---------------------------------------------------------------------------

export interface ParsedOutput {
  final_answer: string | string[];
  confidence: number;
  working: string[];
}

export interface TaskResponse {
  taskId: string;
  modelId: string;
  runMode: RunMode;
  rawOutput: string;
  parsedOutput: ParsedOutput | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Per-Item Score
// ---------------------------------------------------------------------------

export interface ItemScore {
  taskId: string;
  category: ReasoningCategory;
  chcFactor: CHCFactor;
  chcSecondaryFactor?: CHCFactor;
  chcPrimaryWeight: number;
  chcSecondaryWeight?: number;
  tier: DifficultyTier;
  correct: boolean;
  partialCredit: number;
  weightedScore: number;
  traceConsistencyScore: number;
  constraintAdherenceScore: number;
  outputComplianceScore: number;
  irt: IRTParameters;
}

// ---------------------------------------------------------------------------
// IRT Estimation Output
// ---------------------------------------------------------------------------

export type ThetaMethod = "MLE" | "EAP";

export interface ThetaEstimate {
  theta: number;
  se: number;
  information: number;
  method: ThetaMethod;
  converged: boolean;
  iterations: number;
}

// ---------------------------------------------------------------------------
// CHC Factor Score
// ---------------------------------------------------------------------------

export interface CHCFactorScore {
  factor: CHCFactor;
  factorLabel: string;
  theta: ThetaEstimate;
  itemCount: number;
  iqEquivalent: number;
  confidenceInterval: {
    lower: number;
    upper: number;
    level: 0.95;
  };
  itemBreakdown: Array<{
    taskId: string;
    correct: boolean;
    partialCredit: number;
  }>;
}

// ---------------------------------------------------------------------------
// IQ Classification
// ---------------------------------------------------------------------------

export type IQClassification =
  | "Very Low"
  | "Low"
  | "Low Average"
  | "Average"
  | "High Average"
  | "Superior"
  | "Very Superior";

// ---------------------------------------------------------------------------
// Composite Intelligence Score
// ---------------------------------------------------------------------------

export interface CategoryScore {
  category: ReasoningCategory;
  label: string;
  itemCount: number;
  correctCount: number;
  accuracy: number;
  weightedScore: number;
}

export interface CompositeIQ {
  fullScaleIQ: number;
  confidenceInterval: {
    lower: number;
    upper: number;
    level: 0.95;
  };
  percentile: number;
  classification: IQClassification;
}

export interface IntelligenceScore {
  itemScores: ItemScore[];
  categoryScores: CategoryScore[];
  factorScores: CHCFactorScore[];
  compositeIQ: CompositeIQ;
}

// ---------------------------------------------------------------------------
// Full Run Result
// ---------------------------------------------------------------------------

export interface IntelligenceRunResult {
  runId: string;
  benchmarkVersion: string;
  modelId: string;
  runMode: RunMode;
  taskSetId: string;
  startedAt: string;
  completedAt: string;
  responses: TaskResponse[];
  score: IntelligenceScore;
  usage: {
    totalInputTokens: number;
    totalOutputTokens: number;
    estimatedCostUsd: number;
  };
  antiContamination: {
    taskSetHash: string;
    holdoutItemsUsed: number;
    variantRotation: string[];
  };
}

// ---------------------------------------------------------------------------
// Task Bank Manifest
// ---------------------------------------------------------------------------

export interface TaskBankManifest {
  version: string;
  totalTasks: number;
  categories: Record<ReasoningCategory, {
    label: string;
    chcPrimary: CHCFactor;
    taskCount: number;
    tiers: Record<DifficultyTier, number>;
  }>;
  holdoutCount: number;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Norm Table (for IQ conversion)
// ---------------------------------------------------------------------------

export interface NormTable {
  version: string;
  population: "model" | "human";
  sampleSize: number;
  mean: number;
  sd: number;
  lastUpdated: string;
}

export const DEFAULT_NORM: Readonly<NormTable> = Object.freeze({
  version: "1.0",
  population: "model",
  sampleSize: 0,
  mean: 0,
  sd: 1,
  lastUpdated: "2026-04-16",
});
