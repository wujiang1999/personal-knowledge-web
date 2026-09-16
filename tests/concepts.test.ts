import { describe, expect, it } from "vitest";
import { attachSections, buildCategoryTree, normalizeCategory, sha256Hex, type Concept, type SearchResult } from "../lib/concepts";
import { escapeLike } from "../lib/search-syntax";

describe("attachSections", () => {
  const hit = (id: string, matchAt?: number): SearchResult => ({
    id,
    type: "Note",
    title: "t",
    description: null,
    category: null,
    status: "stable",
    tags: [],
    current_version: 1,
    attachment_count: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    body_markdown: "preview",
    score: 1,
    ...(matchAt === undefined ? {} : { match_at: matchAt }),
  });
  const body = "# 顶层\n\n## 小节\n\n正文在这里。\n";

  it("labels a hit with its heading path and never leaks the anchor", () => {
    const [out] = attachSections([hit("a", body.indexOf("正文"))], new Map([["a", body]]));
    expect(out.section).toBe("顶层 > 小节");
    expect(out).not.toHaveProperty("match_at");
  });

  it("omits section above the first heading and keeps other rows intact", () => {
    const out = attachSections(
      [hit("a", 1), hit("b", body.indexOf("正文"))],
      new Map([
        ["a", "没有标题的正文"],
        ["b", body],
      ]),
    );
    expect(out[0]).not.toHaveProperty("section");
    expect(out[0]).not.toHaveProperty("match_at");
    expect(out[1].section).toBe("顶层 > 小节");
  });

  it("drops the field for a body that vanished between the two reads", () => {
    const [out] = attachSections([hit("gone", 10)], new Map());
    expect(out).not.toHaveProperty("section");
    expect(out).not.toHaveProperty("match_at");
    expect(out.body_markdown).toBe("preview");
  });

  it("gives no section to rows with no match anchor (operator-only listing)", () => {
    const [out] = attachSections([hit("a")], new Map([["a", body]]));
    expect(out).not.toHaveProperty("section");
    expect(out).not.toHaveProperty("match_at");
  });
});

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
    attachment_count: 0,
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