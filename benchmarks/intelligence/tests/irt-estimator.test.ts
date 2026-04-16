import { describe, it, expect } from "vitest";
import { estimateAbility } from "../scoring/irt-estimator.js";
import { scoreItem } from "../scoring/item-scorer.js";
import { generateReport } from "../scoring/iq-reporter.js";
import { computeCategoryScores } from "../scoring/chc-aggregator.js";
import { mapToCruxFundamentals, computeIntelligenceCruxComposite } from "../scoring/crux-integration.js";
import type { IntelligenceTask, TaskResponse, ItemScore } from "../lib/types.js";
import { DEFAULT_SCORING_WEIGHTS } from "../lib/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(taskId: string, category: string, tier: number, b: number): IntelligenceTask {
  const catMap: Record<string, { primary: string; secondary?: string }> = {
    A: { primary: "Gf" },
    B: { primary: "Gwm" },
    C: { primary: "Gc", secondary: "Gf" },
    D: { primary: "Gf" },
    E: { primary: "Gf" },
    F: { primary: "Gs", secondary: "Gf" },
  };
  const factors = catMap[category] ?? { primary: "Gf" };

  return {
    taskId,
    version: 1,
    category: category as any,
    categoryLabel: `Category ${category}`,
    tier: tier as any,
    chcPrimaryFactor: factors.primary as any,
    chcSecondaryFactor: factors.secondary as any,
    irt: { model: "2PL", a: 1.0, b, c: 0 },
    track: "R1",
    statement: `Task ${taskId}`,
    constraints: [],
    answerType: "exact",
    correctAnswer: "correct",
    responseSchema: {
      type: "object",
      properties: {
        final_answer: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        working: { type: "array", items: { type: "string" } },
      },
      required: ["final_answer", "confidence", "working"],
    },
    isHoldout: false,
    scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
  };
}

function makeResponse(taskId: string, correct: boolean): TaskResponse {
  return {
    taskId,
    modelId: "test-model",
    runMode: "closed_prompt_only",
    rawOutput: "",
    parsedOutput: {
      final_answer: correct ? "correct" : "wrong",
      confidence: correct ? 0.9 : 0.3,
      working: correct
        ? ["Step 1: Analysis", "Therefore the answer is correct"]
        : ["Guessing"],
    },
    latencyMs: 2000,
    inputTokens: 200,
    outputTokens: 100,
    timestamp: "2026-04-16T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Full pipeline integration test
// ---------------------------------------------------------------------------

describe("full scoring pipeline", () => {
  it("produces plausible IQ for a high-performing model", () => {
    const tasks = [
      makeTask("A001", "A", 1, -1.0),
      makeTask("A002", "A", 2, 0.0),
      makeTask("A003", "A", 3, 1.5),
      makeTask("B001", "B", 1, -1.0),
      makeTask("B002", "B", 2, 0.0),
      makeTask("B003", "B", 3, 1.5),
      makeTask("C001", "C", 1, -1.0),
      makeTask("C002", "C", 2, 0.0),
      makeTask("C003", "C", 3, 1.5),
      makeTask("D001", "D", 1, -1.0),
      makeTask("D002", "D", 2, 0.0),
      makeTask("D003", "D", 3, 1.5),
      makeTask("E001", "E", 1, -1.0),
      makeTask("E002", "E", 2, 0.0),
      makeTask("E003", "E", 3, 1.5),
      makeTask("F001", "F", 1, -1.0),
      makeTask("F002", "F", 2, 0.0),
      makeTask("F003", "F", 3, 1.5),
    ];

    // High performer: gets all easy+medium right, misses all hard
    const itemScores: ItemScore[] = tasks.map(task => {
      const correct = task.tier <= 2;
      return scoreItem(task, makeResponse(task.taskId, correct));
    });

    const report = generateReport(itemScores);

    // Check structure
    expect(report.itemScores).toHaveLength(18);
    expect(report.categoryScores).toHaveLength(6);
    expect(report.factorScores.length).toBeGreaterThan(0);

    // IQ should be above average (correctly solving 12/18)
    expect(report.compositeIQ.fullScaleIQ).toBeGreaterThan(90);
    expect(report.compositeIQ.fullScaleIQ).toBeLessThan(150);
    expect(report.compositeIQ.confidenceInterval.lower).toBeLessThan(report.compositeIQ.fullScaleIQ);
    expect(report.compositeIQ.confidenceInterval.upper).toBeGreaterThan(report.compositeIQ.fullScaleIQ);
    expect(report.compositeIQ.classification).toBeDefined();
  });

  it("produces lower IQ for a weak model", () => {
    const tasks = [
      makeTask("A001", "A", 1, -1.0),
      makeTask("A002", "A", 2, 0.0),
      makeTask("A003", "A", 3, 1.5),
      makeTask("B001", "B", 1, -1.0),
      makeTask("B002", "B", 2, 0.0),
      makeTask("B003", "B", 3, 1.5),
    ];

    // Weak: only gets easy right
    const itemScores: ItemScore[] = tasks.map(task => {
      const correct = task.tier === 1;
      return scoreItem(task, makeResponse(task.taskId, correct));
    });

    const report = generateReport(itemScores);

    // Should be below average
    expect(report.compositeIQ.fullScaleIQ).toBeLessThan(110);
  });

  it("differentiates strong from weak models", () => {
    const tasks = [
      makeTask("A001", "A", 1, -1.0),
      makeTask("A002", "A", 2, 0.0),
      makeTask("A003", "A", 3, 1.5),
      makeTask("B001", "B", 1, -1.0),
      makeTask("B002", "B", 2, 0.0),
      makeTask("B003", "B", 3, 1.5),
    ];

    const strongScores = tasks.map(t => scoreItem(t, makeResponse(t.taskId, true)));
    const weakScores = tasks.map(t => scoreItem(t, makeResponse(t.taskId, t.tier === 1)));

    const strongReport = generateReport(strongScores);
    const weakReport = generateReport(weakScores);

    expect(strongReport.compositeIQ.fullScaleIQ).toBeGreaterThan(weakReport.compositeIQ.fullScaleIQ);
  });
});

// ---------------------------------------------------------------------------
// Category scores
// ---------------------------------------------------------------------------

describe("category scores", () => {
  it("computes per-category accuracy", () => {
    const tasks = [
      makeTask("A001", "A", 1, -1.0),
      makeTask("A002", "A", 2, 0.0),
      makeTask("B001", "B", 1, -1.0),
    ];

    const scores = [
      scoreItem(tasks[0], makeResponse("A001", true)),
      scoreItem(tasks[1], makeResponse("A002", false)),
      scoreItem(tasks[2], makeResponse("B001", true)),
    ];

    const catScores = computeCategoryScores(scores);
    const catA = catScores.find(c => c.category === "A")!;
    const catB = catScores.find(c => c.category === "B")!;

    expect(catA.accuracy).toBe(0.5);
    expect(catB.accuracy).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// CruxFundamentals integration
// ---------------------------------------------------------------------------

describe("CruxFundamentals integration", () => {
  it("maps intelligence scores to fundamentals", () => {
    const tasks = [
      makeTask("A001", "A", 1, -1.0),
      makeTask("A002", "A", 2, 0.0),
    ];

    const itemScores = tasks.map(t => scoreItem(t, makeResponse(t.taskId, true)));
    const report = generateReport(itemScores);
    const mappings = mapToCruxFundamentals(report, 4000);

    expect(mappings.length).toBe(9);

    const rDecision = mappings.find(m => m.fundamental === "R_decision");
    expect(rDecision).toBeDefined();
    expect(rDecision!.value).toBe(1.0); // 100% accuracy
  });

  it("computes composite score", () => {
    const tasks = [makeTask("A001", "A", 1, -1.0)];
    const itemScores = tasks.map(t => scoreItem(t, makeResponse(t.taskId, true)));
    const report = generateReport(itemScores);
    const mappings = mapToCruxFundamentals(report);
    const composite = computeIntelligenceCruxComposite(mappings);

    expect(composite).toBeGreaterThan(0);
    expect(composite).toBeLessThanOrEqual(1);
  });
});
