/**
 * Model caller — sends coding prompts to LLM and extracts code.
 *
 * Supports three providers:
 * - "claude-*" / "gpt-*" — direct API calls (uses credits)
 * - "interactive" — prints prompt to stdout, reads code from stdin (free, uses current session)
 * - "file:<path>" — reads pre-generated code from a file (for batch/offline runs)
 */

import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline";
import { readFileSync, existsSync } from "node:fs";

export interface ModelResponse {
  code: string;
  rawOutput: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

const SYSTEM_PROMPT = `You are a senior TypeScript developer completing a coding task.
Read the task prompt carefully and write a complete solution.
Output ONLY the TypeScript code — no explanations, no markdown fences, no comments about the solution.
The code will be saved directly to a .ts file and must compile and pass tests.`;

export async function callModel(
  model: string,
  prompt: string,
): Promise<ModelResponse> {
  const start = Date.now();

  // Interactive mode: print prompt, read response from stdin
  if (model === "interactive") {
    return callInteractive(prompt, start);
  }

  // File mode: read pre-generated code from a file
  if (model.startsWith("file:")) {
    return callFromFile(model.slice(5), start);
  }

  if (model.startsWith("claude")) {
    const client = new Anthropic();
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return {
      code: extractCode(text),
      rawOutput: text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - start,
    };
  }

  if (model.startsWith("gpt") || model.startsWith("o")) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY required");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = (await res.json()) as any;
    if (data.error) throw new Error(`OpenAI: ${data.error.message}`);
    const text = data.choices?.[0]?.message?.content ?? "";

    return {
      code: extractCode(text),
      rawOutput: text,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - start,
    };
  }

  throw new Error(`Unsupported model: ${model}`);
}

/** Extract code from model output — strips markdown fences if present */
function extractCode(text: string): string {
  // Remove ```typescript or ```ts fences
  const fenceMatch = text.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Remove ``` fences without language tag
  const genericMatch = text.match(/```\s*\n([\s\S]*?)```/);
  if (genericMatch) return genericMatch[1].trim();

  // Already clean code
  return text.trim();
}

/**
 * Interactive mode — prints the prompt and reads code from stdin.
 * Use this when running inside a Claude Code session to use your allowance.
 *
 * The harness prints the task, you paste to Claude, Claude generates code,
 * you paste the code back. Type END_OF_CODE on a line by itself to finish.
 */
async function callInteractive(prompt: string, start: number): Promise<ModelResponse> {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  INTERACTIVE MODE — paste the prompt below to your LLM  ║");
  console.log("║  Then paste the generated code back here.               ║");
  console.log("║  Type END_OF_CODE on a line by itself when done.        ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log("── SYSTEM PROMPT ──");
  console.log(SYSTEM_PROMPT);
  console.log("\n── TASK PROMPT ──");
  console.log(prompt);
  console.log("\n── PASTE YOUR CODE BELOW (end with END_OF_CODE) ──\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = [];

  const code = await new Promise<string>((resolve) => {
    rl.on("line", (line) => {
      if (line.trim() === "END_OF_CODE") {
        rl.close();
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
      }
    });
  });

  return {
    code: extractCode(code),
    rawOutput: code,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: Date.now() - start,
  };
}

/**
 * File mode — reads pre-generated code from a file.
 * Use: --model file:/path/to/solution.ts
 */
async function callFromFile(filepath: string, start: number): Promise<ModelResponse> {
  if (!existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }
  const code = readFileSync(filepath, "utf-8");
  return {
    code: extractCode(code),
    rawOutput: code,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: Date.now() - start,
  };
}
