import { describe, expect, it } from "vitest";
import { llmCallLogSchema } from "../lib/logs";

describe("llmCallLogSchema", () => {
  it("parses a valid report and defaults absent numerics to null", () => {
    const p = llmCallLogSchema.parse({
      kind: "llm",
      purpose: "judge",
      model: "deepseek-chat",
      input_chars: 1234,
      took_ms: 800,
      ok: true,
    });
    expect(p).toMatchObject({
      kind: "llm",
      purpose: "judge",
      model: "deepseek-chat",
      input_chars: 1234,
      prompt_tokens: null,
      completion_tokens: null,
      took_ms: 800,
      ok: true,
      error: null,
    });
  });

  it("truncates over-long model and error fields", () => {
    const p = llmCallLogSchema.parse({
      kind: "embedding",
      purpose: "x".repeat(80),
      model: "m".repeat(300),
      ok: false,
      error: "e".repeat(900),
    });
    expect(p.purpose.length).toBeLessThanOrEqual(50);
    expect(p.model.length).toBeLessThanOrEqual(100);
    expect(p.error?.length).toBe(500);
  });

  it("rejects unknown kinds and out-of-range numerics", () => {
    expect(
      llmCallLogSchema.safeParse({ kind: "other", purpose: "p", model: "m", ok: true }).success
    ).toBe(false);
    expect(
      llmCallLogSchema.safeParse({ kind: "llm", purpose: "p", model: "m", ok: true, took_ms: -1 }).success
    ).toBe(false);
    expect(
      llmCallLogSchema.safeParse({ kind: "llm", purpose: "p", model: "m", ok: "yes" }).success
    ).toBe(false);
  });

  it("rejects an empty purpose after clamping", () => {
    expect(
      llmCallLogSchema.safeParse({ kind: "llm", purpose: "   ", model: "m", ok: true }).success
    ).toBe(false);
  });
});
