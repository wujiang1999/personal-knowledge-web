import { readFileSync } from "node:fs";
import { loadEnv } from "./load-env";
import { getAdminUsername, getLlmChatConfig, type LlmConfig } from "../lib/config";
import { llmChatJsonWith } from "../lib/llm";
import {
  INGEST_SYSTEM_PROMPT,
  ingestUserPrompt,
  splitMarkdownWithPaths,
  validateCandidates,
} from "../lib/ingest";
import { createConcept, searchConcepts } from "../lib/concepts";
import { enqueueReview } from "../lib/reviews";
import { closePool, query } from "../lib/db";

loadEnv();

/**
 * Ingest a Markdown document into atomic knowledge concepts.
 *
 *   npm run ingest -- <file.md>              # dry run: extract + dedup, no writes
 *   npm run ingest -- <file.md> --write      # actually create concepts
 *   options: --category "书籍/书名"           # prefix for every candidate's category
 *            --max 30                        # cap extracted concepts (default 30)
 *
 * Pipeline: split by headings → LLM atomization per chunk → title-based dedup
 * against the existing KB (search score ≥ 25 or exact title → skip and queue
 * for review) → create with generated_by=llm:ingest:<model>.
 * Requires LLM_BASE_URL/API_KEY/MODEL. dry-run 只读：查重命中的内容不写队列，
 * 加 --write 时才落成待裁决记录（见 lib/reviews）。
 */
function usage(): never {
  console.error("usage: npm run ingest -- <file.md> [--write] [--category <前缀>] [--max <N>]");
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) usage();
  const write = args.includes("--write");
  const catIdx = args.indexOf("--category");
  const baseCategory = catIdx !== -1 ? (args[catIdx + 1] ?? "") : "";
  const maxIdx = args.indexOf("--max");
  const max = maxIdx !== -1 ? Math.max(1, Math.trunc(Number(args[maxIdx + 1])) || 30) : 30;

  const cfg: LlmConfig = getLlmChatConfig() ?? usageNever();
  const md = readFileSync(file, "utf8");
  const { chunks, paths } = splitMarkdownWithPaths(md);
  console.error(
    `[ingest] ${file}: ${md.length} 字符 → ${chunks.length} 块;模式=${write ? "写入" : "dry-run(加 --write 才落库)"};模型=${cfg.model}`
  );

  const userRow = await query<{ id: string; username: string; role: string }>(
    "SELECT id, username, role FROM users WHERE username = $1 LIMIT 1",
    [getAdminUsername()]
  );
  if (userRow.rows.length === 0) {
    throw new Error(`找不到用户 ${getAdminUsername()}(ADMIN_USERNAME)`);
  }
  const owner = {
    id: userRow.rows[0].id,
    username: userRow.rows[0].username,
    role: userRow.rows[0].role === "admin" ? ("admin" as const) : ("user" as const),
  };

  const raw: unknown[] = [];
  // Extraction calls are independent per chunk; a small worker pool keeps a
  // long document from serializing N × (network TTFB + generation). A failed
  // chunk logs and is skipped, same as the sequential version did.
  const INGEST_CONCURRENCY = Math.max(1, Number(process.env.INGEST_CONCURRENCY ?? 4));
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < chunks.length) {
      const i = next++;
      try {
        const out = await llmChatJsonWith<unknown>(
          cfg,
          [
            { role: "system", content: INGEST_SYSTEM_PROMPT },
            { role: "user", content: ingestUserPrompt(chunks[i], max, paths[i]) },
          ],
          { meta: { purpose: "ingest-atomize", userId: owner.id }, maxTokens: 4000 }
        );
        if (Array.isArray(out)) raw.push(...out);
        process.stderr.write(`[ingest] 提取 ${i + 1}/${chunks.length} 完成\n`);
      } catch (err) {
        console.error(`[ingest] 第 ${i + 1}/${chunks.length} 块提取失败:`, err instanceof Error ? err.message : err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(INGEST_CONCURRENCY, chunks.length) }, () => worker()));

  const { candidates, dropped } = validateCandidates(raw, { baseCategory: baseCategory || undefined, max });
  console.error(`[ingest] 候选 ${candidates.length} 条(丢弃无效 ${dropped} 条)`);

  const wouldCreate: string[] = [];
  const dupes: { title: string; match: string; score: number; reviewId: string | null }[] = [];
  const failed: { title: string; reason: string }[] = [];
  for (const c of candidates) {
    let deduped = false;
    try {
      const { results } = await searchConcepts({ id: owner.id, role: owner.role }, c.title, 5, 0, "ingest");
      const best = results[0];
      if (best && (best.score >= 25 || best.title === c.title)) {
        // 查重命中不再只是打印一行：内容进审核队列，等人在 /reviews 裁决。
        // dry-run 不写队列（它的契约是零写入），因此只有 --write 才入队。
        const reviewId = write
          ? await enqueueReview(owner, {
              kind: "near_duplicate",
              source: "ingest",
              payload: c,
              targetConceptId: best.id,
              targetTitle: best.title,
              similarity: best.similarity ?? null,
              score: best.score,
              reason:
                best.title === c.title
                  ? "ingest 查重：标题与已有条目完全相同"
                  : `ingest 查重：检索分 ${Math.round(best.score)} ≥ 25`,
            })
          : null;
        dupes.push({ title: c.title, match: best.title, score: best.score, reviewId });
        deduped = true;
      }
    } catch (err) {
      console.error(`[ingest] 查重失败(继续创建): ${c.title}`, err instanceof Error ? err.message : err);
    }
    if (deduped) continue;

    if (!write) {
      wouldCreate.push(c.title);
      continue;
    }
    try {
      const id = await createConcept({ ...c, generatedBy: `llm:ingest:${cfg.model}` }, owner);
      wouldCreate.push(`${c.title} → ${id}`);
    } catch (err) {
      failed.push({ title: c.title, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(`\n== ingest 报告(${write ? "已写入" : "dry-run"}) ==`);
  console.log(`${write ? "创建" : "将创建"} ${wouldCreate.length} 条:`);
  for (const t of wouldCreate) console.log("  + " + t);
  console.log(`跳过相似 ${dupes.length} 条${write ? "（已进入审核队列）" : "（dry-run 不入队）"}:`);
  for (const d of dupes) {
    const queued = d.reviewId ? ` → 待裁决 ${d.reviewId.slice(0, 8)}` : "";
    console.log(`  ~ ${d.title} ≈「${d.match}」(score ${d.score})${queued}`);
  }
  if (failed.length) {
    console.log(`失败 ${failed.length} 条:`);
    for (const f of failed) console.log(`  ✗ ${f.title}: ${f.reason}`);
  }
  await closePool();
}

function usageNever(): never {
  console.error("LLM 未配置:需要 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL(见 .env.example)");
  process.exit(1);
}

main()
  .catch((err) => {
    console.error("[ingest] fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
