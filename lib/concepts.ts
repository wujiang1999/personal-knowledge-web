import { createHash } from "node:crypto";
import { getPool, query } from "./db";

/** Thrown when a concept lookup by id finds no row (typed 404, not string-match). */
export class NotFoundError extends Error {}

export interface Concept {
  id: string;
  type: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
  tags: string[];
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface ConceptVersion {
  id: string;
  concept_id: string;
  version_number: number;
  title: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  status: string | null;
  type: string | null;
  body_markdown: string;
  content_hash: string;
  generated_by: string | null;
  created_at: string;
}

export interface ConceptDetail extends Concept {
  versions: ConceptVersion[];
}

export interface ConceptInput {
  type: string;
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  status?: string;
  body: string;
}

export function sha256Hex(input: string): string {
  return "sha256:" + createHash("sha256").update(input, "utf8").digest("hex");
}

export function normalizeCategory(input?: string | null): string | null {
  const segs = (input ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  return segs.length ? segs.join("/") : null;
}

export async function listConcepts(opts?: {
  status?: string;
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<Concept[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts?.status) {
    params.push(opts.status);
    where.push(`status = $${params.length}`);
  }
  if (opts?.category) {
    params.push(opts.category);
    where.push(`(category = $${params.length} OR category LIKE $${params.length} || '/%')`);
  }
  let sql = "SELECT * FROM concepts";
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY updated_at DESC";
  if (opts?.limit) {
    params.push(opts.limit);
    sql += ` LIMIT $${params.length}`;
  }
  if (opts?.offset) {
    params.push(opts.offset);
    sql += ` OFFSET $${params.length}`;
  }
  const { rows } = await query<Concept>(sql, params);
  return rows;
}

export interface CategoryTreeNode {
  name: string;
  path: string;
  concepts: Concept[];
  children: CategoryTreeNode[];
}

export function buildCategoryTree(concepts: Concept[]): {
  rootConcepts: Concept[];
  roots: CategoryTreeNode[];
} {
  const roots: CategoryTreeNode[] = [];
  const rootConcepts: Concept[] = [];
  const map = new Map<string, CategoryTreeNode>();

  for (const c of concepts) {
    const path = normalizeCategory(c.category);
    if (!path) {
      rootConcepts.push(c);
      continue;
    }
    const segs = path.split("/");
    let siblings = roots;
    let fullPath = "";
    for (let i = 0; i < segs.length; i++) {
      fullPath = fullPath ? `${fullPath}/${segs[i]}` : segs[i];
      let node = map.get(fullPath);
      if (!node) {
        node = { name: segs[i], path: fullPath, concepts: [], children: [] };
        map.set(fullPath, node);
        siblings.push(node);
      }
      if (i === segs.length - 1) node.concepts.push(c);
      siblings = node.children;
    }
  }

  const sortNodes = (nodes: CategoryTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) {
      n.concepts.sort((a, b) => a.title.localeCompare(b.title));
      sortNodes(n.children);
    }
  };
  sortNodes(roots);
  rootConcepts.sort((a, b) => a.title.localeCompare(b.title));

  return { rootConcepts, roots };
}

export async function getConceptDetail(id: string): Promise<ConceptDetail | null> {
  const { rows } = await query<Concept>("SELECT * FROM concepts WHERE id = $1", [id]);
  if (rows.length === 0) return null;
  const concept = rows[0];
  const versions = await query<ConceptVersion>(
    "SELECT * FROM concept_versions WHERE concept_id = $1 ORDER BY version_number DESC",
    [id]
  );
  return { ...concept, versions: versions.rows };
}

export interface SearchResult extends Concept {
  body_markdown: string;
  score: number;
}

export async function searchConcepts(q: string, limit = 20): Promise<SearchResult[]> {
  const needle = q.trim().slice(0, 200);
  if (!needle) return [];

  // Escape LIKE metacharacters — % and _ are user-controllable wildcards.
  // Passed as its own parameter ($2) so similarity/FTS still see the raw $1.
  const like = "%" + needle.replace(/[\\%_]/g, (m) => "\\" + m) + "%";

  // 'simple' FTS treats a CJK run as one lexeme, so a Chinese query can never
  // match content_tsv. Only enter the FTS branch for ASCII tokens; Chinese
  // queries rank purely via pg_trgm similarity + ILIKE (until PGroonga).
  const hasAscii = /[a-z0-9]/i.test(needle);
  const ftsScore = hasAscii
    ? "+ COALESCE(ts_rank(v.content_tsv, websearch_to_tsquery('simple', $1)), 0)"
    : "";
  const ftsWhere = hasAscii
    ? "v.content_tsv @@ websearch_to_tsquery('simple', $1) OR "
    : "";

  const sql = `
    SELECT
      c.id, c.type, c.title, c.description, c.status, c.tags,
      c.current_version, c.created_at, c.updated_at,
      v.body_markdown,
      (
        (CASE WHEN c.title ILIKE $2 THEN 30 ELSE 0 END)
        + (CASE WHEN v.body_markdown ILIKE $2 THEN 15 ELSE 0 END)
        + (CASE WHEN c.description ILIKE $2 THEN 8 ELSE 0 END)
        + (similarity(c.title, $1) * 50)
        + (similarity(v.body_markdown, $1) * 20)
        + (similarity(COALESCE(c.description, ''), $1) * 12)
        ${ftsScore}
      ) AS score
    FROM concepts c
    JOIN concept_versions v
      ON v.concept_id = c.id AND v.version_number = c.current_version
    WHERE (
      ${ftsWhere}
      v.body_markdown ILIKE $2
      OR c.title ILIKE $2
      OR c.description ILIKE $2
      OR c.title % $1
      OR similarity(v.body_markdown, $1) > 0.05
    )
    ORDER BY score DESC, c.updated_at DESC
    LIMIT $3
  `;

  const { rows } = await query<SearchResult>(sql, [needle, like, limit]);
  return rows;
}

export async function createConcept(input: ConceptInput, username: string): Promise<string> {
  const body = input.body;
  const contentHash = sha256Hex(body);
  const type = input.type.trim() || "Note";
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const category = normalizeCategory(input.category);
  const tags = input.tags?.map((t) => t.trim()).filter(Boolean) ?? [];
  const status = input.status ?? "stable";

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO concepts (type, title, description, category, tags, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [type, title, description, category, tags, status]
    );
    const conceptId = inserted.rows[0].id as string;
    // Raw-input traceability: link the source back to the new concept.
    await client.query(
      "INSERT INTO sources (concept_id, source_type, original_name, content, content_hash) VALUES ($1, $2, $3, $4, $5)",
      [conceptId, "text", title || null, body, contentHash]
    );
    // Version 1 carries a metadata snapshot so past versions stay reconstructable.
    await client.query(
      "INSERT INTO concept_versions (concept_id, version_number, title, description, category, tags, status, type, body_markdown, content_hash, generated_by) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [conceptId, title, description, category, tags, status, type, body, contentHash, `human:${username}`]
    );
    await client.query("COMMIT");
    return conceptId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface SaveResult {
  version: number;
  created: boolean;
}

export async function addConceptVersion(
  id: string,
  input: ConceptInput,
  username: string
): Promise<SaveResult> {
  const body = input.body;
  const contentHash = sha256Hex(body);
  const metadata = {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    category: normalizeCategory(input.category),
    tags: input.tags?.map((t) => t.trim()).filter(Boolean) ?? [],
    type: input.type.trim() || "Note",
    status: input.status ?? "stable",
  };

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      "SELECT c.current_version, v.content_hash FROM concepts c JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version WHERE c.id = $1 FOR UPDATE",
      [id]
    );
    if (cur.rows.length === 0) throw new NotFoundError("Concept not found");
    const currentVersion = cur.rows[0].current_version as number;
    const currentHash = cur.rows[0].content_hash as string;

    if (contentHash === currentHash) {
      // 正文未变化：只更新元信息，不新增版本、不新增来源；同步刷新当前版本行的
      // 快照列，保证"最新版本行即最新元数据"不变量（也修正导出的 generated.at）。
      await client.query(
        "UPDATE concepts SET title = $2, description = $3, category = $4, tags = $5, type = $6, status = $7, updated_at = now() WHERE id = $1",
        [id, metadata.title, metadata.description, metadata.category, metadata.tags, metadata.type, metadata.status]
      );
      await client.query(
        "UPDATE concept_versions SET title = $2, description = $3, category = $4, tags = $5, status = $6, type = $7 WHERE concept_id = $1 AND version_number = (SELECT current_version FROM concepts WHERE id = $1)",
        [id, metadata.title, metadata.description, metadata.category, metadata.tags, metadata.status, metadata.type]
      );
      await client.query("COMMIT");
      return { version: currentVersion, created: false };
    }

    const nextVersion = currentVersion + 1;
    // 同概念、同正文哈希已有 source 记录时跳过，避免重复来源行。
    const dup = await client.query(
      "SELECT 1 FROM sources WHERE content_hash = $1 AND concept_id = $2 LIMIT 1",
      [contentHash, id]
    );
    if (!dup.rowCount) {
      await client.query(
        "INSERT INTO sources (concept_id, source_type, original_name, content, content_hash) VALUES ($1, $2, $3, $4, $5)",
        [id, "text", metadata.title || null, body, contentHash]
      );
    }
    await client.query(
      "INSERT INTO concept_versions (concept_id, version_number, title, description, category, tags, status, type, body_markdown, content_hash, generated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      [id, nextVersion, metadata.title, metadata.description, metadata.category, metadata.tags, metadata.status, metadata.type, body, contentHash, `human:${username}`]
    );
    await client.query(
      "UPDATE concepts SET current_version = $2, title = $3, description = $4, category = $5, tags = $6, type = $7, status = $8, updated_at = now() WHERE id = $1",
      [id, nextVersion, metadata.title, metadata.description, metadata.category, metadata.tags, metadata.type, metadata.status]
    );
    await client.query("COMMIT");
    return { version: nextVersion, created: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteConcept(id: string): Promise<boolean> {
  const res = await query("DELETE FROM concepts WHERE id = $1 RETURNING id", [id]);
  return (res.rowCount ?? 0) > 0;
}

export interface Source {
  id: string;
  source_type: string;
  original_name: string | null;
  content_hash: string;
  created_at: string;
}

export async function listSources(): Promise<Source[]> {
  const { rows } = await query<Source>(
    "SELECT id, source_type, original_name, content_hash, created_at FROM sources ORDER BY created_at DESC LIMIT 200"
  );
  return rows;
}

export interface ExportConcept {
  id: string;
  type: string;
  title: string;
  description: string | null;
  category: string | null;
  status: string;
  tags: string[];
  current_version: number;
  body_markdown: string;
  content_hash: string;
  generated_by: string | null;
  updated_at: string;
  version_created_at: string;
}

export async function listConceptsForExport(): Promise<ExportConcept[]> {
  const { rows } = await query<ExportConcept>(`
    SELECT
      c.id, c.type, c.title, c.description, c.category, c.status, c.tags,
      c.current_version, c.updated_at,
      v.body_markdown, v.content_hash, v.generated_by, v.created_at AS version_created_at
    FROM concepts c
    JOIN concept_versions v
      ON v.concept_id = c.id AND v.version_number = c.current_version
    ORDER BY c.updated_at DESC
  `);
  return rows;
}