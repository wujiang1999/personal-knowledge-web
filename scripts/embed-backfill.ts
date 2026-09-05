import { loadEnv } from "./load-env";
import { getLlmEmbeddingConfig } from "../lib/config";
import { llmEmbed } from "../lib/llm";
import { ensureEmbeddingDimension, ensureSemanticSchema, toVectorLiteral } from "../lib/semantic";
import { closePool, query } from "../lib/db";

loadEnv();

/**
 * Embed every concept's current version into concept_embeddings for semantic
 * search. Idempotent: only rows whose content_hash (or model) differs from
 * the stored embedding are recomputed.
 *
 *   npm run db:embed-backfill
 *
 * Requires the pgvector extension (superuser: CREATE EXTENSION vector) and
 * LLM_EMBEDDING_* config; see .env.example.
 */
async function main() {
  const cfg = getLlmEmbeddingConfig();
  if (!cfg) {
    console.error(
      "Embedding 未配置:需要 LLM_EMBEDDING_MODEL 与 LLM_EMBEDDING_DIMENSIONS,\n" +
        "以及 LLM_EMBEDDING_BASE_URL / LLM_EMBEDDING_API_KEY(缺省回退 LLM_BASE_URL / LLM_API_KEY)。"
    );
    process.exit(1);
  }
  const ext = await query<{ ok: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ok"
  );
  if (!ext.rows[0].ok) {
    console.error(
      "pgvector 扩展未安装:先安装扩展包(如 apt install postgresql-16-pgvector),\n" +
        "再以 superuser 执行 CREATE EXTENSION vector;,然后重跑本脚本。"
    );
    process.exit(1);
  }
  await ensureSemanticSchema();
  await ensureEmbeddingDimension(cfg.dimensions);

  // 批量上限受 EMBED_TIMEOUT_MS(30s) 约束：一次请求最多 ~BATCH×6K 字符，
  // qwen3.7-text-embedding-flash 实测 16 条会超时，4 条稳定（2026-09-05）。
  const BATCH = 4;
  let done = 0;
  for (;;) {
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
       LEFT JOIN concept_embeddings e ON e.concept_id = c.id AND e.model = $1
       WHERE c.deleted_at IS NULL AND (e.concept_id IS NULL OR e.content_hash IS DISTINCT FROM v.content_hash)
       LIMIT ${BATCH}`,
      [cfg.model]
    );
    if (rows.length === 0) break;

    const texts = rows.map(
      (r) => `${r.title}\n${r.description ?? ""}\n${r.body_markdown.slice(0, 6000)}`
    );
    const vectors = await llmEmbed(texts, { purpose: "backfill" });
    if (vectors[0].length !== cfg.dimensions) {
      throw new Error(
        `embedding 实际维度 ${vectors[0].length} 与 LLM_EMBEDDING_DIMENSIONS=${cfg.dimensions} 不符,请修正配置后重跑`
      );
    }
    for (let i = 0; i < rows.length; i++) {
      await query(
        `INSERT INTO concept_embeddings (concept_id, owner_id, content_hash, model, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)
         ON CONFLICT (concept_id) DO UPDATE
           SET owner_id = $2, content_hash = $3, model = $4, embedding = $5::vector, created_at = now()`,
        [rows[i].id, rows[i].owner_id, rows[i].content_hash, cfg.model, toVectorLiteral(vectors[i])]
      );
    }
    done += rows.length;
    process.stderr.write(`[embed] ${done} 条已向量化\n`);
  }
  console.log(`backfill 完成:${done} 条新向量化(模型 ${cfg.model},维度 ${cfg.dimensions})`);
}

main()
  .catch((err) => {
    console.error("[embed-backfill] fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
