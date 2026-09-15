import { describe, expect, it } from "vitest";
import { DEPRECATED_FACTOR, MAX_QUERY_TERMS, bm25TermContribution, tokenizeQuery } from "../lib/bm25";

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

describe("bm25TermContribution", () => {
  const n = 100;
  const avgdl = 1000;

  it("is zero for a missing term", () => {
    expect(bm25TermContribution(0, 10, n, avgdl, avgdl)).toBe(0);
  });

  it("rises with tf but saturates (k1 normalization)", () => {
    const at1 = bm25TermContribution(1, 10, n, avgdl, avgdl);
    const at5 = bm25TermContribution(5, 10, n, avgdl, avgdl);
    const at50 = bm25TermContribution(50, 10, n, avgdl, avgdl);
    expect(at5).toBeGreaterThan(at1);
    expect(at50).toBeGreaterThan(at5);
    // Saturation: 10x tf multiplies the score well below 10x.
    expect(at50 / at5).toBeLessThan(10);
  });

  it("penalizes documents longer than the average", () => {
    const short = bm25TermContribution(3, 10, n, avgdl, avgdl);
    const long = bm25TermContribution(3, 10, n, avgdl * 4, avgdl);
    expect(long).toBeLessThan(short);
  });

  it("scores rare terms (low df) higher than common ones", () => {
    const rare = bm25TermContribution(2, 1, n, avgdl, avgdl);
    const common = bm25TermContribution(2, 90, n, avgdl, avgdl);
    expect(rare).toBeGreaterThan(common);
  });

  it("matches the BM25 values the SQL computes", () => {
    // Pinned as literal numbers, not as a restatement of the formula with the
    // same exported constants — the previous version recomputed the
    // implementation inside the assertion, so it could only catch a change
    // that the test's own copy of the formula also happened to miss.
    // Reference points (idf = ln(1 + (n − df + 0.5)/(df + 0.5)), k1 = 1.2,
    // b = 0.75, n = 100, avgdl = 1000). Signature is
    // bm25TermContribution(tf, df, n, docLen, avgdl).
    //   tf=1 df=50 docLen=avgdl → at docLen == avgdl the length-normalization
    //   term collapses to 1, so the value is idf = ln 2 exactly.
    expect(bm25TermContribution(1, n / 2, n, avgdl, avgdl)).toBeCloseTo(0.6931471805599453, 12);
    expect(bm25TermContribution(3, 10, n, 500, avgdl)).toBeCloseTo(3.984191657033, 12);
    expect(bm25TermContribution(1, 90, n, 4000, avgdl)).toBeCloseTo(0.049284788877, 12);
  });

  it("deprecated factor scales the score without zeroing it", () => {
    const raw = bm25TermContribution(2, 10, n, avgdl, avgdl);
    expect(raw * DEPRECATED_FACTOR).toBeGreaterThan(0);
    expect(raw * DEPRECATED_FACTOR).toBeLessThan(raw);
  });
});
