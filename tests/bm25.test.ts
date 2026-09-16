import { describe, expect, it } from "vitest";
import { DEPRECATED_FACTOR, MAX_QUERY_TERMS, bm25fTermContribution, tokenizeQuery } from "../lib/bm25";

describe("tokenizeQuery", () => {
  it("splits mixed CJK+ASCII needles into words and bigrams", () => {
    expect(tokenizeQuery("docker 部署指南")).toEqual(["docker", "部署", "署指", "指南"]);
  });

  it("keeps a lone CJK char as its own term", () => {
    expect(tokenizeQuery("库")).toEqual(["库"]);
  });

  it("lowercases ASCII terms", () => {
    expect(tokenizeQuery("API Keys")).toEqual(["api", "keys"]);
  });


  it("dedupes terms in first-occurrence order", () => {
    expect(tokenizeQuery("向量 向量数据库")).toEqual(["向量", "量数", "数据", "据库"]);
  });

  it("ignores punctuation inside a needle but keeps surrounding terms", () => {
    expect(tokenizeQuery("pgvector!数据库")).toEqual(["pgvector", "数据", "据库"]);
  });

  it("treats CJK punctuation as a term boundary, never a bigram source", () => {
    // Regression: the non-ASCII run regex does not split on punctuation, so
    // `知识库，检索` used to arrive as one run. Stripping the punctuation glued
    // it into 知识库检索 and emitted the cross-boundary bigram 库检 — which then
    // matched any doc where 库 sits next to 检 (数据库检索优化) and inflated its
    // BM25 score.
    expect(tokenizeQuery("知识库，检索")).toEqual(["知识", "识库", "检索"]);
    expect(tokenizeQuery("向量、检索")).toEqual(["向量", "检索"]);
    expect(tokenizeQuery("部署；回滚")).toEqual(["部署", "回滚"]);
    expect(tokenizeQuery("知识库，检索")).not.toContain("库检");
  });

  it("keeps real terms inside the cap on a long punctuated query", () => {
    // Phantom boundary terms used to consume the whole MAX_QUERY_TERMS budget:
    // 14 real phrases expanded to 27 bigrams, truncated at 24, silently
    // dropping 缓存/索引 from the search.
    const long =
      "部署，回滚，备份，监控，告警，扩容，缩容，灰度，压测，限流，熔断，降级，缓存，索引";
    const terms = tokenizeQuery(long);
    expect(terms.length).toBe(14);
    expect(terms).toContain("缓存");
    expect(terms).toContain("索引");
    // No term may straddle a punctuation mark.
    for (const junk of ["署回", "滚备", "份监", "级缓"]) {
      expect(terms).not.toContain(junk);
    }
  });

  it("caps the term list at MAX_QUERY_TERMS", () => {
    const long = Array.from({ length: MAX_QUERY_TERMS + 10 }, (_, i) => `词${i}`).join(" ");
    expect(tokenizeQuery(long).length).toBe(MAX_QUERY_TERMS);
  });
});

describe("bm25fTermContribution", () => {
  const n = 100;
  const df = 10;
  const avg = { title: 20, description: 40, body: 1000 };
  const bag = (
    title: number,
    description: number,
    body: number,
    lens: { title: number; description: number; body: number } = { title: 20, description: 40, body: 1000 },
  ) => ({
    title: { tf: title, len: lens.title },
    description: { tf: description, len: lens.description },
    body: { tf: body, len: lens.body },
  });

  it("is zero for a term missing from every field", () => {
    expect(bm25fTermContribution(bag(0, 0, 0), avg, df, n)).toBe(0);
  });

  it("rises with tf but saturates (k1 normalization)", () => {
    const at1 = bm25fTermContribution(bag(0, 0, 1), avg, df, n);
    const at3 = bm25fTermContribution(bag(0, 0, 3), avg, df, n);
    const at30 = bm25fTermContribution(bag(0, 0, 30), avg, df, n);
    expect(at3).toBeGreaterThan(at1);
    expect(at30).toBeGreaterThan(at3);
    expect(at30 / at3).toBeLessThan(10);
  });

  it("scores a title hit above the same tf in description or body", () => {
    const title = bm25fTermContribution(bag(1, 0, 0), avg, df, n);
    const description = bm25fTermContribution(bag(0, 1, 0), avg, df, n);
    const body = bm25fTermContribution(bag(0, 0, 1), avg, df, n);
    expect(title).toBeGreaterThan(description);
    expect(description).toBeGreaterThan(body);
  });

  it("adds fields: a title hit plus a body hit equals the weighted sum of tfs", () => {
    // weight(title)=2, weight(body)=1, both at their average length → tf̃ = 3,
    // the same combined frequency as three body occurrences.
    const both = bm25fTermContribution(bag(1, 0, 1), avg, df, n);
    const bodyThree = bm25fTermContribution(bag(0, 0, 3), avg, df, n);
    expect(both).toBeCloseTo(bodyThree, 12);
  });

  it("penalizes a document whose matching field is longer than average", () => {
    const short = bm25fTermContribution(bag(0, 0, 3), avg, df, n);
    const long = bm25fTermContribution(bag(0, 0, 3, { title: 20, description: 40, body: 2000 }), avg, df, n);
    expect(long).toBeLessThan(short);
  });

  it("normalizes each field against its own mean, not the document's", () => {
    // A long title is diluted even when the body is average-length: the title
    // norm uses avg.title, so a 60-char title costs 3x the norm of a 20-char one.
    const shortTitle = bm25fTermContribution(bag(1, 0, 0), avg, df, n);
    const longTitle = bm25fTermContribution(bag(1, 0, 0, { title: 60, description: 40, body: 1000 }), avg, df, n);
    expect(longTitle).toBeLessThan(shortTitle);
  });

  it("scores rare terms (low df) higher than common ones", () => {
    const rare = bm25fTermContribution(bag(0, 0, 1), avg, 1, n);
    const common = bm25fTermContribution(bag(0, 0, 1), avg, 90, n);
    expect(rare).toBeGreaterThan(common);
  });

  it("does not divide by zero when a whole field is empty", () => {
    // Every description NULL in the corpus → stats' GREATEST(avg, 1) is what
    // keeps the SQL finite; the reference implementation guards identically.
    const value = bm25fTermContribution(bag(0, 1, 1), { title: 20, description: 0, body: 1000 }, df, n);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
  });

  it("matches the BM25F values the SQL computes", () => {
    // Pinned as literal numbers, not as a restatement of the formula with the
    // same exported constants — recomputing the implementation inside the
    // assertion can only catch a change the test's own copy also missed.
    // n = 100, df = 10, k1 = 1.2, b = 0.75,
    // weights title 2 / description 1.25 / body 1,
    // averages title 20 / description 40 / body 1000.
    expect(bm25fTermContribution(bag(1, 0, 0), avg, df, n)).toBeCloseTo(3.112649732057, 12);
    expect(bm25fTermContribution(bag(0, 1, 0), avg, df, n)).toBeCloseTo(2.540938556781, 12);
    expect(bm25fTermContribution(bag(0, 0, 1), avg, df, n)).toBeCloseTo(2.263745259678, 12);
    expect(bm25fTermContribution(bag(0, 0, 3), avg, df, n)).toBeCloseTo(3.557313979494, 12);
    expect(bm25fTermContribution(bag(0, 0, 1), avg, 90, n)).toBeCloseTo(0.109770666135, 12);
    expect(bm25fTermContribution(bag(2, 1, 4), avg, 1, n)).toBeCloseTo(8.19775000648, 12);
  });

  it("deprecated factor scales the score without zeroing it", () => {
    const raw = bm25fTermContribution(bag(0, 0, 2), avg, df, n);
    expect(raw * DEPRECATED_FACTOR).toBeGreaterThan(0);
    expect(raw * DEPRECATED_FACTOR).toBeLessThan(raw);
  });
});
