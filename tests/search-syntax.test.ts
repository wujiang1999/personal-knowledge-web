import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "../lib/search-syntax";

describe("parseSearchQuery", () => {
  it("passes plain queries through untouched", () => {
    expect(parseSearchQuery("PostgreSQL 索引")).toEqual({
      text: "PostgreSQL 索引",
      tags: [],
      category: null,
      status: null,
    });
  });

  it("strips operators and keeps the free-text remainder", () => {
    const p = parseSearchQuery("索引优化 tag:pg status:draft");
    expect(p.text).toBe("索引优化  ");
    expect(p.tags).toEqual(["pg"]);
    expect(p.status).toBe("draft");
    expect(p.category).toBeNull();
  });

  it("supports quoted values for paths with spaces or slashes", () => {
    const p = parseSearchQuery('部署 category:"技术/部署" tag:ssh');
    expect(p.text.replace(/\s/g, "")).toBe("部署");
    expect(p.category).toBe("技术/部署");
    expect(p.tags).toEqual(["ssh"]);
  });

  it("accumulates repeated tags", () => {
    expect(parseSearchQuery("tag:a tag:b word").tags).toEqual(["a", "b"]);
  });

  it("ignores unknown status values instead of emptying results", () => {
    expect(parseSearchQuery("x status:archived").status).toBeNull();
    expect(parseSearchQuery("x status:draft").status).toBe("draft");
  });

  it("drops malformed operators with empty values", () => {
    const p = parseSearchQuery("word tag: category:");
    expect(p.text).toBe("word  ");
    expect(p.tags).toEqual([]);
  });

  it("handles operators-only queries (filter listing)", () => {
    const p = parseSearchQuery("status:draft");
    expect(p.text).toBe("");
    expect(p.status).toBe("draft");
  });
});
