import { describe, expect, it } from "vitest";
import { headingPathAt, opensWithTitleHeading } from "../lib/headings";

describe("headingPathAt", () => {
  const body = [
    "# 第4章 检索", // 0
    "",
    "章节前言。", // 10
    "",
    "## 4.1 词法", // 17
    "",
    "BM25 相关正文。", // 26
    "",
    "### 4.1.1 分词", // 43
    "",
    "bigram 相关正文。", // 58
    "",
    "## 4.2 语义", // 76
    "",
    "向量相关正文。", // 88
  ].join("\n");

  it("returns the ancestor chain of the region the offset falls in", () => {
    const atBigram = body.indexOf("bigram");
    expect(headingPathAt(body, atBigram)).toEqual(["第4章 检索", "4.1 词法", "4.1.1 分词"]);
    const atVector = body.indexOf("向量");
    expect(headingPathAt(body, atVector)).toEqual(["第4章 检索", "4.2 语义"]);
  });

  it("is empty above the first heading", () => {
    expect(headingPathAt("前言\n\n# 标题\n\n正文", 0)).toEqual([]);
    expect(headingPathAt("前言\n\n# 标题\n\n正文", 3)).toEqual([]);
  });

  it("clamps offsets past the end and ignores negative ones", () => {
    expect(headingPathAt(body, body.length + 500)).toEqual(["第4章 检索", "4.2 语义"]);
    expect(headingPathAt(body, -10)).toEqual(["第4章 检索"]);
  });

  it("ignores headings inside fenced code blocks", () => {
    // Shell comments in ``` blocks are the trap: a naive /^#+/ scan reports
    // them as sections, and these bodies are full of them.
    const withFence = [
      "# 部署", // 0
      "",
      "```bash", // 8
      "# 启动服务", // 16
      "npm start", // 23
      "```", // 33
      "",
      "## 真正的小节", // 37
      "",
      "正文。", // 46
    ].join("\n");
    expect(headingPathAt(withFence, withFence.indexOf("npm start"))).toEqual(["部署"]);
    expect(headingPathAt(withFence, withFence.indexOf("正文。"))).toEqual(["部署", "真正的小节"]);
  });

  it("ignores headings in indented code and tilde fences", () => {
    const tilde = "# 顶层\n\n~~~\n# 不是标题\n~~~\n\n## 是标题\n\nx\n";
    expect(headingPathAt(tilde, tilde.indexOf("# 不是标题"))).toEqual(["顶层"]);
    const indented = "# 顶层\n\n    # 缩进代码\n\n## 是标题\n\nx\n";
    expect(headingPathAt(indented, indented.indexOf("# 缩进代码"))).toEqual(["顶层"]);
  });

  it("reads a closing sequence as decoration, not part of the title", () => {
    expect(headingPathAt("## 标题 ##\n\n正文\n", 12)).toEqual(["标题"]);
  });

  it("handles a body with no headings at all", () => {
    expect(headingPathAt("只是正文，没有标题。", 3)).toEqual([]);
    expect(headingPathAt("", 0)).toEqual([]);
  });

  it("keeps sibling sections from leaking into each other", () => {
    const two = "# A\n\n## B\n\nb 正文\n\n# C\n\nc 正文\n";
    expect(headingPathAt(two, two.indexOf("b 正文"))).toEqual(["A", "B"]);
    expect(headingPathAt(two, two.indexOf("c 正文"))).toEqual(["C"]);
  });
});

describe("opensWithTitleHeading", () => {
  it("detects a body that opens with its own title H1", () => {
    expect(opensWithTitleHeading("# 部署笔记\n\n正文", "部署笔记")).toBe(true);
    expect(opensWithTitleHeading("# 部署笔记\n\n正文", " 部署笔记 ")).toBe(true);
    expect(opensWithTitleHeading("# 部署笔记\n\n正文", "部署 笔记")).toBe(true);
    expect(opensWithTitleHeading("\n\n# 部署笔记\n\n正文", "部署笔记")).toBe(true);
  });

  it("ignores later headings, higher levels and different titles", () => {
    expect(opensWithTitleHeading("前言\n\n# 部署笔记\n\n正文", "部署笔记")).toBe(false);
    expect(opensWithTitleHeading("## 部署笔记\n\n正文", "部署笔记")).toBe(false);
    expect(opensWithTitleHeading("# 别的标题\n\n正文", "部署笔记")).toBe(false);
    expect(opensWithTitleHeading("部署笔记\n\n正文", "部署笔记")).toBe(false);
    expect(opensWithTitleHeading("", "部署笔记")).toBe(false);
    expect(opensWithTitleHeading("# 部署笔记\n\n正文", "   ")).toBe(false);
  });
});
