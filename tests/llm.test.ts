import { afterEach, describe, expect, it } from "vitest";
import { extractJson } from "../lib/llm";
import { getLlmChatConfig, getLlmEmbeddingConfig, isAutoSummaryEnabled } from "../lib/config";

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("unwraps code fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n[{"a":2}]\n```')).toEqual([{ a: 2 }]);
  });

  it("slices surrounding prose", () => {
    expect(extractJson('好的,结果如下:{"a":1} 以上。')).toEqual({ a: 1 });
    expect(extractJson('前言\n[{"x":"y"}]\n后记')).toEqual([{ x: "y" }]);
  });

  it("throws when no JSON exists", () => {
    expect(() => extractJson("抱歉,我无法回答")).toThrow();
    expect(() => extractJson("")).toThrow();
  });
});

describe("llm config gating", () => {
  const keys = [
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_MODEL",
    "LLM_EMBEDDING_BASE_URL",
    "LLM_EMBEDDING_API_KEY",
    "LLM_EMBEDDING_MODEL",
    "LLM_EMBEDDING_DIMENSIONS",
    "LLM_AUTO_SUMMARY",
  ] as const;

  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it("chat config requires all three values", () => {
    expect(getLlmChatConfig()).toBeNull();
    process.env.LLM_BASE_URL = "https://api.example.com/v1/";
    process.env.LLM_API_KEY = "test-key";
    expect(getLlmChatConfig()).toBeNull();
    process.env.LLM_MODEL = "test-model";
    const cfg = getLlmChatConfig();
    expect(cfg).toEqual({ baseUrl: "https://api.example.com/v1", apiKey: "test-key", model: "test-model" });
  });

  it("embedding config falls back to chat values but needs dimensions", () => {
    process.env.LLM_BASE_URL = "https://api.example.com/v1";
    process.env.LLM_API_KEY = "k";
    process.env.LLM_MODEL = "chat-model";
    expect(getLlmEmbeddingConfig()).toBeNull(); // no embedding model/dimensions
    process.env.LLM_EMBEDDING_MODEL = "emb-model";
    expect(getLlmEmbeddingConfig()).toBeNull(); // dimensions still missing
    process.env.LLM_EMBEDDING_DIMENSIONS = "1024";
    const cfg = getLlmEmbeddingConfig();
    expect(cfg).toEqual({
      baseUrl: "https://api.example.com/v1",
      apiKey: "k",
      model: "emb-model",
      dimensions: 1024,
    });
  });

  it("auto summary only when explicitly enabled", () => {
    expect(isAutoSummaryEnabled()).toBe(false);
    process.env.LLM_AUTO_SUMMARY = "on";
    expect(isAutoSummaryEnabled()).toBe(true);
    process.env.LLM_AUTO_SUMMARY = "0";
    expect(isAutoSummaryEnabled()).toBe(false);
  });
});
