import { describe, expect, it } from "vitest";
import { BM25_B, BM25_K1, DEPRECATED_FACTOR, MAX_QUERY_TERMS, bm25TermContribution, tokenizeQuery } from "../lib/bm25";

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

  it("matches the SQL constants", () => {
    // Hand-computed: idf=ln(2), tf=1, docLen=avgdl → 1*ln(2)*2.2/(1+1.2).
    expect(bm25TermContribution(1, n / 2, n, avgdl, avgdl)).toBeCloseTo(
      (Math.log(2) * (BM25_K1 + 1)) / (1 + BM25_K1 * (1 - BM25_B + BM25_B)),
      10
    );
  });

  it("deprecated factor scales the score without zeroing it", () => {
    const raw = bm25TermContribution(2, 10, n, avgdl, avgdl);
    expect(raw * DEPRECATED_FACTOR).toBeGreaterThan(0);
    expect(raw * DEPRECATED_FACTOR).toBeLessThan(raw);
  });
});
