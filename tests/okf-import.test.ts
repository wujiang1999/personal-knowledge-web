import { describe, expect, it } from "vitest";
import { classifyImport, isConceptFile, parseOkfMarkdown, stripExportHeading, type ImportExisting } from "../lib/okf-import";

const existing = (id: string, title: string, hash: string): ImportExisting => ({ id, title, contentHash: hash });

describe("isConceptFile", () => {
  it("keeps entry markdown, drops indexes/logs/non-md", () => {
    // 导出布局：所有条目都在 .okf/<type>/ 下，不能按目录排除
    expect(isConceptFile(".okf/notes/my-note-abc12345.md")).toBe(true);
    expect(isConceptFile(".okf/deprecated/definitions/x-abc12345.md")).toBe(true);
    expect(isConceptFile("notes/my-note-abc12345.md")).toBe(true);
    expect(isConceptFile(".okf/index.md")).toBe(false);
    expect(isConceptFile(".okf/log.md")).toBe(false);
    expect(isConceptFile(".okf/notes/index.md")).toBe(false);
    expect(isConceptFile("notes/pic.png")).toBe(false);
  });
});

describe("stripExportHeading", () => {
  it("removes the exported H1 and following blanks", () => {
    expect(stripExportHeading("\n# 标题\n\n正文第一行\n", "标题")).toBe("正文第一行\n");
  });
  it("keeps bodies whose first line is not the exported H1", () => {
    expect(stripExportHeading("# 别的\n", "标题")).toBe("# 别的\n");
  });
});

describe("parseOkfMarkdown", () => {
  it("parses a full export file", () => {
    const content =
      "---\ntype: Procedure\ntitle: \"部署流程\"\ndescription: 怎么部署\ncategory: \"运维/部署\"\ntags:\n  - ops\nstatus: stable\nkb:\n  id: abc\n---\n\n# 部署流程\n\n1. 第一步\n2. 第二步\n";
    const { doc, error } = parseOkfMarkdown("procedures/x.md", content);
    expect(error).toBeUndefined();
    expect(doc).toMatchObject({
      title: "部署流程",
      type: "Procedure",
      description: "怎么部署",
      category: "运维/部署",
      tags: ["ops"],
      status: "stable",
    });
    expect(doc!.body).toBe("1. 第一步\n2. 第二步\n");
    expect(doc!.body).not.toContain("# 部署流程");
    expect(doc!.body).not.toContain("id: abc");
  });

  it("defaults missing status to stable and type to Note", () => {
    const { doc } = parseOkfMarkdown("notes/x.md", '---\ntitle: "T"\n---\n\n# T\n\nbody\n');
    expect(doc!.status).toBe("stable");
    expect(doc!.type).toBe("Note");
  });

  it("reports per-file errors instead of throwing", () => {
    expect(parseOkfMarkdown("a.md", "no frontmatter here").error).toContain("frontmatter");
    expect(parseOkfMarkdown("a.md", "---\ncontent: x\n---\n\nbody").error).toContain("title");
    expect(parseOkfMarkdown("a.md", '---\ntitle: "T"\nstatus: archived\n---\n\nbody').error).toContain("status");
    expect(parseOkfMarkdown("a.md", '---\ntitle: "T"\n---\n\n   \n').error).toContain("正文为空");
    // broken YAML is caught, not fatal
    expect(parseOkfMarkdown("a.md", "---\ntitle: [unclosed\n---\n\nbody").error).toContain("解析失败");
  });
});

describe("classifyImport", () => {
  const doc = (title: string) =>
    ({ title, path: "x.md", type: "Note", description: null, category: null, tags: [], status: "stable", body: "b" }) as Parameters<
      typeof classifyImport
    >[0];

  it("byte-identical content duplicates even under a different title", () => {
    const d = classifyImport(doc("新标题"), "h1", [existing("id1", "旧标题", "h1")]);
    expect(d.action).toBe("duplicate");
    expect((d as { existingId: string }).existingId).toBe("id1");
  });

  it("same title with different content is a conflict, never an overwrite", () => {
    const d = classifyImport(doc("同名"), "h2", [existing("id1", "同名", "h1")]);
    expect(d.action).toBe("conflict");
  });

  it("title comparison is case-insensitive", () => {
    const d = classifyImport(doc("API 设计"), "h2", [existing("id1", "api 设计", "h1")]);
    expect(d.action).toBe("conflict");
  });

  it("unknown title and hash creates", () => {
    expect(classifyImport(doc("新"), "h9", [existing("id1", "旧", "h1")]).action).toBe("create");
  });
});
