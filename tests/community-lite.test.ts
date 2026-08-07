import { describe, it, expect } from "vitest";
import { fromCommunityLite } from "../src/community-lite.js";
import type { CommunityLiteInput } from "../src/community-lite.js";
import { computeCruxScore } from "../src/score.js";

const HEALTHY_CE_RUN: CommunityLiteInput = {
  events_read_ratio: 0.92,
  version_chain_accuracy: 0.85,
  fact_recall: 0.78,
  coverage_score: 0.65,
  mrr: 0.71,
  latency_p50_ms: 42,
  latency_p95_ms: 120,
  errors: 0,
  total_queries: 50,
};

const ERRORED_CE_RUN: CommunityLiteInput = {
  ...HEALTHY_CE_RUN,
  errors: 3,
};

const MINIMAL_CE_RUN: CommunityLiteInput = {
  events_read_ratio: null,
  version_chain_accuracy: null,
  fact_recall: null,
  coverage_score: null,
  mrr: null,
  latency_p50_ms: 100,
  latency_p95_ms: null,
  errors: 0,
  total_queries: 10,
};

describe("fromCommunityLite", () => {
  it("maps pipeline metrics to correct fundamentals", () => {
    const { fundamentals } = fromCommunityLite(HEALTHY_CE_RUN);
    expect(fundamentals.R_retrieval).toBe(0.92);
    expect(fundamentals.R_supersession).toBe(0.85);
    expect(fundamentals.R_decision).toBe(0.78);
    expect(fundamentals.A_coverage).toBe(0.65);
    expect(fundamentals.T_task_s).toBeCloseTo(0.042, 3);
    expect(fundamentals.S_gate).toBe(1);
    expect(fundamentals.N_tools).toBe(50);
  });

  it("sets agent-layer dimensions to null", () => {
    const { fundamentals } = fromCommunityLite(HEALTHY_CE_RUN);
    expect(fundamentals.R_constraint).toBeNull();
    expect(fundamentals.R_incident).toBeNull();
    expect(fundamentals.P_context).toBeNull();
    expect(fundamentals.K_decision).toBeNull();
    expect(fundamentals.K_causal).toBeNull();
    expect(fundamentals.K_checkpoint).toBeNull();
    expect(fundamentals.K_synthesis).toBeNull();
    expect(fundamentals.S_detect).toBeNull();
    expect(fundamentals.N_corrections).toBe(0);
  });

  it("sets safety_context to ungated", () => {
    const { metadata } = fromCommunityLite(HEALTHY_CE_RUN);
    expect(metadata.safety_context).toBe("ungated");
  });

  it("preserves extra metrics (MRR, p95)", () => {
    const { extra } = fromCommunityLite(HEALTHY_CE_RUN);
    expect(extra.mrr).toBe(0.71);
    expect(extra.latency_p95_ms).toBe(120);
  });

  it("maps errors > 0 to S_gate = 0", () => {
    const { fundamentals } = fromCommunityLite(ERRORED_CE_RUN);
    expect(fundamentals.S_gate).toBe(0);
  });

  it("handles null optional metrics", () => {
    const { fundamentals, extra } = fromCommunityLite(MINIMAL_CE_RUN);
    expect(fundamentals.R_retrieval).toBeNull();
    expect(fundamentals.R_supersession).toBeNull();
    expect(fundamentals.R_decision).toBeNull();
    expect(fundamentals.A_coverage).toBeNull();
    expect(fundamentals.T_task_s).toBeCloseTo(0.1, 3);
    expect(extra.mrr).toBeNull();
    expect(extra.latency_p95_ms).toBeNull();
  });

  it("accepts optional t_human_s", () => {
    const input = { ...HEALTHY_CE_RUN, t_human_s: 300 };
    const { fundamentals } = fromCommunityLite(input);
    expect(fundamentals.T_human_s).toBe(300);
  });

  it("defaults T_human_s to null when not provided", () => {
    const { fundamentals } = fromCommunityLite(HEALTHY_CE_RUN);
    expect(fundamentals.T_human_s).toBeNull();
  });

  describe("integration with computeCruxScore", () => {
    it("healthy CE run produces valid partial CruxScore", () => {
      const { fundamentals, metadata } = fromCommunityLite({
        ...HEALTHY_CE_RUN,
        t_human_s: 300,
      });
      const score = computeCruxScore(fundamentals, undefined, metadata);

      expect(score.metrics_version).toBe("1.3");
      expect(score.composite.S_gate).toBe(1);
      // Cx_em computable because t_human_s is set and Q_info has data
      expect(score.composite.Cx_em).not.toBeNull();
      expect(score.composite.Cx_em!).toBeGreaterThan(0);
      // Q_info = R_decision / 1 (only non-null component)
      expect(score.derived.Q_info).toBeCloseTo(0.78, 2);
      // Q_context null (P_context is null)
      expect(score.derived.Q_context).toBeNull();
      // Q_continuity null (all K_ are null)
      expect(score.derived.Q_continuity).toBeNull();
      // Q_safety: ungated skips S_detect, S_stale is null → 1.0
      expect(score.derived.Q_safety).toBe(1.0);
      expect(score.metadata?.safety_context).toBe("ungated");
    });

    it("errored CE run scores zero", () => {
      const { fundamentals, metadata } = fromCommunityLite({
        ...ERRORED_CE_RUN,
        t_human_s: 300,
      });
      const score = computeCruxScore(fundamentals, undefined, metadata);
      expect(score.composite.Cx_em).toBe(0);
      expect(score.composite.S_gate).toBe(0);
    });

    it("CE run without t_human_s produces null Cx_em", () => {
      const { fundamentals, metadata } = fromCommunityLite(HEALTHY_CE_RUN);
      const score = computeCruxScore(fundamentals, undefined, metadata);
      // No human baseline → can't compute Effective Minutes
      expect(score.composite.Cx_em).toBeNull();
    });
  });
});
