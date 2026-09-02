import { describe, expect, it } from "vitest";
import { embedWikiLinks, parseWikiLinks, segmentBodyWithLinks } from "../lib/links";

describe("parseWikiLinks", () => {
  it("extracts titles in order with positions", () => {
    const refs = parseWikiLinks("见 [[混合检索]] 与[[RAPTOR 索引]]的对比。");
    expect(refs.map((r) => r.title)).toEqual(["混合检索", "RAPTOR 索引"]);
    expect("见 [[混合检索]]".length).toBe(refs[0].end);
  });

  it("trims inner whitespace and drops empty refs", () => {
    const refs = parseWikiLinks("[[  目录树  ]] 和 [[   ]]");
    expect(refs.map((r) => r.title)).toEqual(["目录树"]);
  });

  it("ignores nesting and newline-spanning candidates", () => {
    expect(parseWikiLinks("[[a\nb]]")).toEqual([]);
    expect(parseWikiLinks("[[a[[b]]c]]").map((r) => r.title)).toEqual(["b"]);
  });
});

describe("segmentBodyWithLinks", () => {
  const targets = new Map([["rrf 融合".toLowerCase(), "id-rrf"]]);

  it("returns one text segment when no links exist", () => {
    const segs = segmentBodyWithLinks("plain text", targets);
    expect(segs).toEqual([{ kind: "text", text: "plain text" }]);
  });

  it("resolves known titles and keeps unknown targets null", () => {
    const segs = segmentBodyWithLinks("用 [[RRF 融合]] 合并，但 [[不存在的条目]] 不行", targets);
    expect(segs).toHaveLength(5);
    expect(segs[0]).toEqual({ kind: "text", text: "用 " });
    expect(segs[1]).toEqual({ kind: "link", title: "RRF 融合", targetId: "id-rrf" });
    expect(segs[2]).toEqual({ kind: "text", text: " 合并，但 " });
    expect(segs[3]).toEqual({ kind: "link", title: "不存在的条目", targetId: null });
    expect(segs[4]).toEqual({ kind: "text", text: " 不行" });
  });
  it("round-trips: concatenated segments reproduce the source", () => {
    const body = "前缀 [[A]] 中缀 [[B]] 后缀";
    const segs = segmentBodyWithLinks(body, new Map());
    const rebuilt = segs
      .map((s) => (s.kind === "text" ? s.text : `[[${s.title}]]`))
      .join("");
    expect(rebuilt).toBe(body);
  });
});

describe("embedWikiLinks", () => {
  it("returns the body unchanged when no wiki links exist", () => {
    const body = "# 标题\n\n普通段落，无链接。";
    expect(embedWikiLinks(body)).toBe(body);
  });

  it("converts every reference to a wiki-scheme markdown link", () => {
    expect(embedWikiLinks("a [[X]] b [[Y]] c")).toBe("a [X](wiki:X) b [Y](wiki:Y) c");
  });

  it("percent-encodes CJK and spaces in the destination", () => {
    expect(embedWikiLinks("见 [[深 入 理解]]")).toBe(
      "见 [深 入 理解](wiki:%E6%B7%B1%20%E5%85%A5%20%E7%90%86%E8%A7%A3)"
    );
  });

  it("escapes markdown inline specials in link text but not the destination", () => {
    expect(embedWikiLinks("[[a*b_c]]")).toBe("[a\\*b\\_c](wiki:a*b_c)");
  });

  it("preserves surrounding text including code fences", () => {
    const body = "```bash\ndocker compose up -d\n```\n\n见 [[混合检索]]。";
    expect(embedWikiLinks(body)).toBe(
      "```bash\ndocker compose up -d\n```\n\n见 [混合检索](wiki:%E6%B7%B7%E5%90%88%E6%A3%80%E7%B4%A2)。"
    );
  });
});
