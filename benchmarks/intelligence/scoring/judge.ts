// ScoreCrux Intelligence Benchmark — answer-equivalence judge
//
// The deterministic scorer in item-scorer.ts compares normalised strings, and
// that normalisation folds case and whitespace but not punctuation, label
// style, or prose-vs-list phrasing. So a response that states exactly the
// fixture's answer in its own words scores as a miss:
//
//   fixture  "a: 8, b: 12, c: 20"      answer  "A=8, B=12, C=20"          (B003)
//   fixture  "worker 1: task a (0-3)…" answer  "Worker 2: A (0–3), …"     (F002)
//
// That penalises models for prose style rather than reasoning. This module
// adds a second opinion for those cases only.
//
// Design rules, in order of importance:
//
//  1. RESCUE-ONLY. A judge is consulted only for items the deterministic
//     scorer already marked wrong, and it can only flip wrong → right. Items
//     that pass deterministically never depend on a model call, so a passing
//     score stays reproducible.
//  2. EQUIVALENCE, NOT CORRECTNESS. Judges are asked whether the candidate
//     states the same answer as the reference — never whether it is a good
//     answer. This is the difference between rescuing a formatting variant and
//     inventing credit.
//  3. FINAL ANSWER ONLY. Judges never see the `working` array. A response
//     whose reasoning is right but whose stated answer is wrong stays wrong
//     (this is exactly the Opus 5 artifact that produced run 0a9f0978).
//  4. UNANIMITY. Every configured judge must agree before an item is rescued;
//     a split decision leaves the miss standing and is recorded.
//  5. AUDITABLE. Every verdict, with its one-line reason, is written into the
//     run record next to the item it judged.
//
// The verdict schema asks for `reason` BEFORE `equivalent` deliberately: on
// serving paths without a thinking scratchpad, a model fills the first field
// it is given before it has worked anything out.

import type { IntelligenceTask, ParsedOutput } from "../lib/types.js";

export interface JudgeConfig {
  /** Model id sent to the endpoint. */
  model: string;
  /** Base URL of an Anthropic-shaped /v1/messages endpoint. */
  base: string;
}

export interface JudgeVerdict {
  model: string;
  base: string;
  /** null when the judge errored or returned unparseable output. */
  equivalent: boolean | null;
  reason: string;
  latencyMs: number;
}

export interface ItemJudgement {
  taskId: string;
  verdicts: JudgeVerdict[];
  /** True only when every judge returned `equivalent: true`. */
  rescued: boolean;
  /** True when judges returned different verdicts — recorded, never rescued. */
  split: boolean;
}

/** Parse a `model@base` judge spec, e.g. "gpt-5.6@http://host:9992". */
export function parseJudgeSpec(spec: string): JudgeConfig {
  const at = spec.lastIndexOf("@");
  if (at < 1 || at === spec.length - 1) {
    throw new Error(`Bad --judge-model "${spec}". Expected model@base, e.g. gpt-5.6@http://127.0.0.1:9992`);
  }
  return { model: spec.slice(0, at), base: spec.slice(at + 1).replace(/\/+$/, "") };
}

function asText(answer: unknown): string {
  if (typeof answer === "string") return answer;
  if (Array.isArray(answer)) return answer.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join("\n");
  return JSON.stringify(answer);
}

function buildJudgePrompt(task: IntelligenceTask, candidate: unknown): string {
  const constraints = task.constraints.length
    ? task.constraints.map(c => `- ${c}`).join("\n")
    : "(none)";

  return `You are checking one item of a reasoning benchmark. Decide ONLY whether the CANDIDATE states the same answer as the REFERENCE. You are not judging whether the candidate is well written, well reasoned, or even correct on the merits — only whether it says the same thing as the reference.

Treat as the SAME:
- different punctuation, capitalisation, separators, or key style ("A=8, B=12" vs "a: 8, b: 12")
- prose vs list vs JSON phrasing of the same content
- a different order for items the task does not order
- extra explanation, units, or restatement that does not change the answer
- interchangeable labels swapped, but ONLY when the task makes them interchangeable (e.g. two identical machines with no distinguishing constraint)

Treat as DIFFERENT:
- any differing value, name, count, time, set membership, or outcome
- the candidate omitting part of what the reference answers
- the candidate adding an element the reference excludes
- an answer that is arguably better than the reference but is not what the reference says
- anything you are unsure about

TASK
${task.statement}

CONSTRAINTS
${constraints}

REFERENCE ANSWER
${asText(task.correctAnswer)}

CANDIDATE ANSWER
${asText(candidate)}

Reply with ONLY this JSON object and nothing else:
{"reason": "<one sentence naming the specific difference, or the specific match>", "equivalent": true or false}`;
}

export function parseVerdict(raw: string): { equivalent: boolean | null; reason: string } {
  let s = raw.trim();
  if (s.startsWith("```json")) s = s.slice(7);
  else if (s.startsWith("```")) s = s.slice(3);
  if (s.endsWith("```")) s = s.slice(0, -3);
  s = s.trim();

  // Judges occasionally wrap the object in a sentence; take the first {...}.
  if (!s.startsWith("{")) {
    const open = s.indexOf("{");
    const close = s.lastIndexOf("}");
    if (open >= 0 && close > open) s = s.slice(open, close + 1);
  }

  try {
    const parsed = JSON.parse(s);
    const eq = parsed.equivalent;
    return {
      equivalent: typeof eq === "boolean" ? eq : null,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return { equivalent: null, reason: `unparseable verdict: ${raw.slice(0, 160)}` };
  }
}

async function askJudge(judge: JudgeConfig, prompt: string, timeoutMs: number): Promise<JudgeVerdict> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${judge.base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "crucible-proxy",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: judge.model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    const data = (await res.json()) as any;
    if (!res.ok || data.error) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      return { model: judge.model, base: judge.base, equivalent: null, reason: `judge error: ${msg}`, latencyMs: Date.now() - start };
    }
    const text = (data.content ?? [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    const { equivalent, reason } = parseVerdict(text);
    return { model: judge.model, base: judge.base, equivalent, reason, latencyMs: Date.now() - start };
  } catch (e: any) {
    return { model: judge.model, base: judge.base, equivalent: null, reason: `judge error: ${e?.message ?? e}`, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Collapse a panel's verdicts into a rescue decision. Exported for tests:
 * unanimity is the whole safety property, so it is worth pinning down.
 */
export function aggregateVerdicts(verdicts: JudgeVerdict[]): { verdicts: JudgeVerdict[]; rescued: boolean; split: boolean } {
  const decided = verdicts.filter(v => v.equivalent !== null);
  // A null verdict (transport error, unparseable output) never rescues.
  const rescued = verdicts.length > 0 && verdicts.every(v => v.equivalent === true);
  const split = decided.length > 1 && new Set(decided.map(v => v.equivalent)).size > 1;
  return { verdicts, rescued, split };
}

/**
 * Ask every judge whether `parsed.final_answer` says the same thing as the
 * fixture's answer. Rescues only on unanimous agreement; a null verdict (error
 * or unparseable) never rescues.
 */
export async function judgeItem(
  task: IntelligenceTask,
  parsed: ParsedOutput,
  judges: JudgeConfig[],
  timeoutMs = 180_000,
): Promise<ItemJudgement> {
  const prompt = buildJudgePrompt(task, parsed.final_answer);
  const verdicts = await Promise.all(judges.map(j => askJudge(j, prompt, timeoutMs)));

  return { taskId: task.taskId, ...aggregateVerdicts(verdicts) };
}
