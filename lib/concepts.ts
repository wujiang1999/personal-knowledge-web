import { createHash } from "node:crypto";
import { getPool, query } from "./db";

export interface Concept {
  id: string;
  okf_path: string | null;
  type: string;
  title: string;
  description: string | null;
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
  tags?: string[];
  status?: string;
  body: string;
}

export function sha256Hex(input: string): string {
  return "sha256:" + createHash("sha256").update(input, "utf8").digest("hex");
}

export async function listConcepts(opts?: {
  status?: string;
  limit?: number;
}): Promise<Concept[]> {
  const params: unknown[] = [];
  let sql = "SELECT * FROM concepts";
  if (opts?.status) {
    params.push(opts.status);
    sql += " WHERE status = $1";
  }
  sql += " ORDER BY updated_at DESC";
  if (opts?.limit) {
    params.push(opts.limit);
    sql += ` LIMIT $${params.length}`;
  }
  const { rows } = await query<Concept>(sql, params);
  return rows;
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

  // Only use full-text search when the query contains a real token; otherwise
  // websearch_to_tsquery returns an empty tsquery and `@@ ''` throws.
  const hasToken = /[a-z0-9_一-鿿]/i.test(needle);
  const ftsScore = hasToken
    ? "+ COALESCE(ts_rank(v.content_tsv, websearch_to_tsquery('simple', $1)), 0)"
    : "";
  const ftsWhere = hasToken
    ? "v.content_tsv @@ websearch_to_tsquery('simple', $1) OR "
    : "";

  const sql = `
    SELECT
      c.id, c.okf_path, c.type, c.title, c.description, c.status, c.tags,
      c.current_version, c.created_at, c.updated_at,
      v.body_markdown,
      (
        (CASE WHEN c.title ILIKE '%' || $1 || '%' THEN 30 ELSE 0 END)
        + (CASE WHEN v.body_markdown ILIKE '%' || $1 || '%' THEN 10 ELSE 0 END)
        + (similarity(c.title, $1) * 50)
        ${ftsScore}
      ) AS score
    FROM concepts c
    JOIN concept_versions v
      ON v.concept_id = c.id AND v.version_number = c.current_version
    WHERE (
      ${ftsWhere}
      v.body_markdown ILIKE '%' || $1 || '%'
      OR c.title ILIKE '%' || $1 || '%'
      OR c.title % $1
      OR c.description ILIKE '%' || $1 || '%'
    )
    ORDER BY score DESC, c.updated_at DESC
    LIMIT $2
  `;

  const { rows } = await query<SearchResult>(sql, [needle, limit]);
  return rows;
}

export async function createConcept(input: ConceptInput, username: string): Promise<string> {
  const body = input.body;
  const contentHash = sha256Hex(body);
  const type = input.type.trim() || "Note";
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const tags = input.tags?.map((t) => t.trim()).filter(Boolean) ?? [];
  const status = input.status ?? "stable";

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO sources (source_type, original_name, content, content_hash) VALUES ($1, $2, $3, $4)",
      ["text", title || null, body, contentHash]
    );
    const inserted = await client.query(
      "INSERT INTO concepts (type, title, description, tags, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [type, title, description, tags, status]
    );
    const conceptId = inserted.rows[0].id as string;
    await client.query(
      "INSERT INTO concept_versions (concept_id, version_number, body_markdown, content_hash, generated_by) VALUES ($1, 1, $2, $3, $4)",
      [conceptId, body, contentHash, `human:${username}`]
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
    if (cur.rows.length === 0) throw new Error("Concept not found");
    const currentVersion = cur.rows[0].current_version as number;
    const currentHash = cur.rows[0].content_hash as string;

    if (contentHash === currentHash) {
      // 正文未变化：只更新元信息，不新增版本、不新增来源
      await client.query(
        "UPDATE concepts SET title = $2, description = $3, tags = $4, type = $5, status = $6, updated_at = now() WHERE id = $1",
        [id, metadata.title, metadata.description, metadata.tags, metadata.type, metadata.status]
      );
      await client.query("COMMIT");
      return { version: currentVersion, created: false };
    }

    const nextVersion = currentVersion + 1;
    await client.query(
      "INSERT INTO sources (source_type, original_name, content, content_hash) VALUES ($1, $2, $3, $4)",
      ["text", metadata.title || null, body, contentHash]
    );
    await client.query(
      "INSERT INTO concept_versions (concept_id, version_number, body_markdown, content_hash, generated_by) VALUES ($1, $2, $3, $4, $5)",
      [id, nextVersion, body, contentHash, `human:${username}`]
    );
    await client.query(
      "UPDATE concepts SET current_version = $2, title = $3, description = $4, tags = $5, type = $6, status = $7, updated_at = now() WHERE id = $1",
      [id, nextVersion, metadata.title, metadata.description, metadata.tags, metadata.type, metadata.status]
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
  status: string;
  tags: string[];
  current_version: number;
  body_markdown: string;
  content_hash: string;
  generated_by: string | null;
  updated_at: string;
}

export async function listConceptsForExport(): Promise<ExportConcept[]> {
  const { rows } = await query<ExportConcept>(`
    SELECT
      c.id, c.type, c.title, c.description, c.status, c.tags,
      c.current_version, c.updated_at,
      v.body_markdown, v.content_hash, v.generated_by
    FROM concepts c
    JOIN concept_versions v
      ON v.concept_id = c.id AND v.version_number = c.current_version
    ORDER BY c.updated_at DESC
  `);
  return rows;
}