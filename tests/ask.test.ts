import { describe, expect, it } from "vitest";
import { buildAskMessages, parseAskAnswer, type AskSource } from "../lib/ask";

const src = (id: string, title: string, text = "正文"): AskSource => ({
  id,
  title,
  category: null,
  score: 10,
  similarity: null,
  text,
  truncated: false,
});

describe("buildAskMessages", () => {
  it("numbers the sources so the model can cite them", () => {
    const messages = buildAskMessages("KV cache 显存怎么算？", [
      src("a", "注意力机制", "第 1 份正文"),
      src("b", "推理优化", "第 2 份正文"),
    ]);
    const [system, user] = messages;
    expect(system.role).toBe("system");
    expect(user.content).toContain("[1] 《注意力机制》\n第 1 份正文");
    expect(user.content).toContain("[2] 《推理优化》\n第 2 份正文");
    expect(user.content.endsWith("问题：KV cache 显存怎么算？")).toBe(true);
    // 只依据资料 + 逐句引用 —— 这两条是答案可核查的前提，写死在提示里。
    expect(system.content).toContain("只使用「资料」里的内容");
    expect(system.content).toContain("来源编号");
  });

  it("carries the category when present", () => {
    const messages = buildAskMessages("q", [{ ...src("a", "标题"), category: "技术/数据库" }]);
    expect(messages[1].content).toContain("[1] 《标题》（分类：技术/数据库）");
  });
});

describe("parseAskAnswer", () => {
  const sources = [src("a", "甲"), src("b", "乙"), src("c", "丙")];

  it("maps markers to sources, dedupes and sorts them", () => {
    const out = parseAskAnswer({ answer: "结论一 [2]。结论二 [1][2]。" }, sources);
    expect(out.citations.map((c) => `${c.marker}:${c.id}`)).toEqual(["1:a", "2:b"]);
    expect(out.answer).toBe("结论一 [2]。结论二 [1][2]。");
  });

  it("strips markers that point outside the retrieved sources", () => {
    // 模型偶尔会引用不存在的 [7]：留着就是一条点不开的假引用。
    const out = parseAskAnswer({ answer: "有出处的结论 [1]，无出处的 [7]。" }, sources);
    expect(out.answer).toBe("有出处的结论 [1]，无出处的。");
    expect(out.citations.map((c) => c.marker)).toEqual([1]);
  });

  it("keeps the answer readable when nothing is cited", () => {
    const out = parseAskAnswer({ answer: "资料里没有相关信息。" }, sources);
    expect(out.answer).toBe("资料里没有相关信息。");
    expect(out.citations).toEqual([]);
  });

  it("treats [0] and multi-digit out-of-range markers as invalid", () => {
    const out = parseAskAnswer({ answer: "零 [0] 与越界 [12] 都不算引用 [3]。" }, sources);
    expect(out.answer).toBe("零 与越界 都不算引用 [3]。");
    expect(out.citations.map((c) => c.marker)).toEqual([3]);
  });

  it("rejects an empty or missing answer", () => {
    expect(() => parseAskAnswer({ answer: "   " }, sources)).toThrow(/未返回答案/);
    expect(() => parseAskAnswer({}, sources)).toThrow(/未返回答案/);
    expect(() => parseAskAnswer(null, sources)).toThrow(/未返回答案/);
  });
});
