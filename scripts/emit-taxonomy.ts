/**
 * Publish the canonical memory-backend taxonomy alongside the data.
 *
 * The site reads this file rather than importing the package: `ScoreCrux/dist`
 * is gitignored and never built inside the site's image, so an import would
 * break the deploy. Shipping the taxonomy with the records it describes keeps
 * one source of truth and no build-order dependency.
 *
 *   npx tsx scripts/emit-taxonomy.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MEMORY_BACKENDS, BASELINE_BACKEND, LEGACY_ARM_MAP } from "../src/memory-backend.js";

const out = resolve(import.meta.dirname!, "..", "public-data", "memory-backends.json");
writeFileSync(
  out,
  JSON.stringify(
    {
      generatedFrom: "src/memory-backend.ts",
      baseline: BASELINE_BACKEND,
      note:
        "Canonical vocabulary for how an agent obtained its information. Replaces the "
        + "per-suite treatment-arm labels, which were ambiguous across suites: 'C0' meant a "
        + "bare model in Scale and full context-stuffing in Top Floor.",
      backends: MEMORY_BACKENDS,
      // Published so the research bench pages resolve arm -> backend from the
      // same table the boards use, instead of each keeping its own glossary.
      // scale.vue's local copy had drifted to describing C0 as
      // "Context-Stuffed 32k" while the records say "Bare (no context, no tools)".
      legacyArmMap: LEGACY_ARM_MAP,
    },
    null,
    2,
  ) + "\n",
);
console.log(`wrote ${out} (${Object.keys(MEMORY_BACKENDS).length} backends)`);
