import { describe, expect, it } from "vitest";
import { isReviewAction, isReviewKind, mergeDraft, normalizePayload, reviewTargetFingerprint } from "../lib/reviews";

describe("normalizePayload", () => {
  it("fills defaults for a minimal payload", () => {
    expect(normalizePayload({ title: "标题", body: "正文" })).toEqual({
      type: "Note",
      title: "标题",
      description: undefined,
      category: undefined,
      tags: [],
      status: "stable",
      body: "正文",
    });
  });

  it("trims strings and coerces the optional fields to undefined when blank", () => {
    const p = normalizePayload({
      type: "  Definition ",
      title: "  标题  ",
      description: "   ",
      category: "  ",
      body: "正文",
    });
    expect(p.type).toBe("Definition");
    expect(p.title).toBe("标题");
    expect(p.description).toBeUndefined();
    expect(p.category).toBeUndefined();
  });

  it("clamps oversize fields to the server's zod limits", () => {
    const p = normalizePayload({ title: "t".repeat(300), description: "d".repeat(2000), body: "b" });
    expect(p.title).toHaveLength(200);
    expect(p.description).toHaveLength(1000);
  });

  it("drops non-string tags and caps the list at 30", () => {
    const p = normalizePayload({
      title: "t",
      body: "b",
      tags: [...Array.from({ length: 40 }, (_, i) => `tag${i}`), 42, null, ""],
    });
    expect(p.tags).toHaveLength(30);
    expect(p.tags[0]).toBe("tag0");
    expect(p.tags.every((t) => typeof t === "string" && t.length > 0)).toBe(true);
  });

  it("falls back to stable for an unknown status and tolerates a non-object payload", () => {
    expect(normalizePayload({ title: "t", body: "b", status: "archived" }).status).toBe("stable");
    expect(normalizePayload(null)).toEqual({
      type: "Note",
      title: "",
      description: undefined,
      category: undefined,
      tags: [],
      status: "stable",
      body: "",
    });
  });

  it("preserves a quality-review base fingerprint", () => {
    expect(normalizePayload({ title: "标题", body: "正文", baseFingerprint: "sha256:abc" }).baseFingerprint).toBe("sha256:abc");
  });
});

describe("mergeDraft", () => {
  it("keeps both sides when they differ", () => {
    expect(mergeDraft("旧正文", "新正文")).toBe("旧正文\n\n---\n\n新正文");
  });

  it("returns whichever side carries content when the other is blank", () => {
    expect(mergeDraft("   ", "新正文")).toBe("新正文");
    expect(mergeDraft("旧正文", "  ")).toBe("旧正文");
  });

  it("does not duplicate an identical body", () => {
    expect(mergeDraft("同一份", "同一份")).toBe("同一份");
  });
});

describe("isReviewKind / isReviewAction", () => {
  it("accepts only the declared vocabulary", () => {
    expect(isReviewKind("conflict")).toBe(true);
    expect(isReviewKind("duplicate")).toBe(false);
    expect(isReviewKind("quality_risk")).toBe(true);
    expect(isReviewAction("kept_both")).toBe(true);
    expect(isReviewAction("discard")).toBe(false);
  });
});

describe("reviewTargetFingerprint", () => {
  const base = {
    type: "Note",
    title: "标题",
    description: "说明",
    category: "技术",
    tags: ["知识库"],
    status: "stable",
    body: "正文",
  };

  it("changes when either body or current metadata changes", () => {
    expect(reviewTargetFingerprint(base)).toBe(reviewTargetFingerprint({ ...base, tags: [" 知识库 "] }));
    expect(reviewTargetFingerprint(base)).not.toBe(reviewTargetFingerprint({ ...base, body: "新正文" }));
    expect(reviewTargetFingerprint(base)).not.toBe(reviewTargetFingerprint({ ...base, title: "新标题" }));
  });
});
