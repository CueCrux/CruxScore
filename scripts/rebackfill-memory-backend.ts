/**
 * Re-resolve `rig.memory_backend` on published records against the canonical
 * taxonomy (src/memory-backend.ts).
 *
 * The first backfill used a flat arm->backend map, which is unsafe: `C0` is a
 * bare model in Scale and full context-stuffing in Top Floor. Everything that
 * did not match fell through to `none`, so context-stuffed runs were published
 * as bare-model results and no suite outside Context had a vendor-native
 * baseline for lift.
 *
 *   npx tsx scripts/rebackfill-memory-backend.ts [--dry-run]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { resolveMemoryBackend } from "../src/memory-backend.js";

const PUBLIC_DATA = resolve(import.meta.dirname!, "..", "public-data");
const DRY_RUN = process.argv.includes("--dry-run");

const changes: Array<{ surface: string; from: string; to: string; n: number }> = [];
const tally = new Map<string, number>();
const unresolved: string[] = [];
let scanned = 0, changed = 0;

for (const entry of readdirSync(PUBLIC_DATA, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const surface = entry.name;
  const dir = join(PUBLIC_DATA, surface);

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    let rec: any;
    try { rec = JSON.parse(readFileSync(join(dir, file), "utf-8")); } catch { continue; }
    if (!rec?.rig) continue;
    scanned++;

    const resolved = resolveMemoryBackend({
      surface,
      backend: rec.backend ?? null,
      arm: rec.arm ?? null,
      memorySystemUsed: rec.memory_system?.used ?? null,
    });

    if (resolved === null) { unresolved.push(`${surface}/${file} (arm=${rec.arm})`); continue; }
    if (resolved === rec.rig.memory_backend) continue;

    const key = `${surface}: ${rec.rig.memory_backend} -> ${resolved}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    rec.rig.memory_backend = resolved;
    if (!DRY_RUN) writeFileSync(join(dir, file), JSON.stringify(rec, null, 2) + "\n");
    changed++;
  }
}

console.log(`scanned:  ${scanned}`);
console.log(`changed:  ${changed}${DRY_RUN ? "  (dry run)" : ""}\n`);
for (const [k, n] of [...tally].sort()) console.log(`  ${k.padEnd(46)} ${n}`);
if (unresolved.length) {
  console.log(`\nunresolved (left unchanged): ${unresolved.length}`);
  for (const u of unresolved.slice(0, 10)) console.log(`  - ${u}`);
}
