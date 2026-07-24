#!/usr/bin/env npx tsx
/**
 * ScoreCrux Intelligence Benchmark — CLI entry point.
 *
 * Runs the psychometric intelligence benchmark: loads tasks, prompts a model,
 * scores responses, estimates IRT theta, computes CHC factor scores, and
 * produces an IQ-equivalent composite.
 *
 * Usage:
 *   npx tsx run-intelligence.ts --model claude-opus-5
 *   npx tsx run-intelligence.ts --model gpt-5.4 --mode closed_prompt_only --categories A,B,D
 *   npx tsx run-intelligence.ts --dry-run --verbose
 *   npx tsx run-intelligence.ts --model claude-sonnet-5 --items-per-category 2 --output results/run1.json
 *   npx tsx run-intelligence.ts --model claude-opus-5 --max-tokens 32000   # bigger output budget
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  IntelligenceTask,
  TaskResponse,
  ItemScore,
  RunMode,
  ReasoningCategory,
  DifficultyTier,
  IntelligenceRunResult,
  ParsedOutput,
} from "./lib/types.js";
import { selectTaskSet, DEFAULT_TIERS } from "./lib/task-loader.js";
import { parseResponse } from "./lib/response-parser.js";
import { hashTaskSet } from "./lib/anti-contamination.js";
import { scoreItem } from "./scoring/item-scorer.js";
import { generateReport } from "./scoring/iq-reporter.js";
import { mapToCruxFundamentals, computeIntelligenceCruxComposite } from "./scoring/crux-integration.js";
import { judgeItem, parseJudgeSpec, type JudgeConfig, type ItemJudgement } from "./scoring/judge.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CLIArgs {
  model: string;
  mode: RunMode;
  categories: ReasoningCategory[];
  /** Difficulty tiers to draw from. */
  tiers: DifficultyTier[];
  /** Undefined = one item per selected tier. */
  itemsPerCategory?: number;
  dryRun: boolean;
  verbose: boolean;
  interactive: boolean;
  output: string;
  claimCode?: string;
  submitUrl: string;
  /** Undefined = per-model default (see defaultMaxTokens). */
  maxTokens?: number;
  allowTruncated: boolean;
  /** False drops the (redundant) system prompt — see SYSTEM_PROMPT. */
  systemPrompt: boolean;
  /** Judge panel consulted on deterministic misses only (rescue-only). */
  judges: JudgeConfig[];
  /** Repeat the whole run this many times and report the stack. */
  runs: number;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    model: "claude-sonnet-4-20250514",
    mode: "closed_prompt_only",
    categories: ["A", "B", "C", "D", "E", "F", "G"],
    tiers: [...DEFAULT_TIERS],
    itemsPerCategory: undefined,
    dryRun: false,
    verbose: false,
    interactive: false,
    output: "",
    // Env fallback keeps the code off argv (visible in `ps`); --claim-code overrides.
    claimCode: process.env.SCORECRUX_CLAIM_CODE || undefined,
    submitUrl: "https://scorecrux.com",
    maxTokens: undefined,
    allowTruncated: false,
    systemPrompt: true,
    judges: [],
    runs: 1,
  };

  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];

    switch (flag) {
      case "--model":
        args.model = next;
        i++;
        break;
      case "--mode":
        args.mode = next as RunMode;
        i++;
        break;
      case "--categories":
        args.categories = next.split(",").map(s => s.trim().toUpperCase()) as ReasoningCategory[];
        i++;
        break;
      case "--items-per-category":
        args.itemsPerCategory = parseInt(next, 10);
        i++;
        break;
      case "--tiers":
        args.tiers = next.split(",").map(t => parseInt(t.trim(), 10)) as DifficultyTier[];
        i++;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--verbose":
        args.verbose = true;
        break;
      case "--interactive":
        args.interactive = true;
        break;
      case "--output":
        args.output = next;
        i++;
        break;
      case "--claim-code":
        args.claimCode = next;
        i++;
        break;
      case "--submit-url":
        args.submitUrl = next;
        i++;
        break;
      case "--max-tokens":
        args.maxTokens = parseInt(next, 10);
        i++;
        break;
      case "--allow-truncated":
        args.allowTruncated = true;
        break;
      case "--no-system-prompt":
        args.systemPrompt = false;
        break;
      case "--judge":
        // Default panel: one Claude, one GPT, both off the local Crucible
        // subscription planes, and neither of them the model under test.
        args.judges = [
          parseJudgeSpec("claude-opus-4-8@http://100.75.64.43:10010"),
          parseJudgeSpec("gpt-5.6@http://100.75.64.43:9992"),
        ];
        break;
      case "--judge-model":
        args.judges.push(parseJudgeSpec(next));
        i++;
        break;
      case "--runs":
        args.runs = Math.max(1, parseInt(next, 10));
        i++;
        break;
      default:
        console.error(`Unknown flag: ${flag}`);
        process.exit(1);
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Task prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(task: IntelligenceTask): string {
  let prompt = `You are being evaluated on a reasoning benchmark. Answer the following task.\n\n`;
  prompt += `## Task\n\n${task.statement}\n\n`;

  if (task.constraints.length > 0) {
    prompt += `## Constraints\n\n`;
    for (const c of task.constraints) {
      prompt += `- ${c}\n`;
    }
    prompt += `\n`;
  }

  if (task.contextPack) {
    prompt += `## Context\n\n${task.contextPack}\n\n`;
  }

  prompt += `## Response Format\n\n`;
  prompt += `Respond with a JSON object containing:\n`;
  prompt += `- "final_answer": your answer (string or array)\n`;
  prompt += `- "confidence": a number between 0 and 1\n`;
  prompt += `- "working": an array of strings showing your reasoning steps\n\n`;
  prompt += `Respond ONLY with the JSON object, no other text.\n`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Model pricing (USD per 1M tokens)
// ---------------------------------------------------------------------------

interface PricePerMillion { input: number; output: number; }

/**
 * Pricing table for estimatedCostUsd. Matched by prefix — e.g.
 * "claude-opus-4-7" or "claude-opus-4-20250514" both hit the "claude-opus"
 * row. Update the rates when Anthropic/OpenAI publish new pricing.
 * Rates are USD per 1M tokens.
 */
const MODEL_PRICING: Array<{ match: RegExp; price: PricePerMillion }> = [
  { match: /^claude-fable-5/,         price: { input: 10.0, output: 50.0 } }, // Fable 5 tier
  { match: /^claude-mythos-5/,        price: { input: 10.0, output: 50.0 } }, // Mythos 5 (same tier as Fable 5)
  { match: /^claude-opus-5/,          price: { input: 5.0,  output: 25.0 } }, // Opus 5 — Opus 4.8 list price
  { match: /^claude-sonnet-5/,        price: { input: 3.0,  output: 15.0 } },
  { match: /^claude-opus-4-8/,        price: { input: 5.0,  output: 25.0 } },
  { match: /^claude-opus-4-7/,        price: { input: 5.0,  output: 25.0 } }, // inherits 4-family pricing
  { match: /^claude-opus-4-6/,        price: { input: 5.0,  output: 25.0 } },
  { match: /^claude-opus-4-(\d+|20)/, price: { input: 15.0, output: 75.0 } }, // 4.x family
  { match: /^claude-sonnet-4/,        price: { input: 3.0,  output: 15.0 } },
  { match: /^claude-haiku-4/,         price: { input: 1.0,  output: 5.0 } },
  { match: /^gpt-5\.5/,               price: { input: 2.50, output: 10.0 } }, // estimate; unpublished
  { match: /^gpt-5\.4-nano/,          price: { input: 0.10, output: 0.40 } },
  { match: /^gpt-5\.4-mini/,          price: { input: 0.40, output: 1.60 } },
  { match: /^gpt-5\.4/,               price: { input: 2.50, output: 10.0 } },
  { match: /^gpt-4\.1-nano/,          price: { input: 0.10, output: 0.40 } },
  { match: /^gpt-4\.1-mini/,          price: { input: 0.40, output: 1.60 } },
  { match: /^gpt-4\.1/,               price: { input: 2.00, output: 8.00 } },
];

function estimateModelCost(model: string, inputTokens: number, outputTokens: number): number {
  const row = MODEL_PRICING.find(r => r.match.test(model));
  if (!row) return 0;
  return (inputTokens / 1_000_000) * row.price.input
       + (outputTokens / 1_000_000) * row.price.output;
}

// ---------------------------------------------------------------------------
// Output budget
// ---------------------------------------------------------------------------

/**
 * Models whose extended thinking is ON by default. `max_tokens` caps thinking
 * AND visible text together, so the historical 4096 budget can be spent inside
 * the thinking block and truncate the JSON answer — scoring a capable model as
 * wrong. These get a larger default; every other model keeps 4096 so previously
 * published runs stay comparable. Override either with --max-tokens.
 */
/**
 * Bank version. 1.0 = the original 18 items (tiers 1-3). 1.1 = the 30-item
 * bank that added tiers 4-5 after the frontier hit the old ceiling. A score is
 * only meaningful against the bank it was measured on.
 */
const BENCHMARK_VERSION = "1.2";

const THINKING_ON_BY_DEFAULT = /^claude-(opus-5|fable-5|mythos-5|sonnet-5)/;
const DEFAULT_MAX_TOKENS = 4096;
const THINKING_MAX_TOKENS = 16000;

function defaultMaxTokens(model: string): number {
  return THINKING_ON_BY_DEFAULT.test(model) ? THINKING_MAX_TOKENS : DEFAULT_MAX_TOKENS;
}

// ---------------------------------------------------------------------------
// Model caller
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

/**
 * Restates the response contract that buildPrompt() already puts in the user
 * turn. Redundant by design — it exists to pin the format on providers that
 * weight the system turn more heavily.
 *
 * `--no-system-prompt` drops it. Needed on subscription backends that deliver
 * it via the Claude CLI's `--append-system-prompt`, where it lands on top of
 * Claude Code's own agent prompt rather than acting as a plain API system
 * turn. Measured on claude-opus-5 through Crucible 2026-07-24: with the
 * system prompt, `final_answer` on B001 came back 15/17/18 across samples
 * while the same response's `working` array derived the correct 8 — the model
 * commits to the first field before it reasons. Without it, 8 every time.
 * claude-sonnet-5, claude-fable-5 and claude-opus-4-8 answer correctly either
 * way, so this is specific to Opus 5 on that path. Any run that drops it must
 * say so alongside the score.
 */
const SYSTEM_PROMPT =
  "You are taking a psychometric reasoning test. For each item, respond with a JSON object: { \"final_answer\": \"your answer\", \"confidence\": 0.0-1.0, \"working\": [\"step 1\", \"step 2\", ...] }. Think carefully and show your reasoning in the working array. Give only the JSON, no other text.";

// Shared readline for interactive mode (creating multiple instances on stdin breaks piping)
let sharedRl: ReadlineInterface | null = null;

function getInteractiveRl(): ReadlineInterface {
  if (!sharedRl) {
    sharedRl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  }
  return sharedRl;
}

function readUntilMarker(marker: string): Promise<string> {
  const rl = getInteractiveRl();
  const lines: string[] = [];
  return new Promise<string>((resolve) => {
    const onLine = (line: string) => {
      if (line.trim() === marker) {
        rl.removeListener("line", onLine);
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
      }
    };
    rl.on("line", onLine);
  });
}

/**
 * Provenance captured from the model provider during a real API call.
 * Used by the submit flow to prove Tier A attribution. Remains null for
 * interactive mode (no outbound call = nothing to attest).
 */
interface ProviderProvenance {
  reportedModel: string | null;
  apiBase: string | null;
}
const provenance: ProviderProvenance = { reportedModel: null, apiBase: null };

async function callModel(
  model: string,
  prompt: string,
  _mode: RunMode,
  interactive: boolean = false,
  maxTokens: number = DEFAULT_MAX_TOKENS,
  sendSystemPrompt: boolean = true,
): Promise<{ text: string; inputTokens: number; outputTokens: number; latencyMs: number; stopReason: string | null }> {
  const start = Date.now();

  // Interactive mode: print prompt, read response from stdin.
  // Triggered either by --model interactive (legacy) or --interactive (preferred —
  // lets you set --model to the real identity so attribution tags self_reported).
  if (model === "interactive" || interactive) {
    console.log("\n── ITEM ──");
    console.log(prompt.slice(0, 500));
    console.log("\n── PASTE JSON RESPONSE (end with END_OF_RESPONSE) ──");

    const text = await readUntilMarker("END_OF_RESPONSE");
    return { text, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - start, stopReason: null };
  }

  if (model.startsWith("claude")) {
    const client = new Anthropic();
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      ...(sendSystemPrompt ? { system: SYSTEM_PROMPT } : {}),
    });

    // response.model is the canonical ID Anthropic actually served
    provenance.reportedModel = (response as any).model ?? model;
    // Record the base actually used — ANTHROPIC_BASE_URL points runs at a proxy
    // (e.g. the Crucible subscription backend) and attribution must reflect that.
    provenance.apiBase = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");

    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - start,
      stopReason: (response as any).stop_reason ?? null,
    };
  }

  if (model.startsWith("gpt") || model.startsWith("o")) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY required for OpenAI models");

    // gpt-5.x and o-series reasoning models:
    //  - use `max_completion_tokens` instead of `max_tokens`
    //  - reject prompts that tell them how to reason ("think step by step",
    //    "show your reasoning") with the policy-violation error. They
    //    reason internally and reject explicit meta-reasoning directives.
    //    The user prompt from buildPrompt() already carries the JSON
    //    response-format spec, so for gpt-5.x we skip the extra system
    //    message entirely.
    const isReasoningModel = /^(gpt-5|o[13])/.test(model);
    const messages: Array<{ role: string; content: string }> = [];
    if (!isReasoningModel && sendSystemPrompt) {
      messages.push({ role: "system", content: SYSTEM_PROMPT });
    }
    messages.push({ role: "user", content: prompt });

    const body: Record<string, unknown> = { model, messages };
    if (isReasoningModel) body.max_completion_tokens = maxTokens;
    else body.max_tokens = maxTokens;

    // OPENAI_BASE_URL lets the harness point at an OpenAI-compatible proxy
    // (e.g. the clawd subscription backend) without changing the model id.
    // Defaults to the real OpenAI API so existing behaviour is unchanged.
    const openaiBase = (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
    const res = await fetch(`${openaiBase}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as any;
    if (data.error) throw new Error(`OpenAI: ${data.error.message}`);

    provenance.reportedModel = data.model ?? res.headers.get("openai-model") ?? model;
    provenance.apiBase = openaiBase;

    return {
      text: data.choices?.[0]?.message?.content ?? "",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - start,
      stopReason: data.choices?.[0]?.finish_reason ?? null,
    };
  }

  throw new Error(`Unsupported model: ${model}. Use claude-* or gpt-*`);
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

interface RunSummary {
  runId: string;
  correct: number;
  total: number;
  iq: number;
  deterministicCorrect: number;
  deterministicIQ: number;
  outputPath: string;
}

async function executeRun(args: CLIArgs, runIndex: number, totalRuns: number): Promise<RunSummary> {
  const runId = randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();
  const maxTokens = args.maxTokens ?? defaultMaxTokens(args.model);

  console.log(`\n  ScoreCrux Intelligence Benchmark v1.0`);
  console.log(`  Run ID: ${runId}${totalRuns > 1 ? `  (run ${runIndex} of ${totalRuns})` : ""}`);
  console.log(`  Model: ${args.model}`);
  console.log(`  Mode: ${args.mode}`);
  console.log(`  Categories: ${args.categories.join(", ")}`);
  console.log(`  Tiers: ${args.tiers.join(", ")}${args.tiers.join(",") === DEFAULT_TIERS.join(",") ? " (default)" : ""}`);
  console.log(`  Items/category: ${args.itemsPerCategory ?? args.tiers.length}`);
  console.log(`  Max tokens: ${maxTokens}${args.maxTokens === undefined ? " (default)" : " (--max-tokens)"}`);
  if (!args.systemPrompt) console.log(`  System prompt: OFF (--no-system-prompt) — declare this alongside the score`);
  if (args.judges.length > 0) console.log(`  Judges: ${args.judges.map(j => `${j.model}@${j.base}`).join(", ")} (rescue-only, unanimous)`);
  if (args.dryRun) console.log(`  ** DRY RUN **`);
  console.log();

  // 1. Load task set
  const tasks = await selectTaskSet({
    categories: args.categories,
    tiers: args.tiers,
    itemsPerCategory: args.itemsPerCategory,
  });

  console.log(`  Loaded ${tasks.length} tasks\n`);

  if (tasks.length === 0) {
    console.error("  No tasks found. Check fixture directory.");
    process.exit(1);
  }

  // 2. Run each task
  const responses: TaskResponse[] = [];
  const truncatedItems: string[] = [];
  const declinedItems: string[] = [];
  let totalLatencyMs = 0;

  for (const task of tasks) {
    const prompt = buildPrompt(task);

    if (args.verbose) {
      console.log(`  [${task.taskId}] ${task.categoryLabel} (tier ${task.tier})`);
    }

    if (args.dryRun) {
      console.log(`  [${task.taskId}] DRY RUN — skipping API call`);
      responses.push({
        taskId: task.taskId,
        modelId: args.model,
        runMode: args.mode,
        rawOutput: "",
        parsedOutput: null,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    const result = await callModel(args.model, prompt, args.mode, args.interactive, maxTokens, args.systemPrompt);
    const parsed = parseResponse(result.text);
    totalLatencyMs += result.latencyMs;

    // A truncated or declined item is not a wrong answer — say so loudly rather
    // than letting it score as a miss and depress the IQ estimate silently.
    if (result.stopReason === "max_tokens" || result.stopReason === "length") {
      truncatedItems.push(task.taskId);
      console.warn(`    ! [${task.taskId}] output budget exhausted (${maxTokens} tokens) — answer truncated. Re-run with a higher --max-tokens.`);
    } else if (result.stopReason === "refusal" || result.stopReason === "content_filter") {
      declinedItems.push(task.taskId);
      console.warn(`    ! [${task.taskId}] model declined the item (stop_reason=${result.stopReason}).`);
    }

    responses.push({
      taskId: task.taskId,
      modelId: args.model,
      runMode: args.mode,
      rawOutput: result.text,
      parsedOutput: parsed,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      timestamp: new Date().toISOString(),
      stopReason: result.stopReason,
    });

    if (args.verbose && parsed) {
      console.log(`    Answer: ${JSON.stringify(parsed.final_answer)}`);
      console.log(`    Confidence: ${parsed.confidence}`);
    }
  }

  // 3. Score all items
  const itemScores: ItemScore[] = tasks.map((task, i) =>
    scoreItem(task, responses[i]),
  );

  // 3b. Judge panel — consulted only on deterministic misses, and only able to
  // flip a miss to a hit. An item the string scorer already accepted never
  // reaches a judge, so passing items stay reproducible. See scoring/judge.ts.
  const judgements: ItemJudgement[] = [];
  let judgedScores = itemScores;

  if (args.judges.length > 0 && !args.dryRun) {
    const disputed = itemScores
      .map((score, i) => ({ score, i }))
      .filter(({ score, i }) => !score.correct && responses[i].parsedOutput);

    console.log(`\n  Judging ${disputed.length} deterministic miss(es) with ${args.judges.map(j => j.model).join(" + ")}`);
    judgedScores = [...itemScores];

    for (const { score, i } of disputed) {
      const judgement = await judgeItem(tasks[i], responses[i].parsedOutput!, args.judges);
      judgements.push(judgement);

      if (judgement.rescued) {
        const w = tasks[i].scoringWeights;
        judgedScores[i] = {
          ...score,
          correct: true,
          partialCredit: 1,
          weightedScore:
            w.correctness * 1 +
            w.traceConsistency * score.traceConsistencyScore +
            w.constraintAdherence * score.constraintAdherenceScore +
            w.outputCompliance * score.outputComplianceScore,
        };
      }

      const verdict = judgement.rescued ? "RESCUED" : judgement.split ? "split — kept as miss" : "upheld as miss";
      console.log(`    [${tasks[i].taskId}] ${verdict}`);
      for (const v of judgement.verdicts) {
        console.log(`        ${v.model}: ${v.equivalent} — ${v.reason.slice(0, 120)}`);
      }
    }
  }

  // 4. Generate report (IRT + CHC + IQ)
  const report = generateReport(judgedScores);
  // Kept so a judged run can always be read back against the string scorer.
  const deterministicReport = judgements.length > 0 ? generateReport(itemScores) : null;

  // 5. CruxFundamentals integration
  const cruxMappings = mapToCruxFundamentals(report, totalLatencyMs);
  const cruxComposite = computeIntelligenceCruxComposite(cruxMappings);

  // 6. Build run result
  const completedAt = new Date().toISOString();
  const taskIds = tasks.map(t => t.taskId);

  const runResult: IntelligenceRunResult = {
    runId,
    // 1.1 = the 30-item bank with tiers 4-5 (2026-07-24). Scores are not
    // comparable across bank versions, so the version travels with the run and
    // the board stacks the two separately.
    benchmarkVersion: BENCHMARK_VERSION,
    modelId: args.model,
    runMode: args.mode,
    taskSetId: hashTaskSet(taskIds),
    startedAt,
    completedAt,
    responses,
    score: report,
    usage: (() => {
      const inputTokens = responses.reduce((s, r) => s + r.inputTokens, 0);
      const outputTokens = responses.reduce((s, r) => s + r.outputTokens, 0);
      return {
        totalInputTokens: inputTokens,
        totalOutputTokens: outputTokens,
        estimatedCostUsd: estimateModelCost(args.model, inputTokens, outputTokens),
      };
    })(),
    antiContamination: {
      taskSetHash: hashTaskSet(taskIds),
      holdoutItemsUsed: 0,
      variantRotation: [],
    },
    ...(judgements.length > 0
      ? {
          judging: {
            judges: args.judges.map(j => ({ model: j.model, base: j.base })),
            rescuedTaskIds: judgements.filter(j => j.rescued).map(j => j.taskId),
            splitTaskIds: judgements.filter(j => j.split).map(j => j.taskId),
            judgements,
            deterministic: {
              fullScaleIQ: deterministicReport!.compositeIQ.fullScaleIQ,
              totalCorrect: itemScores.filter(s => s.correct).length,
            },
          },
        }
      : {}),
  };

  // 7. Print results
  console.log(`\n  ━━━ Results ━━━\n`);

  console.log(`  Category Scores:`);
  for (const cat of report.categoryScores) {
    const bar = "█".repeat(Math.round(cat.accuracy * 20)).padEnd(20, "░");
    console.log(`    ${cat.category} ${cat.label.padEnd(30)} ${bar} ${(cat.accuracy * 100).toFixed(0)}% (${cat.correctCount}/${cat.itemCount})`);
  }

  console.log(`\n  CHC Factor Scores:`);
  for (const factor of report.factorScores) {
    console.log(`    ${factor.factor} ${factor.factorLabel.padEnd(25)} IQ-eq: ${Math.round(factor.iqEquivalent)} (${factor.confidenceInterval.lower}-${factor.confidenceInterval.upper})`);
  }

  console.log(`\n  Composite IQ-Equivalent:`);
  console.log(`    Full Scale: ${report.compositeIQ.fullScaleIQ}`);
  console.log(`    95% CI: ${report.compositeIQ.confidenceInterval.lower}-${report.compositeIQ.confidenceInterval.upper}`);
  console.log(`    Percentile: ${report.compositeIQ.percentile}`);
  console.log(`    Classification: ${report.compositeIQ.classification}`);

  if (truncatedItems.length > 0) {
    console.log(`\n  ⚠ ${truncatedItems.length}/${responses.length} items hit the ${maxTokens}-token output budget: ${truncatedItems.join(", ")}`);
    console.log(`    Those items are scored as failures, so this score understates the model.`);
  }
  if (declinedItems.length > 0) {
    console.log(`\n  ⚠ ${declinedItems.length}/${responses.length} items were declined by the model: ${declinedItems.join(", ")}`);
  }

  if (judgements.length > 0) {
    const rescued = judgements.filter(j => j.rescued).length;
    const split = judgements.filter(j => j.split).length;
    console.log(`\n  Judged scoring: ${rescued} miss(es) rescued as equivalent, ${split} split verdict(s) kept as misses`);
    console.log(`    Deterministic (string match only): IQ ${deterministicReport!.compositeIQ.fullScaleIQ}, ${itemScores.filter(s => s.correct).length}/${itemScores.length} correct`);
    console.log(`    Judged:                            IQ ${report.compositeIQ.fullScaleIQ}, ${judgedScores.filter(s => s.correct).length}/${judgedScores.length} correct`);
  }

  console.log(`\n  CruxScore Composite: ${(cruxComposite * 100).toFixed(1)}%`);
  console.log(
    `  Usage: ${runResult.usage.totalInputTokens} in / ${runResult.usage.totalOutputTokens} out tokens` +
    `  |  Cost: $${runResult.usage.estimatedCostUsd.toFixed(4)}`,
  );
  console.log();

  // 8. Save results
  // Repeat runs each get their own file: a stack is only meaningful if every
  // member survives to be inspected.
  const outputPath = args.output
    ? (totalRuns > 1 ? args.output.replace(/\.json$/, `-r${runIndex}.json`) : args.output)
    : resolve(
        dirname(new URL(import.meta.url).pathname),
        "results",
        `intelligence-${runId}.json`,
      );

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  writeFileSync(outputPath, JSON.stringify(runResult, null, 2));
  console.log(`  Results saved to: ${outputPath}`);

  // Auto-submit to ScoreCrux. A run with truncated items understates the model,
  // so it does not go to the public board unless the operator says so.
  if (args.claimCode && truncatedItems.length > 0 && !args.allowTruncated) {
    console.warn(`\n  Not submitting: ${truncatedItems.length} item(s) were truncated by the output budget.`);
    console.warn(`  Re-run with a higher --max-tokens, or submit anyway with --allow-truncated.`);
  } else if (args.claimCode) {
    const submitUrl = `${args.submitUrl}/api/intelligence/submit`;
    console.log(`\n  Submitting to ${args.submitUrl}...`);
    try {
      const payload = {
        claimCode: args.claimCode,
        runId: runResult.runId,
        model: args.model,
        reportedModel: provenance.reportedModel,
        apiBase: provenance.apiBase,
        runMode: runResult.runMode,
        benchmarkVersion: BENCHMARK_VERSION,
        score: runResult.score,
        compositeIQ: runResult.score?.compositeIQ,
        categoryScores: runResult.score?.categoryScores,
        factorScores: runResult.score?.factorScores,
        totalItems: responses.length,
        totalCorrect: judgedScores.filter((s: any) => s.correct).length,
        scoringMode: judgements.length > 0 ? "judged" : "deterministic",
        judges: args.judges.map(j => `${j.model}@${j.base}`),
        usage: runResult.usage,
        durationMs: totalLatencyMs,
        cruxComposite: cruxComposite,
      };
      const tier = provenance.apiBase && provenance.reportedModel ? "verified" : "self-reported";
      console.log(`  Tagging model "${args.model}" (${tier}${provenance.reportedModel && provenance.reportedModel !== args.model ? `; server reports "${provenance.reportedModel}"` : ""})`);
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const serverModel = data.summary?.model;
        const modelNote = serverModel && serverModel !== args.model ? ` as "${serverModel}"` : "";
        console.log(`  Submitted! IQ: ${data.summary?.iq ?? 'N/A'}${modelNote}, ID: ${data.id}`);
      } else {
        const err = await res.text();
        console.warn(`  Submit failed: ${res.status} ${err.slice(0, 160)}`);
      }
    } catch (e: any) {
      console.warn(`  Submit error: ${e.message}`);
    }
  }

  console.log();

  return {
    runId,
    correct: judgedScores.filter(s => s.correct).length,
    total: judgedScores.length,
    iq: report.compositeIQ.fullScaleIQ,
    deterministicCorrect: itemScores.filter(s => s.correct).length,
    deterministicIQ: (deterministicReport ?? report).compositeIQ.fullScaleIQ,
    outputPath,
  };
}

/**
 * Repeat-run stack. One run of this bank resolves very little — the measured
 * within-model spread is ~4.3 IQ points, so a single number cannot separate two
 * close models (see README, "What this bank can and cannot resolve"). Averaging
 * N runs shrinks the standard error by sqrt(N); the operator chooses N.
 */
function reportStack(summaries: RunSummary[]): void {
  const iqs = summaries.map(s => s.iq);
  const mean = iqs.reduce((a, b) => a + b, 0) / iqs.length;
  const sd =
    iqs.length > 1
      ? Math.sqrt(iqs.reduce((a, v) => a + (v - mean) ** 2, 0) / (iqs.length - 1))
      : 0;
  const se = iqs.length > 1 ? sd / Math.sqrt(iqs.length) : 0;

  console.log(`  ━━━ Stack of ${summaries.length} runs ━━━\n`);
  for (const [i, s] of summaries.entries()) {
    console.log(`    run ${i + 1}  ${s.runId}  ${s.correct}/${s.total}  IQ ${s.iq}`);
  }
  console.log(`\n    mean IQ ${mean.toFixed(1)}` +
    (iqs.length > 1
      ? `  SD ${sd.toFixed(1)}  SE ${se.toFixed(1)}  95% CI ${Math.round(mean - 1.96 * se)}-${Math.round(mean + 1.96 * se)}`
      : "  (single run — no interval; use --runs 3 or more before comparing models)"));
  if (iqs.length > 1 && iqs.length < 3) {
    console.log(`    note: 2 runs is enough to see spread, not enough to trust a mean — 3 is the floor for ranking.`);
  }
  console.log();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const summaries: RunSummary[] = [];
  for (let i = 1; i <= args.runs; i++) {
    summaries.push(await executeRun(args, i, args.runs));
  }
  if (args.runs > 1) reportStack(summaries);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
