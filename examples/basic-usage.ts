// Basic ScoreCrux usage — compute agent effectiveness from benchmark fundamentals.
//
// Run with: npx tsx examples/basic-usage.ts

import { computeCruxScore } from "../src/index.js";

// A hypothetical agent benchmark run: the agent designed an auth module
// in 156 seconds. A human expert would take 30 minutes (1800s).
const result = computeCruxScore({
  // Time
  T_orient_s: 4.2,       // 4.2 seconds to first substantive action
  T_task_s: 156.3,       // 156.3 seconds total
  T_human_s: 1800,       // 30 minutes human baseline

  // Information — how well did the agent recall relevant context?
  R_decision: 0.875,     // found 7/8 expected decision keys
  R_constraint: 1.0,     // found all constraint keywords
  R_incident: 1,         // surfaced the relevant incident
  P_context: 0.72,       // used 72% of loaded context
  A_coverage: 0.0,       // did not assess coverage gaps

  // Continuity — not tested in this run (single session)
  K_decision: null,
  K_causal: null,
  K_checkpoint: null,

  // Safety — agent was safe and checked constraints
  S_gate: 1,             // no unsafe actions
  S_detect: 1,           // used constraint-checking tools
  S_stale: 1.0,          // flagged all stale inputs

  // Economic
  C_tokens_usd: 0.024,   // $0.024 total token cost
  N_tools: 8,            // 8 tool calls
  N_turns: 14,           // 14 conversation turns
  N_corrections: 0,      // no user corrections needed

  // Later-version extensions are optional. Omit them until your harness
  // measures them, or pass explicit nulls if you prefer a fully dense object.
  R_temporal: null,
  R_supersession: null,
  A_abstention: null,
  R_retrieval: null,
  R_proposition: null,
  C_contradiction: null,
  K_synthesis: null,
});

console.log("=== Crux Score ===");
console.log(`Cx = ${result.composite.Cx_em} Em`);
console.log(`Interpretation: This session replaced ~${result.composite.Cx_em} effective minutes of expert work.`);
console.log();

console.log("=== Derived Metrics ===");
console.log(`Information Quality (Q_info):   ${result.derived.Q_info?.toFixed(3)}`);
console.log(`Context Efficiency (Q_context): ${result.derived.Q_context?.toFixed(3)}`);
console.log(`Continuity Quality:             ${result.derived.Q_continuity ?? "n/a (single session)"}`);
console.log(`Safety Quality (Q_safety):      ${result.derived.Q_safety?.toFixed(3)}`);
console.log(`Time Compression (V_time):      ${result.derived.V_time?.toFixed(1)}x faster than human`);
console.log(`Cost per Quality (V_cost):      $${result.derived.V_cost?.toFixed(4)}`);
console.log(`Orient Ratio (V_orient):        ${((result.derived.V_orient ?? 0) * 100).toFixed(1)}% of session spent orienting`);
