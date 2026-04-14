#!/usr/bin/env npx tsx
/**
 * ScoreCrux Top Floor — CLI entry point.
 *
 * Orchestrates floor execution, scoring, and result output.
 *
 * Usage:
 *   npx tsx run-topfloor.ts --floor 1 --arm C0 --model claude-sonnet-4-20250514
 *   npx tsx run-topfloor.ts --floor 1-5 --arm T2 --model claude-sonnet-4-20250514 --max-turns 50
 *   npx tsx run-topfloor.ts --floor 1 --dry-run
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  scoreFloor,
  aggregateScores,
  mapToCruxFundamentals,
} from "./scoring/floor-rubric.js";
import type { FloorScore, FloorObjectiveResult, FloorEvidenceResult, FloorWipeResult } from "./scoring/floor-rubric.js";
import { analyseProgression, buildLeaderboard, formatLeaderboard } from "./scoring/aggregate.js";
import { computeCruxScore } from "./scoring/crux-integration.js";
import type { FloorBlueprint, CorpusDocument } from "./generators/document-factory.js";
import { executeFloor, type FloorExecutionOptions } from "./lib/orchestrator.js";
import {
  createSave,
  loadSave,
  persistSave,
  listSaves,
  canAccessFloor,
  isRevisit,
  recordFloorVisit,
  formatSaveStatus,
  suggestRevisits,
  type SaveState,
  type FloorProgress,
} from "./lib/save-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Arm = "C0" | "T1" | "T2" | "T3";

interface RunManifest {
  floors: number[];
  arm: Arm;
  model: string;
  maxTurns: number;
  dryRun: boolean;
  verbose: boolean;
  output: string;
  startedAt: string;
}

interface FloorRunResult {
  floor: number;
  score: FloorScore;
  objectives: FloorObjectiveResult[];
  evidence: FloorEvidenceResult;
  wipe: FloorWipeResult | null;
  turnsUsed: number;
  tokensUsed: number;
  durationMs: number;
}

interface RunResult {
  manifest: RunManifest;
  floorResults: FloorRunResult[];
  aggregate: ReturnType<typeof aggregateScores>;
  crux: ReturnType<typeof computeCruxScore>;
  progression: ReturnType<typeof analyseProgression>;
  completedAt: string;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): RunManifest {
  const get = (flag: string, def: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1]! : def;
  };
  const has = (flag: string) => argv.includes(flag);

  // Parse floor range
  const floorStr = get("--floor", "1");
  let floors: number[];
  if (floorStr.includes("-")) {
    const [start, end] = floorStr.split("-").map(Number);
    floors = [];
    for (let f = start!; f <= end!; f++) floors.push(f);
  } else {
    floors = [Number(floorStr)];
  }

  return {
    floors,
    arm: get("--arm", "C0") as Arm,
    model: get("--model", "claude-sonnet-4-20250514"),
    maxTurns: Number(get("--max-turns", "100")),
    dryRun: has("--dry-run"),
    verbose: has("--verbose"),
    output: get("--output", resolve(import.meta.dirname!, "results")),
    startedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Floor loading
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(import.meta.dirname!, "fixtures/floors");

function loadFloorBlueprint(floorNum: number): FloorBlueprint | null {
  const dir = resolve(FIXTURES_DIR, String(floorNum).padStart(3, "0"));
  const manifestPath = resolve(dir, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as FloorBlueprint;
}

function loadFloorCorpus(floorNum: number): CorpusDocument[] {
  const dir = resolve(FIXTURES_DIR, String(floorNum).padStart(3, "0"), "corpus");
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const docs: CorpusDocument[] = [];
  for (const f of files) {
    const raw = readFileSync(resolve(dir, f), "utf-8");
    docs.push(...(JSON.parse(raw) as CorpusDocument[]));
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Floor execution (stub — full orchestrator is in lib/orchestrator.ts)
// ---------------------------------------------------------------------------

async function executeFloorRange(
  manifest: RunManifest,
): Promise<FloorRunResult[]> {
  const results: FloorRunResult[] = [];

  for (const floorNum of manifest.floors) {
    const blueprint = loadFloorBlueprint(floorNum);
    if (!blueprint) {
      console.warn(`Floor ${floorNum}: no manifest found, skipping.`);
      continue;
    }

    const corpus = loadFloorCorpus(floorNum);
    console.log(
      `\nFloor ${floorNum}: ${blueprint.name} (${corpus.length} docs, ${blueprint.objectives.length} objectives)`,
    );

    if (manifest.dryRun) {
      console.log("  [dry-run] Would execute with:", {
        arm: manifest.arm,
        model: manifest.model,
        maxTurns: manifest.maxTurns,
      });
      continue;
    }

    const startMs = Date.now();

    // Execute floor via the real orchestrator
    const execOpts: FloorExecutionOptions = {
      model: manifest.model as any,
      arm: manifest.arm as any,
      maxTurns: manifest.maxTurns,
      verbose: manifest.verbose,
    };

    const session = await executeFloor(floorNum, execOpts);

    // Map orchestrator results to scoring inputs
    const turnsUsed = session.turns.length;
    const tokensUsed = session.turns.reduce(
      (s, t) => s + t.inputTokens + t.outputTokens,
      0,
    );

    // Check which objectives were solved — fuzzy matching + elevator key override
    const allToolOutput = session.turns
      .flatMap((t) => t.toolCalls.map((tc) => JSON.stringify(tc.result)))
      .join("\n")
      .toLowerCase();

    // Also include assistant text output for matching
    const allAssistantOutput = session.turns
      .map((t) => t.toolCalls.map((tc) => JSON.stringify(tc.args)).join(" "))
      .join("\n")
      .toLowerCase();
    const combinedOutput = allToolOutput + "\n" + allAssistantOutput;

    // Fuzzy match: tokenise solution key and check if tokens appear in output
    function fuzzyMatch(key: string, text: string): boolean {
      // Exact match first
      if (text.includes(key.toLowerCase())) return true;

      // Tokenise: split on underscores, hyphens, spaces, camelCase
      const tokens = key
        .toLowerCase()
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .split(/[_\-\s.]+/)
        .filter((t) => t.length > 2); // skip tiny tokens like "7b"

      if (tokens.length === 0) return false;

      // Check if most tokens appear in the text (>= 60% match)
      const matched = tokens.filter((t) => text.includes(t));
      return matched.length / tokens.length >= 0.6;
    }

    // Check elevator key — if obtained, floor completion = 100%
    const elevatorKeySolved = session.output?.includes("submit_elevator_key") &&
      session.output?.includes("OK") || false;

    const objectives: FloorObjectiveResult[] = blueprint.objectives.map((obj) => {
      const matchedKeys = (obj.solutionKeys ?? []).filter((k: string) =>
        fuzzyMatch(k, combinedOutput),
      );
      const fuzzyRatio = obj.solutionKeys?.length > 0
        ? matchedKeys.length / obj.solutionKeys.length
        : 0;

      // Elevator key override: if key obtained, all objectives count as solved
      const solved = elevatorKeySolved || (fuzzyRatio >= 0.5);
      const points = solved ? obj.points : Math.round(obj.points * fuzzyRatio);
      return { id: obj.id, solved, points, maxPoints: obj.points };
    });

    // Evidence tracking: count signal vs noise docs retrieved
    const readDocCalls = session.turns.flatMap((t) =>
      t.toolCalls.filter((tc) => tc.toolName === "read_document" || tc.toolName === "search_documents"),
    );
    const signalDocs = corpus.filter((d: any) => d.isSignal);
    const evidence: FloorEvidenceResult = {
      signalDocsTotal: signalDocs.length,
      signalDocsRetrieved: readDocCalls.length,
      signalDocsRelevant: 0, // would need doc-level tracking
      noiseDocsRetrieved: 0,
    };

    // Memory wipe tracking
    const wipe: FloorWipeResult | null = session.wipeTriggered
      ? {
          occurred: true,
          scope: "partial",
          knowledgeItemsPre: 0,
          knowledgeItemsRecovered: 0,
          turnsToRecovery: session.wipeRecoveryTurns ?? 0,
          recognizedWipe: false,
        }
      : null;

    const floorScore = scoreFloor({
      floor: floorNum,
      objectives,
      evidence,
      codeChallenges: [],
      wipe,
      stealthViolations: 0,
      elevatorKeySolved,
      tokensUsed,
      turnsUsed,
    });

    results.push({
      floor: floorNum,
      score: floorScore,
      objectives,
      evidence,
      wipe,
      turnsUsed,
      tokensUsed,
      durationMs: Date.now() - startMs,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Results table
// ---------------------------------------------------------------------------

function printResultsTable(results: FloorRunResult[]): void {
  if (results.length === 0) {
    console.log("\n(no results)");
    return;
  }

  console.log("\n--- Floor Results ---");
  console.log(
    "Floor  Completion  Precision  Recall  Stealth  Key    Points",
  );
  console.log("-".repeat(65));

  for (const r of results) {
    const s = r.score;
    console.log(
      [
        String(s.floor).padStart(5),
        (s.objectiveCompletion * 100).toFixed(1).padStart(10) + "%",
        (s.evidencePrecision * 100).toFixed(1).padStart(9) + "%",
        (s.evidenceRecall * 100).toFixed(1).padStart(6) + "%",
        (s.stealthScore * 100).toFixed(0).padStart(7) + "%",
        (s.elevatorKey ? "YES" : " NO").padStart(5),
        `${s.pointsEarned}/${s.pointsMax}`.padStart(10),
      ].join("  "),
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const manifest = parseArgs(argv);

// --- Save/Resume Commands ---
const saveFlag = argv.includes("--save");       // Enable save mode (creates or loads save)
const loadFlag = argv[argv.indexOf("--load") + 1]; // Load a specific save ID
const statusFlag = argv.includes("--status");   // Print save status and exit
const listFlag = argv.includes("--list-saves"); // List all saves and exit
const revisitFlag = argv.includes("--revisit"); // Allow revisiting cleared floors
const suggestFlag = argv.includes("--suggest");  // Suggest floors to revisit
const saveName = argv[argv.indexOf("--save-name") + 1]; // Optional save name

const resultsDir = manifest.output;
mkdirSync(resultsDir, { recursive: true });

// Handle --list-saves
if (listFlag) {
  const saves = listSaves(resultsDir);
  if (saves.length === 0) {
    console.log("No saves found.");
  } else {
    console.log("Saved Games:");
    for (const s of saves) {
      console.log(`  ${s.saveId}  "${s.saveName}"  Floor ${s.highestFloor}  ${s.model}  ${s.updatedAt}`);
    }
  }
  process.exit(0);
}

// Load or create save state
let save: SaveState | null = null;
if (loadFlag && loadFlag !== "--save" && !loadFlag.startsWith("-")) {
  save = loadSave(loadFlag, resultsDir);
  if (!save) {
    console.error(`Save "${loadFlag}" not found.`);
    process.exit(1);
  }
  console.log(`Loaded save: ${save.saveName} (Floor ${save.highestFloorCleared})`);
} else if (saveFlag) {
  save = createSave(manifest.model, manifest.arm, saveName, resultsDir);
  console.log(`New save created: ${save.saveName} (${save.saveId})`);
}

// Handle --status
if (statusFlag && save) {
  console.log(formatSaveStatus(save));
  process.exit(0);
}

// Handle --suggest (show floors worth revisiting)
if (suggestFlag && save) {
  const manifests: Array<{ floor: number; previousFloorDependencies: Array<{ floor: number; fact: string }> }> = [];
  for (const f of save.accessibleFloors) {
    const bp = loadFloorBlueprint(f);
    if (bp) manifests.push({ floor: f, previousFloorDependencies: (bp as any).previousFloorDependencies ?? [] });
  }
  const suggestions = suggestRevisits(save, manifests);
  if (suggestions.length === 0) {
    console.log("No revisit suggestions — all accessible floors are fully solved.");
  } else {
    console.log("Suggested revisits:");
    for (const s of suggestions) {
      console.log(`  Floor ${s.floor}: ${s.reason}`);
    }
  }
  process.exit(0);
}

// Validate floor access if using a save
if (save) {
  for (const f of manifest.floors) {
    if (!canAccessFloor(save, f)) {
      if (revisitFlag && f <= save.highestFloorCleared) {
        // Allow revisiting cleared floors
        if (!save.accessibleFloors.includes(f)) {
          save.accessibleFloors.push(f);
          save.accessibleFloors.sort((a, b) => a - b);
        }
      } else {
        console.error(`Floor ${f} is not accessible. Highest cleared: ${save.highestFloorCleared}. Use --revisit to visit lower floors.`);
        process.exit(1);
      }
    }
  }
}

console.log("ScoreCrux Top Floor Benchmark");
console.log(`  Floors: ${manifest.floors.join(", ")}`);
console.log(`  Arm: ${manifest.arm}`);
console.log(`  Model: ${manifest.model}`);
console.log(`  Max turns: ${manifest.maxTurns}`);
if (save) console.log(`  Save: ${save.saveName} (Floor ${save.highestFloorCleared})`);
if (revisitFlag) console.log(`  Mode: REVISIT (updating memory from lower floors)`);
if (manifest.dryRun) console.log("  ** DRY RUN **");

const floorResults = await executeFloorRange(manifest);

if (floorResults.length === 0) {
  console.log("\nNo floor results produced.");
  process.exit(0);
}

// Score
const floorScores = floorResults.map((r) => r.score);
const aggregate = aggregateScores(floorScores);
const cruxMappings = mapToCruxFundamentals(floorScores, aggregate);
const crux = computeCruxScore(cruxMappings);
const progression = analyseProgression(floorScores);

// Print
printResultsTable(floorResults);

console.log("\n--- Aggregate ---");
console.log(`  Floors cleared: ${aggregate.floorsCleared}`);
console.log(`  Highest floor: ${aggregate.highestFloor}`);
console.log(`  Cumulative score: ${aggregate.cumulativeScore}`);
console.log(`  Efficiency: ${aggregate.efficiency.toFixed(6)}`);
console.log(`  Resilience: ${aggregate.resilience.toFixed(3)}`);

console.log("\n--- ScoreCrux Composite ---");
console.log(`  Composite: ${crux.composite.toFixed(4)}`);
console.log(`  Safety gated: ${crux.safetyGated}`);
if (manifest.verbose) {
  console.log("  Breakdown:");
  for (const b of crux.breakdown) {
    console.log(`    ${b.fundamental}: ${b.raw.toFixed(3)} x ${b.weight} = ${b.weighted.toFixed(4)}`);
  }
}

if (progression.difficultyCliff !== null) {
  console.log(`\n  Difficulty cliff detected at Floor ${progression.difficultyCliff}`);
}
if (progression.wipeImpact) {
  console.log(
    `  Memory wipe impact: ${(progression.wipeImpact.degradation * 100).toFixed(1)}% degradation`,
  );
}

// Update save state with floor results
if (save) {
  for (const r of floorResults) {
    const progress: FloorProgress = {
      floor: r.floor,
      visitType: isRevisit(save, r.floor) ? "revisit" : "first",
      attemptedAt: new Date().toISOString(),
      turnsUsed: r.turnsUsed,
      tokensUsed: r.tokensUsed,
      elevatorKeyObtained: r.score.elevatorKey,
      elevatorKeySubmitted: null,
      objectives: r.objectives.map((o) => ({
        id: o.id,
        solved: o.solved,
        partialCredit: o.points / Math.max(1, o.maxPoints),
      })),
      wipeOccurred: r.wipe?.occurred ?? false,
      durationMs: r.durationMs,
      visitCount: 0, // will be set by recordFloorVisit
    };
    recordFloorVisit(save, progress);
  }
  persistSave(save, resultsDir);

  console.log(`\n--- Save Updated ---`);
  console.log(`  Highest floor: ${save.highestFloorCleared}`);
  console.log(`  Accessible: ${save.accessibleFloors.join(", ")}`);
  console.log(`  Total visits: ${save.stats.totalVisits} (${save.stats.revisitCount} revisits)`);
}

// Save JSON
mkdirSync(manifest.output, { recursive: true });
const result: RunResult = {
  manifest,
  floorResults,
  aggregate,
  crux,
  progression,
  completedAt: new Date().toISOString(),
};

const filename = [
  "topfloor",
  manifest.arm,
  manifest.model.replace(/[^a-zA-Z0-9]/g, "-"),
  `f${manifest.floors[0]}-${manifest.floors[manifest.floors.length - 1]}`,
  new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19),
].join("_") + ".json";

const outPath = resolve(manifest.output, filename);
writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nResults saved to: ${outPath}`);
