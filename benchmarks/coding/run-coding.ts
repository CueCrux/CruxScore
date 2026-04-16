#!/usr/bin/env npx tsx
/**
 * ScoreCrux Coding Benchmark — CLI entry point.
 *
 * Usage:
 *   npx tsx run-coding.ts --model claude-sonnet-4-6
 *   npx tsx run-coding.ts --model gpt-5.4 --mode C-A --tasks greenfield-01,bugfix-01
 *   npx tsx run-coding.ts --model claude-sonnet-4-6 --claim-code CRUX-XXXX-XXXXX
 *   npx tsx run-coding.ts --dry-run --verbose
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { CodingMode, CodingRunResult, TaskResult } from "./lib/types.js";
import { loadAllTasks, loadTasks, listTasks } from "./lib/task-loader.js";
import { callModel } from "./lib/model-caller.js";
import { runInSandbox } from "./lib/sandbox.js";
import { scoreC1 } from "./scoring/c1-execution.js";
import { scoreC2 } from "./scoring/c2-quality.js";
import { scoreC3 } from "./scoring/c3-rubric.js";
import { computeComposite } from "./scoring/composite.js";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CLIArgs {
  model: string;
  mode: CodingMode;
  tasks: string[];
  dryRun: boolean;
  verbose: boolean;
  output: string;
  claimCode?: string;
  submitUrl: string;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    model: "claude-sonnet-4-6",
    mode: "C-A",
    tasks: [],
    dryRun: false,
    verbose: false,
    output: "",
    submitUrl: "https://scorecrux.com",
  };

  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--model": args.model = next; i++; break;
      case "--mode": args.mode = next as CodingMode; i++; break;
      case "--tasks": args.tasks = next.split(",").map(s => s.trim()); i++; break;
      case "--dry-run": args.dryRun = true; break;
      case "--verbose": args.verbose = true; break;
      case "--output": args.output = next; i++; break;
      case "--claim-code": args.claimCode = next; i++; break;
      case "--submit-url": args.submitUrl = next; i++; break;
      default:
        console.error(`Unknown flag: ${flag}`);
        process.exit(1);
    }
  }

  // Default: all tasks
  if (args.tasks.length === 0) {
    args.tasks = listTasks();
  }

  return args;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 0.8, output: 4 },
  "gpt-5.4": { input: 2.5, output: 10 },
  "gpt-5.4-mini": { input: 0.4, output: 1.6 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  const args = parseArgs(process.argv);
  const runId = randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();

  console.log(`  ScoreCrux Coding Benchmark v1.0`);
  console.log(`  Run ID: ${runId}`);
  console.log(`  Model: ${args.model}`);
  console.log(`  Mode: ${args.mode}`);
  console.log(`  Tasks: ${args.tasks.join(", ")}`);
  console.log();

  const tasks = loadTasks(args.tasks);
  const taskResults: TaskResult[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalLatencyMs = 0;
  let reportedModel: string | null = null;
  let apiBase: string | null = null;

  for (const task of tasks) {
    console.log(`  [${task.taskId}] ${task.manifest.title} (${task.manifest.family})`);

    if (args.dryRun) {
      console.log(`    [dry-run] Would call ${args.model} and run sandbox`);
      continue;
    }

    // Build prompt
    const prompt = buildPrompt(task);

    // Call model
    const response = await callModel(args.model, prompt);
    totalInputTokens += response.inputTokens;
    totalOutputTokens += response.outputTokens;
    totalLatencyMs += response.latencyMs;
    if (response.reportedModel && !reportedModel) reportedModel = response.reportedModel;
    if (response.apiBase && !apiBase) apiBase = response.apiBase;

    if (args.verbose) {
      console.log(`    Model: ${response.inputTokens} in / ${response.outputTokens} out / ${response.latencyMs}ms`);
      console.log(`    Code: ${response.code.split("\n").length} lines`);
    }

    // Run in sandbox
    console.log(`    Running sandbox...`);
    const sandbox = await runInSandbox(task, response.code, { verbose: args.verbose });

    if (args.verbose) {
      console.log(`    Build: ${sandbox.buildSuccess ? "OK" : "FAIL"}`);
      console.log(`    Typecheck: ${sandbox.typecheckPassed ? "OK" : "FAIL"}`);
      console.log(`    Visible tests: ${sandbox.visibleTestsPassed}/${sandbox.visibleTestsTotal}`);
      console.log(`    Hidden tests: ${sandbox.hiddenTestsPassed}/${sandbox.hiddenTestsTotal}`);
    }

    // Score
    const c1 = scoreC1(sandbox);
    const c2 = scoreC2(response.code);
    const c3 = scoreC3(response.code);
    const composite = computeComposite(c1, c2, c3);
    const cost = estimateCost(args.model, response.inputTokens, response.outputTokens);

    console.log(`    Score: C1=${(c1.score * 100).toFixed(0)}% C2=${(c2.score * 100).toFixed(0)}% C3=${(c3.score * 100).toFixed(0)}% → ${(composite * 100).toFixed(1)}%`);

    taskResults.push({
      taskId: task.taskId,
      family: task.manifest.family,
      c1, c2, c3, composite,
      generatedCode: response.code,
      buildOutput: sandbox.buildOutput,
      testOutput: sandbox.visibleTestOutput + "\n" + sandbox.hiddenTestOutput,
      lintOutput: sandbox.lintOutput,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      latencyMs: response.latencyMs,
      estimatedCostUsd: cost,
    });
  }

  if (args.dryRun) {
    console.log("\n  [dry-run] No results to save.");
    return;
  }

  // Aggregate
  const totalCost = estimateCost(args.model, totalInputTokens, totalOutputTokens);
  const avgComposite = taskResults.length > 0
    ? taskResults.reduce((s, r) => s + r.composite, 0) / taskResults.length
    : 0;
  const avgTestRate = taskResults.length > 0
    ? taskResults.reduce((s, r) => s + (r.c1.visibleTestsPassed + r.c1.hiddenTestsPassed) / Math.max(r.c1.visibleTestsTotal + r.c1.hiddenTestsTotal, 1), 0) / taskResults.length
    : 0;
  const avgQuality = taskResults.length > 0
    ? taskResults.reduce((s, r) => s + r.c2.score, 0) / taskResults.length
    : 0;
  const avgDesign = taskResults.length > 0
    ? taskResults.reduce((s, r) => s + r.c3.score, 0) / taskResults.length
    : 0;

  const result: CodingRunResult = {
    runId,
    benchmarkVersion: "1.0",
    model: args.model,
    mode: args.mode,
    startedAt,
    completedAt: new Date().toISOString(),
    taskResults,
    aggregate: {
      compositeScore: avgComposite,
      testPassRate: avgTestRate,
      qualityScore: avgQuality,
      designScore: avgDesign,
      totalTasks: taskResults.length,
    },
    usage: {
      totalInputTokens,
      totalOutputTokens,
      estimatedCostUsd: totalCost,
      totalLatencyMs,
    },
  };

  // Print summary
  console.log(`\n  ━━━ Results ━━━`);
  console.log(`  Tasks: ${taskResults.length}`);
  console.log(`  Composite: ${(avgComposite * 100).toFixed(1)}%`);
  console.log(`  Test pass rate: ${(avgTestRate * 100).toFixed(0)}%`);
  console.log(`  Quality: ${(avgQuality * 100).toFixed(0)}%`);
  console.log(`  Design: ${(avgDesign * 100).toFixed(0)}%`);
  console.log(`  Cost: $${totalCost.toFixed(4)}`);
  console.log(`  Time: ${(totalLatencyMs / 1000).toFixed(1)}s`);

  // Save
  const outputDir = args.output || resolve(import.meta.dirname!, "results");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `coding-${runId}.json`);
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n  Results saved to: ${outputPath}`);

  // Auto-submit
  if (args.claimCode) {
    const submitUrl = `${args.submitUrl}/api/coding/submit`;
    console.log(`\n  Submitting to ${args.submitUrl}...`);
    try {
      const payload = {
        claimCode: args.claimCode,
        reportedModel,
        apiBase,
        ...result,
      };
      const tier = apiBase && reportedModel ? "verified" : "self-reported";
      console.log(`  Tagging model "${args.model}" (${tier}${reportedModel && reportedModel !== args.model ? `; server reports "${reportedModel}"` : ""})`);
      const res = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const serverModel = data.summary?.model;
        const modelNote = serverModel && serverModel !== args.model ? ` as "${serverModel}"` : "";
        console.log(`  Submitted! Score: ${(data.summary?.compositeScore * 100).toFixed(1)}%${modelNote}, ID: ${data.id}`);
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

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(task: { manifest: any; prompt: string; starterCode?: string; visibleTests: string }): string {
  let prompt = task.prompt;

  if (task.starterCode) {
    prompt += "\n\n## Starter Code\n\n```typescript\n" + task.starterCode + "\n```\n";
  }

  if (task.visibleTests) {
    prompt += "\n\n## Visible Tests\n\nThese tests must pass:\n\n```typescript\n" + task.visibleTests + "\n```\n";
  }

  prompt += "\n\n## Instructions\n\nWrite your complete solution as a single TypeScript file. Export all required functions and types. The file will be saved as `solution.ts`.";

  return prompt;
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
