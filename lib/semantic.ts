import { getLlmEmbeddingConfig } from "./config";
import { getPool, query } from "./db";
import { llmEmbed, type LlmCallMeta } from "./llm";
import { chunkEmbeddingText, embeddingSourceMatches, splitConceptBody } from "./chunks";
import type { ScopeUser } from "./requireUser";
import { operatorFilterClauses, type ParsedQuery } from "./search-syntax";

/** Semantic search over pgvector embeddings of concept bodies. Entirely
 * optional: the runtime probe requires (a) the `vector` extension and
 * concept_embedding_chunks table, and (b) an embedding endpoint config. When any
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
           AND to_regclass('public.concept_embedding_chunks') IS NOT NULL
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
  // Semantic-only rows have no lexical anchor, so their `section` comes from
  // the chunk that matched (searchConcepts reads this back through match_at).
  const atById = new Map(semCands.map((c) => [c.id, c.startOffset]));
  const fused = rrfMerge<{ id: string }>([lexical, semCands.map((c) => ({ id: c.id }))]);

  const lexicalById = new Map(lexical.map((r) => [r.id, r]));
  const semOnlyIds = fused.filter((f) => !lexicalById.has(f.item.id)).map((f) => f.item.id);
  const semRows = semOnlyIds.length ? await conceptRowsForIds(user, semOnlyIds) : [];
  const semById = new Map(
    semRows.map((r) => [
      r.id,
      { ...r, score: 0, similarity: simById.get(r.id), match_at: atById.get(r.id) } as unknown as T,
    ]),
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

/** Chunk-level recall pool: how many chunks (not concepts) the vector scan
 * returns before de-duplication. A concept is re-derived from its chunks, and a
 * long note can hold several of the nearest chunks, so the pool is a multiple
 * of the requested concept count with a floor. */
const SEMANTIC_CHUNKS_PER_CONCEPT = 3;
const SEMANTIC_CHUNK_POOL_MIN = 60;
/** pgvector's default hnsw.ef_search is 40; asking for a bigger pool than that
 * silently returns fewer rows, so the query raises it (SET LOCAL, transaction
 * scoped — the pooled connection is left clean). */
const HNSW_EF_SEARCH_MIN = 100;

/** One concept's best chunk inside the pool. */
export interface SemanticCandidate {
  id: string;
  /** Cosine similarity (0–1) of the best chunk — the scale-independent signal
   * downstream thresholds use. Never an aggregate: `similarity` keeps its
   * "closeness of one passage" meaning. */
  similarity: number;
  /** Offset of that chunk in the current body, for section labels. */
  startOffset: number;
}

/** Collapse chunk hits to one candidate per concept. The nearest chunk wins
 * and donates its offsets; the number of that concept's chunks inside the pool
 * breaks similarity ties (a concept matching in three places is a better
 * answer than one matching in a single spot), but is not exposed — callers
 * keep seeing a 0–1 similarity. */
export function aggregateChunkHits(
  hits: readonly { id: string; similarity: number; startOffset: number }[],
  limit: number,
): SemanticCandidate[] {
  const best = new Map<string, SemanticCandidate & { hits: number }>();
  for (const hit of hits) {
    const seen = best.get(hit.id);
    if (!seen) {
      best.set(hit.id, { ...hit, hits: 1 });
      continue;
    }
    seen.hits += 1;
    if (hit.similarity > seen.similarity) {
      seen.similarity = hit.similarity;
      seen.startOffset = hit.startOffset;
    }
  }
  return [...best.values()]
    .sort((a, b) => b.similarity - a.similarity || b.hits - a.hits)
    .slice(0, limit)
    .map((c) => ({ id: c.id, similarity: c.similarity, startOffset: c.startOffset }));
}

/** Top concepts by cosine similarity to the query vector, owner-scoped.
 * Similarity rides along (1 − cosine distance) because downstream callers —
 * notably the MCP write-path judge — need a scale-independent relatedness
 * signal; the fused display score is not comparable across result kinds.
 *
 * Retrieval is chunk-level: HNSW ranks chunks, then hits are collapsed per
 * concept. This replaced `DISTINCT ON (concept_id) … ORDER BY concept_id,
 * distance`, which could not use the vector index at all — it walked every
 * chunk of every in-scope concept on each search (≈30 rows per concept here,
 * unbounded as the library grows) and then sorted the whole set in JS. The
 * index-backed top-N pool is bounded by construction; what it gives up is
 * exactness on the tail of the ranking, which RRF only sees through positions
 * and pgvector is approximate on anyway. */
export async function semanticCandidates(
  user: ScopeUser,
  queryVector: number[],
  limit: number,
  /** Search-operator filters (tag:/category:/status:/type:) — without them the
   * vector recall would leak rows the lexical path just filtered out. */
  filters?: ParsedQuery,
): Promise<SemanticCandidate[]> {
  const cfg = getLlmEmbeddingConfig();
  if (!cfg) return [];
  const params: unknown[] = [toVectorLiteral(queryVector)];
  // Alive filter first so trashed concepts never surface from stale embeddings
  // (the backfill only re-syncs on write; a soft delete leaves rows behind).
  const clauses = ["c.deleted_at IS NULL"];
  params.push(cfg.baseUrl, cfg.model, cfg.dimensions);
  clauses.push(
    `cec.embedding_endpoint = $2 AND cec.model = $3 AND cec.dimensions = $4`,
    "cec.content_hash = v.content_hash",
    "cec.source_title = c.title",
    "cec.source_description IS NOT DISTINCT FROM c.description",
  );
  if (user.role !== "admin") clauses.push(`c.owner_id = $${(params.push(user.id), params.length)}`);
  if (filters) clauses.push(...operatorFilterClauses(filters, params));
  const where = "WHERE " + clauses.join(" AND ");
  // Pool size is a bounded integer derived from `limit`, never user text.
  const pool = Math.max(limit * SEMANTIC_CHUNKS_PER_CONCEPT, SEMANTIC_CHUNK_POOL_MIN);
  const efSearch = Math.max(pool, HNSW_EF_SEARCH_MIN);
  const client = await getPool().connect();
  let rows: { id: string; similarity: number; start_offset: number }[];
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL hnsw.ef_search = ${Math.trunc(efSearch)}`);
    ({ rows } = await client.query<{ id: string; similarity: number; start_offset: number }>(
      `SELECT cec.concept_id AS id,
              cec.start_offset,
              1 - (cec.embedding <=> $1::vector) AS similarity
       FROM concept_embedding_chunks cec
       JOIN concepts c ON c.id = cec.concept_id
       JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
       ${where}
       ORDER BY cec.embedding <=> $1::vector
       LIMIT ${pool}`,
      params,
    ));
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return aggregateChunkHits(
    rows.map((r) => ({ id: r.id, similarity: r.similarity, startOffset: r.start_offset })),
    limit,
  );
}

/** A nearest current chunk for each already-scoped concept.  Ask uses this
 * instead of blindly sending the beginning of a long note to the chat model.
 * The joins intentionally repeat the current-source checks from recall: an
 * async writer or an old model may leave rows behind, but they can never be
 * used as RAG evidence. */
export async function relevantChunksForConcepts(
  user: ScopeUser,
  queryVector: number[],
  conceptIds: string[],
): Promise<
  {
    conceptId: string;
    startOffset: number;
    endOffset: number;
    text: string;
    similarity: number;
  }[]
> {
  if (conceptIds.length === 0) return [];
  const cfg = getLlmEmbeddingConfig();
  if (!cfg) return [];
  const params: unknown[] = [toVectorLiteral(queryVector), conceptIds, cfg.baseUrl, cfg.model, cfg.dimensions];
  const ownerClause =
    user.role === "admin" ? "" : `AND c.owner_id = $${(params.push(user.id), params.length)}`;
  const { rows } = await query<{
    concept_id: string;
    start_offset: number;
    end_offset: number;
    chunk_text: string;
    similarity: number;
  }>(
    `SELECT DISTINCT ON (cec.concept_id)
            cec.concept_id, cec.start_offset, cec.end_offset, cec.chunk_text,
            1 - (cec.embedding <=> $1::vector) AS similarity
       FROM concept_embedding_chunks cec
       JOIN concepts c ON c.id = cec.concept_id
       JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
      WHERE cec.concept_id = ANY($2::uuid[])
        AND c.deleted_at IS NULL
        AND cec.embedding_endpoint = $3
        AND cec.model = $4
        AND cec.dimensions = $5
        AND cec.content_hash = v.content_hash
        AND cec.source_title = c.title
        AND cec.source_description IS NOT DISTINCT FROM c.description
        ${ownerClause}
      ORDER BY cec.concept_id, cec.embedding <=> $1::vector`,
    params,
  );
  return rows.map((r) => ({
    conceptId: r.concept_id,
    startOffset: r.start_offset,
    endOffset: r.end_offset,
    text: r.chunk_text,
    similarity: r.similarity,
  }));
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
  await query(`
    CREATE TABLE IF NOT EXISTS concept_embedding_chunks (
      concept_id           uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
      chunk_ordinal        integer NOT NULL,
      owner_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_hash         text NOT NULL,
      source_title         text NOT NULL,
      source_description   text,
      embedding_endpoint   text NOT NULL,
      model                text NOT NULL,
      dimensions           integer NOT NULL CHECK (dimensions > 0),
      start_offset         integer NOT NULL CHECK (start_offset >= 0),
      end_offset           integer NOT NULL CHECK (end_offset >= start_offset),
      chunk_text           text NOT NULL,
      embedding            vector NOT NULL,
      created_at           timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (concept_id, chunk_ordinal)
    )
  `);
  await query(
    "CREATE INDEX IF NOT EXISTS idx_embedding_chunks_owner_model ON concept_embedding_chunks (owner_id, embedding_endpoint, model, dimensions)",
  );
}

/** Pin the embedding columns before any remote embedding work begins. A
 * populated vector column is never altered in place: silently converting a
 * differently dimensioned historical index would hide an incomplete rebuild.
 */
export async function ensureEmbeddingDimension(dimensions: number): Promise<void> {
  const tables = ["concept_embeddings", "concept_embedding_chunks"] as const;
  for (const table of tables) {
    const { rows } = await query<{ dimension: number; has_rows: boolean }>(
      `SELECT a.atttypmod AS dimension, EXISTS (SELECT 1 FROM ${table} LIMIT 1) AS has_rows
         FROM pg_attribute a
        WHERE a.attrelid = 'public.${table}'::regclass
          AND a.attname = 'embedding' AND NOT a.attisdropped`,
    );
    const state = rows[0];
    if (!state) throw new Error(`Embedding table ${table} is missing its embedding column`);
    if (state.dimension === -1) {
      if (state.has_rows) {
        throw new Error(
          `Embedding dimension for ${table} is unpinned with existing rows; run a planned reindex migration before backfill`,
        );
      }
      await query(`ALTER TABLE ${table} ALTER COLUMN embedding TYPE vector(${dimensions})`);
    } else if (state.dimension !== dimensions) {
      throw new Error(
        `Embedding dimension mismatch for ${table}: database vector(${state.dimension}), configured vector(${dimensions}); run a planned rebuild before backfill`,
      );
    }
  }
  await query(
    "CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON concept_embeddings USING hnsw (embedding vector_cosine_ops)",
  );
  await query(
    "CREATE INDEX IF NOT EXISTS idx_embedding_chunks_hnsw ON concept_embedding_chunks USING hnsw (embedding vector_cosine_ops)",
  );
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
  const cfg = getLlmEmbeddingConfig();
  if (!cfg) throw new Error("Embedding 未配置");
  // Cache entries are only interchangeable inside the exact vector space and
  // user scope. A same-named model behind another endpoint is not assumed to
  // produce compatible vectors.
  const cacheKey = `${meta?.userId ?? "system"}\u0000${cfg.baseUrl}\u0000${cfg.model}\u0000${cfg.dimensions}\u0000${needle}`;
  const hit = queryEmbedCache.get(cacheKey);
  if (hit && Date.now() - hit.at < QUERY_EMBED_TTL_MS) {
    queryEmbedCache.delete(cacheKey);
    queryEmbedCache.set(cacheKey, hit); // refresh LRU position
    return hit.vector;
  }
  const vector = (await llmEmbed([needle], meta))[0];
  if (queryEmbedCache.size >= QUERY_EMBED_MAX) {
    const oldest = queryEmbedCache.keys().next().value;
    if (oldest !== undefined) queryEmbedCache.delete(oldest);
  }
  queryEmbedCache.set(cacheKey, { at: Date.now(), vector });
  return vector;
}

export interface ConceptEmbeddingInput {
  conceptId: string;
  ownerId: string;
  contentHash: string;
  title: string;
  description: string | null;
  body: string;
  userId?: string | null;
  apiKeyId?: string | null;
}

/** Publish all chunks as one replacement. The caller computes every vector
 * before this transaction starts; a concurrent save can therefore only cause
 * a harmless skipped publish, never a partially indexed old version. */
export async function publishConceptEmbedding(
  input: ConceptEmbeddingInput,
  vectors: number[][],
): Promise<boolean> {
  const cfg = getLlmEmbeddingConfig();
  if (!cfg) return false;
  const chunks = splitConceptBody(input.body);
  if (vectors.length !== chunks.length || vectors.some((vector) => vector.length !== cfg.dimensions)) {
    throw new Error("Embedding chunk/vector count or dimension mismatch");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      owner_id: string;
      title: string;
      description: string | null;
      content_hash: string;
    }>(
      `SELECT c.owner_id, c.title, c.description, v.content_hash
         FROM concepts c
         JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
        WHERE c.id = $1
        FOR UPDATE`,
      [input.conceptId],
    );
    const source = current.rows[0];
    if (
      !source ||
      !embeddingSourceMatches(
        { contentHash: source.content_hash, title: source.title, description: source.description },
        { contentHash: input.contentHash, title: input.title, description: input.description },
      )
    ) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query("DELETE FROM concept_embedding_chunks WHERE concept_id = $1", [input.conceptId]);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      await client.query(
        `INSERT INTO concept_embedding_chunks
           (concept_id, chunk_ordinal, owner_id, content_hash, source_title, source_description,
            embedding_endpoint, model, dimensions, start_offset, end_offset, chunk_text, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::vector)`,
        [
          input.conceptId,
          chunk.ordinal,
          source.owner_id,
          input.contentHash,
          input.title,
          input.description,
          cfg.baseUrl,
          cfg.model,
          cfg.dimensions,
          chunk.startOffset,
          chunk.endOffset,
          chunk.text,
          toVectorLiteral(vectors[i]),
        ],
      );
    }
    // Keep one first-chunk vector for existing health/statistics consumers.
    await client.query(
      `INSERT INTO concept_embeddings (concept_id, owner_id, content_hash, model, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (concept_id) DO UPDATE
         SET owner_id = $2, content_hash = $3, model = $4, embedding = $5::vector, created_at = now()`,
      [input.conceptId, source.owner_id, input.contentHash, cfg.model, toVectorLiteral(vectors[0])],
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Fire-and-forget indexing after version writes. It builds every current
 * document chunk before atomically publishing; failures leave the prior index
 * intact and the backfill can repair it later. */
export function queueConceptEmbedding(input: ConceptEmbeddingInput): void {
  const cfg = getLlmEmbeddingConfig();
  if (!cfg) return;
  void (async () => {
    const chunks = splitConceptBody(input.body);
    const vectors = await llmEmbed(
      chunks.map((chunk) => chunkEmbeddingText(input.title, input.description, chunk)),
      {
        purpose: "backfill",
        userId: input.userId ?? null,
        apiKeyId: input.apiKeyId ?? null,
      },
    );
    await publishConceptEmbedding(input, vectors);
  })().catch((err: unknown) => {
    console.error(
      "[semantic] write-path embed sync failed:",
      err instanceof Error ? err.message : err,
    );
  });
}
