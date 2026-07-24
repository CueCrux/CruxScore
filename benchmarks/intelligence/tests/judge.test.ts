import { describe, it, expect } from "vitest";
import { parseJudgeSpec, parseVerdict, aggregateVerdicts, type JudgeVerdict } from "../scoring/judge.js";

const verdict = (equivalent: boolean | null, model = "j"): JudgeVerdict => ({
  model,
  base: "http://localhost:1",
  equivalent,
  reason: "",
  latencyMs: 1,
});

describe("parseJudgeSpec", () => {
  it("splits model from base on the last @", () => {
    expect(parseJudgeSpec("gpt-5.6@http://127.0.0.1:9992")).toEqual({
      model: "gpt-5.6",
      base: "http://127.0.0.1:9992",
    });
  });

  it("keeps @ inside the model id", () => {
    expect(parseJudgeSpec("claude-opus-4-5@20251101@http://h:1").model).toBe("claude-opus-4-5@20251101");
  });

  it("strips trailing slashes from the base", () => {
    expect(parseJudgeSpec("m@http://h:1///").base).toBe("http://h:1");
  });

  it("rejects specs without a base", () => {
    expect(() => parseJudgeSpec("gpt-5.6")).toThrow();
    expect(() => parseJudgeSpec("gpt-5.6@")).toThrow();
    expect(() => parseJudgeSpec("@http://h:1")).toThrow();
  });
});

describe("parseVerdict", () => {
  it("reads a bare verdict object", () => {
    expect(parseVerdict('{"reason": "same values", "equivalent": true}')).toEqual({
      equivalent: true,
      reason: "same values",
    });
  });

  it("reads a fenced verdict object", () => {
    expect(parseVerdict('```json\n{"reason": "C differs", "equivalent": false}\n```').equivalent).toBe(false);
  });

  it("extracts the object when the judge wraps it in prose", () => {
    expect(parseVerdict('Here is my verdict: {"reason": "ok", "equivalent": true} — done.').equivalent).toBe(true);
  });

  it("returns null rather than guessing when the verdict is unparseable", () => {
    expect(parseVerdict("the answers look the same to me").equivalent).toBeNull();
  });

  it("returns null when `equivalent` is not a boolean", () => {
    expect(parseVerdict('{"reason": "maybe", "equivalent": "yes"}').equivalent).toBeNull();
  });
});

describe("aggregateVerdicts", () => {
  it("rescues only when every judge agrees", () => {
    expect(aggregateVerdicts([verdict(true), verdict(true)]).rescued).toBe(true);
  });

  it("does not rescue on a split, and records it", () => {
    const r = aggregateVerdicts([verdict(true), verdict(false)]);
    expect(r.rescued).toBe(false);
    expect(r.split).toBe(true);
  });

  it("does not rescue when a judge errored, even if the others agree", () => {
    const r = aggregateVerdicts([verdict(true), verdict(null)]);
    expect(r.rescued).toBe(false);
    expect(r.split).toBe(false);
  });

  it("does not rescue an empty panel", () => {
    expect(aggregateVerdicts([]).rescued).toBe(false);
  });

  it("does not rescue when every judge says no", () => {
    const r = aggregateVerdicts([verdict(false), verdict(false)]);
    expect(r.rescued).toBe(false);
    expect(r.split).toBe(false);
  });
});
