// ScoreCrux — Agent Effectiveness Metric Standard
// Reference implementation of METRICS.md v1.0

export type {
  CruxFundamentals,
  CruxDerived,
  CruxComposite,
  CruxScore,
  CruxWeights,
  CruxRunMetadata,
  SafetyContext,
} from "./types.js";

export { DEFAULT_WEIGHTS } from "./types.js";
export {
  TIER_ANCHORS_S,
  HIGHEST_ANCHORED_TIER,
  TIER_RATIO,
  isDifficultyTier,
  tierIndex,
  tierToHumanSeconds,
  deriveTier,
} from "./tiers.js";
export type { DifficultyTier, TierDerivationParams } from "./tiers.js";
export {
  EFFORT_TIERS,
  isEffortTier,
  VENDOR_NATIVE,
  rigKey,
  baselineKey,
  computeLift,
  ARM_TO_BACKEND,
  backendForArm,
} from "./rig.js";
export type { EffortTier, Rig, RigResult } from "./rig.js";
export { computeDerived } from "./derived.js";
export { computeComposite } from "./composite.js";
export { computeCruxScore } from "./score.js";
export {
  extractFundamental,
  extractFundamentals,
  computeDerivedSingle,
  computeDerivedSubset,
} from "./single.js";
export type { FundamentalId, DerivedId } from "./single.js";
export { fromCommunityLite } from "./community-lite.js";
export type { CommunityLiteInput, CommunityLiteExtra } from "./community-lite.js";
export { generatePassport, verifyPassport, isValidPassportFormat } from "./passport.js";
