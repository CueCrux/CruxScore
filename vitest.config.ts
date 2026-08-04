import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "benchmarks/**/tests/**/*.test.ts"],
    // Coding fixture tests (benchmarks/coding/fixtures/**) import a
    // sandbox-runtime-only `solution.js`; they run inside the sandbox, never as
    // repo unit tests. Keep the vitest defaults we still rely on alongside.
    exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
    coverage: {
      provider: "v8",
      // Benchmark-local scorers are included so a second, divergent Em
      // implementation cannot reappear unmeasured. `src/**` was the only
      // included path when Top Floor shipped an inverted `effectiveMinutes`
      // that no test ever exercised.
      include: ["src/**/*.ts", "benchmarks/**/scoring/**/*.ts"],
      exclude: ["src/index.ts"],
      // Both paths are scoped by glob rather than one global + one glob:
      // Vitest still counts glob-matched files toward the global thresholds,
      // so a global 100% would be computed over the benchmark scorers too.
      thresholds: {
        // The reference implementation stays at 100%.
        "src/**/*.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Benchmark scorers are a ratchet, not a wall: set at measured
        // coverage and raised as each suite is brought up. Lowering a number
        // here should need the same justification as deleting a test.
        "benchmarks/**/scoring/**/*.ts": {
          branches: 55,
          functions: 30,
          lines: 29,
          statements: 29,
        },
      },
    },
  },
});
