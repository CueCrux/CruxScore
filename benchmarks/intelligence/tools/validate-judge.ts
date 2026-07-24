#!/usr/bin/env npx tsx
/**
 * Calibration harness for scoring/judge.ts. Run it by hand — it makes live
 * judge calls, so it is deliberately not part of `vitest run`.
 *
 *   npx tsx tools/validate-judge.ts [run.json]
 *   JUDGES="claude-opus-4-8@http://host:10010,gpt-5.6@http://host:9992" npx tsx tools/validate-judge.ts
 *
 * Re-run this whenever the judge prompt, the panel, or a judge model changes:
 * a panel that stops rejecting the CONTROL cases is a panel that will inflate
 * scores.
 *
 * Runs the judge panel over two populations:
 *   RESCUE  — real answers from run 4fdb84e6 that the deterministic scorer
 *             marked wrong but that state the fixture's answer.
 *   CONTROL — answers that MUST NOT be rescued: the genuine misses from the
 *             same run, plus fabricated near-misses (one value changed).
 *
 * A judge panel is only useful if it clears the first group and rejects the
 * second. Prints a per-case table and a pass/fail summary.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeItem, parseJudgeSpec } from "../scoring/judge.js";
import type { IntelligenceTask, ParsedOutput } from "../lib/types.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "categories");
const RUN = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "results", "opus5-20260724-r2.json");

function loadTasks(): Map<string, IntelligenceTask> {
  const out = new Map<string, IntelligenceTask>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".json")) {
        const t = JSON.parse(readFileSync(p, "utf8"));
        if (t.taskId) out.set(t.taskId, t);
      }
    }
  };
  walk(FIXTURES);
  return out;
}

interface Case { taskId: string; answer: unknown; expectRescue: boolean; note: string }

const run = JSON.parse(readFileSync(RUN, "utf8"));
const tasks = loadTasks();
const answerOf = (id: string) =>
  (run.responses.find((r: any) => r.taskId === id)?.parsedOutput as ParsedOutput | null)?.final_answer;

const cases: Case[] = [
  // --- real answers the deterministic scorer rejected on formatting ---
  { taskId: "B003", answer: answerOf("B003"), expectRescue: true,  note: "real: A=8,B=12,C=20 vs a: 8, b: 12, c: 20" },
  { taskId: "F002", answer: answerOf("F002"), expectRescue: true,  note: "real: same schedule, worker labels transposed" },
  { taskId: "F003", answer: answerOf("F003"), expectRescue: true,  note: "real: same schedule, arrow notation" },
  { taskId: "D002", answer: answerOf("D002"), expectRescue: true,  note: "real: same content in prose" },
  // --- real answers that genuinely differ ---
  { taskId: "D003", answer: answerOf("D003"), expectRescue: false, note: "real: includes N3 in never-activates set" },
  { taskId: "C003", answer: answerOf("C003"), expectRescue: false, note: "real: funded proposals only, no enumeration" },
  // --- fabricated near-misses: one value changed, everything else identical ---
  { taskId: "B001", answer: "17", expectRescue: false, note: "control: wrong value" },
  { taskId: "B003", answer: "A=8, B=12, C=21", expectRescue: false, note: "control: one value off by one" },
  { taskId: "F002", answer: "7 hours. Worker 1: A (0-3), then C (3-5). Worker 2: B (0-2), then D (2-6).", expectRescue: false, note: "control: wrong makespan" },
  { taskId: "F003", answer: "Minimum makespan = 9 hours. M1: T1 0→3, T3 3→7. M2: T2 0→2, T4 2→3, T6 3→6.", expectRescue: false, note: "control: drops T5" },
  { taskId: "E003", answer: "LSBR", expectRescue: false, note: "control: one letter wrong" },
  { taskId: "A001", answer: "Kael: coffee, Mira: tea, Tobin: juice", expectRescue: false, note: "control: two assignments swapped" },
];

const judges = (process.env.JUDGES ??
  "claude-opus-4-8@http://100.75.64.43:10010,gpt-5.6@http://100.75.64.43:9992")
  .split(",").map(s => parseJudgeSpec(s.trim()));

console.log(`judges: ${judges.map(j => `${j.model} @ ${j.base}`).join(" | ")}\n`);

async function main() {
let pass = 0, fail = 0;
for (const c of cases) {
  const task = tasks.get(c.taskId)!;
  const parsed: ParsedOutput = { final_answer: c.answer as any, confidence: 1, working: [] };
  const j = await judgeItem(task, parsed, judges);
  const ok = j.rescued === c.expectRescue;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.taskId.padEnd(5)} rescued=${String(j.rescued).padEnd(5)} expected=${String(c.expectRescue).padEnd(5)} ${c.note}`);
  for (const v of j.verdicts) {
    console.log(`        ${v.model.padEnd(18)} ${String(v.equivalent).padEnd(5)} ${v.reason.slice(0, 130)}`);
  }
}

console.log(`\n${pass} pass / ${fail} fail out of ${cases.length}`);
process.exit(fail === 0 ? 0 : 1);
}

main();
