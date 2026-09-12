import { loadEnv } from "./load-env";
import { closePool, query } from "../lib/db";
import { getAdminUsername, getLlmChatConfig } from "../lib/config";
import { llmChatJson } from "../lib/llm";
import { addConceptVersion, createConcept } from "../lib/concepts";

loadEnv();

/**
 * Weekly review (Obsidian periodic-notes pattern + LLM narrative): collect
 * concepts updated in the window, assemble a deterministic digest grouped
 * by category, ask the configured LLM for an overview/highlights/suggestions
 * (thinking disabled, capped tokens — the call is logged to llm_calls), and
 * store the note 「每周回顾 <ISO date>」 under 回顾/. Re-runs create a new
 * version, so history is preserved.
 *
 *   npm run review [--days 7] [--write]   (default: dry-run to stdout)
 */

interface Row {
  id: string;
  title: string;
  description: string | null;
  status: string;
  category: string | null;
  body_markdown: string;
  created_at: string;
  updated_at: string;
}

interface Narrative {
  overview?: string;
  highlights?: string[];
  suggestions?: string[];
}

const LIST_ROW_LIMIT = 40;

async function main() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf("--days");
  const days = daysIdx !== -1 ? Math.max(1, Math.trunc(Number(args[daysIdx + 1])) || 7) : 7;
  const write = args.includes("--write");

  const cfg = getLlmChatConfig();
  const { rows } = await query<Row>(
    `SELECT c.id, c.title, c.description, c.status, c.category,
            v.body_markdown, c.created_at, c.updated_at
     FROM concepts c
     JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
     WHERE c.updated_at > now() - ($1::int * interval '1 day')
     ORDER BY c.updated_at DESC
     LIMIT 200`,
    [days],
  );
  console.error(
    `[review] 近 ${days} 天变更 ${rows.length} 条；模式=${write ? "写入" : "dry-run(加 --write 才落库)"}；LLM=${cfg ? cfg.model : "未配置"}`,
  );

  // Deterministic detail: grouped by category, 新增/更新 tagged.
  const byCategory = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.category ?? "（未分类）";
    const list = byCategory.get(key) ?? [];
    list.push(r);
    byCategory.set(key, list);
  }

  // Compact LLM input: newest first, bounded per row and overall.
  let budget = 6000;
  const llmLines: string[] = [];
  for (const r of rows) {
    if (llmLines.length >= LIST_ROW_LIMIT || budget <= 0) break;
    const kind =
      new Date(r.created_at).getTime() >= Date.now() - days * 86_400_000 ? "新增" : "更新";
    const desc = (r.description || r.body_markdown.slice(0, 150)).replace(/\s+/g, " ").trim();
    const line = `- [${kind}][${r.category ?? "未分类"}] ${r.title} — ${desc}`.slice(0, 220);
    budget -= line.length;
    llmLines.push(line);
  }

  let narrative: Narrative | null = null;
  if (cfg && rows.length > 0) {
    try {
      narrative = await llmChatJson<Narrative>(
        [
          {
            role: "system",
            content:
              '你是个人知识库的周报助手。根据变更列表输出 JSON：{"overview":"2-3句总体脉络","highlights":["最重要的3-5条及为什么"],"suggestions":["1-3条后续动作建议，如需要补的[[链接]]或该合并的条目"]}。中文，具体、可执行，不堆套话。',
          },
          {
            role: "user",
            content: `近 ${days} 天知识库变更：\n${llmLines.join("\n")}`,
          },
        ],
        { meta: { purpose: "weekly-review" }, maxTokens: 1200, temperature: 0.3 },
      );
    } catch (err) {
      console.error(
        "[review] LLM 叙事失败（继续用确定性部分）:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(
    `> 生成于 ${today} · 覆盖近 ${days} 天 · ${rows.length} 条变更 · LLM 叙事：${narrative ? "已生成" : "未生成"}`,
  );
  lines.push("");
  lines.push(`## 概览`);
  lines.push("");
  lines.push(
    narrative?.overview?.trim() ||
      (rows.length ? `近 ${days} 天共 ${rows.length} 条条目变更。` : "近窗口无变更。"),
  );
  lines.push("");
  if (narrative?.highlights?.length) {
    lines.push(`## 重点`);
    lines.push("");
    for (const h of narrative.highlights) lines.push(`- ${h}`);
    lines.push("");
  }
  lines.push(`## 明细`);
  lines.push("");
  for (const [cat, list] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`### ${cat}（${list.length}）`);
    lines.push("");
    for (const r of list) {
      const kind =
        new Date(r.created_at).getTime() >= Date.now() - days * 86_400_000 ? "新增" : "更新";
      const desc = (r.description || "").replace(/\s+/g, " ").trim().slice(0, 120);
      lines.push(
        `- [${kind}] [[${r.title}]]${r.status !== "stable" ? `（${r.status}）` : ""}${desc ? ` — ${desc}` : ""}`,
      );
    }
    lines.push("");
  }
  if (narrative?.suggestions?.length) {
    lines.push(`## 建议后续`);
    lines.push("");
    for (const s of narrative.suggestions) lines.push(`- ${s}`);
    lines.push("");
  }
  const digest = lines.join("\n");

  if (!write) {
    console.log(digest);
    await closePool();
    return;
  }

  const userRow = await query<{ id: string; username: string }>(
    "SELECT id, username FROM users WHERE username = $1 LIMIT 1",
    [getAdminUsername()],
  );
  if (userRow.rows.length === 0)
    throw new Error(`找不到用户 ${getAdminUsername()}(ADMIN_USERNAME)`);
  const owner = { id: userRow.rows[0].id, username: userRow.rows[0].username };
  const title = `每周回顾 ${today}`;
  const input = {
    type: "Note",
    title,
    description: `近 ${days} 天知识库回顾（${rows.length} 条变更）`,
    category: "回顾",
    status: "stable" as const,
    body: digest,
    generatedBy: narrative ? `llm:review:${cfg?.model}` : undefined,
  };
  const existing = await query<{ id: string }>(
    "SELECT id FROM concepts WHERE title = $1 AND owner_id = $2 LIMIT 1",
    [title, owner.id],
  );
  if (existing.rows.length > 0) {
    const { version } = await addConceptVersion(existing.rows[0].id, input, owner.username, {
      userId: owner.id,
    });
    console.log(`[review] 已更新 ${title} → v${version}`);
  } else {
    const id = await createConcept(input, { ...owner, role: "admin" as const });
    console.log(`[review] 已创建 ${title} → ${id}`);
  }
  await closePool();
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
