/**
 * Clear every published benchmark result.
 *
 * Removes leaderboard records only. The taxonomy (memory-backends.json), the
 * manifest and the directory README are metadata, not results, and stay — the
 * board must still be able to describe itself when it has nothing to show.
 *
 * Records live in git, so this is recoverable by revert as well as from the
 * tarballs in scorecrux-backups/.
 *
 *   npx tsx scripts/clear-results.ts [--dry-run]
 */
import { readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

const PUBLIC_DATA = resolve(import.meta.dirname!, "..", "public-data");
const DRY_RUN = process.argv.includes("--dry-run");

/** Files under public-data that describe the board rather than a result. */
const METADATA = new Set(["index.json", "memory-backends.json", "README.md"]);

let removed = 0;
const perSurface = new Map<string, number>();

for (const entry of readdirSync(PUBLIC_DATA, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(PUBLIC_DATA, entry.name);
  let n = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || METADATA.has(file)) continue;
    if (!DRY_RUN) rmSync(join(dir, file));
    n++;
  }
  if (n > 0) perSurface.set(entry.name, n);
  removed += n;
}

if (!DRY_RUN) {
  const manifestPath = join(PUBLIC_DATA, "index.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  for (const key of Object.keys(manifest.surfaces ?? {})) {
    manifest.surfaces[key] = { published: 0, embargoed: 0 };
  }
  manifest.cleared = {
    note:
      "All results cleared for a fresh start. Every surface reports zero until new runs "
      + "are submitted under the unified Capability / Memory Lift / Efficiency boards.",
  };
  delete manifest.cleaning;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

console.log(`removed ${removed} result records${DRY_RUN ? " (dry run)" : ""}`);
for (const [s, n] of [...perSurface].sort()) console.log(`  ${s.padEnd(14)} ${n}`);
console.log(`\nkept: ${[...METADATA].join(", ")}`);
