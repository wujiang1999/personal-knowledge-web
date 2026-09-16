import JSZip from "jszip";
import yaml from "js-yaml";
import type { ExportConcept } from "./concepts";
import { opensWithTitleHeading } from "./headings";

export function slugify(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "concept";
}

/** Type → OKF directory. `type` is free-form by contract (any string ≤64
 * chars, default "Note") and reaches this from three different surfaces — the
 * web form, the MCP tool and OKF import — so classification cannot depend on
 * the spelling. Matching is per token, in word order, so "Technical Note" and
 * "Reference Note" land in notes/references rather than in one catch-all, and
 * CJK types ("参考", "操作步骤") resolve too. A plural token falls back to its
 * singular, which is what kept `References` from silently becoming notes.
 * Anything unrecognized stays in notes — the same default the old substring
 * chain produced, minus the accidental matches. */
const TYPE_DIR_ALIASES: Record<string, string> = {
  definition: "definitions",
  定义: "definitions",
  概念: "definitions",
  procedure: "procedures",
  步骤: "procedures",
  操作: "procedures",
  流程: "procedures",
  decision: "decisions",
  决策: "decisions",
  entity: "entities",
  实体: "entities",
  reference: "references",
  参考: "references",
  引用: "references",
  资料: "references",
  note: "notes",
  笔记: "notes",
};

export function typeToDir(type: string, status: string): string {
  const normalized = (type || "").trim().toLowerCase();
  const tokens = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let base = "";
  for (const token of tokens) {
    const singular = token.endsWith("s") ? token.slice(0, -1) : token;
    if (Object.hasOwn(TYPE_DIR_ALIASES, token)) base = TYPE_DIR_ALIASES[token];
    else if (Object.hasOwn(TYPE_DIR_ALIASES, singular)) base = TYPE_DIR_ALIASES[singular];
    if (base) break;
  }
  if (!base) {
    // CJK compounds have no word boundaries ("参考资料" is one token), so fall
    // back to containment — for multi-character CJK aliases only.
    for (const [alias, dir] of Object.entries(TYPE_DIR_ALIASES)) {
      if (alias.length > 1 && /^\p{Script=Han}+$/u.test(alias) && normalized.includes(alias)) {
        base = dir;
        break;
      }
    }
  }
  const dir = base || "notes";
  return status === "deprecated" ? `deprecated/${dir}` : dir;
}

function buildFrontmatter(c: ExportConcept, headingInBody: boolean): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    type: c.type,
    title: c.title,
  };
  if (c.description) fm.description = c.description;
  if (c.category) fm.category = c.category;
  if (c.tags.length) fm.tags = c.tags;
  fm.status = c.status;
  fm.generated = {
    by: c.generated_by ?? `human:user`,
    // The current version's created_at — not concepts.updated_at, which would
    // advance past the version's date after a metadata-only edit.
    at: c.version_created_at,
  };
  fm.kb = {
    id: c.id,
    version: c.current_version,
    language: "zh-CN",
    content_hash: c.content_hash,
    sensitivity: "private",
    // Where the file's single H1 comes from: "body" when the stored body
    // already opens with it (nothing was injected), "injected" when the
    // exporter added the wrapper. The importer reads ONLY this key — the rest
    // of kb.* stays traceability the import deliberately discards.
    title_heading: headingInBody ? "body" : "injected",
  };
  return fm;
}

export function conceptToMarkdown(c: ExportConcept): { path: string; content: string } {
  // A body that already opens with its own `# title` gets no second wrapper:
  // the exported file reads with one heading instead of two. `kb.title_heading`
  // records which of the two layouts this file uses, so the importer can
  // restore the body byte-for-byte either way (a bundle exported before this
  // field existed is read as "injected", which is what it was).
  const headingInBody = opensWithTitleHeading(c.body_markdown, c.title);
  const yamlStr = yaml.dump(buildFrontmatter(c, headingInBody), {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
  const dir = typeToDir(c.type, c.status);
  const filename = `${slugify(c.title)}-${c.id.slice(0, 8)}.md`;
  const path = `.okf/${dir}/${filename}`;
  const body = headingInBody ? c.body_markdown : `# ${c.title}\n\n${c.body_markdown}`;
  const content = `---\n${yamlStr}---\n\n${body}\n`;
  return { path, content };
}

/** Latest version creation time across concepts, or null when the KB is empty. */
function latestChangeAt(concepts: ExportConcept[]): string | null {
  let latest: string | null = null;
  for (const c of concepts) {
    // ISO-8601 strings from pg timestamptz compare lexicographically.
    if (!latest || c.version_created_at > latest) latest = c.version_created_at;
  }
  return latest;
}

export function buildIndex(concepts: ExportConcept[]): string {
  const lines: string[] = [
    "---",
    'okf_version: "0.2"',
    'title: "Personal Knowledge Base"',
  ];
  // Deterministic timestamp (max version created_at) so identical DB state
  // produces byte-identical exports; omit when the KB is empty.
  const latest = latestChangeAt(concepts);
  if (latest) lines.push(`exported_at: "${latest}"`);
  lines.push("---", "", "# Personal Knowledge Base", "", `Exported ${concepts.length} concept(s).`, "");
  for (const c of concepts) {
    const dir = typeToDir(c.type, c.status);
    const filename = `${slugify(c.title)}-${c.id.slice(0, 8)}.md`;
    lines.push(`- [${c.title}](./${dir}/${filename})`);
  }
  return lines.join("\n") + "\n";
}

export function buildLog(concepts: ExportConcept[]): string {
  const lines = ["# Change Log", ""];
  const entries = [...concepts].sort(
    (a, b) => new Date(b.version_created_at).getTime() - new Date(a.version_created_at).getTime()
  );
  for (const c of entries) {
    lines.push(`- ${c.version_created_at} v${c.current_version} ${c.title} (${c.type})`);
  }
  return lines.join("\n") + "\n";
}

export async function buildOkfZip(
  concepts: ExportConcept[],
  username: string
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(".okf/index.md", buildIndex(concepts));
  zip.file(".okf/log.md", buildLog(concepts));

  const dirs = new Map<string, string[]>();
  for (const c of concepts) {
    const { path, content } = conceptToMarkdown(c);
    zip.file(path, content);
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir)!.push(path.split("/").pop()!);
  }
  for (const [dir, files] of dirs) {
    zip.file(
      `${dir}/index.md`,
      `# ${dir.replace(".okf/", "").replace("deprecated/", "")}\n\n` +
        files.map((f) => `- [${f.replace(/\.md$/, "")}](./${f})`).join("\n") +
        "\n"
    );
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  void username;
  return buffer;
}