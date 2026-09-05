import { isAutoSummaryEnabled, getLlmChatConfig } from "./config";
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
 */
export async function generateSummaryForConcept(conceptId: string): Promise<SummaryOutcome> {
  const cfg = getLlmChatConfig();
  if (!cfg) return { status: "skipped", reason: "LLM 未配置" };
  if (!isAutoSummaryEnabled()) return { status: "skipped", reason: "LLM_AUTO_SUMMARY 未开启" };

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
