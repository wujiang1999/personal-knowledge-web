import { describe, expect, it } from "vitest";
import { buildContradictionMessages, parseClaimVerdict, parseClaims } from "../lib/claims";
import type { SearchResult } from "../lib/concepts";

const hit = (id: string, title: string): SearchResult =>
  ({
    id,
    title,
    type: "Note",
    description: null,
    category: null,
    status: "stable",
    tags: [],
    current_version: 1,
    attachment_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    body_markdown: "…",
    score: 12,
  }) as SearchResult;

describe("parseClaims", () => {
  it("keeps order, trims and collapses whitespace", () => {
    const out = parseClaims({ claims: [{ text: "  A  主张 \n", quote: "原句" }, { text: "B 主张" }] });
    expect(out.map((c) => c.text)).toEqual(["A 主张", "B 主张"]);
    expect(out[0].quote).toBe("原句");
    expect(out[1].quote).toBe("");
  });

  it("drops empty entries and case-insensitive duplicates", () => {
    const out = parseClaims({
      claims: [{ text: "同一句" }, { text: "   " }, { text: "同一句" }, { text: 42 }, { text: "另一句" }],
    });
    expect(out.map((c) => c.text)).toEqual(["同一句", "另一句"]);
  });

  it("clamps to the per-concept cap and truncates a runaway claim", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ text: `主张 ${i}` }));
    expect(parseClaims({ claims: many }).length).toBe(8);
    expect(parseClaims({ claims: [{ text: "x".repeat(500) }] })[0].text).toHaveLength(200);
  });

  it("returns empty for a malformed payload instead of throwing", () => {
    expect(parseClaims(null)).toEqual([]);
    expect(parseClaims({ claims: "nope" })).toEqual([]);
    expect(parseClaims({})).toEqual([]);
  });
});

describe("parseClaimVerdict", () => {
  const candidates = [hit("11111111-2222-3333-4444-555555555555", "甲条目"), hit("99999999-8888-7777-6666-555555555555", "乙条目")];

  it("maps a contradicts verdict onto the candidate it points at", () => {
    const v = parseClaimVerdict(
      { verdict: "contradicts", targetId: "11111111-2222-3333-4444-555555555555", reason: "数值相反" },
      candidates
    );
    expect(v.verdict).toBe("contradicts");
    expect(v.target?.title).toBe("甲条目");
    expect(v.reason).toBe("数值相反");
  });

  it("accepts a truncated id or a title (models rewrite long uuids)", () => {
    expect(parseClaimVerdict({ verdict: "contradicts", targetId: "11111111" }, candidates).target?.title).toBe("甲条目");
    expect(parseClaimVerdict({ verdict: "contradicts", targetId: "乙条目" }, candidates).target?.title).toBe("乙条目");
  });

  it("downgrades an unresolvable contradiction to unrelated (never queue a dangling finding)", () => {
    expect(parseClaimVerdict({ verdict: "contradicts", targetId: "不存在的条目" }, candidates)).toEqual({
      verdict: "unrelated",
      target: null,
      reason: "",
    });
    expect(parseClaimVerdict({ verdict: "contradicts" }, candidates).target).toBeNull();
  });

  it("passes through consistent/unrelated and treats junk as unrelated", () => {
    expect(parseClaimVerdict({ verdict: "consistent" }, candidates).verdict).toBe("consistent");
    expect(parseClaimVerdict({ verdict: "maybe" }, candidates).verdict).toBe("unrelated");
    expect(parseClaimVerdict(null, candidates).verdict).toBe("unrelated");
  });
});

describe("buildContradictionMessages", () => {
  // Regression: searchConcepts returns only a ~500-char match-anchored preview
  // of body_markdown. Judging a factual contradiction from that window read
  // "the preview doesn't mention the opposite" as a contradiction and kept
  // flooding /reviews with false positives. The caller now reloads full bodies
  // (lib/concepts.ts:getBodiesByIds) and passes them in.
  const claim = { text: "RRF 的 k 取 60", quote: "" };
  const candidates = [hit("11111111-2222-3333-4444-555555555555", "甲条目")];

  const userText = (messages: { role: string; content: string }[]) =>
    messages.find((m) => m.role === "user")?.content ?? "";

  it("sends the supplied full body, not the search preview", () => {
    const fullBody = `前言\n${"填充".repeat(400)}\n结论：k 实际取 20，与 60 相反`;
    const preview = hit("11111111-2222-3333-4444-555555555555", "甲条目");
    preview.body_markdown = "…填充填充 结论：k 实际取 20";

    const messages = buildContradictionMessages(claim, "源条目", candidates, new Map([
      ["11111111-2222-3333-4444-555555555555", fullBody],
    ]));
    const text = userText(messages);

    // The tail that a 500-char preview would have cut off must reach the model.
    expect(text).toContain("k 实际取 20，与 60 相反");
    expect(text).toContain("前言");
    expect(text).not.toContain(preview.body_markdown);
    expect(text).toContain("主张（出自《源条目》）：RRF 的 k 取 60");
  });

  it("renders a missing body as empty rather than falling back to the preview", () => {
    const text = userText(buildContradictionMessages(claim, "源条目", candidates, new Map()));
    expect(text).toContain("《甲条目》");
    expect(text).not.toContain("…");
  });

  it("marks truncation explicitly so an unseen tail is not read as evidence", () => {
    const huge = "x".repeat(8_001) + "尾部结论";
    const text = userText(
      buildContradictionMessages(claim, "源条目", candidates, new Map([
        ["11111111-2222-3333-4444-555555555555", huge],
      ]))
    );
    expect(text).toContain("已截断");
    expect(text).not.toContain("尾部结论");
  });
});
