import JSZip from "jszip";
import yaml from "js-yaml";
import type { ExportConcept } from "./concepts";

export function slugify(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "concept";
}

export function typeToDir(type: string, status: string): string {
  const t = (type || "").toLowerCase();
  let base: string;
  if (t.includes("definition")) base = "definitions";
  else if (t.includes("procedure")) base = "procedures";
  else if (t.includes("decision")) base = "decisions";
  else if (t.includes("entity")) base = "entities";
  else if (t.includes("reference")) base = "references";
  else base = "notes";
  return status === "deprecated" ? `deprecated/${base}` : base;
}

function buildFrontmatter(c: ExportConcept): Record<string, unknown> {
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
  };
  return fm;
}

export function conceptToMarkdown(c: ExportConcept): { path: string; content: string } {
  const yamlStr = yaml.dump(buildFrontmatter(c), {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
  const dir = typeToDir(c.type, c.status);
  const filename = `${slugify(c.title)}-${c.id.slice(0, 8)}.md`;
  const path = `.okf/${dir}/${filename}`;
  const content = `---\n${yamlStr}---\n\n# ${c.title}\n\n${c.body_markdown}\n`;
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