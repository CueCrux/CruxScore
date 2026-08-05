// ScoreCrux — Canonical memory-backend taxonomy
//
// One vocabulary for "how did the agent get its information", shared by every
// suite. It replaces the per-suite treatment-arm labels, which were ambiguous
// across suites in a way that silently corrupted the boards:
//
//   Scale     C0 = "Bare (no context, no tools)"
//   Top Floor C0 = "Flat context — all floor docs in prompt"
//
// The same label meant a bare model in one suite and full context-stuffing in
// the other. Both were mapped to `none`, so the Memory Lift board had no
// vendor-native baseline outside the Context suite and could not compute lift
// for anything else, while the Capability board presented context-stuffed runs
// as bare-model results.
//
// Arms remain on the record for provenance. They are no longer what anything is
// ranked or displayed by.

/** How the agent obtained its information. */
export interface MemoryBackendSpec {
  id: string;
  label: string;
  description: string;
  /** The reference condition memory lift is measured against. Exactly one. */
  isBaseline: boolean;
  /** Synthetic ceiling/floor — bounds the scale, never ranked. */
  isControl: boolean;
  /** Whether the agent could retrieve on demand rather than being handed everything. */
  retrieval: boolean;
}

export const MEMORY_BACKENDS: Readonly<Record<string, MemoryBackendSpec>> = Object.freeze({
  none: {
    id: "none",
    label: "None",
    description: "Bare model. No corpus, no tools — answers from training knowledge alone.",
    isBaseline: false,
    isControl: false,
    retrieval: false,
  },
  "vendor-native": {
    id: "vendor-native",
    label: "Vendor-native",
    description:
      "The vendor's own context handling: the full corpus injected into the context window, "
      + "no retrieval layer. O(N) tokens, unresolved history. This is the baseline every "
      + "memory system is measured against.",
    isBaseline: true,
    isControl: false,
    retrieval: false,
  },
  "raw-tools": {
    id: "raw-tools",
    label: "Raw tools",
    description:
      "Direct search/read tools with no memory abstraction — the agent retrieves on demand "
      + "but nothing persists between sessions.",
    isBaseline: false,
    isControl: false,
    retrieval: true,
  },
  compaction: {
    id: "compaction",
    label: "Compaction",
    description: "Current-value-only summary. Reduced tokens, history discarded.",
    isBaseline: false,
    isControl: false,
    retrieval: false,
  },
  "rag-bm25": {
    id: "rag-bm25",
    label: "RAG (BM25)",
    description: "In-process BM25 retrieval over the corpus. O(k) tokens.",
    isBaseline: false,
    isControl: false,
    retrieval: true,
  },
  "sqlite-fts": {
    id: "sqlite-fts",
    label: "SQLite FTS",
    description: "SQLite FTS5 retrieval — the reference retrieval implementation.",
    isBaseline: false,
    isControl: false,
    retrieval: true,
  },
  crux: {
    id: "crux",
    label: "Crux",
    description: "Freshness-resolved daemon retrieval with persistent memory across sessions.",
    isBaseline: false,
    isControl: false,
    retrieval: true,
  },
  oracle: {
    id: "oracle",
    label: "Oracle (control)",
    description: "Synthetic perfect answers. The ceiling — bounds the scale, never ranked.",
    isBaseline: false,
    isControl: true,
    retrieval: false,
  },
  random: {
    id: "random",
    label: "Random (control)",
    description: "Synthetic wrong answers. The floor — bounds the scale, never ranked.",
    isBaseline: false,
    isControl: true,
    retrieval: false,
  },
});

/** The single condition lift is measured against. */
export const BASELINE_BACKEND = "vendor-native";

export function isKnownBackend(id: string): boolean {
  return Object.hasOwn(MEMORY_BACKENDS, id);
}

export function backendLabel(id: string): string {
  return MEMORY_BACKENDS[id]?.label ?? id;
}

export function isControlBackend(id: string): boolean {
  return MEMORY_BACKENDS[id]?.isControl ?? false;
}

/**
 * Legacy treatment arms, resolved per suite.
 *
 * Keyed by surface *first* because the arm labels collide: `C0` is a bare model
 * in Scale and full context-stuffing in Top Floor. A flat arm→backend map is
 * exactly the bug this table exists to prevent.
 */
export const LEGACY_ARM_MAP: Readonly<Record<string, Readonly<Record<string, string>>>> =
  Object.freeze({
    scale: Object.freeze({
      C0: "none", // "Bare (no context, no tools)"
      C2: "vendor-native", // "Context-stuffed (full corpus in prompt)"
      F1: "raw-tools", // "File-based retrieval" / "Raw tools"
      T2: "crux", // MemoryCrux tool arm
    }),
    topfloor: Object.freeze({
      C0: "vendor-native", // "Flat context — all floor docs in prompt, no tools"
      T1: "raw-tools", // "Tools only — navigation tools, no persistent memory"
      T2: "crux", // "MemoryCrux — navigation + memory tools"
      T3: "crux", // "+ sandbox" — code execution is a separate capability, not a backend
    }),
  });

/**
 * Resolve a record's memory backend.
 *
 * Returns null when it cannot be determined — deliberately, so the caller
 * reports the record as unresolved rather than defaulting it to `none`.
 * Defaulting is what made context-stuffed runs appear as bare-model results.
 */
export function resolveMemoryBackend(opts: {
  surface: string;
  /** Explicit backend already on the record (the Context suite sets this). */
  backend?: string | null;
  /** Legacy treatment arm. */
  arm?: string | null;
  /** Explicit "no memory system was used" declaration. */
  memorySystemUsed?: boolean | null;
}): string | null {
  if (opts.backend && isKnownBackend(opts.backend)) return opts.backend;

  if (opts.arm) {
    const perSuite = LEGACY_ARM_MAP[opts.surface];
    // Only a suite-scoped lookup is safe; arm labels are not globally unique.
    if (perSuite?.[opts.arm]) return perSuite[opts.arm]!;
    // A known suite with an unrecognised arm is a real gap, not a `none`.
    if (perSuite) return null;
  }

  // Suites that run a single prompt with no corpus and no tools.
  if (opts.memorySystemUsed === false && !opts.arm) return "none";

  return null;
}
