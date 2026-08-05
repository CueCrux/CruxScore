import { describe, it, expect } from "vitest";
import {
  MEMORY_BACKENDS,
  BASELINE_BACKEND,
  LEGACY_ARM_MAP,
  isKnownBackend,
  backendLabel,
  isControlBackend,
  resolveMemoryBackend,
} from "../src/memory-backend.js";

describe("taxonomy", () => {
  it("names exactly one baseline", () => {
    const baselines = Object.values(MEMORY_BACKENDS).filter(b => b.isBaseline);
    expect(baselines.map(b => b.id)).toEqual([BASELINE_BACKEND]);
  });

  it("gives every backend a label and a description", () => {
    for (const [id, spec] of Object.entries(MEMORY_BACKENDS)) {
      expect(spec.id).toBe(id);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(20);
    }
  });

  it("marks oracle and random as the only controls", () => {
    const controls = Object.values(MEMORY_BACKENDS).filter(b => b.isControl).map(b => b.id);
    expect(controls.sort()).toEqual(["oracle", "random"]);
  });

  it("distinguishes retrieval-capable backends", () => {
    expect(MEMORY_BACKENDS["crux"]!.retrieval).toBe(true);
    expect(MEMORY_BACKENDS["raw-tools"]!.retrieval).toBe(true);
    // Handing the model everything up front is not retrieval.
    expect(MEMORY_BACKENDS["vendor-native"]!.retrieval).toBe(false);
    expect(MEMORY_BACKENDS["none"]!.retrieval).toBe(false);
  });
});

describe("helpers", () => {
  it("recognises known backends", () => {
    expect(isKnownBackend("crux")).toBe(true);
    expect(isKnownBackend("nonsense")).toBe(false);
  });

  it("labels known backends and passes through unknown ids", () => {
    expect(backendLabel("vendor-native")).toBe("Vendor-native");
    expect(backendLabel("mem0")).toBe("mem0");
  });

  it("identifies controls", () => {
    expect(isControlBackend("oracle")).toBe(true);
    expect(isControlBackend("crux")).toBe(false);
    expect(isControlBackend("unknown")).toBe(false);
  });
});

describe("resolveMemoryBackend — arm labels are suite-scoped", () => {
  it("resolves C0 differently per suite, because it means different things", () => {
    // This collision is the whole reason the map is keyed by surface first.
    expect(resolveMemoryBackend({ surface: "scale", arm: "C0" })).toBe("none");
    expect(resolveMemoryBackend({ surface: "topfloor", arm: "C0" })).toBe("vendor-native");
  });

  it("maps context-stuffing to the vendor-native baseline", () => {
    expect(resolveMemoryBackend({ surface: "scale", arm: "C2" })).toBe("vendor-native");
  });

  it("maps tool-only arms to raw-tools, not none", () => {
    expect(resolveMemoryBackend({ surface: "scale", arm: "F1" })).toBe("raw-tools");
    expect(resolveMemoryBackend({ surface: "topfloor", arm: "T1" })).toBe("raw-tools");
  });

  it("maps memory-tool arms to crux", () => {
    expect(resolveMemoryBackend({ surface: "topfloor", arm: "T2" })).toBe("crux");
    // The sandbox in T3 is a separate capability, not a different memory backend.
    expect(resolveMemoryBackend({ surface: "topfloor", arm: "T3" })).toBe("crux");
  });

  it("prefers an explicit backend over any arm", () => {
    expect(
      resolveMemoryBackend({ surface: "scale", backend: "sqlite-fts", arm: "C0" }),
    ).toBe("sqlite-fts");
  });

  it("ignores an explicit backend that is not in the taxonomy", () => {
    expect(resolveMemoryBackend({ surface: "scale", backend: "bogus", arm: "C2" }))
      .toBe("vendor-native");
  });

  it("returns null for an unrecognised arm in a known suite", () => {
    // Must not default to `none` — that is what published context-stuffed runs
    // as bare-model results.
    expect(resolveMemoryBackend({ surface: "scale", arm: "Z9" })).toBeNull();
  });

  it("returns null for an arm in an unmapped suite", () => {
    expect(resolveMemoryBackend({ surface: "mystery", arm: "C0" })).toBeNull();
  });

  it("accepts an explicit no-memory declaration only when no arm is present", () => {
    expect(resolveMemoryBackend({ surface: "intelligence", memorySystemUsed: false })).toBe("none");
    // An arm present but unmapped stays unresolved rather than being overridden.
    expect(
      resolveMemoryBackend({ surface: "scale", arm: "Z9", memorySystemUsed: false }),
    ).toBeNull();
  });

  it("returns null when there is nothing to go on", () => {
    expect(resolveMemoryBackend({ surface: "scale" })).toBeNull();
  });
});

describe("LEGACY_ARM_MAP", () => {
  it("only maps arms to backends that exist in the taxonomy", () => {
    for (const [surface, arms] of Object.entries(LEGACY_ARM_MAP)) {
      for (const [arm, backend] of Object.entries(arms)) {
        expect(isKnownBackend(backend), `${surface}/${arm} -> ${backend}`).toBe(true);
      }
    }
  });
});
