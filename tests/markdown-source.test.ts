import { describe, expect, it } from "vitest";
import { normalizeMathDelimiters } from "../lib/markdown-source";

describe("normalizeMathDelimiters", () => {
  it("returns bodies with neither backslash nor `$$` untouched", () => {
    const body = "# 标题\n\n价格 $5，$HOME 与 $PATH 都是普通文本。";
    expect(normalizeMathDelimiters(body)).toBe(body);
  });

  it("converts LaTeX inline delimiters to the dollar syntax", () => {
    expect(normalizeMathDelimiters("\\(d_i=1\\)，没有后续回报。")).toBe(
      "$d_i=1$，没有后续回报。"
    );
    expect(normalizeMathDelimiters("以 \\(70\\%\\) 的概率选 A。")).toBe(
      "以 $70\\%$ 的概率选 A。"
    );
  });

  it("promotes a display block that owns its lines", () => {
    const source = "前文\n\n\\[\nq_i=Q_\\theta(s_i,a_i)\n\\]\n\n后文";
    expect(normalizeMathDelimiters(source)).toBe("前文\n\n$$\nq_i=Q_\\theta(s_i,a_i)\n$$\n\n后文");
  });

  it("promotes a single-line display block instead of leaving it inline", () => {
    expect(normalizeMathDelimiters("所以：\n\n\\[\\boxed{V^\\pi(s)=20}\\]\n")).toBe(
      "所以：\n\n$$\n\\boxed{V^\\pi(s)=20}\n$$\n"
    );
  });

  it("keeps a display block inside its list item by re-indenting the closer", () => {
    expect(normalizeMathDelimiters("- 项：\n\n  \\[\n  x=1\n  \\]\n")).toBe(
      "- 项：\n\n  $$\nx=1\n  $$\n"
    );
  });

  it("keeps `\\\\[2pt]` line breaks inside aligned content", () => {
    const source =
      "\\[\n\\begin{aligned}\n\\text{MC：}&\\quad Y_t=G_t\\\\[2pt]\n\\text{TD：}&\\quad Y_t=R_{t+1}\n\\end{aligned}\n\\]";
    expect(normalizeMathDelimiters(source)).toBe(
      "$$\n\\begin{aligned}\n\\text{MC：}&\\quad Y_t=G_t\\\\[2pt]\n\\text{TD：}&\\quad Y_t=R_{t+1}\n\\end{aligned}\n$$"
    );
  });

  it("falls back to inline math when a display delimiter shares its line", () => {
    expect(normalizeMathDelimiters("见 \\[x=1\\] 图。")).toBe("见 $x=1$ 图。");
  });

  it("leaves fenced code blocks verbatim", () => {
    const source = "前\n\n```latex\n\\(x\\)\n\\[\n y\n\\]\n```\n\n后";
    expect(normalizeMathDelimiters(source)).toBe(source);
    const tildes = "~~~\n$$x$$\n~~~";
    expect(normalizeMathDelimiters(tildes)).toBe(tildes);
  });

  it("leaves inline code spans verbatim", () => {
    const source = "行内 `\\(x\\)` 与 ``\\[ y \\]`` 保持源码。";
    expect(normalizeMathDelimiters(source)).toBe(source);
  });

  it("does not treat an escaped backslash as a math opener", () => {
    expect(normalizeMathDelimiters("路径 C:\\\\(x 与 \\\\alpha")).toBe(
      "路径 C:\\\\(x 与 \\\\alpha"
    );
  });

  it("leaves an unclosed delimiter alone", () => {
    expect(normalizeMathDelimiters("有 \\( 未闭合，\\[ 也没有。")).toBe(
      "有 \\( 未闭合，\\[ 也没有。"
    );
  });

  it("promotes a single-line `$$…$$` block to centered display math", () => {
    expect(normalizeMathDelimiters("$$\\tilde{tf}_t=\\sum_f w_f\\cdot\\frac{tf}{len}$$\n")).toBe(
      "$$\n\\tilde{tf}_t=\\sum_f w_f\\cdot\\frac{tf}{len}\n$$\n"
    );
  });

  it("leaves two expressions on one `$$` line alone", () => {
    const source = "$$a$$ 和 $$b$$\n";
    expect(normalizeMathDelimiters(source)).toBe(source);
  });
});
