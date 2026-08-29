import { describe, expect, it } from "vitest";
import { buildCategoryTree, isSameOrDescendantPath, rewriteCategoryPath, type Concept } from "../lib/concepts";

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

describe("buildCategoryTree with empty folders", () => {
  const mk = (id: string, title: string, category: string | null): Concept => ({
    id,
    type: "Note",
    title,
    description: null,
    category,
    status: "stable",
    tags: [],
    current_version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });

  it("creates empty folder nodes with implicit intermediate parents", () => {
    const { roots } = buildCategoryTree([], ["技术/测试"]);
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe("技术");
    expect(roots[0].concepts).toHaveLength(0);
    expect(roots[0].children[0]).toMatchObject({ name: "测试", concepts: [], children: [] });
  });

  it("merges empty folders with concept-derived folders without duplication", () => {
    const { roots } = buildCategoryTree([mk("1", "条目", "AI/Web")], ["AI", "技术/测试"]);
    const names = roots.map((r) => r.name).sort();
    expect(names).toEqual(["AI", "技术"]);
    const ai = roots.find((r) => r.name === "AI");
    expect(ai?.concepts).toHaveLength(0);
    expect(ai?.children[0]).toMatchObject({ name: "Web" });
    expect(ai?.children[0]?.concepts).toHaveLength(1);
  });

  it("normalizes stray slashes in folder paths", () => {
    const { roots } = buildCategoryTree([], [" a / b "]);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ name: "a", path: "a" });
    expect(roots[0].children[0]?.path).toBe("a/b");
  });
});
