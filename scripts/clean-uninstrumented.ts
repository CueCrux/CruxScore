/**
 * Remove published records that lack cost/token instrumentation.
 *
 * A result whose token bill was never recorded cannot be placed on the
 * Efficiency board and cannot be compared on cost against anything else, so it
 * occupies a leaderboard row without supporting the claim the row makes.
 *
 * Fields checked (any one satisfies the axis):
 *   context tokens — `context_tokens`, `corpus_tokens`
 *   cost           — `c_tokens_usd`, `estimatedCostUsd`, `totalCostUsd`
 *
 * Rules:
 *   either  (default) — remove unless BOTH axes are recorded
 *   both              — remove only when NEITHER axis is recorded
 *
 * Note on `either`: no published record has tokens without cost, so this rule
 * is in practice "must have context tokens". It therefore removes whole
 * single-prompt suites (intelligence, coding, code-minimalism) that record cost
 * but have no context-retrieval step to measure. That is a deliberate choice,
 * not an oversight — see the ExecPlan decision log.
 *
 * Records without a `rig` are left alone; they are not leaderboard rows.
 *
 *   npx tsx scripts/clean-uninstrumented.ts [--rule either|both] [--dry-run]
 */

import { readdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname!, "..");
const PUBLIC_DATA = resolve(ROOT, "public-data");

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const ruleIdx = argv.indexOf("--rule");
const RULE = ruleIdx >= 0 ? argv[ruleIdx + 1] : "either";

if (RULE !== "either" && RULE !== "both") {
  console.error(`--rule must be "either" or "both"; got ${JSON.stringify(RULE)}`);
  process.exit(1);
}

const CTX_FIELDS = ["context_tokens", "corpus_tokens"] as const;
const COST_FIELDS = ["c_tokens_usd", "estimatedCostUsd", "totalCostUsd"] as const;

function hasNumber(rec: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.some((f) => {
    const v = rec[f];
    return typeof v === "number" && Number.isFinite(v);
  });
}

interface Removal {
  surface: string;
  file: string;
  hasCtx: boolean;
  hasCost: boolean;
}

const removals: Removal[] = [];
const perSurface = new Map<string, { total: number; removed: number }>();

for (const entry of readdirSync(PUBLIC_DATA, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const surface = entry.name;
  const dir = join(PUBLIC_DATA, surface);
  const stats = { total: 0, removed: 0 };

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;

    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    } catch {
      continue;
    }
    // Only leaderboard rows are in scope. Scorecards and bundles are not runs.
    if (!rec || typeof rec !== "object" || Array.isArray(rec) || !("rig" in rec)) continue;

    stats.total++;
    const hasCtx = hasNumber(rec, CTX_FIELDS);
    const hasCost = hasNumber(rec, COST_FIELDS);

    const drop = RULE === "either" ? !(hasCtx && hasCost) : !hasCtx && !hasCost;
    if (!drop) continue;

    stats.removed++;
    removals.push({ surface, file, hasCtx, hasCost });
    if (!DRY_RUN) rmSync(join(dir, file));
  }

  perSurface.set(surface, stats);
}

// ---------------------------------------------------------------------------
// Manifest — counts must not outlive the records they describe
// ---------------------------------------------------------------------------

const manifestPath = join(PUBLIC_DATA, "index.json");
if (!DRY_RUN) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  for (const [surface, stats] of perSurface) {
    if (manifest.surfaces?.[surface] && stats.removed > 0) {
      manifest.surfaces[surface].published = stats.total - stats.removed;
    }
  }
  manifest.cleaning = {
    rule: RULE,
    removed: removals.length,
    note:
      "Records without both a context-token count and a measured cost were removed: "
      + "a result with no token bill cannot be ranked on Efficiency or compared on cost.",
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`rule:     ${RULE}${DRY_RUN ? "  (dry run — nothing written)" : ""}`);
console.log(`removed:  ${removals.length}\n`);
console.log(`${"surface".padEnd(18)}${"total".padStart(7)}${"removed".padStart(9)}${"kept".padStart(7)}`);
for (const [surface, s] of [...perSurface].sort()) {
  if (s.total === 0) continue;
  const flag = s.removed === s.total && s.total > 0 ? "   <- surface emptied" : "";
  console.log(
    `${surface.padEnd(18)}${String(s.total).padStart(7)}${String(s.removed).padStart(9)}`
    + `${String(s.total - s.removed).padStart(7)}${flag}`,
  );
}

const ctxOnly = removals.filter((r) => r.hasCtx && !r.hasCost).length;
const costOnly = removals.filter((r) => !r.hasCtx && r.hasCost).length;
const neither = removals.filter((r) => !r.hasCtx && !r.hasCost).length;
console.log(
  `\nof those removed: ${costOnly} had cost but no context tokens, `
  + `${ctxOnly} had context tokens but no cost, ${neither} had neither`,
);
