// CruxScore — Agent Effectiveness Metric Standard
// Reference implementation of METRICS.md v1.0

export type {
  CruxFundamentals,
  CruxDerived,
  CruxComposite,
  CruxScore,
  CruxWeights,
} from "./types.js";

export { DEFAULT_WEIGHTS } from "./types.js";
export { computeDerived } from "./derived.js";
export { computeComposite } from "./composite.js";
export { computeCruxScore } from "./score.js";

// Synthetic Data Engine
export type {
  SynthPersona,
  SynthSession,
  SynthQuery,
  SynthFeedback,
  SynthFact,
  SynthEntityInstance,
  SynthGenerationConfig,
  SynthDataset,
  SynthDistribution,
  DemographicSegment,
  TopicCluster,
  ReasoningTier,
  SessionArc,
  PredicateRole,
} from "./synth-types.js";

export { generateSynthDataset, defaultDistribution } from "./synth-engine.js";
export { analyseAndAdjust, distributionHealth } from "./synth-analyser.js";
export type { UsageTelemetry } from "./synth-analyser.js";

// Taxonomy (for consumers that need the raw entity/query templates)
export { ENTITY_TAXONOMY, QUERY_TEMPLATES, CATEGORY_SIMILARITIES, LOCATIONS } from "./synth-taxonomy.js";
