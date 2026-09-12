import { loadEnv } from "./load-env";
import { chunkEmbeddingText, chunkProfileMatches, splitConceptBody } from "../lib/chunks";
import { getLlmEmbeddingConfig } from "../lib/config";
import { closePool, query } from "../lib/db";
import { llmEmbed } from "../lib/llm";
import {
  ensureEmbeddingDimension,
  ensureSemanticSchema,
  publishConceptEmbedding,
  type ConceptEmbeddingInput,
} from "../lib/semantic";

loadEnv();

type BackfillConcept = ConceptEmbeddingInput;

interface StoredChunkProfile {
  chunk_ordinal: number;
  content_hash: string;
  source_title: string;
  source_description: string | null;
  embedding_endpoint: string;
  model: string;
  dimensions: number;
  start_offset: number;
  end_offset: number;
  chunk_text: string;
}

/** The exact comparison makes repeated backfills no-ops only when every
 * chunk belongs to the current body and current configured vector space. */
export function isChunkProfileComplete(
  stored: StoredChunkProfile[],
  input: Pick<ConceptEmbeddingInput, "contentHash" | "title" | "description" | "body">,
  cfg: { baseUrl: string; model: string; dimensions: number },
): boolean {
  const expected = splitConceptBody(input.body);
  if (stored.length !== expected.length) return false;
  return expected.every((chunk) => {
    const row = stored.find((candidate) => candidate.chunk_ordinal === chunk.ordinal);
    return !!row && chunkProfileMatches(
      {
        contentHash: row.content_hash,
        title: row.source_title,
        description: row.source_description,
        endpoint: row.embedding_endpoint,
        model: row.model,
        dimensions: row.dimensions,
        startOffset: row.start_offset,
        endOffset: row.end_offset,
        text: row.chunk_text,
      },
      { contentHash: input.contentHash, title: input.title, description: input.description },
      { endpoint: cfg.baseUrl, model: cfg.model, dimensions: cfg.dimensions },
      chunk,
    );
  });
}

async function needsBackfill(input: BackfillConcept, cfg: { baseUrl: string; model: string; dimensions: number }): Promise<boolean> {
  const [chunks, legacy] = await Promise.all([
    query<StoredChunkProfile>(
      `SELECT chunk_ordinal, content_hash, source_title, source_description, embedding_endpoint,
              model, dimensions, start_offset, end_offset, chunk_text
         FROM concept_embedding_chunks WHERE concept_id = $1`,
      [input.conceptId],
    ),
    query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM concept_embeddings
          WHERE concept_id = $1 AND owner_id = $2 AND content_hash = $3 AND model = $4
       ) AS ok`,
      [input.conceptId, input.ownerId, input.contentHash, cfg.model],
    ),
  ]);
  return !legacy.rows[0]?.ok || !isChunkProfileComplete(chunks.rows, input, cfg);
}

/**
 * Rebuild chunk embeddings for every current concept, including soft-deleted
 * records. Keeping trash indexed preserves the legacy coverage/stats
 * invariant while every recall query still filters deleted_at IS NULL.
 */
async function main() {
  const cfg = getLlmEmbeddingConfig();
  if (!cfg) {
    throw new Error("Embedding 未配置:需要 LLM_EMBEDDING_MODEL、LLM_EMBEDDING_DIMENSIONS 和 endpoint/key。");
  }
  const ext = await query<{ ok: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ok",
  );
  if (!ext.rows[0]?.ok) {
    throw new Error("pgvector 扩展未安装:先安装并执行 CREATE EXTENSION vector;，然后重跑本脚本。");
  }
  await ensureSemanticSchema();
  await ensureEmbeddingDimension(cfg.dimensions);

  const { rows } = await query<{
    id: string;
    owner_id: string;
    content_hash: string;
    title: string;
    description: string | null;
    body_markdown: string;
  }>(
    `SELECT c.id, c.owner_id, v.content_hash, c.title, c.description, v.body_markdown
       FROM concepts c
       JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
      ORDER BY c.id`,
  );

  let done = 0;
  let skipped = 0;
  for (const row of rows) {
    const input: BackfillConcept = {
      conceptId: row.id,
      ownerId: row.owner_id,
      contentHash: row.content_hash,
      title: row.title,
      description: row.description,
      body: row.body_markdown,
    };
    if (!(await needsBackfill(input, cfg))) {
      skipped++;
      continue;
    }
    const chunks = splitConceptBody(input.body);
    const vectors = await llmEmbed(
      chunks.map((chunk) => chunkEmbeddingText(input.title, input.description, chunk)),
      { purpose: "backfill" },
    );
    if (!(await publishConceptEmbedding(input, vectors))) {
      // A concurrent save won the race. Its queue will index the replacement;
      // leave this row for the next idempotent run rather than writing stale chunks.
      process.stderr.write(`[embed] 跳过已变更条目 ${input.conceptId}\n`);
      continue;
    }
    done++;
    process.stderr.write(`[embed] ${done} 条已向量化\n`);
  }
  console.log(
    `backfill 完成:${done} 条重建，${skipped} 条已是完整当前分块（模型 ${cfg.model},维度 ${cfg.dimensions}）`,
  );
}

main()
  .catch((err) => {
    console.error("[embed-backfill] fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
