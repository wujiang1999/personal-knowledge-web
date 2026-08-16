import { describe, expect, it } from "vitest";
import { buildIndex, buildLog, conceptToMarkdown, slugify, typeToDir } from "../lib/okf";

const baseConcept = {
  id: "11111111-2222-3333-4444-555555555555",
  type: "Technical Note",
  title: "Docker 部署笔记",
  description: "部署相关",
  category: "技术/部署",
  status: "stable",
  tags: ["docker", "部署"],
  current_version: 3,
  body_markdown: "# 正文\n\n- docker compose up -d",
  content_hash: "sha256:abc",
  generated_by: "human:admin",
  updated_at: "2026-08-16T10:00:00.000Z",
  version_created_at: "2026-08-16T09:00:00.000Z",
};

describe("okf slugify", () => {
  it("lowercases and collapses separators", () => {
    expect(slugify("Hello World !! Foo")).toBe("hello-world-foo");
  });

  it("keeps CJK characters", () => {
    expect(slugify("部署指南 2026")).toBe("部署指南-2026");
  });

  it("falls back for separator-only input", () => {
    expect(slugify("  --- ")).toBe("concept");
  });
});

describe("okf typeToDir", () => {
  it("maps OKF types to directories", () => {
    expect(typeToDir("Definition", "stable")).toBe("definitions");
    expect(typeToDir("Procedure", "stable")).toBe("procedures");
    expect(typeToDir("Decision", "stable")).toBe("decisions");
    expect(typeToDir("Entity", "stable")).toBe("entities");
    expect(typeToDir("Reference", "stable")).toBe("references");
    expect(typeToDir("Note", "stable")).toBe("notes");
  });

  it("routes deprecated concepts under deprecated/", () => {
    expect(typeToDir("Definition", "deprecated")).toBe("deprecated/definitions");
  });
});

describe("okf determinism", () => {
  it("produces identical markdown for identical state", () => {
    expect(conceptToMarkdown(baseConcept)).toEqual(conceptToMarkdown({ ...baseConcept }));
  });

  it("index and log are byte-identical for identical state", () => {
    expect(buildIndex([baseConcept])).toBe(buildIndex([baseConcept]));
    expect(buildLog([baseConcept])).toBe(buildLog([baseConcept]));
  });

  it("log sorts by version_created_at descending", () => {
    const older = { ...baseConcept, title: "old", version_created_at: "2026-08-01T00:00:00.000Z" };
    const log = buildLog([baseConcept, older]);
    expect(log.indexOf("Docker 部署笔记")).toBeLessThan(log.indexOf("old"));
  });

  it("frontmatter generated.at uses version_created_at (not updated_at)", () => {
    const out = conceptToMarkdown(baseConcept);
    // js-yaml quotes timestamp-like strings to avoid Date coercion; match the value only.
    expect(out.content).toContain("2026-08-16T09:00:00.000Z");
    expect(out.content).not.toContain("2026-08-16T10:00:00.000Z");
  });

  it("builds a safe zip path (slugified, no traversal)", () => {
    const out = conceptToMarkdown({ ...baseConcept, title: "../evil" });
    expect(out.path).not.toContain("..");
  });
});