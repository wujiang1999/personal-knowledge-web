import { ASK_MIN_SCORE, ASK_MIN_SIMILARITY } from "./ask";
import { getLlmChatConfig } from "./config";
import { searchConcepts, type SearchResult } from "./concepts";
import { query } from "./db";
import { llmChatJsonWith } from "./llm";
import { enqueueReview } from "./reviews";
import type { ScopeUser } from "./requireUser";

/** Claim 抽取（矛盾审计）：把条目正文拆成**可判断真伪的原子主张**，逐条回查库内
 * 相关条目，判定是否与既有内容矛盾；矛盾的作为 conflict 进审核队列（即"纠错"
 * 闭环里存量条目的那一半——写入侧已有查重，存量矛盾此前没人发现）。
 *
 * 默认只读：抽取向来会调 LLM，但**不写库**；`--write` 才把矛盾落成待裁决记录。
 * 与 `npm run ingest`、`npm run curate` 同一惯例。 */

/** 每个条目最多抽多少条主张（一次审计的 LLM 调用量 ≈ 1 + 主张数）。 */
export const CLAIM_MAX_PER_CONCEPT = 8;
/** 每条主张取多少候选条目去做矛盾判定。 */
export const CLAIM_CANDIDATES = 3;

const CLAIM_MAX_CHARS = 200;
const QUOTE_MAX_CHARS = 300;

export interface ExtractedClaim {
  text: string;
  /** 正文里的原句片段，供人快速核对（缺失时为空串）。 */
  quote: string;
}

/** 模型输出 → 主张列表：去空白、去重、截断、丢空条目。 */
export function parseClaims(raw: unknown, max = CLAIM_MAX_PER_CONCEPT): ExtractedClaim[] {
  const list = (raw as { claims?: unknown })?.claims;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ExtractedClaim[] = [];
  for (const item of list) {
    const rec = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const text = (typeof rec.text === "string" ? rec.text : "").replace(/\s+/g, " ").trim().slice(0, CLAIM_MAX_CHARS);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      text,
      quote: (typeof rec.quote === "string" ? rec.quote : "").replace(/\s+/g, " ").trim().slice(0, QUOTE_MAX_CHARS),
    });
    if (out.length >= max) break;
  }
  return out;
}

/** 一条主张的判定结果；`target` 只在 contradicts 且 targetId 能对上候选时才有。 */
export interface ClaimVerdict {
  verdict: "consistent" | "contradicts" | "unrelated";
  target: SearchResult | null;
  reason: string;
}

/**
 * 解析矛盾判定：模型常把 id 截断或改写成标题，因此接受"前缀 id 或标题"匹配
 * （与 MCP judge 的 findTarget 同一取舍）；对不上就退化为 unrelated——宁可漏报
 * 一条，也不把找不到落点的判定当成矛盾送进队列。
 */
export function parseClaimVerdict(raw: unknown, candidates: SearchResult[]): ClaimVerdict {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const rawVerdict = typeof rec.verdict === "string" ? rec.verdict : "";
  const reason = typeof rec.reason === "string" ? rec.reason.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  const verdict =
    rawVerdict === "consistent" || rawVerdict === "contradicts" || rawVerdict === "unrelated"
      ? rawVerdict
      : "unrelated";
  if (verdict !== "contradicts") return { verdict, target: null, reason };
  const rawId = typeof rec.targetId === "string" ? rec.targetId.trim() : "";
  const target =
    candidates.find((c) => c.id === rawId) ??
    (rawId.length >= 8 ? candidates.find((c) => c.id.startsWith(rawId)) : undefined) ??
    candidates.find((c) => c.title === rawId);
  return target ? { verdict, target, reason } : { verdict: "unrelated", target: null, reason };
}

/** 抽取主张的提示词：强调"可判断真伪的陈述"，把目录句、过渡句挡在外面。 */
export function buildClaimMessages(title: string, body: string): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        "你从知识库条目正文里抽取**原子主张**。" +
        "一条主张 = 一句可以判断真伪的陈述（含具体结论、数值、因果关系）。" +
        "不要抽提问句、目录句、过渡句（如「本节介绍…」）、纯定义性措辞与引用文献列表。" +
        `最多 ${CLAIM_MAX_PER_CONCEPT} 条，按重要性排序，不要重复或近义重复。` +
        '只输出 JSON：{"claims":[{"text":"主张","quote":"正文里支撑它的原句片段"}]}',
    },
    { role: "user", content: `标题：${title}\n\n正文：\n${body.slice(0, 8000)}` },
  ];
}

export function buildContradictionMessages(
  claim: ExtractedClaim,
  sourceTitle: string,
  candidates: SearchResult[]
): { role: "system" | "user"; content: string }[] {
  const material = candidates
    .map((c, i) => `[${i + 1}] id=${c.id} 《${c.title}》\n${c.body_markdown}`)
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        "你是知识库的矛盾审计助手。判断「主张」与「既有条目」是否事实冲突：" +
        "矛盾 = 两者不能同时为真（数值、结论、因果相反）；仅仅详略不同、角度不同不算矛盾。" +
        '只输出 JSON：{"verdict":"consistent|contradicts|unrelated","targetId":"冲突条目的 id","reason":"≤120 字理由"}' +
        "；verdict 为 contradicts 时必须给出 targetId。",
    },
    { role: "user", content: `主张（出自《${sourceTitle}》）：${claim.text}\n\n既有条目：\n${material}` },
  ];
}

export interface ClaimFinding {
  claim: string;
  targetId: string;
  targetTitle: string;
  reason: string;
  similarity: number | null;
  score: number;
  /** --write 时入队得到的待裁决记录 id（重复入队会复用已有记录）。 */
  reviewId?: string | null;
}

export interface ClaimAuditOutcome {
  conceptId: string;
  title: string;
  claims: number;
  checked: number;
  skippedWeak: number;
  findings: ClaimFinding[];
  error?: string;
}

export interface AuditOptions {
  /** 真写：把矛盾入队（缺省只读）。 */
  write?: boolean;
  /** 每条主张的判定都回传，供 CLI 打印进度。 */
  onProgress?: (message: string) => void;
}

/** 待审的条目正文（owner 作用域 + 未删除）。 */
export async function claimAuditTargets(
  user: ScopeUser,
  opts: { id?: string; limit: number }
): Promise<{ id: string; title: string; category: string | null; body: string; contentHash: string }[]> {
  const params: unknown[] = [];
  const where: string[] = ["c.deleted_at IS NULL"];
  if (opts.id) {
    params.push(opts.id);
    where.push(`c.id = $${params.length}`);
  }
  if (user.role !== "admin") {
    params.push(user.id);
    where.push(`c.owner_id = $${params.length}`);
  }
  params.push(opts.limit);
  const { rows } = await query<{
    id: string;
    title: string;
    category: string | null;
    body: string;
    content_hash: string;
  }>(
    `SELECT c.id, c.title, c.category, v.body_markdown AS body, v.content_hash
       FROM concepts c
       JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
      WHERE ${where.join(" AND ")}
      ORDER BY c.updated_at DESC LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    body: r.body,
    contentHash: r.content_hash,
  }));
}

/**
 * 审计一个条目的主张并（可选）入队矛盾。
 *
 * 候选门槛复用问答那套「库里有没有相关内容」的标定（相似度 / 纯词法分）：低于
 * 门槛说明这条主张在库里找不到落脚点，做矛盾判定只会浪费一次调用。
 */
export async function auditConceptClaims(
  user: ScopeUser,
  target: { id: string; title: string; category: string | null; body: string },
  opts: AuditOptions = {}
): Promise<ClaimAuditOutcome> {
  const outcome: ClaimAuditOutcome = {
    conceptId: target.id,
    title: target.title,
    claims: 0,
    checked: 0,
    skippedWeak: 0,
    findings: [],
  };
  const cfg = getLlmChatConfig();
  if (!cfg) throw new Error("LLM 未配置（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL）");

  const extracted = parseClaims(
    await llmChatJsonWith<unknown>(cfg, buildClaimMessages(target.title, target.body), {
      meta: { purpose: "claims", userId: user.id, apiKeyId: user.apiKeyId },
      maxTokens: 1500,
    })
  );
  outcome.claims = extracted.length;

  for (const claim of extracted) {
    const { results } = await searchConcepts(user, claim.text, CLAIM_CANDIDATES, 0, "api");
    const candidates = results.filter((r) => r.id !== target.id);
    if (candidates.length === 0) {
      outcome.skippedWeak++;
      continue;
    }
    const top = candidates[0];
    const topSimilarity = top.similarity ?? null;
    const tooWeak = topSimilarity !== null ? topSimilarity < ASK_MIN_SIMILARITY : top.score < ASK_MIN_SCORE;
    if (tooWeak) {
      outcome.skippedWeak++;
      continue;
    }
    outcome.checked++;
    const verdict = parseClaimVerdict(
      await llmChatJsonWith<unknown>(cfg, buildContradictionMessages(claim, target.title, candidates), {
        meta: { purpose: "claims", userId: user.id, apiKeyId: user.apiKeyId },
        maxTokens: 600,
      }),
      candidates
    );
    opts.onProgress?.(`    「${claim.text.slice(0, 40)}…」→ ${verdict.verdict}`);
    if (!verdict.target) continue;

    const finding: ClaimFinding = {
      claim: claim.text,
      targetId: verdict.target.id,
      targetTitle: verdict.target.title,
      reason: verdict.reason,
      similarity: verdict.target.similarity ?? null,
      score: verdict.target.score,
    };
    if (opts.write) {
      // 候选内容 = 这条主张本身：裁决时可"采用新内容"修正目标、"合并"人工改写
      // 正文、或"分别保留"把主张建为新条目；出处写在正文里，人看得见来路。
      const body = [
        `> 主张（出自《${target.title}》）：${claim.text}`,
        claim.quote ? `\n原文片段：\n> ${claim.quote}` : "",
        `\n（由 claim 审计提出：《${target.title}》的这条主张与本文条目存在事实冲突。${verdict.reason}）`,
      ]
        .join("\n")
        .trim();
      finding.reviewId = await enqueueReview(user, {
        kind: "conflict",
        source: "claims",
        payload: {
          type: "Note",
          title: claim.text,
          category: target.category ?? undefined,
          tags: [],
          status: "draft",
          body,
        },
        targetConceptId: verdict.target.id,
        targetTitle: verdict.target.title,
        similarity: verdict.target.similarity ?? null,
        score: verdict.target.score,
        reason: `主张审计：与《${verdict.target.title}》矛盾 — ${verdict.reason}`,
      });
    }
    outcome.findings.push(finding);
  }
  return outcome;
}
