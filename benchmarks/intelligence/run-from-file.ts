#!/usr/bin/env npx tsx
/**
 * Score pre-computed responses and submit to ScoreCrux.
 * Usage: npx tsx run-from-file.ts --responses /tmp/opus-iq-responses.json --model claude-opus-4-6 --claim-code TOWER-...
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { selectTaskSet } from "./lib/task-loader.js";
import { scoreItem } from "./scoring/item-scorer.js";
import { generateReport } from "./scoring/iq-reporter.js";
import { mapToCruxFundamentals, computeIntelligenceCruxComposite } from "./scoring/crux-integration.js";
import type { TaskResponse } from "./lib/types.js";

const args: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) {
    args[process.argv[i].slice(2)] = process.argv[i + 1] ?? "true";
    if (process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) i++;
  }
}

const responsesFile = args.responses ?? "/tmp/opus-iq-responses.json";
const model = args.model ?? "claude-opus-4-6";
const claimCode = args["claim-code"];

async function main() {
const responses = JSON.parse(readFileSync(responsesFile, "utf-8"));
const tasks = await selectTaskSet();

console.log(`  Scoring ${tasks.length} items for ${model}`);

const itemScores = tasks.map((task) => {
  const resp = responses[task.taskId];
  if (!resp) return null;

  const taskResponse: TaskResponse = {
    taskId: task.taskId,
    model,
    mode: "closed_prompt_only",
    rawOutput: JSON.stringify(resp),
    parsedOutput: resp,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 5000,
  };

  return scoreItem(task, taskResponse);
}).filter(Boolean) as any[];

const correct = itemScores.filter((s) => s.correct).length;
console.log(`  Correct: ${correct}/${itemScores.length}`);

const report = generateReport(itemScores);
const cruxMappings = mapToCruxFundamentals(report, 90000);
const cruxComposite = computeIntelligenceCruxComposite(cruxMappings);

console.log();
for (const c of report.categoryScores) {
  console.log(`  ${c.category} ${c.label}: ${(c.accuracy * 100).toFixed(0)}% (${c.correctCount}/${c.itemCount})`);
}
console.log();
for (const f of report.factorScores) {
  const ci = f.confidenceInterval;
  console.log(`  ${f.factor} ${f.factorLabel}: IQ ${f.iqEquivalent.toFixed(0)} (${ci?.lower?.toFixed(0) ?? '?'}-${ci?.upper?.toFixed(0) ?? '?'})`);
}
console.log();
const ci = report.compositeIQ.confidenceInterval;
console.log(`  Full Scale IQ: ${report.compositeIQ.fullScaleIQ}`);
console.log(`  95% CI: ${ci?.lower?.toFixed(0) ?? '?'}-${ci?.upper?.toFixed(0) ?? '?'}`);
console.log(`  Classification: ${report.compositeIQ.classification}`);
console.log(`  CruxScore: ${(cruxComposite * 100).toFixed(1)}%`);

const runId = `opus-interactive-${Date.now().toString(36)}`;
mkdirSync("results", { recursive: true });
const compositeCI = report.compositeIQ.confidenceInterval;
const result = {
  runId, model, modelId: model, mode: "closed_prompt_only", runMode: "closed_prompt_only",
  benchmarkVersion: "1.0", score: report,
  compositeIQ: {
    ...report.compositeIQ,
    ciLower: compositeCI?.lower,
    ciUpper: compositeCI?.upper,
    ci95Lower: compositeCI?.lower,
    ci95Upper: compositeCI?.upper,
  },
  categoryScores: report.categoryScores.map(c => ({ ...c, categoryLabel: c.label })),
  factorScores: report.factorScores.map(f => ({
    ...f,
    iq: f.iqEquivalent,
    ci95Lower: f.confidenceInterval?.lower,
    ci95Upper: f.confidenceInterval?.upper,
  })),
  totalItems: itemScores.length, totalCorrect: correct,
  usage: { totalInputTokens: 0, totalOutputTokens: 0, estimatedCostUsd: 0, totalLatencyMs: 90000 },
  cruxComposite, durationMs: 90000,
};
writeFileSync(resolve("results", `intelligence-${runId}.json`), JSON.stringify(result, null, 2));
console.log(`\n  Saved to results/intelligence-${runId}.json`);

if (claimCode) {
  console.log(`  Submitting to ScoreCrux...`);
  fetch("https://scorecrux.com/api/intelligence/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...result, claimCode }),
  }).then(r => r.json()).then(d => {
    console.log(`  ${d.ok ? `Submitted! IQ: ${d.summary?.iq} (${d.summary?.classification})` : "Failed"}`);
  }).catch(e => console.error(`  Error: ${e.message}`));
}
}
main().catch(e => { console.error(e); process.exit(1); });
