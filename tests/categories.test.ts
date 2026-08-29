import { describe, expect, it } from "vitest";
import { isSameOrDescendantPath, rewriteCategoryPath } from "../lib/concepts";

describe("isSameOrDescendantPath", () => {
  it("matches the folder itself", () => {
    expect(isSameOrDescendantPath("AI", "AI")).toBe(true);
  });

  it("matches descendants on the slash boundary", () => {
    expect(isSameOrDescendantPath("AI/Harness", "AI")).toBe(true);
    expect(isSameOrDescendantPath("AI/Harness/Loop", "AI")).toBe(true);
  });

  it("rejects prefix lookalikes that are not inside the folder", () => {
    expect(isSameOrDescendantPath("AI2", "AI")).toBe(false);
    expect(isSameOrDescendantPath("AI2/Harness", "AI")).toBe(false);
    expect(isSameOrDescendantPath("技术", "AI")).toBe(false);
  });
});

describe("rewriteCategoryPath", () => {
  it("rewrites the folder itself", () => {
    expect(rewriteCategoryPath("AI", "AI", "人工智能")).toBe("人工智能");
  });

  it("rewrites subtree paths by prefix replacement", () => {
    expect(rewriteCategoryPath("AI/Harness", "AI", "人工智能")).toBe("人工智能/Harness");
    expect(rewriteCategoryPath("AI/Harness/Loop", "AI", "人工智能")).toBe("人工智能/Harness/Loop");
  });

  it("moves a folder to the root level", () => {
    expect(rewriteCategoryPath("AI/Harness", "AI/Harness", "Harness")).toBe("Harness");
  });

  it("keeps a rename that only changes the last segment", () => {
    expect(rewriteCategoryPath("技术/架构/子项", "技术/架构", "技术/新架构")).toBe("技术/新架构/子项");
  });
});
