// ScoreCrux Intelligence Benchmark — response parsing
//
// Isolated from the runner so it can be unit-tested and reused by
// tools/rescore-run.ts, which re-parses stored raw output.

import type { ParsedOutput } from "./types.js";

/**
 * Pull the first balanced JSON object out of a response.
 *
 * Models do not always honour "respond ONLY with the JSON object". A model
 * that answers correctly but writes one line of prose before the fenced block
 * used to fail JSON.parse outright and score zero — the item then looked like
 * a reasoning failure, and (being unparsed) it never reached the judge either.
 * That is what cost claude-opus-5 item B001 in run 08e259e7 while its answer,
 * inside the block, was right.
 *
 * Scanning for the first balanced `{...}` is the narrowest fix: it accepts
 * surrounding prose and fences, and still refuses to guess — the extracted
 * text must parse as JSON, and only the documented fields are read. When a
 * response contains several objects (a model that answers, second-guesses
 * itself, then re-answers) the FIRST is taken: that is the answer the model
 * committed to under the response contract.
 */
export function extractJsonObject(raw: string): string | null {
  const text = raw.replace(/```json/gi, "```");
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
      if (depth < 0) depth = 0; // stray brace in prose
    }
  }
  return null;
}

export function parseResponse(raw: string): ParsedOutput | null {
  try {
    const candidate = extractJsonObject(raw);
    if (!candidate) return null;

    const parsed = JSON.parse(candidate);

    return {
      final_answer: parsed.final_answer ?? "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      working: Array.isArray(parsed.working) ? parsed.working : [],
    };
  } catch {
    return null;
  }
}

