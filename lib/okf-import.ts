import JSZip from "jszip";
import yaml from "js-yaml";
import { createConcept, listConceptsForExport, sha256Hex, DuplicateBodyError } from "./concepts";
import { enqueueReview } from "./reviews";
import type { ScopeUser } from "./requireUser";

/** OKF Bundle 导入：解析导出 ZIP（Markdown + YAML frontmatter），按规划的
 * 重复/冲突治理规则分类——完全重复复用已有条目（不重建），同名不同内容视为
 * 冲突留给人工裁决（绝不静默覆盖），其余创建为新条目。解析失败的文件进入
 * errors 报告，不阻塞其余文件（"解析失败不能显示成导入成功"）。
 *
 * 冲突额外落一行审核队列记录：导入报告关掉浏览器就没了，队列不会——裁决
 * 入口必须有持久形态（见 lib/reviews）。 */

export const OKF_IMPORT_MAX_BYTES = 20 * 1024 * 1024;

export interface ParsedOkfDoc {
  path: string;
  title: string;
  type: string;
  description: string | null;
  category: string | null;
  tags: string[];
  status: string;
  body: string;
}

const CONCEPT_STATUSES = new Set(["draft", "stable", "deprecated"]);

/** ZIP 内哪些文件是知识条目。注意导出布局把所有内容都放在 .okf/ 下
 * （.okf/<type>/xxx.md），所以不能按目录排除——只排除各级 index.md、
 * 变更日志 log.md 和非 Markdown 文件。 */
export function isConceptFile(path: string): boolean {
  if (!path.toLowerCase().endsWith(".md")) return false;
  const base = (path.split("/").pop() ?? "").toLowerCase();
  return base !== "index.md" && base !== "log.md";
}

/** Strip the exported `# {title}` H1 wrapper so a round trip is byte-exact.
 *
 * The exporter emits `\n\n# {title}\n\n{body}\n`, so the inverse removes
 * exactly that decoration: one leading blank line, the H1, one blank line and
 * one trailing newline. Nothing else is normalized — an earlier version also
 * trimmed the body and re-appended a newline, which silently changed every
 * body that did not already end with one and turned restore-imports into a
 * wall of false "same title, different content" conflicts (2026-09-10). */
export function stripExportHeading(body: string, title: string): string {
  const lead = body.startsWith("\r\n") ? 2 : body.startsWith("\n") ? 1 : 0;
  const lines = body.slice(lead).split("\n");
  if ((lines[0] ?? "").trim() !== `# ${title.trim()}`) return body;
  lines.shift();
  if ((lines[0] ?? "").trim() === "") lines.shift(); // the exporter's single blank line
  const out = lines.join("\n");
  return out.endsWith("\n") ? out.slice(0, -1) : out; // the exporter's single trailing newline
}

/** Parse one exported Markdown file into a concept-shaped doc, or a per-file
 * error. Traceability frontmatter from the source system (kb.*, generated.*)
 * is intentionally ignored — the import records fresh provenance instead. */
export function parseOkfMarkdown(path: string, content: string): { doc?: ParsedOkfDoc; error?: string } {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return { error: "缺少 YAML frontmatter" };
  let fm: unknown;
  try {
    fm = yaml.load(fmMatch[1]);
  } catch (err) {
    return { error: `frontmatter 解析失败:${err instanceof Error ? err.message : "未知错误"}` };
  }
  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) return { error: "frontmatter 不是对象" };
  const rec = fm as Record<string, unknown>;

  const title = typeof rec.title === "string" ? rec.title.trim() : "";
  if (!title) return { error: "frontmatter 缺少 title" };
  const status = rec.status === undefined ? "stable" : String(rec.status);
  if (!CONCEPT_STATUSES.has(status)) return { error: `未知 status:${status}` };

  const tags = Array.isArray(rec.tags) ? rec.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 30) : [];
  const type = typeof rec.type === "string" && rec.type.trim() ? rec.type.trim().slice(0, 64) : "Note";
  const description =
    typeof rec.description === "string" && rec.description.trim() ? rec.description.trim().slice(0, 1000) : null;
  const category = typeof rec.category === "string" && rec.category.trim() ? rec.category.trim().slice(0, 200) : null;

  const body = stripExportHeading(content.slice(fmMatch[0].length), title);
  if (!body.trim()) return { error: "正文为空" };

  return {
    doc: { path, title, type, description, category, tags, status, body },
  };
}

/** Unzip an exported OKF bundle into parsed docs + per-file errors. */
export async function parseOkfZip(
  bytes: Buffer
): Promise<{ docs: ParsedOkfDoc[]; errors: { path: string; error: string }[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const docs: ParsedOkfDoc[] = [];
  const errors: { path: string; error: string }[] = [];
  const files = Object.values(zip.files).filter((f) => !f.dir && isConceptFile(f.name));
  for (const f of files) {
    const content = await f.async("string");
    const { doc, error } = parseOkfMarkdown(f.name, content);
    if (doc) docs.push(doc);
    else if (error) errors.push({ path: f.name, error });
  }
  return { docs, errors };
}

export interface ImportExisting {
  id: string;
  title: string;
  contentHash: string;
}

export type ImportDecision =
  | { action: "create"; doc: ParsedOkfDoc }
  | { action: "duplicate"; doc: ParsedOkfDoc; existingId: string; existingTitle: string }
  | { action: "conflict"; doc: ParsedOkfDoc; existingId: string; existingTitle: string };

/** Governance classification (规划 §三): byte-identical content anywhere in the
 * scope → duplicate (reuse what exists); same title with different content →
 * conflict (human decides — never overwrite); anything else → create. */
export function classifyImport(doc: ParsedOkfDoc, bodyHash: string, existing: ImportExisting[]): ImportDecision {
  const lowerTitle = doc.title.toLowerCase();
  const byHash = existing.find((e) => e.contentHash === bodyHash);
  if (byHash) return { action: "duplicate", doc, existingId: byHash.id, existingTitle: byHash.title };
  const byTitle = existing.find((e) => e.title.toLowerCase() === lowerTitle);
  if (byTitle) return { action: "conflict", doc, existingId: byTitle.id, existingTitle: byTitle.title };
  return { action: "create", doc };
}

export interface OkfImportReport {
  total: number;
  imported: { id: string; title: string }[];
  duplicates: { title: string; existingId: string; existingTitle: string }[];
  conflicts: { title: string; existingId: string; existingTitle: string; reviewId: string | null }[];
  errors: { path: string; error: string }[];
}

export async function importOkfZip(user: ScopeUser & { username: string }, bytes: Buffer): Promise<OkfImportReport> {
  const { docs, errors } = await parseOkfZip(bytes);
  const report: OkfImportReport = { total: docs.length, imported: [], duplicates: [], conflicts: [], errors };

  // Current-version hashes across the caller's scope, for the classification
  // pass. (listConceptsForExport already joins them; the export shape is a
  // convenient read model here too.)
  const existing: ImportExisting[] = (await listConceptsForExport(user)).map((c) => ({
    id: c.id,
    title: c.title,
    contentHash: c.content_hash,
  }));

  for (const doc of docs) {
    const decision = classifyImport(doc, sha256Hex(doc.body), existing);
    if (decision.action === "duplicate") {
      report.duplicates.push({ title: doc.title, existingId: decision.existingId, existingTitle: decision.existingTitle });
      continue;
    }
    if (decision.action === "conflict") {
      const reviewId = await enqueueReview(user, {
        kind: "conflict",
        source: "okf-import",
        payload: {
          type: doc.type,
          title: doc.title,
          description: doc.description ?? undefined,
          category: doc.category ?? undefined,
          tags: doc.tags,
          status: doc.status,
          body: doc.body,
        },
        targetConceptId: decision.existingId,
        targetTitle: decision.existingTitle,
        reason: `导入文件 ${doc.path} 与已有条目同名、内容不同`,
      });
      report.conflicts.push({
        title: doc.title,
        existingId: decision.existingId,
        existingTitle: decision.existingTitle,
        reviewId,
      });
      continue;
    }
    // createConcept re-checks byte-identical bodies inside its own transaction
    // — the concurrency-safe backstop for two imports racing (classify saw a
    // stale snapshot); those surface here as duplicates, never as twins.
    try {
      const id = await createConcept(
        {
          type: doc.type,
          title: doc.title,
          description: doc.description ?? undefined,
          category: doc.category ?? undefined,
          tags: doc.tags,
          status: doc.status,
          body: doc.body,
        },
        user
      );
      report.imported.push({ id, title: doc.title });
    } catch (err) {
      if (err instanceof DuplicateBodyError) {
        report.duplicates.push({ title: doc.title, existingId: err.existingId, existingTitle: err.existingTitle });
      } else {
        report.errors.push({ path: doc.path, error: err instanceof Error ? err.message : "写入失败" });
      }
    }
  }
  return report;
}
