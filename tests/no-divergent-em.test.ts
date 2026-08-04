import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Architectural guard: Effective Minutes has exactly one implementation.
 *
 * Top Floor previously shipped its own `computeCruxScore` returning
 * `effectiveMinutes = totalMinutes * (1 - composite)` — inverted (a perfect
 * agent scored 0 Em) and anchored on agent wall-clock rather than T_human. It
 * survived because nothing asserted that Em is computed in one place.
 *
 * Coverage alone would not have caught it: the file can be fully covered and
 * still compute the wrong quantity. This test checks the structure instead.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", "dist", "fixtures", "results", "corpus", ".git"]);

/**
 * Strip comments so the guard checks code, not prose. Without this, the doc
 * comment in crux-integration.ts explaining the deleted defect trips the very
 * rule it documents.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("Em has one implementation", () => {
  const benchmarkFiles = walk(join(ROOT, "benchmarks"));

  it("finds benchmark sources to check", () => {
    // Guard the guard: a broken walk would make every assertion below vacuous.
    expect(benchmarkFiles.length).toBeGreaterThan(20);
  });

  it("no benchmark defines its own computeCruxScore", () => {
    const offenders = benchmarkFiles.filter((f) =>
      /export\s+(async\s+)?function\s+computeCruxScore\b/.test(code(f)),
    );
    expect(
      offenders.map((f) => relative(ROOT, f)),
      "Em must come from src/score.ts — import computeCruxScore, do not redefine it",
    ).toEqual([]);
  });

  it("no benchmark computes an Effective Minutes value locally", () => {
    // `effectiveMinutes` is a reserved name: the deleted defect used it, and
    // any reappearance means a second Em is being derived outside the package.
    const offenders = benchmarkFiles.filter((f) =>
      /\beffectiveMinutes\b/.test(code(f)),
    );
    expect(
      offenders.map((f) => relative(ROOT, f)),
      "use the package's Cx_em; a benchmark-local `effectiveMinutes` is not comparable",
    ).toEqual([]);
  });

  it("no benchmark assigns Cx_em from its own arithmetic", () => {
    const offenders = benchmarkFiles.filter((f) =>
      /\bCx_em\s*[:=]\s*[^;,\n]*[*/+-]/.test(code(f)),
    );
    expect(
      offenders.map((f) => relative(ROOT, f)),
      "Cx_em is computed by src/composite.ts and read, never recomputed",
    ).toEqual([]);
  });

  it("keeps the canonical implementation in src/score.ts", () => {
    const score = readFileSync(join(ROOT, "src", "score.ts"), "utf8");
    expect(score).toMatch(/export\s+function\s+computeCruxScore\b/);
  });
});
