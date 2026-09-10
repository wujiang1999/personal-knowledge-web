import { isAutoSummaryEnabled, getLlmChatConfig } from "./config";
import type { ScopeUser } from "./requireUser";
import { claimTask, failTask, finishTask, progressTask } from "./tasks";
import { query } from "./db";
import { llmChatJson } from "./llm";
import { invalidateSearchCache } from "./concepts";

/** Auto summary: when a concept is saved without a description, fill it from
 * the LLM in the background. Never blocks or fails the write path — the hook
 * in the API routes is fire-and-forget, and every failure path returns or
 * throws into a caught promise. */

const SUMMARY_MAX_CHARS = 300;
const BODY_WINDOW = 6000;

export type SummaryOutcome =
  | { status: "skipped"; reason: string }
  | { status: "done"; description: string };

/**
 * Generate a one-line description for the concept's current version when it
 * has none. Human-written descriptions are never overwritten.
 *
 * The `LLM_AUTO_SUMMARY` switch deliberately lives in the *hook*
 * (maybeQueueAutoSummary): it gates automatic spending after every save, not
 * an explicit request — the manual "补齐缺失描述" batch goes through here
 * regardless of that switch.
 */
export async function generateSummaryForConcept(conceptId: string): Promise<SummaryOutcome> {
  const cfg = getLlmChatConfig();
  if (!cfg) return { status: "skipped", reason: "LLM 未配置" };

  const cur = await query<{ owner_id: string; title: string; description: string | null; body_markdown: string }>(
    `SELECT c.owner_id, c.title, c.description, v.body_markdown
     FROM concepts c
     JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
     WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [conceptId]
  );
  if (cur.rows.length === 0) return { status: "skipped", reason: "concept not found" };
  if (cur.rows[0].description) return { status: "skipped", reason: "description 已存在" };

  const { owner_id, title, body_markdown } = cur.rows[0];
  const data = await llmChatJson<{ description?: unknown }>([
    {
      role: "system",
      content:
        '你为个人知识库条目写一句话描述。只输出 JSON：{"description":"..."}。要求：≤120 字中文，概括核心结论或用途，具体可检索，不要出现"本文""该条目"等字样。',
    },
    {
      role: "user",
      content: `标题：${title}\n\n正文：\n${body_markdown.slice(0, BODY_WINDOW)}`,
    },
  ], { meta: { purpose: "auto-summary", userId: owner_id }, maxTokens: 200 });
  const description = typeof data.description === "string" ? data.description.trim().slice(0, SUMMARY_MAX_CHARS) : "";
  if (!description) return { status: "skipped", reason: "LLM 返回空描述" };

  // Metadata-only update: mirrors addConceptVersion's same-hash branch so the
  // "latest version row = latest metadata" invariant holds. No new version,
  // no source row, no generated_by change (that column marks body origin).
  await query("UPDATE concepts SET description = $2, updated_at = now() WHERE id = $1", [
    conceptId,
    description,
  ]);
  await query(
    "UPDATE concept_versions SET description = $2 WHERE concept_id = $1 AND version_number = (SELECT current_version FROM concepts WHERE id = $1)",
    [conceptId, description]
  );
  invalidateSearchCache();
  return { status: "done", description };
}

/**
 * Fire-and-forget hook for write paths (concept create / new version). Safe
 * to call unconditionally: it no-ops when the feature is not enabled.
 */
export function maybeQueueAutoSummary(conceptId: string): void {
  if (!getLlmChatConfig() || !isAutoSummaryEnabled()) return;
  void generateSummaryForConcept(conceptId).catch((err: unknown) => {
    console.error(
      `[summary] ${conceptId} failed:`,
      err instanceof Error ? err.message : err
    );
  });
}

/** 批量补齐缺失描述的规模上限：一次任务的条目数（每条一次 LLM 调用）。 */
export const RESUMARIZE_MAX_BATCH = 50;

/** 缺描述的条目数——按钮文案与任务结果都要它（`npm run curate` 的同一信号）。 */
export async function countMissingDescriptions(user: ScopeUser): Promise<number> {
  const scope = user.role === "admin" ? "" : "AND c.owner_id = $1";
  const scopeParams = user.role === "admin" ? [] : [user.id];
  const { rows } = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM concepts c
      WHERE c.deleted_at IS NULL AND coalesce(btrim(c.description), '') = '' ${scope}`,
    scopeParams
  );
  return Number(rows[0]?.n ?? 0);
}

/** 待补描述的条目（新的先来：近期录入的更可能是刚 ingest 进来的）。 */
async function listMissingDescriptions(
  user: ScopeUser,
  limit: number
): Promise<{ id: string; title: string }[]> {
  const scope = user.role === "admin" ? "" : "AND owner_id = $2";
  const scopeParams = user.role === "admin" ? [] : [user.id];
  const { rows } = await query<{ id: string; title: string }>(
    `SELECT id, title FROM concepts
      WHERE deleted_at IS NULL AND coalesce(btrim(description), '') = '' ${scope}
      ORDER BY updated_at DESC LIMIT $1`,
    [limit, ...scopeParams]
  );
  return rows;
}

/** 批量任务的结果形态（进 tasks.result：进度与逐条明细）。 */
export interface ResummarizeResult {
  total: number;
  done: number;
  updated: number;
  skipped: number;
  failed: number;
  finished: boolean;
  items: { id: string; title: string; status: string; error?: string }[];
  tookMs?: number;
}

/**
 * 执行者：把「全库缺描述」逐条补齐，边跑边把进度写进任务行（客户端就是靠它
 * 显示 x/y）。与问答任务同一套约定：进程内 fire-and-forget、不抛异常、异常
 * 落进任务行；中途进程消失由 lib/tasks 的租约在下次读取时判失败。
 */
export async function executeResummarizeTask(
  taskId: string,
  user: ScopeUser,
  limit: number
): Promise<void> {
  const startedAt = Date.now();
  try {
    if (!(await claimTask(taskId))) return;
    const targets = await listMissingDescriptions(user, Math.min(limit, RESUMARIZE_MAX_BATCH));
    const result: ResummarizeResult = {
      total: targets.length,
      done: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      finished: false,
      items: [],
    };
    await progressTask(taskId, result);
    for (const target of targets) {
      try {
        const outcome = await generateSummaryForConcept(target.id);
        if (outcome.status === "done") result.updated++;
        else result.skipped++;
        result.items.push({ id: target.id, title: target.title, status: outcome.status });
      } catch (err) {
        result.failed++;
        result.items.push({
          id: target.id,
          title: target.title,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      result.done++;
      // 每条都落一次进度：批量最多 50 条，代价可忽略，换来刷新页面也不丢进度。
      await progressTask(taskId, result);
    }
    result.finished = true;
    result.tookMs = Date.now() - startedAt;
    await finishTask(taskId, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[summary] 批量补描述失败:", taskId, message);
    await failTask(taskId, message).catch(() => {});
  }
}
