import { describe, expect, it } from "vitest";
import { aggregateChunkHits, rrfMerge, toVectorLiteral } from "../lib/semantic";

describe("aggregateChunkHits", () => {
  it("keeps one candidate per concept, scoring it by its nearest chunk", () => {
    const out = aggregateChunkHits(
      [
        { id: "a", similarity: 0.4, startOffset: 100 },
        { id: "b", similarity: 0.9, startOffset: 0 },
        { id: "a", similarity: 0.7, startOffset: 900 },
      ],
      10,
    );
    expect(out.map((c) => c.id)).toEqual(["b", "a"]);
    expect(out[1]).toEqual({ id: "a", similarity: 0.7, startOffset: 900 });
  });

  it("breaks similarity ties by how many chunks of that concept matched", () => {
    // Three mediocre passages are a better answer than one accidental hit.
    const out = aggregateChunkHits(
      [
        { id: "single", similarity: 0.5, startOffset: 0 },
        { id: "many", similarity: 0.5, startOffset: 10 },
        { id: "many", similarity: 0.5, startOffset: 20 },
        { id: "many", similarity: 0.5, startOffset: 30 },
      ],
      10,
    );
    expect(out.map((c) => c.id)).toEqual(["many", "single"]);
  });

  it("honours the limit after collapsing, and tolerates an empty pool", () => {
    const hits = [
      { id: "a", similarity: 0.6, startOffset: 0 },
      { id: "b", similarity: 0.5, startOffset: 0 },
      { id: "c", similarity: 0.4, startOffset: 0 },
    ];
    expect(aggregateChunkHits(hits, 2).map((c) => c.id)).toEqual(["a", "b"]);
    expect(aggregateChunkHits([], 5)).toEqual([]);
  });
});

describe("rrfMerge", () => {
  it("boosts ids that appear in multiple lists", () => {
    const a = [{ id: "x" }, { id: "y" }];
    const b = [{ id: "y" }, { id: "z" }];
    const merged = rrfMerge([a, b]);
    expect(merged[0].item.id).toBe("y"); // rank1+rank2 in both lists wins
    const ids = merged.map((m) => m.item.id);
    expect(ids).toContain("x");
    expect(ids).toContain("z");
  });

  it("keeps single-list order for disjoint lists", () => {
    const merged = rrfMerge([[{ id: "1" }, { id: "2" }], [{ id: "3" }]]);
    expect(merged.map((m) => m.item.id)).toEqual(["1", "3", "2"]);
  });

  it("handles empty lists", () => {
    expect(rrfMerge([[], []])).toEqual([]);
  });
});

describe("toVectorLiteral", () => {
  it("formats a pgvector text literal", () => {
    expect(toVectorLiteral([1, 2.5, -3])).toBe("[1,2.5,-3]");
  });
});
