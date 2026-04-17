#!/usr/bin/env npx tsx
/**
 * ScoreCrux Intelligence Benchmark — CLI entry point.
 *
 * Runs the psychometric intelligence benchmark: loads tasks, prompts a model,
 * scores responses, estimates IRT theta, computes CHC factor scores, and
 * produces an IQ-equivalent composite.
 *
 * Usage:
 *   npx tsx run-intelligence.ts --model claude-sonnet-4-20250514
 *   npx tsx run-intelligence.ts --model gpt-5.4 --mode closed_prompt_only --categories A,B,D
 *   npx tsx run-intelligence.ts --dry-run --verbose
 *   npx tsx run-intelligence.ts --model claude-opus-4-20250514 --items-per-category 2 --output results/run1.json
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
  IntelligenceRunResult,
  ParsedOutput,
} from "./lib/types.js";
import { selectTaskSet } from "./lib/task-loader.js";
import { hashTaskSet } from "./lib/anti-contamination.js";
import { scoreItem } from "./scoring/item-scorer.js";
import { generateReport } from "./scoring/iq-reporter.js";
import { mapToCruxFundamentals, computeIntelligenceCruxComposite } from "./scoring/crux-integration.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CLIArgs {
  model: string;
  mode: RunMode;
  categories: ReasoningCategory[];
  itemsPerCategory: number;
  dryRun: boolean;
  verbose: boolean;
  interactive: boolean;
  output: string;
  claimCode?: string;
  submitUrl: string;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    model: "claude-sonnet-4-20250514",
    mode: "closed_prompt_only",
    categories: ["A", "B", "C", "D", "E", "F"],
    itemsPerCategory: 3,
    dryRun: false,
    verbose: false,
    interactive: false,
    output: "",
    claimCode: undefined,
    submitUrl: "https://scorecrux.com",
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
// Response parser
// ---------------------------------------------------------------------------

function parseResponse(raw: string): ParsedOutput | null {
  try {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);

    return {
      final_answer: parsed.final_answer ?? "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      working: Array.isArray(parsed.working) ? parsed.working : [],
    };
  } catch {
    return null;
  }
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
  { match: /^claude-opus-4-7/,        price: { input: 15.0, output: 75.0 } }, // inherits 4-family pricing
  { match: /^claude-opus-4-6/,        price: { input: 15.0, output: 75.0 } },
  { match: /^claude-opus-4-(\d+|20)/, price: { input: 15.0, output: 75.0 } }, // 4.x family
  { match: /^claude-sonnet-4/,        price: { input: 3.0,  output: 15.0 } },
  { match: /^claude-haiku-4/,         price: { input: 0.80, output: 4.0 } },
  { match: /^gpt-5\.4-nano/,          price: { input: 0.10, output: 0.40 } },
  { match: /^gpt-5\.4-mini/,          price: { input: 0.40, output: 1.60 } },
  { match: /^gpt-5\.4/,               price: { input: 2.50, output: 10.0 } },
];

function estimateModelCost(model: string, inputTokens: number, outputTokens: number): number {
  const row = MODEL_PRICING.find(r => r.match.test(model));
  if (!row) return 0;
  return (inputTokens / 1_000_000) * row.price.input
       + (outputTokens / 1_000_000) * row.price.output;
}

// ---------------------------------------------------------------------------
// Model caller
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

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
): Promise<{ text: string; inputTokens: number; outputTokens: number; latencyMs: number }> {
  const start = Date.now();

  // Interactive mode: print prompt, read response from stdin.
  // Triggered either by --model interactive (legacy) or --interactive (preferred —
  // lets you set --model to the real identity so attribution tags self_reported).
  if (model === "interactive" || interactive) {
    console.log("\n── ITEM ──");
    console.log(prompt.slice(0, 500));
    console.log("\n── PASTE JSON RESPONSE (end with END_OF_RESPONSE) ──");

    const text = await readUntilMarker("END_OF_RESPONSE");
    return { text, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - start };
  }

  if (model.startsWith("claude")) {
    const client = new Anthropic();
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
      system: "You are taking a psychometric reasoning test. For each item, respond with a JSON object: { \"final_answer\": \"your answer\", \"confidence\": 0.0-1.0, \"working\": [\"step 1\", \"step 2\", ...] }. Think carefully and show your reasoning in the working array. Give only the JSON, no other text.",
    });

    // response.model is the canonical ID Anthropic actually served
    provenance.reportedModel = (response as any).model ?? model;
    provenance.apiBase = "https://api.anthropic.com";

    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - start,
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
    if (!isReasoningModel) {
      messages.push({ role: "system", content: "You are taking a psychometric reasoning test. For each item, respond with a JSON object: { \"final_answer\": \"your answer\", \"confidence\": 0.0-1.0, \"working\": [\"step 1\", \"step 2\", ...] }. Think carefully and show your reasoning in the working array. Give only the JSON, no other text." });
    }
    messages.push({ role: "user", content: prompt });

    const body: Record<string, unknown> = { model, messages };
    if (isReasoningModel) body.max_completion_tokens = 4096;
    else body.max_tokens = 4096;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as any;
    if (data.error) throw new Error(`OpenAI: ${data.error.message}`);

    provenance.reportedModel = data.model ?? res.headers.get("openai-model") ?? model;
    provenance.apiBase = "https://api.openai.com";

    return {
      text: data.choices?.[0]?.message?.content ?? "",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - start,
    };
  }

  throw new Error(`Unsupported model: ${model}. Use claude-* or gpt-*`);
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const args = parseArgs(process.argv);
  const runId = randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();

  console.log(`\n  ScoreCrux Intelligence Benchmark v1.0`);
  console.log(`  Run ID: ${runId}`);
  console.log(`  Model: ${args.model}`);
  console.log(`  Mode: ${args.mode}`);
  console.log(`  Categories: ${args.categories.join(", ")}`);
  console.log(`  Items/category: ${args.itemsPerCategory}`);
  if (args.dryRun) console.log(`  ** DRY RUN **`);
  console.log();

  // 1. Load task set
  const tasks = await selectTaskSet({
    categories: args.categories,
    itemsPerCategory: args.itemsPerCategory,
  });

  console.log(`  Loaded ${tasks.length} tasks\n`);

  if (tasks.length === 0) {
    console.error("  No tasks found. Check fixture directory.");
    process.exit(1);
  }

  // 2. Run each task
  const responses: TaskResponse[] = [];
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

    const result = await callModel(args.model, prompt, args.mode, args.interactive);
    const parsed = parseResponse(result.text);
    totalLatencyMs += result.latencyMs;

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

  // 4. Generate report (IRT + CHC + IQ)
  const report = generateReport(itemScores);

  // 5. CruxFundamentals integration
  const cruxMappings = mapToCruxFundamentals(report, totalLatencyMs);
  const cruxComposite = computeIntelligenceCruxComposite(cruxMappings);

  // 6. Build run result
  const completedAt = new Date().toISOString();
  const taskIds = tasks.map(t => t.taskId);

  const runResult: IntelligenceRunResult = {
    runId,
    benchmarkVersion: "1.0",
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

  console.log(`\n  CruxScore Composite: ${(cruxComposite * 100).toFixed(1)}%`);
  console.log(
    `  Usage: ${runResult.usage.totalInputTokens} in / ${runResult.usage.totalOutputTokens} out tokens` +
    `  |  Cost: $${runResult.usage.estimatedCostUsd.toFixed(4)}`,
  );
  console.log();

  // 8. Save results
  const outputPath = args.output || resolve(
    dirname(new URL(import.meta.url).pathname),
    "results",
    `intelligence-${runId}.json`,
  );

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  writeFileSync(outputPath, JSON.stringify(runResult, null, 2));
  console.log(`  Results saved to: ${outputPath}`);

  // Auto-submit to ScoreCrux
  if (args.claimCode) {
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
        benchmarkVersion: '1.0',
        score: runResult.score,
        compositeIQ: runResult.score?.compositeIQ,
        categoryScores: runResult.score?.categoryScores,
        factorScores: runResult.score?.factorScores,
        totalItems: responses.length,
        totalCorrect: itemScores.filter((s: any) => s.correct).length,
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
}

run().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
