#!/usr/bin/env npx tsx
/**
 * Public-data exporter for ScoreCrux benchmarks.
 *
 * Reads the live submission store (TOPFLOOR_DATA_DIR — a Docker volume on prod),
 * filters out embargoed / private / practice / hidden records, strips PII,
 * and writes the result to the `public-data/` tree of the ScoreCrux git repo.
 *
 * Designed to be run by a daily systemd timer on the ScoreCrux-Frontdoor host.
 *
 * Usage:
 *   npx tsx scripts/export-public-data.ts                        # export + commit + push
 *   npx tsx scripts/export-public-data.ts --dry-run              # print what would change
 *   npx tsx scripts/export-public-data.ts --no-push              # commit locally only
 *   npx tsx scripts/export-public-data.ts --embargo-hours 72     # override the 48h default
 *
 * Env:
 *   TOPFLOOR_DATA_DIR          — source submission store (default: ./data/topfloor)
 *   PUBLIC_EXPORT_EMBARGO_HOURS — embargo in hours (default: 48)
 *   PUBLIC_DATA_REPO_DIR       — target ScoreCrux repo checkout (default: cwd)
 */

import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------- CLI ------------------------------------------------------------

interface Args {
  dryRun: boolean;
  noPush: boolean;
  embargoHours: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    dryRun: false,
    noPush: false,
    embargoHours: Number(process.env.PUBLIC_EXPORT_EMBARGO_HOURS ?? 48),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-push") out.noPush = true;
    else if (a === "--embargo-hours") { out.embargoHours = Number(argv[++i]); }
    else if (a === "--help" || a === "-h") {
      console.log("See file header for usage.");
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(out.embargoHours) || out.embargoHours < 0) {
    console.error(`Invalid --embargo-hours: ${out.embargoHours}`);
    process.exit(2);
  }
  return out;
}

// ---------- Paths ----------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.PUBLIC_DATA_REPO_DIR
  ? resolve(process.env.PUBLIC_DATA_REPO_DIR)
  : resolve(HERE, "..");
const DATA_DIR = process.env.TOPFLOOR_DATA_DIR || resolve(REPO_ROOT, "..", "ScoreCrux-Frontdoor", "data", "topfloor");
const PUBLIC_DIR = resolve(REPO_ROOT, "public-data");

// ---------- Redaction rules ------------------------------------------------

/**
 * Fields dropped from every record before publishing.
 * - claimCode: single-use auth secret
 * - submitterPlayerId: internal identifier
 * - ip / clientIp / remoteAddress: PII
 * - sessionToken / token: auth material
 * - audit / auditLog: internal ops
 */
const PII_FIELDS = new Set([
  "claimCode",
  "submitterPlayerId",
  "ip", "clientIp", "remoteAddress",
  "sessionToken", "token",
  "audit", "auditLog",
]);

function redact<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map(redact) as any;
  if (obj && typeof obj === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (PII_FIELDS.has(k)) continue;
      out[k] = redact(v);
    }
    return out as T;
  }
  return obj;
}

function isEmbargoed(submittedAt: string | undefined, embargoMs: number): boolean {
  if (!submittedAt) return true; // no timestamp → be safe, don't publish
  const t = Date.parse(submittedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t < embargoMs;
}

/** Context-token and cost fields, in the several spellings the suites use. */
const CTX_TOKEN_FIELDS = ["context_tokens", "corpus_tokens"];
const COST_FIELDS = ["c_tokens_usd", "estimatedCostUsd", "totalCostUsd"];

function hasMeasure(record: any, fields: string[]): boolean {
  return fields.some((f) => typeof record?.[f] === "number" && Number.isFinite(record[f]));
}

/**
 * Whether a leaderboard row carries its token bill.
 *
 * A result with no recorded context-token count and cost cannot be ranked on
 * Efficiency or compared on cost against anything else, so it occupies a row
 * without supporting the claim the row makes.
 *
 * This must stay in step with `scripts/clean-uninstrumented.ts`. Without it the
 * exporter reinstates on its next daily run exactly what that script removed,
 * because the records are still present and publishable in the source store.
 */
function isInstrumented(record: any): boolean {
  // Not a leaderboard row — scorecards, bundles, manifests are out of scope.
  if (!record || typeof record !== "object" || !("rig" in record)) return true;
  return hasMeasure(record, CTX_TOKEN_FIELDS) && hasMeasure(record, COST_FIELDS);
}

function isPublishable(record: any, embargoMs: number): boolean {
  if (record?.leaderboard_visible === false) return false;
  if (record?.fixture_tier === "practice") return false;
  if (record?.hidden === true) return false;
  if (record?.scope === "private") return false;
  if (!isInstrumented(record)) return false;
  // `type === 'scale'` records use `date` (no `submittedAt`); accept either
  const when = record?.submittedAt ?? record?.updatedAt ?? record?.createdAt ?? record?.date;
  if (isEmbargoed(when, embargoMs)) return false;
  return true;
}

// ---------- Per-surface exporters -----------------------------------------

interface SurfaceStats { read: number; published: number; embargoed: number; skipped: number; }

function exportSimpleSurface(
  surface: "intelligence" | "coding" | "scale" | "topfloor" | "glassbox",
  srcSubdir: string,
  outSubdir: string,
  embargoMs: number,
  dryRun: boolean,
): SurfaceStats {
  const stats: SurfaceStats = { read: 0, published: 0, embargoed: 0, skipped: 0 };
  const srcDir = join(DATA_DIR, srcSubdir);
  const outDir = join(PUBLIC_DIR, outSubdir);

  if (!existsSync(srcDir)) {
    console.log(`  [${surface}] source missing (${srcDir}) — skipping`);
    return stats;
  }

  if (!dryRun) mkdirSync(outDir, { recursive: true });

  const kept = new Set<string>();

  for (const file of readdirSync(srcDir).filter(f => f.endsWith(".json"))) {
    stats.read++;
    let rec: any;
    try { rec = JSON.parse(readFileSync(join(srcDir, file), "utf-8")); }
    catch { stats.skipped++; continue; }

    if (!isPublishable(rec, embargoMs)) {
      // Distinguish embargo from private/practice for reporting
      const when = rec?.submittedAt ?? rec?.updatedAt ?? rec?.createdAt ?? rec?.date;
      if (rec?.leaderboard_visible === false || rec?.fixture_tier === "practice"
          || rec?.hidden === true || rec?.scope === "private") {
        stats.skipped++;
      } else if (isEmbargoed(when, embargoMs)) {
        stats.embargoed++;
      } else {
        stats.skipped++;
      }
      continue;
    }

    const redacted = redact(rec);
    kept.add(file);
    if (!dryRun) writeFileSync(join(outDir, file), JSON.stringify(redacted, null, 2));
    stats.published++;
  }

  // Idempotency: remove files from public-data that are no longer in source
  // or no longer pass the filter (e.g. a withdrawal within embargo window).
  if (existsSync(outDir)) {
    for (const existing of readdirSync(outDir).filter(f => f.endsWith(".json"))) {
      if (!kept.has(existing)) {
        if (!dryRun) rmSync(join(outDir, existing));
      }
    }
  }

  return stats;
}

/**
 * Direct surfaces have no live submission store: their records are committed
 * straight into `public-data/<subdir>/` by the suite's own emitter (e.g. the
 * `context` suite's `run_matrix.py`). This pass is COUNT-ONLY and
 * non-destructive — it indexes what is already published so `index.json`
 * reflects reality, without applying the embargo/idempotency-delete model that
 * only fits store-backed surfaces (applying it here would delete freshly
 * committed records inside their 48h window).
 */
function exportDirectSurface(surface: string, subdir: string): SurfaceStats {
  const stats: SurfaceStats = { read: 0, published: 0, embargoed: 0, skipped: 0 };
  const dir = join(PUBLIC_DIR, subdir);
  if (!existsSync(dir)) {
    console.log(`  [${surface}] no published dir (${dir}) — 0 records`);
    return stats;
  }
  for (const file of readdirSync(dir).filter(f => f.endsWith(".json"))) {
    stats.read++;
    stats.published++;
  }
  return stats;
}

/**
 * Pending models need a separate pass because `observations[]` contains
 * submitterPlayerId / submitterOrg we must redact to a count, not names.
 */
function exportPendingModels(embargoMs: number, dryRun: boolean): SurfaceStats {
  const stats: SurfaceStats = { read: 0, published: 0, embargoed: 0, skipped: 0 };
  const srcDir = join(DATA_DIR, "pending-models");
  const outDir = join(PUBLIC_DIR, "pending-models");
  if (!existsSync(srcDir)) return stats;
  if (!dryRun) mkdirSync(outDir, { recursive: true });

  const kept = new Set<string>();

  for (const file of readdirSync(srcDir).filter(f => f.endsWith(".json"))) {
    stats.read++;
    let rec: any;
    try { rec = JSON.parse(readFileSync(join(srcDir, file), "utf-8")); }
    catch { stats.skipped++; continue; }

    if (rec?.status && rec.status !== "pending") { stats.skipped++; continue; }
    if (isEmbargoed(rec?.firstSeenAt, embargoMs)) { stats.embargoed++; continue; }

    const obs = Array.isArray(rec.observations) ? rec.observations : [];
    const orgs = new Set<string>();
    const submitters = new Set<string>();
    for (const o of obs) {
      if (o?.submitterOrg) orgs.add(String(o.submitterOrg));
      if (o?.submitterPlayerId) submitters.add(String(o.submitterPlayerId));
    }

    const pub = {
      id: rec.id,
      proposedDisplayName: rec.proposedDisplayName ?? rec.id,
      proposedProvider: rec.proposedProvider ?? null,
      firstSeenAt: rec.firstSeenAt,
      lastSeenAt: rec.lastSeenAt,
      timesSeen: rec.timesSeen ?? 0,
      distinctSubmitters: submitters.size,
      distinctOrganizations: orgs.size,
      status: rec.status ?? "pending",
    };

    kept.add(file);
    if (!dryRun) writeFileSync(join(outDir, file), JSON.stringify(pub, null, 2));
    stats.published++;
  }

  if (existsSync(outDir)) {
    for (const existing of readdirSync(outDir).filter(f => f.endsWith(".json"))) {
      if (!kept.has(existing)) {
        if (!dryRun) rmSync(join(outDir, existing));
      }
    }
  }
  return stats;
}

// ---------- Index manifest -------------------------------------------------

function writeIndex(all: Record<string, SurfaceStats>, embargoHours: number, dryRun: boolean): void {
  const manifest = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    embargoHours,
    surfaces: Object.fromEntries(
      Object.entries(all).map(([k, v]) => [k, { published: v.published, embargoed: v.embargoed }]),
    ),
    policy: {
      embargo: `Records are withheld from publication for ${embargoHours} hours after submission to give submitters a window to withdraw or amend.`,
      filtered: [
        "Records with leaderboard_visible === false",
        "Records with fixture_tier === 'practice'",
        "Records with hidden === true",
        "Records with scope === 'private'",
      ],
      redacted: Array.from(PII_FIELDS).sort(),
      notes: "Pending model observations are aggregated to counts; per-observation submitter IDs and orgs are never published.",
    },
  };
  if (!dryRun) {
    mkdirSync(PUBLIC_DIR, { recursive: true });
    writeFileSync(join(PUBLIC_DIR, "index.json"), JSON.stringify(manifest, null, 2));
  }
}

// ---------- Git ------------------------------------------------------------

function run(cmd: string, cwd: string, dryRun: boolean, stdin?: string): string {
  if (dryRun) { console.log(`  [dry-run] ${cmd}`); return ""; }
  return execSync(cmd, {
    cwd,
    stdio: stdin !== undefined ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    input: stdin,
  }).toString();
}

function gitHasChanges(cwd: string): boolean {
  try {
    const out = execSync("git status --porcelain public-data", { cwd, stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .trim();
    return out.length > 0;
  } catch { return false; }
}

function commitAndPush(dryRun: boolean, noPush: boolean, stats: Record<string, SurfaceStats>): void {
  if (dryRun) { console.log("  [dry-run] would commit + push if changes"); return; }
  if (!gitHasChanges(REPO_ROOT)) {
    console.log("  No changes to public-data. Nothing to commit.");
    return;
  }
  const summary = Object.entries(stats)
    .map(([k, v]) => `${k}:${v.published}`)
    .join(" ");
  const msg = `data: daily public-data sync (${summary})\n\nEmbargoed records held for ${process.env.PUBLIC_EXPORT_EMBARGO_HOURS ?? 48}h; private/practice/hidden records excluded; PII redacted.`;
  run(`git add public-data`, REPO_ROOT, false);
  // Pass the message via stdin so real newlines are preserved.
  run(
    `git -c user.name="ScoreCrux Public Export" -c user.email="ops@scorecrux.com" commit -F -`,
    REPO_ROOT,
    false,
    msg,
  );
  if (!noPush) {
    run(`git push origin HEAD`, REPO_ROOT, false);
  } else {
    console.log("  --no-push: committed locally, skipping push.");
  }
}

// ---------- Main -----------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);
  const embargoMs = args.embargoHours * 3600 * 1000;

  console.log(`ScoreCrux public-data exporter`);
  console.log(`  source:       ${DATA_DIR}`);
  console.log(`  target:       ${PUBLIC_DIR}`);
  console.log(`  embargo:      ${args.embargoHours}h`);
  console.log(`  dry-run:      ${args.dryRun}`);
  console.log(`  push:         ${!args.noPush}`);
  console.log();

  if (!existsSync(DATA_DIR)) {
    console.error(`  source dir not found: ${DATA_DIR}`);
    process.exit(1);
  }

  const stats: Record<string, SurfaceStats> = {
    intelligence: exportSimpleSurface("intelligence", "intelligence-results", "intelligence", embargoMs, args.dryRun),
    coding:       exportSimpleSurface("coding",       "coding-results",       "coding",       embargoMs, args.dryRun),
    scale:        exportSimpleSurface("scale",        "scale-results",        "scale",        embargoMs, args.dryRun),
    topfloor:     exportSimpleSurface("topfloor",     "topfloor-results",     "topfloor",     embargoMs, args.dryRun),
    glassbox:     exportSimpleSurface("glassbox",     "glassbox-results",     "glassbox",     embargoMs, args.dryRun),
    context:      exportDirectSurface("context",      "context"),
    pendingModels: exportPendingModels(embargoMs, args.dryRun),
  };

  writeIndex(stats, args.embargoHours, args.dryRun);

  console.log(`\n  Summary:`);
  for (const [k, v] of Object.entries(stats)) {
    console.log(`    ${k.padEnd(15)} read=${v.read}  published=${v.published}  embargoed=${v.embargoed}  skipped=${v.skipped}`);
  }
  console.log();

  commitAndPush(args.dryRun, args.noPush, stats);
}

main();
