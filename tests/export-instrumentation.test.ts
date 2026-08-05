import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * The exporter and the cleaning script must agree on what counts as
 * instrumented. If they drift, the daily export silently reinstates every
 * record the cleaning removed.
 */
describe("export filter matches the cleaning rule", () => {
  const exporter = readFileSync(resolve(ROOT, "scripts", "export-public-data.ts"), "utf8");
  const cleaner = readFileSync(resolve(ROOT, "scripts", "clean-uninstrumented.ts"), "utf8");

  it("the exporter applies an instrumentation gate", () => {
    expect(exporter).toMatch(/isInstrumented\(record\)/);
  });

  for (const field of ["context_tokens", "corpus_tokens"]) {
    it(`both scripts recognise ${field} as a context-token field`, () => {
      expect(exporter).toContain(field);
      expect(cleaner).toContain(field);
    });
  }

  for (const field of ["c_tokens_usd", "estimatedCostUsd", "totalCostUsd"]) {
    it(`both scripts recognise ${field} as a cost field`, () => {
      expect(exporter).toContain(field);
      expect(cleaner).toContain(field);
    });
  }

  it("both scope the gate to leaderboard rows only", () => {
    // Scorecards and bundles carry no rig and must never be dropped.
    expect(exporter).toMatch(/"rig" in record/);
    expect(cleaner).toMatch(/"rig" in rec/);
  });
});

describe("published records satisfy the rule", () => {
  it("every remaining record has both a context-token count and a cost", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const dir = resolve(ROOT, "public-data");
    const offenders: string[] = [];

    for (const surface of readdirSync(dir)) {
      const sub = resolve(dir, surface);
      if (!statSync(sub).isDirectory()) continue;
      for (const file of readdirSync(sub)) {
        if (!file.endsWith(".json")) continue;
        const rec = JSON.parse(readFileSync(resolve(sub, file), "utf8"));
        if (!rec || typeof rec !== "object" || !("rig" in rec)) continue;
        const ctx = ["context_tokens", "corpus_tokens"].some(f => typeof rec[f] === "number");
        const cost = ["c_tokens_usd", "estimatedCostUsd", "totalCostUsd"].some(f => typeof rec[f] === "number");
        if (!ctx || !cost) offenders.push(`${surface}/${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
