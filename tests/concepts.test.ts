import { describe, expect, it } from "vitest";
import { buildCategoryTree, escapeLike, normalizeCategory, sha256Hex, type Concept } from "../lib/concepts";

describe("escapeLike", () => {
  it("escapes % _ and backslash", () => {
    expect(escapeLike("50%_done\\x")).toBe("50\\%\\_done\\\\x");
  });

  it("leaves plain text untouched", () => {
    expect(escapeLike("docker 部署")).toBe("docker 部署");
  });
});

describe("normalizeCategory", () => {
  it("splits and trims slash segments", () => {
    expect(normalizeCategory(" 技术 / 部署 / k8s ")).toBe("技术/部署/k8s");
  });

  it("returns null for empty or separator-only input", () => {
    expect(normalizeCategory("")).toBeNull();
    expect(normalizeCategory("  /  ")).toBeNull();
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
  });
});

describe("sha256Hex", () => {
  it("produces the stable prefixed digest", () => {
    expect(sha256Hex("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("buildCategoryTree", () => {
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

  it("builds a nested sorted tree and separates root concepts", () => {
    const { roots, rootConcepts } = buildCategoryTree([
      mk("3", "Zdoc", "技术/部署"),
      mk("1", "Adoc", null),
      mk("2", "Bdoc", "技术/数据库"),
    ]);
    expect(rootConcepts.map((c) => c.title)).toEqual(["Adoc"]);
    expect(roots[0].name).toBe("技术");
    expect(roots[0].children.map((c) => c.name)).toEqual(["部署", "数据库"]);
  });

  it("handles a concept at a parent path with children", () => {
    const { roots } = buildCategoryTree([
      mk("1", "Parent", "技术"),
      mk("2", "Child", "技术/部署"),
    ]);
    expect(roots[0].concepts.map((c) => c.title)).toEqual(["Parent"]);
    expect(roots[0].children[0].concepts.map((c) => c.title)).toEqual(["Child"]);
  });
});