import { createHash } from "node:crypto";
import { getPool, query } from "./db";
import { deleteAttachmentFile } from "./attachments";
import type { ScopeUser } from "./requireUser";
import {
  cachedQueryVector,
  conceptRowsForIds,
  hasSemanticSearch,
  queueConceptEmbedding,
  rerankWithSemantic,
  semanticCandidates,
} from "./semantic";
import { BM25_B, BM25_K1, DEPRECATED_FACTOR, tokenizeQuery } from "./bm25";
import { logRetrievalHits, logSearch, logWhereClause, type LogFilter } from "./logs";
import { operatorFilterClauses, parseSearchQuery } from "./search-syntax";

/** Thrown when a concept lookup by id finds no row (typed 404, not string-match). */
export class NotFoundError extends Error {}

/** Thrown when a create would store a byte-identical duplicate of an existing
 * concept (same current-version body hash inside the caller's scope). Carries
 * the existing row so the API can answer 409 and point at it. Exact-content
 * dedup is the book's §3.3.3.2 "去重、合并" principle applied at write time;
 * near-duplicates stay a human/search judgment. */
export class DuplicateBodyError extends Error {
  constructor(
    public readonly existingId: string,
    public readonly existingTitle: string,
  ) {
    super(`内容与已有条目「${existingTitle}」完全相同，请直接编辑该条目`);
    this.name = "DuplicateBodyError";
  }
}

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
  /** Soft-delete marker (回收站). Live reads across lib filter this to NULL;
   * only the trash surface and the detail page (restore banner) see a value. */
  deleted_at?: string | null;
  /** Populated on list/detail/search reads; lets an admin tell whose row it is. */
  owner_id?: string;
  owner_username?: string;
  /** Files uploaded under this concept. Populated by a COUNT subquery on
   * list/detail/search reads; never mutated by hand. */
  attachment_count: number;
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
  /** Version-row provenance marker; defaults to `human:<username>`. Ingest
   * pipelines pass e.g. `llm:ingest:<model>` for machine-created versions. */
  generatedBy?: string;
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
  const where: string[] = ["c.deleted_at IS NULL"];
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
  let sql =
    "SELECT c.*, ou.username AS owner_username, " +
    "(SELECT count(*) FROM attachments a WHERE a.concept_id = c.id)::int AS attachment_count " +
    "FROM concepts c LEFT JOIN users ou ON ou.id = c.owner_id";
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

/** Total concept count with the same owner/category scope as listConcepts —
 * feeds the knowledge list pager (共 N 条 / 共 Y 页). */
export async function countConcepts(user: ScopeUser, category?: string): Promise<number> {
  const params: unknown[] = [];
  const where: string[] = ["c.deleted_at IS NULL"];
  if (user.role !== "admin") {
    params.push(user.id);
    where.push(`c.owner_id = $${params.length}`);
  }
  if (category) {
    params.push(category);
    where.push(`(c.category = $${params.length} OR c.category LIKE $${params.length} || '/%')`);
  }
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM concepts c WHERE ${where.join(" AND ")}`,
    params,
  );
  return rows[0]?.n ?? 0;
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

export function buildCategoryTree(
  concepts: Concept[],
  extraFolderPaths: string[] = [],
): {
  rootConcepts: Concept[];
  roots: CategoryTreeNode[];
} {
  const roots: CategoryTreeNode[] = [];
  const rootConcepts: Concept[] = [];
  const map = new Map<string, CategoryTreeNode>();

  // Walk a slash path creating every missing node; returns the leaf.
  const ensurePath = (path: string): CategoryTreeNode => {
    const segs = path.split("/");
    let siblings = roots;
    let fullPath = "";
    let node: CategoryTreeNode = { name: "", path: "", concepts: [], children: [] };
    for (let i = 0; i < segs.length; i++) {
      fullPath = fullPath ? `${fullPath}/${segs[i]}` : segs[i];
      const existing = map.get(fullPath);
      if (!existing) {
        node = { name: segs[i], path: fullPath, concepts: [], children: [] };
        map.set(fullPath, node);
        siblings.push(node);
      } else {
        node = existing;
      }
      siblings = node.children;
    }
    return node;
  };

  // Empty-folder rows exist without concepts and must show up in the tree.
  for (const p of extraFolderPaths) {
    const path = normalizeCategory(p);
    if (path) ensurePath(path);
  }

  for (const c of concepts) {
    const path = normalizeCategory(c.category);
    if (!path) {
      rootConcepts.push(c);
      continue;
    }
    ensurePath(path).concepts.push(c);
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
  { ok: true; affected: number } | { ok: false; code: "invalid" | "conflict"; message: string };

/** Rename a folder (rewrite `path` → `newPath`) for every concept in scope. */
export async function renameCategoryFolder(
  user: ScopeUser,
  path: string,
  newPath: string,
): Promise<CategoryOpResult> {
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
    // Both entity forms can occupy it: empty-folder rows and concept categories.
    const conflict = await client.query(
      `SELECT 1 FROM concepts WHERE (category = $1 OR category LIKE $2 || '/%')${ownerClauseRead} LIMIT 1`,
      [to, escapeLike(to), ...scopeParams],
    );
    if ((conflict.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "conflict", message: `目标文件夹「${to}」已存在` };
    }
    const conflictFolder = await client.query(
      `SELECT 1 FROM folders WHERE (path = $1 OR path LIKE $2 || '/%')${ownerClauseRead} LIMIT 1`,
      [to, escapeLike(to), ...scopeParams],
    );
    if ((conflictFolder.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "conflict", message: `目标文件夹「${to}」已存在` };
    }
    // A folder exists when concepts, folder rows, or both occupy the subtree.
    const source = await client.query(
      `SELECT 1 FROM concepts WHERE (category = $1 OR category LIKE $2 || '/%')${ownerClauseRead} LIMIT 1`,
      [from, escapeLike(from), ...scopeParams],
    );
    let exists = (source.rowCount ?? 0) > 0;
    if (!exists) {
      const sourceFolder = await client.query(
        `SELECT 1 FROM folders WHERE (path = $1 OR path LIKE $2 || '/%')${ownerClauseRead} LIMIT 1`,
        [from, escapeLike(from), ...scopeParams],
      );
      exists = (sourceFolder.rowCount ?? 0) > 0;
    }
    if (!exists) {
      await client.query("ROLLBACK");
      return { ok: false, code: "invalid", message: `文件夹「${from}」不存在` };
    }
    const updated = await client.query(
      `UPDATE concepts
       SET category = CASE WHEN category = $1 THEN $2 ELSE $2 || substring(category FROM length($1) + 1) END
       WHERE (category = $1 OR category LIKE $3 || '/%')${ownerClauseUpdate}`,
      user.role === "admin" ? [from, to, escapeLike(from)] : [from, to, escapeLike(from), user.id],
    );
    // Rewrite the entity form of the folder (and its empty subfolders) too.
    await client.query(
      `UPDATE folders
       SET path = CASE WHEN path = $1 THEN $2 ELSE $2 || substring(path FROM length($1) + 1) END
       WHERE (path = $1 OR path LIKE $3 || '/%')${ownerClauseUpdate}`,
      user.role === "admin" ? [from, to, escapeLike(from)] : [from, to, escapeLike(from), user.id],
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

/** Delete a folder: uncategorize every concept in its subtree (content kept)
 * and remove the entity form of the folder subtree. */
export async function deleteCategoryFolder(
  user: ScopeUser,
  path: string,
): Promise<CategoryOpResult> {
  const from = normalizeCategory(path);
  if (!from) return { ok: false, code: "invalid", message: "路径不能为空" };

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const ownerClauseUpdate = user.role === "admin" ? "" : " AND owner_id = $3";
    const ownerClauseRead = user.role === "admin" ? "" : " AND owner_id = $3";
    const scopeParams = user.role === "admin" ? [] : [user.id];
    const updated = await client.query(
      `UPDATE concepts SET category = NULL WHERE (category = $1 OR category LIKE $2 || '/%')${ownerClauseUpdate}`,
      user.role === "admin" ? [from, escapeLike(from)] : [from, escapeLike(from), user.id],
    );
    await client.query(
      `DELETE FROM folders WHERE (path = $1 OR path LIKE $2 || '/%')${ownerClauseRead}`,
      [from, escapeLike(from), ...scopeParams],
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

/** Folder paths stored as entities (empty folders); the tree unions these
 * with concept-derived paths. */
export async function listFolders(user: ScopeUser): Promise<string[]> {
  const { rows } =
    user.role === "admin"
      ? await query<{ path: string }>("SELECT path FROM folders")
      : await query<{ path: string }>("SELECT path FROM folders WHERE owner_id = $1", [user.id]);
  return rows.map((r) => r.path);
}

/** Create an empty folder. Rejects paths already occupied in either form. */
export async function createFolder(user: ScopeUser, path: string): Promise<CategoryOpResult> {
  const to = normalizeCategory(path);
  if (!to) return { ok: false, code: "invalid", message: "路径不能为空" };

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const ownerClauseRead = user.role === "admin" ? "" : " AND owner_id = $2";
    const scopeParams = user.role === "admin" ? [] : [user.id];
    const dupFolder = await client.query(
      `SELECT 1 FROM folders WHERE (path = $1 OR path LIKE $2 || '/%')${ownerClauseRead} LIMIT 1`,
      [to, escapeLike(to), ...scopeParams],
    );
    const dupConcept = await client.query(
      `SELECT 1 FROM concepts WHERE (category = $1 OR category LIKE $2 || '/%')${ownerClauseRead} LIMIT 1`,
      [to, escapeLike(to), ...scopeParams],
    );
    if ((dupFolder.rowCount ?? 0) > 0 || (dupConcept.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "conflict", message: `文件夹「${to}」已存在` };
    }
    try {
      await client.query("INSERT INTO folders (owner_id, path) VALUES ($1, $2)", [user.id, to]);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        await client.query("ROLLBACK");
        return { ok: false, code: "conflict", message: `文件夹「${to}」已存在` };
      }
      throw err;
    }
    await client.query("COMMIT");
    return { ok: true, affected: 1 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getConceptDetail(id: string, user: ScopeUser): Promise<ConceptDetail | null> {
  const { rows } =
    user.role === "admin"
      ? await query<Concept>(
          `SELECT c.*, ou.username AS owner_username,
            (SELECT count(*) FROM attachments a WHERE a.concept_id = c.id)::int AS attachment_count
          FROM concepts c LEFT JOIN users ou ON ou.id = c.owner_id WHERE c.id = $1`,
          [id],
        )
      : await query<Concept>(
          `SELECT c.*, ou.username AS owner_username,
            (SELECT count(*) FROM attachments a WHERE a.concept_id = c.id)::int AS attachment_count
          FROM concepts c LEFT JOIN users ou ON ou.id = c.owner_id WHERE c.id = $1 AND c.owner_id = $2`,
          [id, user.id],
        );
  if (rows.length === 0) return null;
  const concept = rows[0];
  const versions = await query<ConceptVersion>(
    "SELECT * FROM concept_versions WHERE concept_id = $1 ORDER BY version_number DESC",
    [id],
  );
  return { ...concept, versions: versions.rows };
}

export interface SearchResult extends Concept {
  body_markdown: string;
  score: number;
  /** Cosine similarity (1 − distance) to the query embedding, 0–1. Only
   * present when semantic search ran; the MCP write-path judge uses it as a
   * scale-independent relatedness signal since fused scores aren't comparable
   * across lexical and semantic-only rows. */
  similarity?: number;
}

// Repeat searches (UI resubmits, MCP agent loops, back-navigation re-renders)
// hit the same needle within seconds. A small TTL cache turns those into ~0ms.
// Cleared on any concept mutation — search text only changes through those.
const searchCache = new Map<string, { at: number; results: SearchResult[]; total: number }>();
const SEARCH_CACHE_TTL = Number(process.env.SEARCH_CACHE_TTL_MS ?? 60_000);
const SEARCH_CACHE_MAX = Number(process.env.SEARCH_CACHE_MAX ?? 200);

/** Drop every cached search result — called on any concept mutation, and by
 * lib/summary when it backfills a description after the fact. */
export function invalidateSearchCache(): void {
  searchCache.clear();
}

export async function searchConcepts(
  user: ScopeUser,
  q: string,
  limit = 20,
  offset = 0,
  // Caller surface recorded in search_logs: ui | api | ingest.
  source = "api",
): Promise<{ results: SearchResult[]; total: number }> {
  const startedAt = Date.now();
  // Which path answered: bm25 | trgm-fallback | semantic-only ("none" only
  // when every stage failed). Cache hits skip logging entirely — the same
  // query was logged at most SEARCH_CACHE_TTL ago.
  let mode = "none";
  // Operators (tag:/category:/status:) are stripped from the matching text;
  // the RAW query keys the cache and rides search_logs verbatim.
  const parsed = parseSearchQuery(q);
  const rawKey = q.trim().slice(0, 200);
  const needle = parsed.text.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!needle && parsed.tags.length === 0 && !parsed.category && !parsed.status) {
    return { results: [], total: 0 };
  }

  const cacheKey = `${user.id}:${user.role}|${rawKey}|${limit}|${offset}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) {
    return { results: cached.results, total: cached.total };
  }
  // Semantic stage needs a query vector; embed CONCURRENTLY with the lexical
  // query — the two are independent, and the embedding HTTP round trip
  // (300-700ms cross-border) otherwise rides the critical path. Cache hits
  // above return early and never trigger it. Failure degrades to
  // lexical-only: logged here, the stage below sees undefined.
  const embedPromise =
    offset === 0 && needle.length > 0 && (await hasSemanticSearch())
      ? cachedQueryVector(needle, {
          purpose: "search-embed",
          userId: user.id,
          apiKeyId: user.apiKeyId,
        }).catch((err: unknown) => {
          console.error(
            "[semantic] recall failed, lexical only:",
            err instanceof Error ? err.message : err,
          );
          return undefined;
        })
      : null;

  const isAdmin = user.role === "admin";
  // BM25 terms: lowercase ASCII word runs + CJK bigrams (TokenBigram shape).
  // The term list travels as ONE array parameter, so the statement text — and
  // with it the named prepared plan — never varies with term count.
  const terms = tokenizeQuery(needle);

  // $1 = ownerId, $2 = terms[], $3 = needle (preview anchor), $4 = limit,
  // $5 = offset; the role check is appended last for the admin bypass, then
  // operator filters (values only — clause presence is encoded in the
  // prepared-statement name, so each shape plans once per connection).
  const params: unknown[] = [user.id, terms, needle, limit, offset];
  const ownerClause = isAdmin
    ? `($${(params.push(user.role), params.length)}::text = 'admin' OR c.owner_id = $1)`
    : "c.owner_id = $1";
  const filterClauses = operatorFilterClauses(parsed, params);
  const filterSql = filterClauses.length ? " AND " + filterClauses.join(" AND ") : "";
  const filterShape = `${parsed.tags.length ? "T" : ""}${parsed.category ? "C" : ""}${parsed.status ? "S" : ""}`;

  const sql = `
    WITH corpus AS MATERIALIZED (
      SELECT c.id, c.type, c.title, c.description, c.category, c.status, c.tags,
             c.current_version, c.created_at, c.updated_at, c.owner_id,
             ou.username AS owner_username,
             (SELECT count(*) FROM attachments a WHERE a.concept_id = c.id)::int AS attachment_count,
             v.body_markdown,
             (char_length(c.title) + char_length(COALESCE(c.description, ''))
               + char_length(v.body_markdown))::real AS doc_len
      FROM concepts c
      LEFT JOIN users ou ON ou.id = c.owner_id
      JOIN concept_versions v
        ON v.concept_id = c.id AND v.version_number = c.current_version
      WHERE c.deleted_at IS NULL AND ${ownerClause}${filterSql}
    ),
    -- Corpus-wide document frequency per term, using the same lower()ed
    -- substring definition as tf below, so idf and tf agree.
    df AS (
      SELECT t.term, count(*)::real AS df
      FROM corpus, unnest($2::text[]) AS t(term)
      WHERE position(t.term IN lower(corpus.title)) > 0
         OR position(t.term IN lower(COALESCE(corpus.description, ''))) > 0
         OR position(t.term IN lower(corpus.body_markdown)) > 0
      GROUP BY t.term
    ),
    scored AS (
      SELECT c.*,
        (SELECT COALESCE(sum(
           ln(1 + (s.n - d.df + 0.5) / (d.df + 0.5))
           * tfx.tf * (${BM25_K1} + 1)
           / (tfx.tf + ${BM25_K1} * (1 - ${BM25_B} + ${BM25_B} * c.doc_len / s.avgdl))
         ), 0)
         FROM unnest($2::text[]) AS t(term)
         JOIN df d ON d.term = t.term
         CROSS JOIN LATERAL (
           SELECT GREATEST(
             (char_length(c.title) - char_length(replace(lower(c.title), t.term, '')))
           + (char_length(COALESCE(c.description, ''))
               - char_length(replace(lower(COALESCE(c.description, '')), t.term, '')))
           + (char_length(c.body_markdown) - char_length(replace(lower(c.body_markdown), t.term, '')))
           , 0)::real / GREATEST(char_length(t.term), 1) AS tf
         ) tfx
         CROSS JOIN (SELECT count(*)::real AS n, COALESCE(avg(doc_len), 1)::real AS avgdl FROM corpus) s
        ) AS bm25
      FROM corpus c
    )
    SELECT id, type, title, description, category, status, tags, current_version, created_at, updated_at,
           owner_id, owner_username, attachment_count,
           -- Search results only ever render a ~2-line preview (UI) or feed a
           -- truncating client (MCP bodyPreview); shipping full markdown grew
           -- the payload 5-10x. Return a match-anchored window capped at 500
           -- chars — falls back to the head of the body when the raw needle
           -- itself does not appear (term-only matches).
           substring(
             body_markdown from greatest(1, position(lower($3) in lower(body_markdown)) - 120) for 500
           ) AS body_markdown,
           -- Total match count for pagination (evaluated over the full window).
           count(*) over () AS total_count,
           -- 失效内容降权(§3.3.3.2): deprecated stays findable but is scaled
           -- out of the front rows; ordering and emitted score agree.
           round((bm25 * (CASE WHEN status = 'deprecated' THEN ${DEPRECATED_FACTOR} ELSE 1 END))::numeric, 2)::float8 AS score
    FROM scored
    WHERE bm25 > 0
    ORDER BY score DESC, updated_at DESC
    LIMIT $4 OFFSET $5
  `;

  // A named statement is parsed and planned ONCE per pooled connection;
  // repeat executions skip parse+plan entirely (the multi-engine SQL used to
  // cost ~65ms planning per cold search). The text is deterministic per
  // scope shape; connections are replaced on deploy, which invalidates old
  // prepared statements naturally.
  let lexicalResults: SearchResult[] = [];
  let total = 0;
  if (terms.length === 0) {
    // Operators only (no free text): plain scoped listing, newest first —
    // the natural "status:draft" / "tag:pg" filter-listing query. Own param
    // array: the BM25 base carries $2/$3 (terms / preview anchor) that this
    // shape never references, and pg cannot type unused parameters.
    const fparams: unknown[] = [user.id, limit, offset];
    const fOwner = isAdmin
      ? `($${(fparams.push(user.role), fparams.length)}::text = 'admin' OR c.owner_id = $1)`
      : "c.owner_id = $1";
    const fClauses = operatorFilterClauses(parsed, fparams);
    const fWhere = fClauses.length ? " AND " + fClauses.join(" AND ") : "";
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const stmtName = `search_filter_v1_${isAdmin ? "admin" : "user"}_${filterShape}`;
      const { rows } = await client.query<SearchResult & { total_count: string }>({
        name: stmtName,
        text: `
          SELECT c.id, c.type, c.title, c.description, c.category, c.status, c.tags,
                 c.current_version, c.created_at, c.updated_at, c.owner_id,
                 ou.username AS owner_username,
                 (SELECT count(*) FROM attachments a WHERE a.concept_id = c.id)::int AS attachment_count,
                 substring(v.body_markdown from 1 for 500) AS body_markdown,
                 count(*) over () AS total_count,
                 0::float8 AS score
          FROM concepts c
          LEFT JOIN users ou ON ou.id = c.owner_id
          JOIN concept_versions v
            ON v.concept_id = c.id AND v.version_number = c.current_version
          WHERE c.deleted_at IS NULL AND ${fOwner}${fWhere}
          ORDER BY c.updated_at DESC
          LIMIT $2 OFFSET $3
        `,
        values: fparams as never[],
      });
      await client.query("COMMIT");
      total = rows.length > 0 ? Number(rows[0].total_count) : 0;
      lexicalResults = rows.map(({ total_count, ...r }) => {
        void total_count;
        return r;
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    mode = "operators";
  } else {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const stmtName = `search_bm25_v1_${isAdmin ? "admin" : "user"}_${filterShape || "plain"}`;
      const { rows } = await client.query<SearchResult & { total_count: string }>({
        name: stmtName,
        text: sql,
        values: params as never[],
      });
      await client.query("COMMIT");
      // count(*) over() rides on the rows; an offset past the end has no rows
      // and therefore reports total 0 — the UI simply shows an empty page.
      total = rows.length > 0 ? Number(rows[0].total_count) : 0;
      lexicalResults = rows.map(({ total_count, ...r }) => {
        void total_count;
        return r;
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    if (lexicalResults.length > 0) mode = "bm25";
  }

  // Typo tolerance: exact-term BM25 misses near-miss strings ("数所库" vs
  // "数据库" share no bigram); a trigram pass over the raw needle surfaces
  // those. Page-1-only — this degenerate window has no pagination count.
  if (lexicalResults.length === 0 && needle.length >= 3) {
    try {
      lexicalResults = await searchTrgmFuzzy(user, needle, limit);
      total = lexicalResults.length;
      mode = "trgm-fallback";
    } catch (err) {
      console.error("[search] trgm fallback failed:", err instanceof Error ? err.message : err);
    }
  }

  // Semantic recall expansion (pgvector, entirely optional), first page only
  // so deeper pages keep predictable paging. Runs outside the pooled
  // connection (the embedding HTTP call must not hold one); any failure
  // degrades to lexical-only. Two modes: with a lexical window, fuse both
  // lists via RRF; when the window is empty — the exact case lexical search
  // cannot cover (paraphrased queries, no keyword overlap) — answer from the
  // nearest embeddings alone.
  let results = lexicalResults;
  let totalOut = total;
  const queryVector = embedPromise ? await embedPromise : undefined;
  if (queryVector) {
    try {
      if (lexicalResults.length > 0) {
        results = await rerankWithSemantic(
          user,
          needle,
          lexicalResults,
          limit,
          queryVector,
          parsed,
        );
      } else {
        const semCands = await semanticCandidates(user, queryVector, limit, parsed);
        const ids = semCands.map((c) => c.id);
        const semRows = ids.length ? await conceptRowsForIds(user, ids) : [];
        // Nearest-first ordering: cosine distance ranks the semantic list;
        // the raw similarity also rides on the row for downstream judges.
        const order = new Map(ids.map((id, i) => [id, i]));
        const simById = new Map(semCands.map((c) => [c.id, c.similarity]));
        semRows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        results = semRows.map((r, i) => ({
          ...r,
          score: Math.max(1, 100 - i * 5),
          similarity: simById.get(r.id),
        }));
        // count(*) over() reported 0 for the empty window; the semantic list
        // is the honest match count for this (page-1-only) path.
        totalOut = results.length;
        mode = "semantic-only";
      }
    } catch (err) {
      console.error(
        "[semantic] recall failed, lexical only:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 去重后的 top-k: every path above already yields unique ids (one corpus
  // row per concept; RRF keys by id) — enforce it regardless of path so the
  // returned contract is always one row per concept, fused order preserved.
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const r of results) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    deduped.push(r);
  }
  results = deduped;
  // Per-entry retrieval counter (ui|api only — the ingest dedup probe must
  // not inflate the curation signal; cache hits never reach this line).
  // Feeds /stats hot entries + the never-retrieved report. Fire-and-forget.
  if (source !== "ingest") logRetrievalHits(results.map((r) => r.id));
  // Usage record for /logs (query record page). Fire-and-forget; cache hits
  // above never reach this line.
  logSearch({
    userId: user.id,
    apiKeyId: user.apiKeyId,
    query: rawKey,
    source,
    mode,
    resultCount: results.length,
    total: totalOut,
    tookMs: Date.now() - startedAt,
  });

  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(cacheKey, { at: Date.now(), results, total: totalOut });
  return { results, total: totalOut };
}

/** Trigram fuzzy fallback for the empty BM25 window (typos, near-miss
 * strings). pg_trgm needs >=3 chars to form trigrams; callers gate on that.
 * Scores are similarity-weighted heuristics, deprecated entries scaled down
 * by the same factor as the BM25 path. */
async function searchTrgmFuzzy(
  user: ScopeUser,
  needle: string,
  limit: number,
): Promise<SearchResult[]> {
  // $1 = ownerId, $2 = needle, $3 = limit; role appended last for admin.
  const params: unknown[] = [user.id, needle, limit];
  const ownerClause =
    user.role === "admin"
      ? `($${(params.push(user.role), params.length)}::text = 'admin' OR c.owner_id = $1)`
      : "c.owner_id = $1";
  const sql = `
    SELECT c.id, c.type, c.title, c.description, c.status, c.tags,
           c.current_version, c.created_at, c.updated_at,
           c.owner_id, ou.username AS owner_username,
           (SELECT count(*) FROM attachments a WHERE a.concept_id = c.id)::int AS attachment_count,
           substring(
             v.body_markdown from greatest(1, position(lower($2) in lower(v.body_markdown)) - 120) for 500
           ) AS body_markdown,
           (
             (similarity(c.title, $2) * 50)
             + (word_similarity($2, v.body_markdown) * 20)
             + (similarity(COALESCE(c.description, ''), $2) * 12)
           ) * (CASE WHEN c.status = 'deprecated' THEN ${DEPRECATED_FACTOR} ELSE 1 END)::float8 AS score
    FROM concepts c
    LEFT JOIN users ou ON ou.id = c.owner_id
    JOIN concept_versions v
      ON v.concept_id = c.id AND v.version_number = c.current_version
    WHERE c.deleted_at IS NULL
      AND ${ownerClause}
      AND (c.title % $2 OR v.body_markdown % $2 OR v.body_markdown %> $2)
    ORDER BY score DESC, c.updated_at DESC
    LIMIT $3
  `;
  // SET LOCAL keeps the trgm thresholds session-scoped: the pooled
  // connection is returned clean after COMMIT/ROLLBACK.
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL pg_trgm.similarity_threshold = 0.1");
    await client.query("SET LOCAL pg_trgm.word_similarity_threshold = 0.4");
    const { rows } = await client.query<SearchResult>({
      name: "search_trgm_v1",
      text: sql,
      values: params as never[],
    });
    await client.query("COMMIT");
    return rows;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function createConcept(
  input: ConceptInput,
  user: { id: string; username: string; role: "user" | "admin" },
): Promise<string> {
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
    // Exact-body dedup within the caller's scope: a concept whose current
    // version already hashes identically wins; the create fails with 409.
    // Trashed concepts don't count — restoring them is the intended path, but
    // re-creating the content must also be possible once they're trashed.
    const dupBody = await client.query(
      `SELECT c.id, c.title FROM concepts c
       JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
       WHERE v.content_hash = $1 AND c.deleted_at IS NULL ${user.role === "admin" ? "" : "AND c.owner_id = $2"} LIMIT 1`,
      user.role === "admin" ? [contentHash] : [contentHash, user.id],
    );
    if (dupBody.rows.length > 0) {
      throw new DuplicateBodyError(dupBody.rows[0].id as string, dupBody.rows[0].title as string);
    }
    const inserted = await client.query(
      "INSERT INTO concepts (owner_id, type, title, description, category, tags, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [user.id, type, title, description, category, tags, status],
    );
    const conceptId = inserted.rows[0].id as string;
    // Raw-input traceability: link the source back to the new concept.
    await client.query(
      "INSERT INTO sources (concept_id, source_type, original_name, content, content_hash) VALUES ($1, $2, $3, $4, $5)",
      [conceptId, "text", title || null, body, contentHash],
    );
    // Version 1 carries a metadata snapshot so past versions stay reconstructable.
    await client.query(
      "INSERT INTO concept_versions (concept_id, version_number, title, description, category, tags, status, type, body_markdown, content_hash, generated_by) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [
        conceptId,
        title,
        description,
        category,
        tags,
        status,
        type,
        body,
        contentHash,
        input.generatedBy ?? `human:${user.username}`,
      ],
    );
    await client.query("COMMIT");
    invalidateSearchCache();
    queueConceptEmbedding({
      conceptId,
      ownerId: user.id,
      contentHash,
      title,
      description,
      body,
      userId: user.id,
    });
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
  username: string,
  /** Attribution for the write-path embedding sync (llm_calls row). */
  meta?: { userId?: string | null; apiKeyId?: string | null },
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
      "SELECT c.current_version, c.owner_id, v.content_hash FROM concepts c JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version WHERE c.id = $1 FOR UPDATE",
      [id],
    );
    if (cur.rows.length === 0) throw new NotFoundError("Concept not found");
    const currentVersion = cur.rows[0].current_version as number;
    const currentHash = cur.rows[0].content_hash as string;
    const ownerId = cur.rows[0].owner_id as string;

    if (contentHash === currentHash) {
      // 正文未变化：只更新元信息，不新增版本、不新增来源；同步刷新当前版本行的
      // 快照列，保证"最新版本行即最新元数据"不变量（也修正导出的 generated.at）。
      await client.query(
        "UPDATE concepts SET title = $2, description = $3, category = $4, tags = $5, type = $6, status = $7, updated_at = now() WHERE id = $1",
        [
          id,
          metadata.title,
          metadata.description,
          metadata.category,
          metadata.tags,
          metadata.type,
          metadata.status,
        ],
      );
      await client.query(
        "UPDATE concept_versions SET title = $2, description = $3, category = $4, tags = $5, status = $6, type = $7 WHERE concept_id = $1 AND version_number = (SELECT current_version FROM concepts WHERE id = $1)",
        [
          id,
          metadata.title,
          metadata.description,
          metadata.category,
          metadata.tags,
          metadata.status,
          metadata.type,
        ],
      );
      await client.query("COMMIT");
      invalidateSearchCache();
      return { version: currentVersion, created: false };
    }

    const nextVersion = currentVersion + 1;
    // 同概念、同正文哈希已有 source 记录时跳过，避免重复来源行。
    const dup = await client.query(
      "SELECT 1 FROM sources WHERE content_hash = $1 AND concept_id = $2 LIMIT 1",
      [contentHash, id],
    );
    if (!dup.rowCount) {
      await client.query(
        "INSERT INTO sources (concept_id, source_type, original_name, content, content_hash) VALUES ($1, $2, $3, $4, $5)",
        [id, "text", metadata.title || null, body, contentHash],
      );
    }
    await client.query(
      "INSERT INTO concept_versions (concept_id, version_number, title, description, category, tags, status, type, body_markdown, content_hash, generated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      [
        id,
        nextVersion,
        metadata.title,
        metadata.description,
        metadata.category,
        metadata.tags,
        metadata.status,
        metadata.type,
        body,
        contentHash,
        input.generatedBy ?? `human:${username}`,
      ],
    );
    await client.query(
      "UPDATE concepts SET current_version = $2, title = $3, description = $4, category = $5, tags = $6, type = $7, status = $8, updated_at = now() WHERE id = $1",
      [
        id,
        nextVersion,
        metadata.title,
        metadata.description,
        metadata.category,
        metadata.tags,
        metadata.type,
        metadata.status,
      ],
    );
    await client.query("COMMIT");
    invalidateSearchCache();
    queueConceptEmbedding({
      conceptId: id,
      ownerId,
      contentHash,
      title: metadata.title,
      description: metadata.description,
      body,
      userId: meta?.userId ?? null,
      apiKeyId: meta?.apiKeyId ?? null,
    });
    return { version: nextVersion, created: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function restoreConceptVersion(
  id: string,
  versionNumber: number,
  user: ScopeUser,
  username: string,
): Promise<SaveResult> {
  // Version rows are immutable, so "rollback" creates a NEW version from the
  // historical snapshot — nothing is rewritten, and the rollback itself is
  // undoable by rolling back again. Metadata comes from the old version's
  // snapshot, matching what the detail page showed at that version.
  const detail = await getConceptDetail(id, user);
  if (!detail) throw new NotFoundError("Concept not found");
  const v = detail.versions.find((row) => row.version_number === versionNumber);
  if (!v) throw new NotFoundError("Version not found");
  return addConceptVersion(
    id,
    {
      type: v.type ?? detail.type,
      title: v.title ?? detail.title,
      description: v.description ?? undefined,
      category: v.category ?? undefined,
      tags: v.tags,
      status: v.status ?? undefined,
      body: v.body_markdown,
    },
    username,
    { userId: user.id, apiKeyId: user.apiKeyId },
  );
}

export type TrashItem = Concept & { deleted_at: string };

/** Recycle bin listing: soft-deleted concepts only, newest deletion first. */
export async function listTrash(user: ScopeUser, limit = 100, offset = 0): Promise<TrashItem[]> {
  const params: unknown[] = [];
  let sql =
    "SELECT c.*, ou.username AS owner_username, " +
    "(SELECT count(*) FROM attachments a WHERE a.concept_id = c.id)::int AS attachment_count " +
    "FROM concepts c LEFT JOIN users ou ON ou.id = c.owner_id";
  const where: string[] = ["c.deleted_at IS NOT NULL"];
  if (user.role !== "admin") {
    params.push(user.id);
    where.push(`c.owner_id = $${params.length}`);
  }
  sql += " WHERE " + where.join(" AND ") + " ORDER BY c.deleted_at DESC";
  params.push(Math.min(Math.max(limit, 1), 200));
  sql += ` LIMIT $${params.length}`;
  if (offset) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }
  const { rows } = await query<TrashItem>(sql, params);
  return rows;
}

/** Soft delete: mark deleted_at; versions, attachments and sources all stay.
 * Every live read path filters these rows out, so the item vanishes from
 * lists/search/graph/export while remaining restorable. */
export async function trashConcept(id: string, user: ScopeUser): Promise<boolean> {
  const { rows } =
    user.role === "admin"
      ? await query<{ id: string }>(
          "UPDATE concepts SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
          [id],
        )
      : await query<{ id: string }>(
          "UPDATE concepts SET deleted_at = now() WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL RETURNING id",
          [id, user.id],
        );
  if (rows.length > 0) invalidateSearchCache();
  return rows.length > 0;
}

/** Undo a soft delete. */
export async function restoreConcept(id: string, user: ScopeUser): Promise<boolean> {
  const { rows } =
    user.role === "admin"
      ? await query<{ id: string }>(
          "UPDATE concepts SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id",
          [id],
        )
      : await query<{ id: string }>(
          "UPDATE concepts SET deleted_at = NULL WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL RETURNING id",
          [id, user.id],
        );
  if (rows.length > 0) invalidateSearchCache();
  return rows.length > 0;
}

export type PurgeResult = { ok: true } | { ok: false; reason: "not-found" | "not-trashed" };

/** Hard delete (原删除路径): only allowed on already-trashed concepts, so real
 * destruction is always a second, explicit step after the soft delete. CASCADE
 * wipes versions/attachments/embeddings; sources survive as audit rows. */
export async function purgeConcept(id: string, user: ScopeUser): Promise<PurgeResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Ownership check inside the same transaction that deletes (no TOCTOU),
    // and collect attachment disk keys before the CASCADE wipes the rows.
    // Admin accounts may purge any user's trashed concept.
    const owned =
      user.role === "admin"
        ? await client.query("SELECT 1 FROM concepts WHERE id = $1 AND deleted_at IS NOT NULL", [
            id,
          ])
        : await client.query(
            "SELECT 1 FROM concepts WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL",
            [id, user.id],
          );
    if (owned.rowCount === 0) {
      await client.query("ROLLBACK");
      // Distinguish "never existed / other owner" from "still live" for the API.
      const any =
        user.role === "admin"
          ? await client.query("SELECT 1 FROM concepts WHERE id = $1", [id])
          : await client.query("SELECT 1 FROM concepts WHERE id = $1 AND owner_id = $2", [
              id,
              user.id,
            ]);
      return { ok: false, reason: any.rowCount === 0 ? "not-found" : "not-trashed" };
    }
    const atts = await client.query<{ storage_key: string }>(
      "SELECT storage_key FROM attachments WHERE concept_id = $1",
      [id],
    );
    const res =
      user.role === "admin"
        ? await client.query("DELETE FROM concepts WHERE id = $1 RETURNING id", [id])
        : await client.query("DELETE FROM concepts WHERE id = $1 AND owner_id = $2 RETURNING id", [
            id,
            user.id,
          ]);
    await client.query("COMMIT");
    const deleted = (res.rowCount ?? 0) > 0;
    // Remove disk bytes after the DB commit; any failure is logged, and the
    // orphan is recoverable via the reconcile script.
    if (deleted) {
      invalidateSearchCache();
      for (const a of atts.rows) {
        await deleteAttachmentFile(a.storage_key);
      }
      return { ok: true };
    }
    return { ok: false, reason: "not-found" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Empty the caller's recycle bin (admin: everyone's). Returns the count. */
export async function emptyTrash(user: ScopeUser): Promise<number> {
  const items = await listTrash(user, 200, 0);
  let purged = 0;
  for (const item of items) {
    const res = await purgeConcept(item.id, user);
    if (res.ok) purged++;
  }
  return purged;
}

export interface Source {
  id: string;
  source_type: string;
  original_name: string | null;
  content_hash: string;
  created_at: string;
}

/** Newest source records, owner-scoped (admin sees all). Same optional time
 * filter as the /logs tables; ownership lives on concepts (owner_id) while
 * the timestamp lives on sources — hence the two separate expressions. */
export async function listSources(user: ScopeUser, filter?: LogFilter): Promise<Source[]> {
  const params: unknown[] = [];
  const where = logWhereClause("c.owner_id", "s.created_at", user, filter, params);
  const { rows } = await query<Source>(
    `SELECT s.id, s.source_type, s.original_name, s.content_hash, s.created_at
     FROM sources s
     JOIN concepts c ON c.id = s.concept_id
     ${where}
     ORDER BY s.created_at DESC LIMIT 200`,
    params,
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
  // 回收站必须排除：导出=有效知识快照、图谱=可见条目、导入查重=现存的可见条目，
  // 三者共用的这份读取面此前漏了 deleted_at 过滤（2026-09-10 实测：导出包里
  // 混着一条已删除条目，导入还会把撞上它的内容误判成「重复」而静默跳过）。
  const { rows } = await query<ExportConcept>(
    `
    SELECT
      c.id, c.type, c.title, c.description, c.category, c.status, c.tags,
      c.current_version, c.updated_at,
      v.body_markdown, v.content_hash, v.generated_by, v.created_at AS version_created_at
    FROM concepts c
    JOIN concept_versions v
      ON v.concept_id = c.id AND v.version_number = c.current_version
    WHERE c.deleted_at IS NULL
    ${user.role === "admin" ? "" : "AND c.owner_id = $1"}
    ORDER BY c.updated_at DESC
  `,
    user.role === "admin" ? [] : [user.id],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Wiki links ([[标题]]): the book (§3.3.2) asks for a Wikipedia-style
// bidirectional reference network instead of isolated note islands. Parsing
// is pure and lives in lib/links; these are the scoped DB lookups.
// ---------------------------------------------------------------------------

/** Resolve wiki-link titles to concept ids visible to `user`. Matching is
 * case-insensitive; unknown titles simply stay unresolved (dimmed in UI). */
export async function resolveLinkTargets(
  user: ScopeUser,
  titles: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(titles.map((t) => t.trim()).filter(Boolean))].slice(0, 100);
  if (uniq.length === 0) return map;
  const lowered = uniq.map((t) => t.toLowerCase());
  const { rows } = await query<{ id: string; title: string }>(
    `SELECT c.id, c.title FROM concepts c
     WHERE c.deleted_at IS NULL AND lower(c.title) = ANY($1::text[]) ${user.role === "admin" ? "" : "AND c.owner_id = $2"}`,
    user.role === "admin" ? [lowered] : [lowered, user.id],
  );
  for (const r of rows) {
    const key = r.title.toLowerCase();
    if (!map.has(key)) map.set(key, r.id);
  }
  return map;
}

/** Concepts whose current body MENTIONS `targetTitle` as plain text without
 * linking it — the Obsidian "unlinked mentions" pattern (deterministic; the
 * snippet is shown for human confirmation, an LLM pass is overkill while the
 * context is visible). The check is occurrence-level: a body that links the
 * title SOMEWHERE can still carry an unlinked mention elsewhere (only
 * occurrences directly preceded by "[[" count as linked). Case-insensitive. */
export async function findUnlinkedMentions(
  user: ScopeUser,
  targetId: string,
  targetTitle: string,
  limit = 20,
): Promise<{ id: string; title: string; snippet: string }[]> {
  if (targetTitle.trim().length < 2) return [];
  const { rows } = await query<{ id: string; title: string; body_markdown: string }>(
    `SELECT c.id, c.title, v.body_markdown
     FROM concepts c
     JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
     WHERE c.id <> $1
       AND c.deleted_at IS NULL
       AND position(lower($2) IN lower(v.body_markdown)) > 0
       ${user.role === "admin" ? "" : "AND c.owner_id = $3"}
     LIMIT ${Math.max(1, Math.min(50, limit))}`,
    user.role === "admin" ? [targetId, targetTitle] : [targetId, targetTitle, user.id],
  );
  const lowerTitle = targetTitle.toLowerCase();
  const out: { id: string; title: string; snippet: string }[] = [];
  for (const r of rows) {
    const lower = r.body_markdown.toLowerCase();
    let hit = -1;
    let idx = lower.indexOf(lowerTitle);
    while (idx !== -1) {
      if (lower.slice(idx - 2, idx) !== "[[") {
        hit = idx;
        break;
      }
      idx = lower.indexOf(lowerTitle, idx + 1);
    }
    if (hit === -1) continue;
    const from = Math.max(0, hit - 40);
    const to = hit + targetTitle.length + 40;
    const snippet =
      (from > 0 ? "…" : "") +
      r.body_markdown.slice(from, to).replace(/\s+/g, " ").trim() +
      (to < r.body_markdown.length ? "…" : "");
    out.push({ id: r.id, title: r.title, snippet });
    if (out.length >= limit) break;
  }
  return out;
}

/** Concepts whose current body links to `targetTitle` via `[[targetTitle]]`
 * or the alias form `[[targetTitle|display]]`, newest first — the backlink
 * panel of a concept page. */
export async function findBacklinks(
  user: ScopeUser,
  targetId: string,
  targetTitle: string,
  limit = 50,
): Promise<{ id: string; title: string; updated_at: string }[]> {
  const exact = `%${escapeLike(`[[${targetTitle}]]`)}%`;
  const aliased = `%${escapeLike(`[[${targetTitle}|`)}%`;
  const { rows } = await query<{ id: string; title: string; updated_at: string }>(
    `SELECT c.id, c.title, c.updated_at
     FROM concepts c
     JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
     WHERE c.id <> $1 AND c.deleted_at IS NULL AND (v.body_markdown ILIKE $2 ESCAPE '\\' OR v.body_markdown ILIKE $3 ESCAPE '\\')
       ${user.role === "admin" ? "" : "AND c.owner_id = $4"}
     ORDER BY c.updated_at DESC
     LIMIT ${Math.max(1, Math.min(200, limit))}`,
    user.role === "admin" ? [targetId, exact, aliased] : [targetId, exact, aliased, user.id],
  );
  return rows;
}
/** Current bodies for embed targets (`![[标题]]` transclusion), keyed by
 * LOWERCASED title; viewer-scoped, missing titles stay absent from the map.
 * Used by the concept detail page to render embed boxes without extra
 * per-embed queries. */
export async function getBodiesByTitles(
  user: ScopeUser,
  titles: string[],
): Promise<Map<string, { id: string; body: string }>> {
  const uniq = [...new Set(titles.map((t) => t.trim()).filter(Boolean))].slice(0, 50);
  const map = new Map<string, { id: string; body: string }>();
  if (uniq.length === 0) return map;
  const lowered = uniq.map((t) => t.toLowerCase());
  const { rows } = await query<{ id: string; title: string; body_markdown: string }>(
    `SELECT c.id, c.title, v.body_markdown
     FROM concepts c
     JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
     WHERE c.deleted_at IS NULL AND lower(c.title) = ANY($1::text[]) ${user.role === "admin" ? "" : "AND c.owner_id = $2"}`,
    user.role === "admin" ? [lowered] : [lowered, user.id],
  );
  for (const r of rows) map.set(r.title.toLowerCase(), { id: r.id, body: r.body_markdown });
  return map;
}
