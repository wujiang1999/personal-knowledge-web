import { describe, expect, it } from "vitest";
import {
  chunkProfileMatches,
  embeddingSourceMatches,
  splitConceptBody,
} from "../lib/chunks";

describe("splitConceptBody", () => {
  it("covers an entire long body, including its tail, with stable offsets", () => {
    const paragraphs = Array.from({ length: 24 }, (_, i) => `段落${i}: ${"x".repeat(230)}`);
    const body = `${paragraphs.join("\n\n")}\n\n唯一尾部证据`;
    const chunks = splitConceptBody(body, 600, 100);

    expect(chunks[0].startOffset).toBe(0);
    expect(chunks.at(-1)?.endOffset).toBe(body.length);
    expect(chunks.some((chunk) => chunk.text.includes("唯一尾部证据"))).toBe(true);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startOffset).toBeLessThan(chunks[i - 1].endOffset);
      expect(chunks[i].endOffset).toBeGreaterThan(chunks[i].startOffset);
    }
  });

  it("prefers paragraph windows before splitting an exceptional long paragraph", () => {
    const body = `开头\n\n${"长段".repeat(500)}\n\n结尾`;
    const chunks = splitConceptBody(body, 500, 80);
    expect(chunks[0].text).toContain("开头");
    expect(chunks.at(-1)?.text).toContain("结尾");
  });

  it("never splits an astral Unicode character across a chunk boundary", () => {
    const body = `${"a".repeat(49)}🚀${"b".repeat(80)}`;
    const chunks = splitConceptBody(body, 50, 10);
    for (const chunk of chunks) {
      expect(chunk.text).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
    expect(chunks.some((chunk) => chunk.text.includes("🚀"))).toBe(true);
  });
});

describe("chunk freshness and vector-space guards", () => {
  const source = { contentHash: "sha256:current", title: "新标题", description: "新摘要" };
  const chunk = splitConceptBody("尾部事实")[0];
  const row = {
    contentHash: source.contentHash,
    title: source.title,
    description: source.description,
    endpoint: "https://dashscope.example/v1",
    model: "qwen3.7-text-embedding-flash",
    dimensions: 1024,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    text: chunk.text,
  };

  it("rejects a same-dimension vector from another configured model", () => {
    expect(
      chunkProfileMatches(row, source, { endpoint: row.endpoint, model: "other-1024-model", dimensions: 1024 }, chunk),
    ).toBe(false);
  });

  it("rejects an async result after a newer source has replaced it", () => {
    expect(embeddingSourceMatches(source, { ...source, contentHash: "sha256:old" })).toBe(false);
    expect(embeddingSourceMatches(source, source)).toBe(true);
  });
});
