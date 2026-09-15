import { describe, expect, it } from "vitest";
import {
  classifyImport,
  isConceptFile,
  parseOkfMarkdown,
  readBoundedBody,
  stripExportHeading,
  type ImportExisting,
} from "../lib/okf-import";

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
  it("removes exactly the exporter's wrapper", () => {
    expect(stripExportHeading("\n# 标题\n\n正文第一行\n", "标题")).toBe("正文第一行");
    expect(stripExportHeading("\n# 标题\n\n正文第一行\n\n", "标题")).toBe("正文第一行\n");
    expect(stripExportHeading("\n# 标题\n\n正文\n", "标题")).toBe("正文");
  });
  it("keeps bodies whose first line is not the exported H1", () => {
    expect(stripExportHeading("# 别的\n", "标题")).toBe("# 别的\n");
  });
  it("round-trips any stored body byte-exactly (the 2026-09-10 false-conflict bug)", () => {
    // 导出器写 `# {title}\n\n{body}\n`;只要去掉的"包装"多一个字节,
    // content_hash 就不再相等,恢复导入会把每条都判成同名异内容。
    const exported = (title: string, body: string) =>
      `---\ntitle: ${title}\ntype: Note\nstatus: stable\n---\n\n# ${title}\n\n${body}\n`;
    for (const body of ["正文", "正文\n", "正文\n\n", "一\n\n二", "  缩进\n结尾  ", "# 非标题首行"]) {
      expect(stripExportHeading(exported("T", body).replace(/^[\s\S]*?---\n\n/, ""), "T")).toBe(body);
    }
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
    expect(doc!.body).toBe("1. 第一步\n2. 第二步");
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

describe("readBoundedBody", () => {
  /** A Request whose body streams `chunks` and records how many were pulled.
   * `duplex: "half"` is required by undici/Node whenever a body is a stream. */
  function streamRequest(chunks: Uint8Array[]) {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled < chunks.length) {
          controller.enqueue(chunks[pulled++]);
        } else {
          controller.close();
        }
      },
    });
    const req = new Request("http://local/api/import/okf", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    return { req, pulled: () => pulled };
  }

  it("returns the concatenated body when under the cap", async () => {
    const { req } = streamRequest([Buffer.from("zip-head"), Buffer.from("-tail")]);
    const bytes = await readBoundedBody(req, 1024);
    expect(bytes).not.toBeNull();
    expect(bytes?.toString()).toBe("zip-head-tail");
  });

  it("rejects an oversized body and stops reading it", async () => {
    // Regression: the route called `await req.arrayBuffer()`, which buffers the
    // entire stream before any length check can run. Content-Length is absent
    // under chunked transfer-encoding, so the declared-size pre-check bounded
    // nothing and a large chunked upload could exhaust the heap.
    const big = Buffer.alloc(4096, 0x61);
    const { req, pulled } = streamRequest([big, big, big, big]);

    const bytes = await readBoundedBody(req, 4096);

    expect(bytes).toBeNull();
    // The abort must be early: the remaining chunks are never pulled, so peak
    // memory stays near the cap instead of the body's full size.
    expect(pulled()).toBeLessThan(4);
  });

  it("accepts a body exactly at the cap", async () => {
    const exact = Buffer.alloc(100, 0x62);
    const { req } = streamRequest([exact]);
    const bytes = await readBoundedBody(req, 100);
    expect(bytes?.length).toBe(100);
  });

  it("returns an empty buffer for an empty body", async () => {
    const { req } = streamRequest([]);
    const bytes = await readBoundedBody(req, 100);
    expect(bytes).not.toBeNull();
    expect(bytes?.length).toBe(0);
  });

  it("falls back safely when the request has no body", async () => {
    const req = new Request("http://local/api/import/okf", { method: "POST", body: Buffer.from("abc") });
    const bytes = await readBoundedBody(req, 10);
    expect(bytes?.toString()).toBe("abc");
  });
});
