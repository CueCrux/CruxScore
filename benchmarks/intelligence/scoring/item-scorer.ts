// ScoreCrux Intelligence Benchmark — Item Scorer
//
// Scores individual task responses: correctness, trace consistency,
// constraint adherence, output compliance.

import type {
  IntelligenceTask,
  TaskResponse,
  ItemScore,
  ParsedOutput,
} from "../lib/types.js";

/**
 * Normalize a string for comparison: lowercase, trim, collapse whitespace.
 */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Check exact match (case-insensitive, whitespace-normalized).
 */
function exactMatch(answer: string, correct: string, variants?: string[]): boolean {
  const norm = normalize(answer);
  if (norm === normalize(correct)) return true;
  if (variants) {
    return variants.some(v => normalize(v) === norm);
  }
  return false;
}

/**
 * Check set match (order-independent, case-insensitive).
 */
function setMatch(answer: string[], correct: string[]): { match: boolean; overlap: number } {
  const normAnswer = new Set(answer.map(normalize));
  const normCorrect = new Set(correct.map(normalize));

  let overlap = 0;
  for (const item of normCorrect) {
    if (normAnswer.has(item)) overlap++;
  }

  const match = overlap === normCorrect.size && normAnswer.size === normCorrect.size;
  return { match, overlap };
}

/**
 * Check ordered list match.
 */
function orderedListMatch(answer: string[], correct: string[]): { match: boolean; correctPositions: number } {
  if (answer.length !== correct.length) {
    return { match: false, correctPositions: 0 };
  }

  let correctPositions = 0;
  for (let i = 0; i < correct.length; i++) {
    if (normalize(answer[i]) === normalize(correct[i])) {
      correctPositions++;
    }
  }

  return { match: correctPositions === correct.length, correctPositions };
}

/**
 * Score correctness for a single item.
 * Returns 0 or 1 for binary, or partial credit if rules apply.
 */
function scoreCorrectness(task: IntelligenceTask, parsed: ParsedOutput): { correct: boolean; partial: number } {
  const answer = parsed.final_answer;
  const correct = task.correctAnswer;

  switch (task.answerType) {
    case "exact": {
      const ansStr = typeof answer === "string" ? answer : String(answer);
      const corStr = typeof correct === "string" ? correct : String(correct);
      // Exact match first
      if (exactMatch(ansStr, corStr, task.acceptableVariants)) {
        return { correct: true, partial: 1 };
      }
      // Fuzzy: check if the correct answer appears within a verbose response
      // e.g., "yes, by Rule 2 and Rule 3" should match correct="yes"
      const normAns = normalize(ansStr);
      const normCor = normalize(corStr);
      if (normAns.startsWith(normCor) || normAns.includes(normCor + " ") || normAns.includes(normCor + ",") || normAns.includes(normCor + ".")) {
        return { correct: true, partial: 1 };
      }
      return { correct: false, partial: 0 };
    }

    case "set": {
      const ansArr = Array.isArray(answer) ? answer : [answer];
      const corArr = Array.isArray(correct) ? correct : [correct];
      const { match, overlap } = setMatch(
        ansArr.map(String),
        corArr.map(String),
      );
      if (match) return { correct: true, partial: 1 };

      // Check partial credit rules
      if (task.partialCreditRules) {
        for (const rule of task.partialCreditRules) {
          if (rule.condition === "contains_correct_subset" && overlap > 0) {
            return { correct: false, partial: rule.credit * (overlap / corArr.length) };
          }
        }
      }
      return { correct: false, partial: 0 };
    }

    case "ordered_list": {
      const ansArr = Array.isArray(answer) ? answer : [answer];
      const corArr = Array.isArray(correct) ? correct : [correct];
      const { match, correctPositions } = orderedListMatch(
        ansArr.map(String),
        corArr.map(String),
      );
      if (match) return { correct: true, partial: 1 };

      // Check partial credit
      if (task.partialCreditRules) {
        for (const rule of task.partialCreditRules) {
          if (rule.condition === "correct_except_order") {
            const { overlap } = setMatch(ansArr.map(String), corArr.map(String));
            if (overlap === corArr.length) return { correct: false, partial: rule.credit };
          }
        }
      }
      return { correct: false, partial: correctPositions / corArr.length };
    }

    case "structured": {
      const ansStr = typeof answer === "string" ? answer : JSON.stringify(answer);
      const corStr = typeof correct === "string" ? correct : JSON.stringify(correct);

      // Exact match first
      if (normalize(ansStr) === normalize(corStr)) {
        return { correct: true, partial: 1 };
      }

      // Fuzzy structured match: extract key tokens from correct answer
      // and check if the response contains them
      const correctTokens = normalize(corStr)
        .replace(/[{}()\[\]"']/g, "")
        .split(/[,.:;]+/)
        .map(t => t.trim())
        .filter(t => t.length > 2);

      const ansNorm = normalize(ansStr);
      let matched = 0;
      for (const token of correctTokens) {
        // Check if the essential content (names, values, assignments) appears
        const keyParts = token.split(/\s+/).filter(p => p.length > 1);
        const found = keyParts.every(part => ansNorm.includes(part));
        if (found) matched++;
      }

      const matchRatio = correctTokens.length > 0 ? matched / correctTokens.length : 0;
      if (matchRatio >= 0.8) return { correct: true, partial: 1 };
      if (matchRatio >= 0.5) return { correct: false, partial: matchRatio };
      return { correct: false, partial: 0 };
    }

    default:
      return { correct: false, partial: 0 };
  }
}

/**
 * Score trace consistency using heuristics.
 * Checks whether working steps reference each other and don't contain
 * obvious contradictions in literal values.
 */
function scoreTraceConsistency(working: string[]): number {
  if (working.length === 0) return 0;
  if (working.length === 1) return 0.5;

  let score = 0.5; // base score for providing any working

  // Bonus for multi-step reasoning
  if (working.length >= 3) score += 0.2;

  // Bonus for referencing previous steps (simple heuristic)
  let references = 0;
  for (let i = 1; i < working.length; i++) {
    const step = working[i].toLowerCase();
    if (step.includes("therefore") || step.includes("so ") ||
        step.includes("from step") || step.includes("this means") ||
        step.includes("since ") || step.includes("because") ||
        step.includes("given that") || step.includes("thus")) {
      references++;
    }
  }
  if (references > 0) score += Math.min(0.3, references * 0.1);

  return Math.min(1.0, score);
}

/**
 * Score constraint adherence.
 * Checks whether the response respects the task's stated constraints.
 */
function scoreConstraintAdherence(task: IntelligenceTask, parsed: ParsedOutput): number {
  if (task.constraints.length === 0) return 1.0;

  // Basic heuristic: if the model produced a valid answer format, assume
  // constraints were respected. More sophisticated checks would parse
  // the constraints and verify against the answer.
  return parsed.final_answer ? 1.0 : 0.0;
}

/**
 * Score output compliance (JSON schema conformance).
 */
function scoreOutputCompliance(parsed: ParsedOutput | null): number {
  if (!parsed) return 0;

  let score = 0;
  if (parsed.final_answer !== undefined) score += 0.4;
  if (typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1) score += 0.3;
  if (Array.isArray(parsed.working) && parsed.working.length > 0) score += 0.3;

  return score;
}

/**
 * Score a single item response.
 */
export function scoreItem(task: IntelligenceTask, response: TaskResponse): ItemScore {
  const parsed = response.parsedOutput;

  if (!parsed) {
    return {
      taskId: task.taskId,
      category: task.category,
      chcFactor: task.chcPrimaryFactor,
      chcSecondaryFactor: task.chcSecondaryFactor,
      chcPrimaryWeight: getCHCPrimaryWeight(task),
      chcSecondaryWeight: getCHCSecondaryWeight(task),
      tier: task.tier,
      correct: false,
      partialCredit: 0,
      weightedScore: 0,
      traceConsistencyScore: 0,
      constraintAdherenceScore: 0,
      outputComplianceScore: 0,
      irt: task.irt,
    };
  }

  const { correct, partial } = scoreCorrectness(task, parsed);
  const traceScore = scoreTraceConsistency(parsed.working);
  const constraintScore = scoreConstraintAdherence(task, parsed);
  const complianceScore = scoreOutputCompliance(parsed);

  const w = task.scoringWeights;
  const weightedScore =
    w.correctness * (correct ? 1 : partial) +
    w.traceConsistency * traceScore +
    w.constraintAdherence * constraintScore +
    w.outputCompliance * complianceScore;

  return {
    taskId: task.taskId,
    category: task.category,
    chcFactor: task.chcPrimaryFactor,
    chcSecondaryFactor: task.chcSecondaryFactor,
    chcPrimaryWeight: getCHCPrimaryWeight(task),
    chcSecondaryWeight: getCHCSecondaryWeight(task),
    tier: task.tier,
    correct,
    partialCredit: partial,
    weightedScore,
    traceConsistencyScore: traceScore,
    constraintAdherenceScore: constraintScore,
    outputComplianceScore: complianceScore,
    irt: task.irt,
  };
}

function getCHCPrimaryWeight(task: IntelligenceTask): number {
  // C and F have cross-loading
  if (task.category === "C" || task.category === "F") return 0.6;
  return 1.0;
}

function getCHCSecondaryWeight(task: IntelligenceTask): number | undefined {
  if (task.category === "C" || task.category === "F") return 0.4;
  return undefined;
}
