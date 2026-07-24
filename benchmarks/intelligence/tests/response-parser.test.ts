import { describe, it, expect } from "vitest";
import { extractJsonObject, parseResponse } from "../lib/response-parser.js";

const OBJ = '{"final_answer": "8", "confidence": 1, "working": ["0+5=5", "x2=10"]}';

describe("extractJsonObject", () => {
  it("reads a bare object", () => {
    expect(extractJsonObject(OBJ)).toBe(OBJ);
  });

  it("reads a fenced object", () => {
    expect(extractJsonObject("```json\n" + OBJ + "\n```")).toBe(OBJ);
  });

  it("reads an object preceded by prose — the claude-opus-5 B001 case", () => {
    const raw = "0+5=5, ×2=10, −3=7, +1=8.\n\n```json\n" + OBJ + "\n```";
    expect(extractJsonObject(raw)).toBe(OBJ);
  });

  it("reads an object followed by prose", () => {
    expect(extractJsonObject(OBJ + "\n\nLet me know if you want the steps expanded.")).toBe(OBJ);
  });

  it("takes the first object when a model answers twice", () => {
    const second = '{"final_answer": "15", "confidence": 1, "working": []}';
    expect(extractJsonObject(OBJ + "\n\nWait — recheck:\n" + second)).toBe(OBJ);
  });

  it("handles braces inside strings", () => {
    const tricky = '{"final_answer": "use {curly} braces", "confidence": 1, "working": []}';
    expect(extractJsonObject("note: " + tricky)).toBe(tricky);
  });

  it("handles an escaped quote inside a string", () => {
    const tricky = '{"final_answer": "say \\"hi\\"", "confidence": 1, "working": []}';
    expect(extractJsonObject(tricky)).toBe(tricky);
  });

  it("handles nested objects", () => {
    const nested = '{"final_answer": {"a": 1}, "confidence": 1, "working": []}';
    expect(extractJsonObject("prefix " + nested + " suffix")).toBe(nested);
  });

  it("returns null when there is no object at all", () => {
    expect(extractJsonObject("The answer is 8.")).toBeNull();
  });

  it("ignores a stray closing brace before the real object", () => {
    expect(extractJsonObject("} oops\n" + OBJ)).toBe(OBJ);
  });
});

describe("parseResponse", () => {
  it("parses prose-then-fence into the documented fields", () => {
    const parsed = parseResponse("Answer: 8.\n```json\n" + OBJ + "\n```");
    expect(parsed).not.toBeNull();
    expect(parsed!.final_answer).toBe("8");
    expect(parsed!.confidence).toBe(1);
    expect(parsed!.working).toHaveLength(2);
  });

  it("defaults missing fields rather than throwing", () => {
    const parsed = parseResponse('{"final_answer": "8"}');
    expect(parsed!.confidence).toBe(0);
    expect(parsed!.working).toEqual([]);
  });

  it("keeps array answers as arrays", () => {
    const parsed = parseResponse('{"final_answer": ["Y", "Z"], "confidence": 0.9, "working": []}');
    expect(parsed!.final_answer).toEqual(["Y", "Z"]);
  });

  it("returns null on prose with no JSON — it never guesses an answer", () => {
    expect(parseResponse("The final value of the counter is 8.")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseResponse('{"final_answer": "8", oops}')).toBeNull();
  });
});
