import { createHash } from "node:crypto";
import { getPool, query } from "./db";
import { deleteAttachmentFile } from "./attachments";
import type { ScopeUser } from "./requireUser";

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
  /** Populated on list/detail/search reads; lets an admin tell whose row it is. */
  owner_id?: string;
  owner_username?: string;
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

/** Escape LIKE metacharacters so user input can never act as a wildcard. */
export function escapeLike(needle: string): string {
  return needle.replace(/[\\%_]/g, (m) => "\\" + m);
}

export async function listConcepts(opts: {
  user: ScopeUser;
  status?: string;
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<Concept[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  // Admin accounts transcend owner scoping: no owner filter at all.
  if (opts.user.role !== "admin") {
    params.push(opts.user.id);
    where.push(`c.owner_id = $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`c.status = $${params.length}`);
  }
  if (opts.category) {
    params.push(opts.category);
    where.push(`(c.category = $${params.length} OR c.category LIKE $${params.length} || '/%')`);
  }
  let sql = "SELECT c.*, ou.username AS owner_username FROM concepts c LEFT JOIN users ou ON ou.id = c.owner_id";
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY c.updated_at DESC";
  if (opts.limit) {
    params.push(opts.limit);
    sql += ` LIMIT $${params.length}`;
  }
  if (opts.offset) {
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

/**
 * Deterministic Chinese-aware collation. Plain a.name.localeCompare(b.name)
 * without a locale yields platform-dependent order (Windows sorts CJK by
 * pinyin, many Linux locales by code point), which breaks the category tree
 * across environments and CI. Pin the collation explicitly.
 */
const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "variant" });

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
    nodes.sort((a, b) => collator.compare(a.name, b.name));
    for (const n of nodes) {
      n.concepts.sort((a, b) => collator.compare(a.title, b.title));
      sortNodes(n.children);
    }
  };
  sortNodes(roots);
  rootConcepts.sort((a, b) => collator.compare(a.title, b.title));

  return { rootConcepts, roots };
}

// ---- Category folder management -------------------------------------------
// Folders are derived views over concepts.category (no folder entity), so
// rename/move rewrite the path prefix of every concept in the subtree and
// delete uncategorizes it. Version snapshots keep the classification history;
// updated_at is intentionally left untouched so bulk ops don't flood 最近更新.

/** True when `path` equals or lives under `ancestor` (slash-boundary aware). */
export function isSameOrDescendantPath(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(ancestor + "/");
}

/** Pure prefix rewrite for folder rename/move. Callers must only pass rows
 * matching `from` exactly or `from + "/*"` — the SQL filters on that. */
export function rewriteCategoryPath(category: string, from: string, to: string): string {
  return category === from ? to : to + category.slice(from.length);
}

export type CategoryOpResult =
  | { ok: true; affected: number }
  | { ok: false; code: "invalid" | "conflict"; message: string };

/** Rename a folder (rewrite `path` → `newPath`) for every concept in scope. */
export async function renameCategoryFolder(user: ScopeUser, path: string, newPath: string): Promise<CategoryOpResult> {
  const from = normalizeCategory(path);
  const to = normalizeCategory(newPath);
  if (!from || !to) return { ok: false, code: "invalid", message: "路径不能为空" };
  if (to === from) return { ok: true, affected: 0 };
  if (isSameOrDescendantPath(to, from)) {
    return { ok: false, code: "invalid", message: "不能把文件夹移动到它自身内部" };
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Non-admin users only see and move their own concepts; admin transcends
    // scoping, mirroring listConcepts.
    const ownerClauseRead = user.role === "admin" ? "" : " AND owner_id = $3";
    const ownerClauseUpdate = user.role === "admin" ? "" : " AND owner_id = $4";
    const scopeParams = user.role === "admin" ? [] : [user.id];

    // Target path must be free — silent folder merging would be surprising.
    const conflict = await client.query(
      `SELECT 1 FROM concepts WHERE (category = $1 OR category LIKE $2 || '/%')${ownerClauseRead} LIMIT 1`,
      [to, escapeLike(to), ...scopeParams]
    );
    if ((conflict.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "conflict", message: `目标文件夹「${to}」已存在` };
    }
    const source = await client.query(
      `SELECT 1 FROM concepts WHERE (category = $1 OR category LIKE $2 || '/%')${ownerClauseRead} LIMIT 1`,
      [from, escapeLike(from), ...scopeParams]
    );
    if ((source.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "invalid", message: `文件夹「${from}」不存在` };
    }
    const updated = await client.query(
      `UPDATE concepts
       SET category = CASE WHEN category = $1 THEN $2 ELSE $2 || substring(category FROM length($1) + 1) END
       WHERE (category = $1 OR category LIKE $3 || '/%')${ownerClauseUpdate}`,
      user.role === "admin" ? [from, to, escapeLike(from)] : [from, to, escapeLike(from), user.id]
    );
    await client.query("COMMIT");
    invalidateSearchCache();
    return { ok: true, affected: updated.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Delete a folder: uncategorize every concept in its subtree (content kept). */
export async function deleteCategoryFolder(user: ScopeUser, path: string): Promise<CategoryOpResult> {
  const from = normalizeCategory(path);
  if (!from) return { ok: false, code: "invalid", message: "路径不能为空" };

  const ownerClause = user.role === "admin" ? "" : " AND owner_id = $3";
  const res = await query(
    `UPDATE concepts SET category = NULL WHERE (category = $1 OR category LIKE $2 || '/%')${ownerClause}`,
    user.role === "admin" ? [from, escapeLike(from)] : [from, escapeLike(from), user.id]
  );
  invalidateSearchCache();
  return { ok: true, affected: res.rowCount ?? 0 };
}

export async function getConceptDetail(id: string, user: ScopeUser): Promise<ConceptDetail | null> {
  const { rows } =
    user.role === "admin"
      ? await query<Concept>(
          "SELECT c.*, ou.username AS owner_username FROM concepts c LEFT JOIN users ou ON ou.id = c.owner_id WHERE c.id = $1",
          [id]
        )
      : await query<Concept>(
          "SELECT c.*, ou.username AS owner_username FROM concepts c LEFT JOIN users ou ON ou.id = c.owner_id WHERE c.id = $1 AND c.owner_id = $2",
          [id, user.id]
        );
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

/** Cached probe: is the pgroonga extension installed in this database? */
let pgroongaAvailable: boolean | null = null;
async function hasPgroonga(): Promise<boolean> {
  if (pgroongaAvailable === null) {
    try {
      const { rows } = await query<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_extension WHERE extname = 'pgroonga'"
      );
      pgroongaAvailable = Number(rows[0]?.count ?? 0) > 0;
    } catch {
      pgroongaAvailable = false;
    }
  }
  return pgroongaAvailable;
}

// Repeat searches (UI resubmits, MCP agent loops, back-navigation re-renders)
// hit the same needle within seconds. A small TTL cache turns those into ~0ms.
// Cleared on any concept mutation — search text only changes through those.
const searchCache = new Map<string, { at: number; rows: SearchResult[] }>();
const SEARCH_CACHE_TTL = 60_000;
const SEARCH_CACHE_MAX = 200;

function invalidateSearchCache(): void {
  searchCache.clear();
}

export async function searchConcepts(user: ScopeUser, q: string, limit = 20): Promise<SearchResult[]> {
  const needle = q.trim().slice(0, 200);
  if (!needle) return [];

  const cacheKey = `${user.id}:${user.role}|${needle}|${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) {
    return cached.rows;
  }

  // Tokenize on whitespace/punctuation. Every token must appear in
  // title/description/body — AND semantics the raw-needle ILIKE cannot
  // express — and the score gains a token-coverage term.
  const tokens = needle.split(/[\s,，。;；:：、|/\\]+/).filter(Boolean);
  const tokenCount = tokens.length;

  const hasAscii = /[a-z0-9]/i.test(needle);
  // pg_trgm needs at least 3 characters to form trigrams.
  const hasTrigrams = needle.length >= 3;
  const pgroonga = await hasPgroonga();

  // $1 = ownerId, then one LIKE param per token, then full-needle LIKE,
  // prefix, raw needle, limit; role is appended last for the admin bypass.
  const params: unknown[] = [user.id];
  const tokenConds: string[] = [];
  const coverageTerms: string[] = [];
  for (const tok of tokens) {
    params.push(`%${escapeLike(tok)}%`);
    const p = `$${params.length}`;
    tokenConds.push(`(c.title ILIKE ${p} OR c.description ILIKE ${p} OR v.body_markdown ILIKE ${p})`);
    coverageTerms.push(
      `CASE WHEN c.title ILIKE ${p} OR c.description ILIKE ${p} OR v.body_markdown ILIKE ${p} THEN 1 ELSE 0 END`
    );
  }
  params.push(`%${escapeLike(needle)}%`);
  const likeParam = `$${params.length}`;
  params.push(`${escapeLike(needle)}%`);
  const prefixParam = `$${params.length}`;
  params.push(needle);
  const qParam = `$${params.length}`;
  params.push(limit);
  const limitParam = `$${params.length}`;
  let ownerClause = "c.owner_id = $1";
  if (user.role === "admin") {
    params.push(user.role);
    ownerClause = `($${params.length}::text = 'admin' OR c.owner_id = $1)`;
  }

  // WHERE branches: strict token AND is the primary path; FTS (ASCII-only),
  // trgm fuzzy (>=3 chars), and PGroonga (when installed) add recall.
  const branches: string[] = [`(${tokenConds.join(" AND ")})`];
  if (hasAscii) {
    branches.push(`v.content_tsv @@ websearch_to_tsquery('simple', ${qParam})`);
  }
  if (hasTrigrams) {
    // `%` and `%>` (query on the right) drive the GIN trgm index; the
    // per-session thresholds are lowered below so partial matches survive.
    branches.push(`c.title % ${qParam} OR v.body_markdown % ${qParam} OR v.body_markdown %> ${qParam}`);
  }
  if (pgroonga) {
    // `&@` = all keywords with a CJK-aware bigram tokenizer; no query
    // syntax, so arbitrary user input cannot raise a parse error.
    branches.push(`v.body_markdown &@ ${qParam} OR c.title &@ ${qParam} OR COALESCE(c.description, '') &@ ${qParam}`);
  }

  const sql = `
    SELECT
      c.id, c.type, c.title, c.description, c.status, c.tags,
      c.current_version, c.created_at, c.updated_at,
      c.owner_id, ou.username AS owner_username,
      -- Search results only ever render a ~2-line preview (UI) or feed a
      -- truncating client (MCP bodyPreview); shipping full markdown grew the
      -- payload 5-10x. Return a match-anchored window capped at 500 chars —
      -- falls back to the head of the body when the raw needle itself does
      -- not appear (token-only matches).
      substring(
        v.body_markdown from greatest(1, position(lower(${qParam}) in lower(v.body_markdown)) - 120) for 500
      ) AS body_markdown,
      (
        (CASE WHEN c.title = ${qParam} THEN 100 ELSE 0 END)
        + (CASE WHEN c.title ILIKE ${prefixParam} THEN 40 ELSE 0 END)
        + (CASE WHEN c.title ILIKE ${likeParam} THEN 30 ELSE 0 END)
        + (CASE WHEN v.body_markdown ILIKE ${likeParam} THEN 15 ELSE 0 END)
        + (CASE WHEN c.description ILIKE ${likeParam} THEN 8 ELSE 0 END)
        + (${coverageTerms.join(" + ")}) * 20.0 / ${tokenCount}
        ${hasTrigrams ? `+ (similarity(c.title, ${qParam}) * 50)
        + (word_similarity(${qParam}, v.body_markdown) * 20)
        + (similarity(COALESCE(c.description, ''), ${qParam}) * 12)` : ""}
        				${hasAscii ? `+ COALESCE(ts_rank('{0.1,0.2,0.4,1.0}'::real[], v.content_tsv, websearch_to_tsquery('simple', ${qParam})), 0)` : ""}
        ${pgroonga ? `+ COALESCE(pgroonga_score(v), 0) * 15
        + COALESCE(pgroonga_score(c), 0) * 30` : ""}
      ) AS score
    FROM concepts c
    LEFT JOIN users ou ON ou.id = c.owner_id
    JOIN concept_versions v
      ON v.concept_id = c.id AND v.version_number = c.current_version
    WHERE ${ownerClause} AND (${branches.join(" OR ")})
    ORDER BY score DESC, c.updated_at DESC
    LIMIT ${limitParam}
  `;

  // SET LOCAL keeps the thresholds session-scoped: the pooled connection is
  // returned clean after COMMIT/ROLLBACK.
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (hasTrigrams) {
      await client.query("SET LOCAL pg_trgm.similarity_threshold = 0.1");
      await client.query("SET LOCAL pg_trgm.word_similarity_threshold = 0.4");
    }
    // A named statement is parsed and planned ONCE per pooled connection;
    // repeat executions skip parse+plan entirely. Measured on this schema:
    // planning the multi-engine SQL costs ~65ms cold vs ~0.7ms execution, so
    // unnamed queries re-paid that on every search after a cold connect.
    // The text is deterministic per (engine flags, token count), so the name
    // cannot collide with different SQL. Connections are replaced on deploy,
    // which naturally invalidates old prepared statements.
    const stmtName = `search_v1_${hasAscii ? 1 : 0}${hasTrigrams ? 1 : 0}${pgroonga ? 1 : 0}_${tokenCount}`;
    const { rows } = await client.query<SearchResult>({ name: stmtName, text: sql, values: params as never[] });
    await client.query("COMMIT");
    if (searchCache.size >= SEARCH_CACHE_MAX) {
      const oldest = searchCache.keys().next().value;
      if (oldest !== undefined) searchCache.delete(oldest);
    }
    searchCache.set(cacheKey, { at: Date.now(), rows });
    return rows;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function createConcept(input: ConceptInput, user: { id: string; username: string }): Promise<string> {
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
      "INSERT INTO concepts (owner_id, type, title, description, category, tags, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [user.id, type, title, description, category, tags, status]
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
      [conceptId, title, description, category, tags, status, type, body, contentHash, `human:${user.username}`]
    );
    await client.query("COMMIT");
    invalidateSearchCache();
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
      invalidateSearchCache();
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
    invalidateSearchCache();
    return { version: nextVersion, created: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteConcept(id: string, user: ScopeUser): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Ownership check inside the same transaction that deletes (no TOCTOU),
    // and collect attachment disk keys before the CASCADE wipes the rows.
    // Admin accounts may delete any user's concept.
    const owned =
      user.role === "admin"
        ? await client.query("SELECT 1 FROM concepts WHERE id = $1", [id])
        : await client.query("SELECT 1 FROM concepts WHERE id = $1 AND owner_id = $2", [id, user.id]);
    if (owned.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    const atts = await client.query<{ storage_key: string }>(
      "SELECT storage_key FROM attachments WHERE concept_id = $1",
      [id]
    );
    const res =
      user.role === "admin"
        ? await client.query("DELETE FROM concepts WHERE id = $1 RETURNING id", [id])
        : await client.query("DELETE FROM concepts WHERE id = $1 AND owner_id = $2 RETURNING id", [id, user.id]);
    await client.query("COMMIT");
    const deleted = (res.rowCount ?? 0) > 0;
    // Remove disk bytes after the DB commit; any failure is logged, and the
    // orphan is recoverable via the reconcile script.
    if (deleted) {
      invalidateSearchCache();
      for (const a of atts.rows) {
        await deleteAttachmentFile(a.storage_key);
      }
    }
    return deleted;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface Source {
  id: string;
  source_type: string;
  original_name: string | null;
  content_hash: string;
  created_at: string;
}

export async function listSources(user: ScopeUser): Promise<Source[]> {
  const { rows } = await query<Source>(
    `SELECT s.id, s.source_type, s.original_name, s.content_hash, s.created_at
     FROM sources s
     JOIN concepts c ON c.id = s.concept_id
     ${user.role === "admin" ? "" : "WHERE c.owner_id = $1"}
     ORDER BY s.created_at DESC LIMIT 200`,
    user.role === "admin" ? [] : [user.id]
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

export async function listConceptsForExport(user: ScopeUser): Promise<ExportConcept[]> {
  const { rows } = await query<ExportConcept>(`
    SELECT
      c.id, c.type, c.title, c.description, c.category, c.status, c.tags,
      c.current_version, c.updated_at,
      v.body_markdown, v.content_hash, v.generated_by, v.created_at AS version_created_at
    FROM concepts c
    JOIN concept_versions v
      ON v.concept_id = c.id AND v.version_number = c.current_version
    ${user.role === "admin" ? "" : "WHERE c.owner_id = $1"}
    ORDER BY c.updated_at DESC
  `, user.role === "admin" ? [] : [user.id]);
  return rows;
}