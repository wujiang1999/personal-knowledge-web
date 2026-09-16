import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "../lib/search-syntax";

describe("parseSearchQuery", () => {
  it("passes plain queries through untouched", () => {
    expect(parseSearchQuery("PostgreSQL 索引")).toEqual({
      text: "PostgreSQL 索引",
      tags: [],
      category: null,
      status: null,
      type: null,
    });
  });

  it("strips operators and keeps the free-text remainder", () => {
    const p = parseSearchQuery("索引优化 tag:pg status:draft");
    expect(p.text).toBe("索引优化  ");
    expect(p.tags).toEqual(["pg"]);
    expect(p.status).toBe("draft");
    expect(p.category).toBeNull();
    expect(p.type).toBeNull();
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

  it("parses the type operator, keeping the raw value for a case-insensitive match", () => {
    expect(parseSearchQuery("检索 type:Reference").type).toBe("Reference");
    expect(parseSearchQuery("检索 type:参考").type).toBe("参考");
    expect(parseSearchQuery('type:"Reference Note"').type).toBe("Reference Note");
  });

  it("keeps one type operator, last one wins", () => {
    expect(parseSearchQuery("type:Note type:Procedure").type).toBe("Procedure");
  });

  it("ignores unknown status values instead of emptying results", () => {
    expect(parseSearchQuery("x status:archived").status).toBeNull();
    expect(parseSearchQuery("x status:draft").status).toBe("draft");
  });

  it("drops malformed operators with empty values", () => {
    const p = parseSearchQuery("word tag: category: type:");
    expect(p.text).toBe("word   ");
    expect(p.tags).toEqual([]);
    expect(p.type).toBeNull();
  });

  it("only treats an operator name as an operator at a word boundary", () => {
    // "hashtag:x" was stripped as a tag filter, and a bare `type:` alternation
    // would have done the same to "filetype:pdf" — a plausible thing to search.
    const p = parseSearchQuery("hashtag:x filetype:pdf 检索");
    expect(p.text).toBe("hashtag:x filetype:pdf 检索");
    expect(p.tags).toEqual([]);
    expect(p.type).toBeNull();
  });

  it("handles operators-only queries (filter listing)", () => {
    const p = parseSearchQuery("status:draft");
    expect(p.text).toBe("");
    expect(p.status).toBe("draft");
    const t = parseSearchQuery("type:Reference");
    expect(t.text).toBe("");
    expect(t.type).toBe("Reference");
  });
});
