import { describe, expect, it } from "vitest";
import { ingestUserPrompt, splitMarkdown, splitMarkdownWithPaths, validateCandidates } from "../lib/ingest";

describe("splitMarkdown", () => {
  const filler = (s: string, n: number) => s.repeat(n);

  it("splits sizeable sections by heading, keeping pre-heading content out", () => {
    const md = [
      filler("引言内容。", 30), // 每段 ≥ MIN_CHUNK(120) 字,避免被合并
      "# A",
      filler("A 的正文。", 30),
      "## A1",
      filler("A1 的正文。", 30),
    ].join("\n\n");
    const chunks = splitMarkdown(md);
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toContain("引言内容");
    expect(chunks[1]).toContain("# A");
    expect(chunks[2]).toContain("## A1");
  });

  it("keeps heading context attached to its section", () => {
    const chunks = splitMarkdown(`${filler("intro。", 30)}\n\n# Title\n${filler("body。", 40)}`);
    const headingChunk = chunks.find((c) => c.startsWith("# Title"));
    expect(headingChunk).toBeDefined();
    expect(headingChunk!).toContain("body。");
  });

  it("merges tiny fragments forward so headings are not lost", () => {
    const chunks = splitMarkdown("intro\n\n# Title\nbody of title");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("# Title");
    expect(chunks[0]).toContain("intro");
  });

  it("splits oversized sections into paragraph windows", () => {
    const para = "很长的段落。".repeat(200); // ~1200 chars
    const md = `# 标题\n\n${para}\n\n${para}\n\n${para}`; // ~3600 chars
    const chunks = splitMarkdown(md);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2800);
  });

  it("does not treat #hashtag-like lines without space as headings", () => {
    const chunks = splitMarkdown("body #tag more body");
    expect(chunks).toHaveLength(1);
  });
});

describe("splitMarkdownWithPaths", () => {
  const filler = (s: string, n: number) => s.repeat(n);

  it("tracks the heading breadcrumb per chunk", () => {
    // 每节 ≥120 字,避免触发小碎片前向合并
    const md = [
      filler("引言内容。", 30),
      "# 第一章",
      filler("第一章的正文。", 30),
      "## 第二节",
      filler("第二节的正文。", 30),
    ].join("\n\n");
    const { chunks, paths } = splitMarkdownWithPaths(md);
    expect(chunks.length).toBe(3);
    expect(paths).toEqual(["", "第一章", "第一章 > 第二节"]);
  });

  it("pops the stack when a shallower heading reappears", () => {
    const md = `# A\n\n${filler("A 节正文。", 30)}\n\n## A1\n\n${filler("A1 节正文。", 30)}\n\n# B\n\n${filler("B 节正文。", 30)}`;
    const { chunks, paths } = splitMarkdownWithPaths(md);
    expect(chunks.length).toBe(3);
    expect(paths).toEqual(["A", "A > A1", "B"]);
  });

  it("keeps chunk text identical to splitMarkdown", () => {
    const md = `# A\n\n${filler("a。", 30)}\n\n## A1\n\n${filler("a1。", 30)}`;
    expect(splitMarkdownWithPaths(md).chunks).toEqual(splitMarkdown(md));
  });
});

describe("ingestUserPrompt", () => {
  it("prepends the location context when given", () => {
    const p = ingestUserPrompt("正文", 5, "第一章 > 第二节");
    expect(p.startsWith("位置：第一章 > 第二节")).toBe(true);
  });

  it("omits the context line for empty paths", () => {
    expect(ingestUserPrompt("正文", 5, "")).toBe("材料如下（最多拆出 5 条）：\n\n正文");
    expect(ingestUserPrompt("正文", 5)).toBe("材料如下（最多拆出 5 条）：\n\n正文");
  });
});

describe("validateCandidates", () => {
  const good = {
    title: "RAG 检索增强生成",
    description: "一种结合检索与生成的架构。",
    type: "Definition",
    category: "技术/LLM",
    tags: ["rag", "llm"],
    body: "RAG 通过先检索后生成的方式降低幻觉。" + "细节。".repeat(20),
  };

  it("accepts valid candidates and normalizes fields", () => {
    const { candidates, dropped } = validateCandidates([good, { junk: true }], {});
    expect(candidates).toHaveLength(1);
    expect(dropped).toBe(1);
    const c = candidates[0];
    expect(c.type).toBe("Definition");
    expect(c.category).toBe("技术/LLM");
    expect(c.status).toBe("stable");
    expect(c.tags).toEqual(["rag", "llm"]);
  });

  it("prefixes the base category", () => {
    const { candidates } = validateCandidates([good], { baseCategory: "书籍/深入理解AI Agent" });
    expect(candidates[0].category).toBe("书籍/深入理解AI Agent/技术/LLM");
  });

  it("drops entries without a usable title or body", () => {
    const { candidates } = validateCandidates(
      [
        { ...good, title: "   " },
        { ...good, body: "太短" },
        { title: "只有标题没有正文" },
      ],
      {}
    );
    expect(candidates).toHaveLength(0);
  });

  it("clamps over-limit fields and caps tags/count", () => {
    const long = {
      ...good,
      title: "标".repeat(500),
      description: "描".repeat(2000),
      tags: Array.from({ length: 30 }, (_, i) => `t${i}`),
    };
    const { candidates } = validateCandidates([long, long, long], { max: 2 });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].title.length).toBe(200);
    expect(candidates[0].description!.length).toBe(500);
    expect(candidates[0].tags.length).toBe(8);
  });
});
