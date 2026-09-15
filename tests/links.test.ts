import { describe, expect, it } from "vitest";
import {
  MIN_MENTION_TITLE_CHARS,
  embedWikiLinks,
  findUnlinkedMentionOffset,
  parseWikiLinks,
  segmentBodyWithLinks,
  splitBodyBlocks,
} from "../lib/links";

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
    expect(segs[1]).toEqual({ kind: "link", title: "RRF 融合", display: "RRF 融合", embed: false, targetId: "id-rrf" });
    expect(segs[2]).toEqual({ kind: "text", text: " 合并，但 " });
    expect(segs[3]).toEqual({ kind: "link", title: "不存在的条目", display: "不存在的条目", embed: false, targetId: null });
    expect(segs[4]).toEqual({ kind: "text", text: " 不行" });
  });

  it("splits [[target|display]] aliases: pure target, display text", () => {
    const refs = parseWikiLinks("见 [[RRF 融合|RRF]] 与 [[空别名|]]。");
    expect(refs).toEqual([
      { title: "RRF 融合", display: "RRF", embed: false, start: 2, end: 16 },
      { title: "空别名", display: "空别名", embed: false, start: 19, end: 27 },
    ]);
  });

  it("segment keeps alias display while resolving by target", () => {
    const segs = segmentBodyWithLinks("用 [[RRF 融合|RRF]] 合并", targets);
    expect(segs[1]).toEqual({ kind: "link", title: "RRF 融合", display: "RRF", embed: false, targetId: "id-rrf" });
  });
  it("round-trips: concatenated segments reproduce the source (incl. aliases)", () => {
    const body = "前缀 [[A]] 中缀 [[B|乙]] 后缀";
    const segs = segmentBodyWithLinks(body, new Map());
    const rebuilt = segs
      .map((s) =>
        s.kind === "text" ? s.text : `[[${s.title}${s.display === s.title ? "" : `|${s.display}`}]]`
      )
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

describe("embed refs (![[标题]])", () => {
  it("flags bang-prefixed refs as embeds", () => {
    const refs = parseWikiLinks("见 [[A]] 与 ![[B]]。");
    expect(refs.map((r) => r.embed)).toEqual([false, true]);
    expect(refs[1].title).toBe("B");
  });

  it("inline embeds degrade to labeled links, consuming the bang", () => {
    expect(embedWikiLinks("行内 ![[A|别名]] 嵌入")).toBe("行内 [📄 别名](wiki:A) 嵌入");
  });
});

describe("splitBodyBlocks", () => {
  it("returns one lossless markdown chunk without embeds", () => {
    const body = "# 标题\n\n正文段落。";
    expect(splitBodyBlocks(body)).toEqual([{ kind: "markdown", text: body }]);
  });

  it("consumes block-level embed lines", () => {
    const blocks = splitBodyBlocks("前文\n\n![[A]]\n\n后文");
    expect(blocks).toEqual([
      { kind: "markdown", text: "前文\n" },
      { kind: "embed", title: "A", display: "A" },
      { kind: "markdown", text: "\n后文" },
    ]);
  });

  it("keeps inline embeds and fenced embeds as markdown", () => {
    const body = "行内 ![[A]] 不拆。\n\n```\n![[B]]\n```\n\n![[C|别名]]";
    const blocks = splitBodyBlocks(body);
    expect(blocks.filter((b) => b.kind === "embed")).toEqual([
      { kind: "embed", title: "C", display: "别名" },
    ]);
    const md = blocks.find((b) => b.kind === "markdown");
    expect(md && "text" in md && md.text.includes("![[A]]")).toBe(true);
    expect(md && "text" in md && md.text.includes("![[B]]")).toBe(true);
  });
});

describe("findUnlinkedMentionOffset", () => {
  // Shared by the concept detail page's 未链接提及 panel and `npm run curate`
  // §5. These pin the two behaviours the separate copies used to get wrong.
  it("finds a plain mention and returns -1 when absent", () => {
    expect(findUnlinkedMentionOffset("讲讲 混合检索 的原理", "混合检索")).toBe(3);
    expect(findUnlinkedMentionOffset("没有相关内容", "混合检索")).toBe(-1);
  });

  it("does not report a linked title as unlinked", () => {
    expect(findUnlinkedMentionOffset("见 [[混合检索]]", "混合检索")).toBe(-1);
    expect(findUnlinkedMentionOffset("见 [[混合检索|混合]]", "混合检索")).toBe(-1);
    expect(findUnlinkedMentionOffset("嵌入 ![[混合检索]]", "混合检索")).toBe(-1);
  });

  it("treats whitespace-padded links as linked", () => {
    // parseWikiLinks trims the target, so `[[ 混合检索 ]]` renders as a real
    // link; the old detail-page check tested for a literal "[[" two chars
    // back and flagged it as an *unlinked* mention instead.
    expect(findUnlinkedMentionOffset("见 [[ 混合检索 ]]", "混合检索")).toBe(-1);
  });

  it("requires ASCII word boundaries but not CJK ones", () => {
    expect(findUnlinkedMentionOffset("AISLE is a word", "AI")).toBe(-1);
    expect(findUnlinkedMentionOffset("about AI today", "AI")).toBe(6);
    expect(findUnlinkedMentionOffset("(AI)", "AI")).toBe(1);
    // CJK has no delimiters: a substring occurrence is a mention.
    // 这0 是1 知2 识3 库4 检5 索6 — 库检 starts at index 4.
    expect(findUnlinkedMentionOffset("这是知识库检索", "库检")).toBe(4);
  });

  it("reports a stray mention even when the title is linked elsewhere", () => {
    // The curate copy skipped the whole body once the title appeared inside
    // any `[[`, hiding this second, genuinely unlinked occurrence.
    const body = "先链接 [[混合检索]]，后面又裸提 混合检索 一次";
    const hit = findUnlinkedMentionOffset(body, "混合检索");
    expect(hit).toBeGreaterThan(body.indexOf("[[混合检索]]"));
    expect(body.slice(hit, hit + 4)).toBe("混合检索");
  });

  it("ignores titles too short to be meaningful", () => {
    expect(MIN_MENTION_TITLE_CHARS).toBe(2);
    expect(findUnlinkedMentionOffset("a b c", "a")).toBe(-1);
    expect(findUnlinkedMentionOffset("标题很短", " ")).toBe(-1);
  });

  it("is case-insensitive", () => {
    expect(findUnlinkedMentionOffset("see PostgreSQL docs", "postgresql")).toBe(4);
  });
});
