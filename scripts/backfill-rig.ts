/**
 * Backfill `rig` onto published records.
 *
 * Every surface already encodes the rig axes, but in a different vocabulary
 * each: Context uses `backend`, Scale and Top Floor use treatment `arm`,
 * Intelligence and Coding use neither because no memory system is involved.
 * This normalises all of them onto {model, memory_backend, effort_tier} so one
 * board can rank them together.
 *
 * `effort_tier` is always null here. No historical run declared its reasoning
 * effort, and inferring it from token counts would fabricate the very axis the
 * field exists to measure.
 *
 * Idempotent: re-running produces no further changes.
 *
 *   npx tsx scripts/backfill-rig.ts [--dry-run]
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { backendForArm, type Rig } from "../src/rig.js";

const ROOT = resolve(import.meta.dirname!, "..");
const PUBLIC_DATA = resolve(ROOT, "public-data");
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Surfaces where the model is given the task in-prompt with no memory system.
 *
 * code-minimalism belongs here despite carrying an `arm`: its arms are prompt
 * profiles ("crux-code-minimalism", "ponytail-plugin"), not memory backends.
 */
const NO_MEMORY_SURFACES = new Set(["intelligence", "coding", "code-minimalism"]);

interface Record_ {
  model?: string;
  backend?: string;
  arm?: string;
  memory_system?: { used?: boolean; name?: string };
  rig?: Rig;
  [k: string]: unknown;
}

/** Derive the memory backend for a record, or null if it cannot be determined. */
function deriveBackend(surface: string, rec: Record_): string | null {
  // Context declares the backend directly, in the canonical vocabulary.
  if (typeof rec.backend === "string" && rec.backend.length > 0) return rec.backend;

  // Suites with no memory system, checked before `arm` because some of them
  // use `arm` for something other than a memory configuration.
  if (NO_MEMORY_SURFACES.has(surface)) return "none";

  // Scale and Top Floor declare a treatment arm.
  if (typeof rec.arm === "string" && rec.arm.length > 0) {
    const mapped = backendForArm(rec.arm);
    if (mapped) return mapped;
  }

  // An explicit "no memory system" declaration.
  if (rec.memory_system && rec.memory_system.used === false) return "none";

  return null;
}

let scanned = 0;
let updated = 0;
let skipped = 0;
const unresolved: string[] = [];

for (const entry of readdirSync(PUBLIC_DATA, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue; // public-data/ also holds README.md and index.json
  const surface = entry.name;
  const dir = join(PUBLIC_DATA, surface);
  const entries = readdirSync(dir).filter((f) => f.endsWith(".json"));

  for (const file of entries) {
    const path = join(dir, file);
    let rec: Record_;
    try {
      rec = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      continue;
    }
    if (typeof rec !== "object" || rec === null || Array.isArray(rec)) continue;

    scanned++;

    if (rec.rig) {
      skipped++;
      continue;
    }

    const model = typeof rec.model === "string" ? rec.model : null;
    const backend = deriveBackend(surface, rec);

    if (!model || !backend) {
      unresolved.push(`${surface}/${file}`);
      continue;
    }

    rec.rig = { model, memory_backend: backend, effort_tier: null };

    if (!DRY_RUN) {
      writeFileSync(path, JSON.stringify(rec, null, 2) + "\n");
    }
    updated++;
  }
}

console.log(`scanned:    ${scanned}`);
console.log(`updated:    ${updated}${DRY_RUN ? " (dry run — nothing written)" : ""}`);
console.log(`already ok: ${skipped}`);
console.log(`unresolved: ${unresolved.length}`);
for (const u of unresolved.slice(0, 20)) console.log(`  - ${u}`);
if (unresolved.length > 20) console.log(`  ... and ${unresolved.length - 20} more`);

// Unresolved records are left untouched and reported. A record whose rig cannot
// be derived must stay absent from the rig board rather than carry a guess.
