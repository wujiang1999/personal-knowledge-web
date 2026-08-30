import { describe, expect, it } from "vitest";
import { rrfMerge, toVectorLiteral } from "../lib/semantic";

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
