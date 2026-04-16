import { describe, it, expect } from "vitest";
import { scoreItem } from "../scoring/item-scorer.js";
import type { IntelligenceTask, TaskResponse, ParsedOutput } from "../lib/types.js";
import { DEFAULT_SCORING_WEIGHTS } from "../lib/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseTask: IntelligenceTask = {
  taskId: "TEST001",
  version: 1,
  category: "A",
  categoryLabel: "Deduction & Elimination",
  tier: 1,
  chcPrimaryFactor: "Gf",
  irt: { model: "2PL", a: 1.0, b: 0.0, c: 0 },
  track: "R1",
  statement: "Test task",
  constraints: ["must be lowercase"],
  answerType: "exact",
  correctAnswer: "alice",
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

function makeResponse(parsed: ParsedOutput | null): TaskResponse {
  return {
    taskId: "TEST001",
    modelId: "test-model",
    runMode: "closed_prompt_only",
    rawOutput: parsed ? JSON.stringify(parsed) : "",
    parsedOutput: parsed,
    latencyMs: 1000,
    inputTokens: 100,
    outputTokens: 50,
    timestamp: "2026-04-16T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Exact match
// ---------------------------------------------------------------------------

describe("scoreItem — exact match", () => {
  it("scores correct answer", () => {
    const result = scoreItem(baseTask, makeResponse({
      final_answer: "Alice",
      confidence: 0.95,
      working: ["Step 1: Process of elimination", "Therefore Alice"],
    }));
    expect(result.correct).toBe(true);
    expect(result.partialCredit).toBe(1);
    expect(result.weightedScore).toBeGreaterThan(0.7);
  });

  it("scores incorrect answer", () => {
    const result = scoreItem(baseTask, makeResponse({
      final_answer: "Bob",
      confidence: 0.5,
      working: ["Guessing Bob"],
    }));
    expect(result.correct).toBe(false);
    expect(result.partialCredit).toBe(0);
  });

  it("handles case-insensitive matching", () => {
    const result = scoreItem(baseTask, makeResponse({
      final_answer: "ALICE",
      confidence: 0.9,
      working: ["Found Alice"],
    }));
    expect(result.correct).toBe(true);
  });

  it("accepts variant answers", () => {
    const task: IntelligenceTask = {
      ...baseTask,
      acceptableVariants: ["alice smith", "a. smith"],
    };
    const result = scoreItem(task, makeResponse({
      final_answer: "Alice Smith",
      confidence: 0.9,
      working: ["Alice Smith"],
    }));
    expect(result.correct).toBe(true);
  });

  it("scores null parsed output as zero", () => {
    const result = scoreItem(baseTask, makeResponse(null));
    expect(result.correct).toBe(false);
    expect(result.weightedScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Set match
// ---------------------------------------------------------------------------

describe("scoreItem — set match", () => {
  const setTask: IntelligenceTask = {
    ...baseTask,
    taskId: "SET001",
    answerType: "set",
    correctAnswer: ["red", "blue", "green"],
  };

  it("scores correct set (order independent)", () => {
    const result = scoreItem(setTask, makeResponse({
      final_answer: ["green", "red", "blue"],
      confidence: 0.9,
      working: ["All three colors"],
    }));
    expect(result.correct).toBe(true);
  });

  it("scores incorrect set", () => {
    const result = scoreItem(setTask, makeResponse({
      final_answer: ["red", "yellow"],
      confidence: 0.5,
      working: ["Guessing"],
    }));
    expect(result.correct).toBe(false);
  });

  it("applies partial credit for subset", () => {
    const taskWithPartial: IntelligenceTask = {
      ...setTask,
      partialCreditRules: [{ condition: "contains_correct_subset", credit: 0.5 }],
    };
    const result = scoreItem(taskWithPartial, makeResponse({
      final_answer: ["red", "blue"],
      confidence: 0.6,
      working: ["Found two of three"],
    }));
    expect(result.correct).toBe(false);
    expect(result.partialCredit).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Ordered list match
// ---------------------------------------------------------------------------

describe("scoreItem — ordered list", () => {
  const orderedTask: IntelligenceTask = {
    ...baseTask,
    taskId: "ORD001",
    answerType: "ordered_list",
    correctAnswer: ["first", "second", "third"],
  };

  it("scores correct order", () => {
    const result = scoreItem(orderedTask, makeResponse({
      final_answer: ["first", "second", "third"],
      confidence: 0.95,
      working: ["Correct order"],
    }));
    expect(result.correct).toBe(true);
  });

  it("scores wrong order as incorrect with partial credit", () => {
    const result = scoreItem(orderedTask, makeResponse({
      final_answer: ["second", "first", "third"],
      confidence: 0.5,
      working: ["Close but wrong order"],
    }));
    expect(result.correct).toBe(false);
    // 1 out of 3 correct positions
    expect(result.partialCredit).toBeCloseTo(1 / 3, 2);
  });
});

// ---------------------------------------------------------------------------
// Trace consistency
// ---------------------------------------------------------------------------

describe("scoreItem — trace consistency", () => {
  it("gives higher trace score for logical connectives", () => {
    const goodTrace = scoreItem(baseTask, makeResponse({
      final_answer: "Alice",
      confidence: 0.9,
      working: [
        "From the clues, Bob cannot sit in position 1",
        "Therefore Alice must be in position 1",
        "Since Alice is in position 1, the answer is Alice",
      ],
    }));

    const badTrace = scoreItem(baseTask, makeResponse({
      final_answer: "Alice",
      confidence: 0.9,
      working: ["Alice"],
    }));

    expect(goodTrace.traceConsistencyScore).toBeGreaterThan(badTrace.traceConsistencyScore);
  });
});

// ---------------------------------------------------------------------------
// Output compliance
// ---------------------------------------------------------------------------

describe("scoreItem — output compliance", () => {
  it("gives full compliance for complete response", () => {
    const result = scoreItem(baseTask, makeResponse({
      final_answer: "Alice",
      confidence: 0.9,
      working: ["Step 1"],
    }));
    expect(result.outputComplianceScore).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// CHC mapping
// ---------------------------------------------------------------------------

describe("scoreItem — CHC factor mapping", () => {
  it("maps category A to Gf with weight 1.0", () => {
    const result = scoreItem(baseTask, makeResponse({
      final_answer: "Alice",
      confidence: 0.9,
      working: ["Step"],
    }));
    expect(result.chcFactor).toBe("Gf");
    expect(result.chcPrimaryWeight).toBe(1.0);
    expect(result.chcSecondaryFactor).toBeUndefined();
  });

  it("maps category C to Gc with Gf secondary", () => {
    const cTask: IntelligenceTask = {
      ...baseTask,
      category: "C",
      chcPrimaryFactor: "Gc",
      chcSecondaryFactor: "Gf",
    };
    const result = scoreItem(cTask, makeResponse({
      final_answer: "Alice",
      confidence: 0.9,
      working: ["Step"],
    }));
    expect(result.chcFactor).toBe("Gc");
    expect(result.chcSecondaryFactor).toBe("Gf");
    expect(result.chcPrimaryWeight).toBe(0.6);
    expect(result.chcSecondaryWeight).toBe(0.4);
  });
});
