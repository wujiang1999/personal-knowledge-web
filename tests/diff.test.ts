import { describe, expect, it } from "vitest";
import { diffLines } from "../lib/diff";

const kinds = (a: string, b: string) => diffLines(a, b).map((l) => l.kind).join(",");

describe("diffLines", () => {
  it("identical text yields all-same lines", () => {
    const out = diffLines("a\nb\nc", "a\nb\nc");
    expect(out.map((l) => l.text)).toEqual(["a", "b", "c"]);
    expect(out.every((l) => l.kind === "same")).toBe(true);
  });

  it("empty input on one side", () => {
    expect(diffLines("", "a\nb").map((l) => `${l.kind}:${l.text}`)).toEqual(["add:a", "add:b"]);
    expect(diffLines("a\nb", "").map((l) => `${l.kind}:${l.text}`)).toEqual(["del:a", "del:b"]);
  });

  it("marks an edited middle line as del+add pair", () => {
    const out = diffLines("head\nold\ntail", "head\nnew\ntail");
    expect(out.map((l) => `${l.kind}:${l.text}`)).toEqual(["same:head", "del:old", "add:new", "same:tail"]);
  });

  it("handles additions at the end", () => {
    const out = diffLines("a", "a\nb\nc");
    expect(out.map((l) => `${l.kind}:${l.text}`)).toEqual(["same:a", "add:b", "add:c"]);
  });

  it("trims common suffix so only the changed prefix shows", () => {
    expect(kinds("x\nsame", "y\nsame")).toBe("del,add,same");
  });

  it("reorder is represented as del+add churn (LCS keeps at most one anchor)", () => {
    const out = diffLines("a\nb", "b\na");
    expect(out.some((l) => l.kind === "del")).toBe(true);
    expect(out.some((l) => l.kind === "add")).toBe(true);
    expect(out.filter((l) => l.kind === "same")).toHaveLength(1);
  });

  it("falls back to whole-block replace beyond the cell budget", () => {
    // With a 2001x2000 middle the DP would cost 4M cells — over budget, so
    // every removed line becomes del and every new line becomes add.
    const a = Array.from({ length: 2100 }, (_, i) => `old-${i}`).join("\n");
    const b = Array.from({ length: 2000 }, (_, i) => `new-${i}`).join("\n");
    const out = diffLines(a, b);
    expect(out.filter((l) => l.kind === "del")).toHaveLength(2100);
    expect(out.filter((l) => l.kind === "add")).toHaveLength(2000);
  });

  it("output always reconstructs both inputs when re-split by kind", () => {
    const a = "one\ntwo\nthree\nfour";
    const b = "one\nTWO\nthree\nfour\nfive";
    const out = diffLines(a, b);
    expect(out.filter((l) => l.kind !== "add").map((l) => l.text).join("\n")).toBe(a);
    expect(out.filter((l) => l.kind !== "del").map((l) => l.text).join("\n")).toBe(b);
  });
});
