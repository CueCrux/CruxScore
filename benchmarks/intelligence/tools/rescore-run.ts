#!/usr/bin/env npx tsx
/**
 * Re-score a stored run from its raw output.
 *
 * A run record keeps every response verbatim, so a scoring fix can be applied
 * to runs that already happened without spending tokens on the model again.
 * Use it when the parser, the item scorer, or the judge panel changes.
 *
 *   npx tsx tools/rescore-run.ts results/run.json                 # re-parse + re-score
 *   npx tsx tools/rescore-run.ts results/run.json --judge         # + equivalence panel
 *   npx tsx tools/rescore-run.ts results/run.json --judge --write # overwrite the file
 *   npx tsx tools/rescore-run.ts results/run.json --judge --write \
 *       --claim-code CRUX-... --submit                            # republish it
 *
 * Prints the stored score next to the re-scored one so the delta is explicit.
 * Submitting is opt-in (--submit) because republishing a corrected score is a
 * deliberate act: the board keeps the run id, so withdraw the stale record
 * first or the submit endpoint will skip it as a duplicate.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseResponse } from "../lib/response-parser.js";
import { selectTaskSet } from "../lib/task-loader.js";
import { scoreItem } from "../scoring/item-scorer.js";
import { generateReport } from "../scoring/iq-reporter.js";
import { judgeItem, parseJudgeSpec, type ItemJudgement } from "../scoring/judge.js";
import type { ItemScore, IntelligenceTask } from "../lib/types.js";

const args = process.argv.slice(2);
const path = args.find(a => !a.startsWith("--"));
if (!path) {
  console.error("usage: rescore-run.ts <run.json> [--judge] [--judge-model model@base] [--write]");
  process.exit(1);
}
const wantJudge = args.includes("--judge") || args.includes("--judge-model");
const submit = args.includes("--submit");
const claimCode = args.includes("--claim-code") ? args[args.indexOf("--claim-code") + 1] : undefined;
const submitUrl = args.includes("--submit-url") ? args[args.indexOf("--submit-url") + 1]! : "https://scorecrux.com";
const write = args.includes("--write");
const judges = args.includes("--judge-model")
  ? args.flatMap((a, i) => (a === "--judge-model" ? [parseJudgeSpec(args[i + 1]!)] : []))
  : [
      parseJudgeSpec("claude-opus-4-8@http://100.75.64.43:10010"),
      parseJudgeSpec("gpt-5.6@http://100.75.64.43:9992"),
    ];

const file = resolve(path);
const run = JSON.parse(readFileSync(file, "utf8"));

async function main() {
const allTasks = await selectTaskSet({
  categories: ["A", "B", "C", "D", "E", "F"],
  itemsPerCategory: 3,
});
const taskById = new Map<string, IntelligenceTask>(allTasks.map(t => [t.taskId, t]));

const responses = run.responses.map((r: any) => ({ ...r, parsedOutput: parseResponse(r.rawOutput ?? "") }));
const reparsed = responses.filter(
  (r: any, i: number) => (run.responses[i].parsedOutput === null) !== (r.parsedOutput === null),
);

const tasks = responses.map((r: any) => taskById.get(r.taskId)!);
const itemScores: ItemScore[] = responses.map((r: any, i: number) => scoreItem(tasks[i], r));

const judgements: ItemJudgement[] = [];
let judgedScores = itemScores;

if (wantJudge) {
  judgedScores = [...itemScores];
  const disputed = itemScores
    .map((score, i) => ({ score, i }))
    .filter(({ score, i }) => !score.correct && responses[i].parsedOutput);
  console.log(`judging ${disputed.length} miss(es) with ${judges.map(j => j.model).join(" + ")}`);
  for (const { score, i } of disputed) {
    const judgement = await judgeItem(tasks[i], responses[i].parsedOutput!, judges);
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
    console.log(`  [${tasks[i].taskId}] ${judgement.rescued ? "RESCUED" : judgement.split ? "split — kept" : "upheld"}`);
  }
}

const report = generateReport(judgedScores);
const storedIQ = run.score?.compositeIQ?.fullScaleIQ;
const storedCorrect = (run.score?.itemScores ?? []).filter((s: any) => s.correct).length;
const nowCorrect = judgedScores.filter(s => s.correct).length;

console.log(`\n  model:     ${run.modelId}   run: ${run.runId}`);
if (reparsed.length) console.log(`  re-parsed: ${reparsed.map((r: any) => r.taskId).join(", ")} (previously unparseable)`);
console.log(`  stored:    IQ ${storedIQ}, ${storedCorrect}/${itemScores.length} correct`);
console.log(`  re-scored: IQ ${report.compositeIQ.fullScaleIQ}, ${nowCorrect}/${itemScores.length} correct` +
  (wantJudge ? ` (${judgements.filter(j => j.rescued).length} rescued by judges)` : ""));

if (write) {
  run.responses = responses;
  run.score = report;
  run.rescoredAt = new Date().toISOString();
  if (judgements.length) {
    run.judging = {
      judges: judges.map(j => ({ model: j.model, base: j.base })),
      rescuedTaskIds: judgements.filter(j => j.rescued).map(j => j.taskId),
      splitTaskIds: judgements.filter(j => j.split).map(j => j.taskId),
      judgements,
      deterministic: {
        fullScaleIQ: generateReport(itemScores).compositeIQ.fullScaleIQ,
        totalCorrect: itemScores.filter(s => s.correct).length,
      },
    };
  }
  writeFileSync(file, JSON.stringify(run, null, 2));
  console.log(`  written:   ${file}`);
}

if (submit) {
  if (!claimCode) {
    console.error("  --submit needs --claim-code");
    process.exit(1);
  }
  const payload = {
    claimCode,
    runId: run.runId,
    model: run.modelId,
    reportedModel: run.reportedModel ?? null,
    apiBase: run.apiBase ?? null,
    runMode: run.runMode,
    benchmarkVersion: run.benchmarkVersion ?? "1.0",
    score: report,
    compositeIQ: report.compositeIQ,
    categoryScores: report.categoryScores,
    factorScores: report.factorScores,
    totalItems: judgedScores.length,
    totalCorrect: nowCorrect,
    usage: run.usage,
    durationMs: responses.reduce((s: number, r: any) => s + (r.latencyMs ?? 0), 0),
    scoringMode: judgements.length > 0 ? "judged" : "deterministic",
    judges: judgements.length > 0 ? judges.map(j => `${j.model}@${j.base}`) : [],
  };
  const res = await fetch(`${submitUrl}/api/intelligence/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (res.ok && !body.skipped) console.log(`  submitted: IQ ${body.summary?.iq}, id ${body.id}`);
  else if (body.skipped) console.log(`  NOT submitted: a record with run id ${run.runId} already exists — withdraw it first`);
  else console.log(`  submit failed: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
}
}

main();
