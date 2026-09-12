import { getLlmEmbeddingConfig } from "./config";
import { query } from "./db";
import { llmEmbed, type LlmCallMeta } from "./llm";
import type { ScopeUser } from "./requireUser";
import { operatorFilterClauses, type ParsedQuery } from "./search-syntax";

/** Semantic search over pgvector embeddings of concept bodies. Entirely
 * optional: the runtime probe requires (a) the `vector` extension and
 * concept_embeddings table, and (b) an embedding endpoint config. When any
 * piece is missing, search stays purely lexical — callers degrade silently. */

/** Runtime probe (cached per process, like the pgroonga one): is semantic
 * search usable right now? */
let semanticProbe: boolean | null = null;
export async function hasSemanticSearch(): Promise<boolean> {
  if (semanticProbe === null) {
    try {
      const { rows } = await query<{ ok: boolean }>(
        `SELECT
           EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
           AND to_regclass('public.concept_embeddings') IS NOT NULL
         AS ok`,
      );
      semanticProbe = rows[0]?.ok === true && getLlmEmbeddingConfig() !== null;
    } catch {
      semanticProbe = false;
    }
  }
  return semanticProbe;
}

/** Format a JS number array as a pgvector text literal for `::vector` casts. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/** Reciprocal-rank fusion over ranked id lists (ids are opaque strings).
 * Classic k=60 constant; a list contributes 1/(60 + rank). */
export function rrfMerge<T extends { id: string }>(lists: T[][]): { item: T; rrf: number }[] {
  const scores = new Map<string, { item: T; rrf: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const entry = scores.get(item.id);
      const contribution = 1 / (60 + rank + 1);
      if (entry) entry.rrf += contribution;
      else scores.set(item.id, { item, rrf: contribution });
    });
  }
  return [...scores.values()].sort((a, b) => b.rrf - a.rrf);
}

/**
 * Rerank a lexical result window against nearest-embedding neighbors and
 * inject semantic-only hits. Generic over the row shape (only id + score are
 * touched) so this module stays free of imports from lib/concepts (which
 * imports this one). Sem-only rows receive the fused RRF score as their
 * display score.
 */
export async function rerankWithSemantic<T extends { id: string; score: number }>(
  user: ScopeUser,
  needle: string,
  lexical: T[],
  limit: number,
  /** Precomputed query vector: searchConcepts embeds concurrently with the
   * lexical query; when absent (direct callers), embed here as before. */
  queryVector?: number[],
  /** Search-operator filters — constrain vector recall to the same scope
   * the lexical window was built from. */
  filters?: ParsedQuery,
): Promise<T[]> {
  const vector =
    queryVector ??
    (
      await llmEmbed([needle.slice(0, 4000)], {
        purpose: "search-embed",
        userId: user.id,
        apiKeyId: user.apiKeyId,
      })
    )[0];
  const semCands = await semanticCandidates(user, vector, Math.max(limit * 2, 20), filters);
  const simById = new Map(semCands.map((c) => [c.id, c.similarity]));
  const fused = rrfMerge<{ id: string }>([lexical, semCands.map((c) => ({ id: c.id }))]);

  const lexicalById = new Map(lexical.map((r) => [r.id, r]));
  const semOnlyIds = fused.filter((f) => !lexicalById.has(f.item.id)).map((f) => f.item.id);
  const semRows = semOnlyIds.length ? await conceptRowsForIds(user, semOnlyIds) : [];
  const semById = new Map(
    semRows.map((r) => [r.id, { ...r, score: 0, similarity: simById.get(r.id) } as unknown as T]),
  );

  const out: T[] = [];
  for (const { item, rrf } of fused) {
    if (out.length >= limit) break;
    const row = lexicalById.get(item.id) ?? semById.get(item.id);
    if (!row) continue; // scope-filtered out (e.g. other owner's embedding)
    const similarity = simById.get(item.id);
    const full = lexicalById.has(item.id)
      ? { ...row, similarity }
      : { ...row, score: Math.round(rrf * 100), similarity };
    out.push(full as T);
  }
  return out;
}

/** Top concepts by cosine similarity to the query vector, owner-scoped.
 * Similarity rides along (1 − cosine distance) because downstream callers —
 * notably the MCP write-path judge — need a scale-independent relatedness
 * signal; the fused display score is not comparable across result kinds. */
export async function semanticCandidates(
  user: ScopeUser,
  queryVector: number[],
  limit: number,
  /** Search-operator filters (tag:/category:/status:) — without them the
   * vector recall would leak rows the lexical path just filtered out. */
  filters?: ParsedQuery,
): Promise<{ id: string; similarity: number }[]> {
  const params: unknown[] = [toVectorLiteral(queryVector)];
  // Alive filter first so trashed concepts never surface from stale embeddings
  // (the backfill only re-syncs on write; a soft delete leaves rows behind).
  const clauses = ["c.deleted_at IS NULL"];
  if (user.role !== "admin") clauses.push(`c.owner_id = $${(params.push(user.id), params.length)}`);
  if (filters) clauses.push(...operatorFilterClauses(filters, params));
  const where = "WHERE " + clauses.join(" AND ");
  const { rows } = await query<{ id: string; similarity: number }>(
    `SELECT ce.concept_id AS id, 1 - (ce.embedding <=> $1::vector) AS similarity
     FROM concept_embeddings ce
     JOIN concepts c ON c.id = ce.concept_id
     ${where}
     ORDER BY ce.embedding <=> $1::vector
     LIMIT ${limit}`,
    params,
  );
  return rows;
}

/** Fetch SearchResult-shaped rows for semantic-only hits (no lexical match
 * window exists, so preview the head of the body). */
export async function conceptRowsForIds(
  user: ScopeUser,
  ids: string[],
): Promise<
  {
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
    owner_id: string | undefined;
    owner_username: string | undefined;
    attachment_count: number;
    body_markdown: string;
  }[]
> {
  if (ids.length === 0) return [];
  const { rows } = await query<{
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
    owner_id: string | null;
    owner_username: string | null;
    attachment_count: number;
    body_markdown: string;
  }>(
    `SELECT c.id, c.type, c.title, c.description, c.category, c.status, c.tags,
            c.current_version, c.created_at, c.updated_at,
            c.owner_id, ou.username AS owner_username,
            (SELECT count(*) FROM attachments a WHERE a.concept_id = c.id)::int AS attachment_count,
            left(v.body_markdown, 500) AS body_markdown
     FROM concepts c
     LEFT JOIN users ou ON ou.id = c.owner_id
     JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
     WHERE c.id = ANY($1::uuid[])
       AND c.deleted_at IS NULL
       ${user.role === "admin" ? "" : "AND c.owner_id = $2"}`,
    user.role === "admin" ? [ids] : [ids, user.id],
  );
  // SearchResult models a missing owner as undefined (LEFT JOIN types as
  // nullable); coerce once so callers can assign directly.
  return rows.map((r) => ({
    ...r,
    owner_id: r.owner_id ?? undefined,
    owner_username: r.owner_username ?? undefined,
  }));
}

/** Ensure the (untyped) embeddings table exists — used by the backfill script
 * so pgvector installed *after* migration 0013 ran still reaches a complete
 * schema. Idempotent. */
export async function ensureSemanticSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS concept_embeddings (
      concept_id   uuid PRIMARY KEY REFERENCES concepts(id) ON DELETE CASCADE,
      owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_hash text NOT NULL,
      model        text NOT NULL,
      embedding    vector NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now()
    )
  `);
  await query("CREATE INDEX IF NOT EXISTS idx_embeddings_owner ON concept_embeddings (owner_id)");
}

/**
 * Pin the embedding column's dimension and add the ANN index once the real
 * embedding size is known (pgvector needs a fixed typmod for hnsw). Idempotent
 * per process; failures are swallowed into a warning — an unindexed table is
 * merely slower, and this scale tolerates it.
 */
export async function ensureEmbeddingDimension(dimensions: number): Promise<void> {
  try {
    await query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM pg_attribute
           WHERE attrelid = 'public.concept_embeddings'::regclass
             AND attname = 'embedding' AND atttypmod = -1
         ) THEN
           ALTER TABLE concept_embeddings ALTER COLUMN embedding TYPE vector(${dimensions});
         END IF;
       END $$;`,
    );
    await query(
      "CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON concept_embeddings USING hnsw (embedding vector_cosine_ops)",
    );
  } catch (err) {
    console.error(
      "[semantic] dimension/index ensure failed (continuing unindexed):",
      err instanceof Error ? err.message : err,
    );
  }
}

// -------------------------------
// query-embedding cache + write-path embedding sync
// -------------------------------

/** LRU cache of query embeddings. A text's vector is deterministic, so no
 * invalidation is needed — a hit merely skips the cross-border embedding
 * round trip (300-700ms) that search-embed otherwise pays per unique query. */
const queryEmbedCache = new Map<string, { at: number; vector: number[] }>();
const QUERY_EMBED_TTL_MS = Number(process.env.QUERY_EMBED_CACHE_TTL_MS ?? 3_600_000);
const QUERY_EMBED_MAX = Number(process.env.QUERY_EMBED_CACHE_MAX ?? 200);

/** Query vector for `needle` (already operator-stripped and normalized by the
 * caller). Resolves from the LRU when fresh; otherwise one embedding call,
 * attributed via `meta`. Throws on failure — callers degrade to lexical-only. */
export async function cachedQueryVector(needle: string, meta?: LlmCallMeta): Promise<number[]> {
  const hit = queryEmbedCache.get(needle);
  if (hit && Date.now() - hit.at < QUERY_EMBED_TTL_MS) {
    queryEmbedCache.delete(needle);
    queryEmbedCache.set(needle, hit); // refresh LRU position
    return hit.vector;
  }
  const vector = (await llmEmbed([needle], meta))[0];
  if (queryEmbedCache.size >= QUERY_EMBED_MAX) {
    const oldest = queryEmbedCache.keys().next().value;
    if (oldest !== undefined) queryEmbedCache.delete(oldest);
  }
  queryEmbedCache.set(needle, { at: Date.now(), vector });
  return vector;
}

/** Fire-and-forget embedding sync for version writes: keeps
 * concept_embeddings at full coverage without manual backfill runs. Same text
 * construction and upsert as scripts/embed-backfill.ts. Never blocks the
 * write; failures are logged and swallowed — search degrades to lexical-only,
 * and the next write (or `npm run db:embed-backfill`) repairs the row. */
export function queueConceptEmbedding(input: {
  conceptId: string;
  ownerId: string;
  contentHash: string;
  title: string;
  description: string | null;
  body: string;
  userId?: string | null;
  apiKeyId?: string | null;
}): void {
  const cfg = getLlmEmbeddingConfig();
  if (!cfg) return;
  void (async () => {
    const text = `${input.title}\n${input.description ?? ""}\n${input.body.slice(0, 6000)}`;
    const vectors = await llmEmbed([text], {
      purpose: "backfill",
      userId: input.userId ?? null,
      apiKeyId: input.apiKeyId ?? null,
    });
    await query(
      `INSERT INTO concept_embeddings (concept_id, owner_id, content_hash, model, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (concept_id) DO UPDATE
         SET owner_id = $2, content_hash = $3, model = $4, embedding = $5::vector, created_at = now()`,
      [input.conceptId, input.ownerId, input.contentHash, cfg.model, toVectorLiteral(vectors[0])],
    );
  })().catch((err: unknown) => {
    console.error(
      "[semantic] write-path embed sync failed:",
      err instanceof Error ? err.message : err,
    );
  });
}
