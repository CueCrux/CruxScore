// ScoreCrux — Agent Effectiveness Metric Standard v1.0
// Type definitions matching METRICS.md

/**
 * Weights for the Crux Score composite computation.
 * w1 = Information Quality, w2 = Context Efficiency, w3 = Continuity Quality.
 */
export interface CruxWeights {
  w1: number;
  w2: number;
  w3: number;
}

/** Default weights locked at v1.0. */
export const DEFAULT_WEIGHTS: Readonly<CruxWeights> = Object.freeze({
  w1: 3,
  w2: 2,
  w3: 2,
});

/**
 * 16 fundamental dimensions across 5 categories.
 * These are the raw measurements recorded from run instrumentation.
 * Nullable fields are null when the dimension cannot be measured for a given run.
 */
export interface CruxFundamentals {
  // Time (METRICS.md §1.1)
  T_orient_s: number | null;
  T_task_s: number;
  T_human_s: number | null;

  // Information (METRICS.md §1.2)
  R_decision: number | null;
  R_constraint: number | null;
  R_incident: number | null;
  P_context: number | null;
  A_coverage: number | null;

  // Information v1.1 extensions
  R_temporal: number | null;
  R_supersession: number | null;
  A_abstention: number | null;
  R_retrieval: number | null;

  // Information v1.2 extensions (proposition-level)
  R_proposition: number | null;
  C_contradiction: number | null;

  // Information v1.3 extensions
  I_provenance: number | null;       // I10: reasoning provenance traceability
  I_premise_rejection: number | null; // I11: false-premise detection

  // Continuity (METRICS.md §1.3)
  K_decision: number | null;
  K_causal: number | null;
  K_checkpoint: number | null;
  K_synthesis: number | null;

  // Continuity v1.3 extensions
  K_novel_synthesis: number | null;  // K5: novel cross-session synthesis

  // Safety (METRICS.md §1.4)
  S_gate: 0 | 1 | null;
  S_detect: 0 | 1 | null;
  S_stale: number | null;

  // Economic (METRICS.md §1.5)
  C_tokens_usd: number;
  N_tools: number;
  N_turns: number;
  N_corrections: number;
}

/**
 * 7 derived metrics computed from fundamentals.
 * See METRICS.md §2 for formulas.
 */
export interface CruxDerived {
  // Quality (§2.1)
  Q_info: number | null;
  Q_context: number | null;
  Q_continuity: number | null;
  Q_safety: number | null;
  Q_abstention: number | null;

  // Proposition quality (§2.1)
  Q_proposition: number | null;

  // Efficiency (§2.2)
  V_time: number | null;
  V_cost: number | null;
  V_orient: number | null;
  V_retrieval: number | null;
}

/**
 * The Crux Score composite — a single metric in Effective Minutes (Em).
 * See METRICS.md §3 for definition and interpretation.
 */
export interface CruxComposite {
  Cx_em: number | null;
  weights: CruxWeights;
  S_gate: 0 | 1 | null;
}

/** Safety context — whether the run had MCP safety tooling available. */
export type SafetyContext = "gated" | "ungated";

/**
 * Memory system declaration — what (if any) memory/retrieval system backed
 * the agent during a benchmark run.
 *
 * Every submission must declare its memory system. If none was used, set
 * `used: false`. This ensures leaderboard results are comparable and
 * transparently attributed.
 */
export interface MemorySystemDeclaration {
  /** Whether a memory system was used during the run. */
  used: boolean;
  /** Identifier of the memory system (e.g., "Crux", "VaultCrux", "MemoryCrux",
   *  "Mem0", "Zep", "LangGraph", or any custom system).
   *  Required when `used` is true. */
  name?: string;
  /** Version string of the memory system (semver, git SHA, or release tag).
   *  Required when `used` is true. */
  version?: string;
  /** Optional variant or configuration label (e.g., "with-ollama-embeddings",
   *  "keyword-only", "v5.1-gpu"). */
  variant?: string;
}

/**
 * Run metadata — optional contextual information that accompanies a ScoreCrux
 * result. safety_context affects Q_safety computation.
 */
export interface CruxRunMetadata {
  /** Whether MCP constraint-checking tools were available during this run.
   *  "gated" = tools available (S_detect is meaningful).
   *  "ungated" = no safety tooling (S_detect treated as null for Q_safety). */
  safety_context?: SafetyContext;
  /** Canonical drift category if drift was detected during this run.
   *  See PlanCrux/docs/reference/drift-classification-taxonomy.md */
  drift_category?: string;
  /** Receipt schema version active during this run */
  receipt_schema_version?: string;
  /** Shield manifest hash active during this run (AIVSS policy provenance) */
  shield_manifest_hash?: string;
  /** Memory system declaration — required on submission. */
  memory_system?: MemorySystemDeclaration;
}

/**
 * Complete Crux Score output for a single run.
 */
export interface CruxScore {
  metrics_version: "1.0" | "1.1" | "1.2" | "1.3";
  fundamentals: CruxFundamentals;
  derived: CruxDerived;
  composite: CruxComposite;
  /** Optional run metadata for drift classification and policy provenance */
  metadata?: CruxRunMetadata;
}
