import { addConceptVersion, createConcept, getConceptDetail, sha256Hex, type ConceptInput } from "./concepts";
import { query } from "./db";
import type { AuthUser, ScopeUser } from "./requireUser";

/** 冲突/近似重复审核队列（迁移 0018）。
 *
 * 写路径上的三道治理此前都只「发现」不「安放」：ingest CLI 的近似重复跳过即遗忘、
 * OKF 导入的同名异内容冲突只活在一次性报告里、MCP 判别出的 conflict 只回给 agent
 * 一句话。于是「人工裁决」没有入口，内容被拦下就等于被丢弃。
 *
 * 本模块把三者统一成一张收件箱：**一行待裁决记录 = 一份完整候选内容 + 它撞上的
 * 目标条目 + 来源与相似度信号**。裁决四选一：
 *   kept_old    保留旧内容（仅落状态，知识库不变）
 *   adopted_new 采用新内容（目标条目生成新版本）
 *   merged      合并（目标条目生成新版本，正文取人工编辑后的草稿）
 *   kept_both   分别保留（用候选内容新建条目）
 * 全部走既有的不可变版本/条目写入路径，因此裁决本身也符合「历史不可改写」。 */

/** 待裁决的两种性质：事实冲突（同名异内容）与近似重复（阈值命中但未必冲突）。 */
export const REVIEW_KINDS = ["conflict", "near_duplicate"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/** 谁把它放进队列——报告文案与排查都靠它。 */
export const REVIEW_SOURCES = ["ingest", "okf-import", "mcp", "api"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export const REVIEW_ACTIONS = ["kept_old", "adopted_new", "merged", "kept_both"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const REVIEW_STATUSES = ["pending", "resolved"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const CONCEPT_STATUSES = ["draft", "stable", "deprecated"] as const;

/** 存进 payload 的候选内容：ConceptInput 的规范化形态（默认值已填好）。 */
export interface ReviewPayload {
  type: string;
  title: string;
  description?: string;
  category?: string;
  tags: string[];
  status: (typeof CONCEPT_STATUSES)[number];
  body: string;
}

export function isReviewKind(v: unknown): v is ReviewKind {
  return typeof v === "string" && (REVIEW_KINDS as readonly string[]).includes(v);
}

export function isReviewAction(v: unknown): v is ReviewAction {
  return typeof v === "string" && (REVIEW_ACTIONS as readonly string[]).includes(v);
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * jsonb payload → ConceptInput 形态。行是历史数据（可能由更早的版本写入），
 * 因此逐字段容错而不是抛错：坏字段退化为缺省值，页面永远渲染得出来。
 * 与 ingest 的 validateCandidates 同一取舍——不猜内容，只做边界收敛。
 */
export function normalizePayload(raw: unknown): ReviewPayload {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const status = str(o.status, 16);
  const tags = Array.isArray(o.tags)
    ? o.tags.map((t) => str(t, 64)).filter(Boolean).slice(0, 30)
    : [];
  const description = str(o.description, 1000);
  const category = str(o.category, 200);
  return {
    type: str(o.type, 64) || "Note",
    title: str(o.title, 200),
    description: description || undefined,
    category: category || undefined,
    tags,
    status: (CONCEPT_STATUSES as readonly string[]).includes(status)
      ? (status as ReviewPayload["status"])
      : "stable",
    body: typeof o.body === "string" ? o.body : "",
  };
}

/**
 * 合并草稿：旧正文在前、新正文在后、中间一条分隔线。刻意不做智能去重——
 * 裁决页已经并排给出两份正文的差异，草稿的唯一职责是「不丢内容地」把两边
 * 摆进编辑框，删减交给人的判断。
 */
export function mergeDraft(oldBody: string, newBody: string): string {
  const oldText = oldBody.trim();
  const newText = newBody.trim();
  if (!oldText) return newText;
  if (!newText || oldText === newText) return oldText;
  return `${oldText}\n\n---\n\n${newText}`;
}

export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  source: ReviewSource;
  status: ReviewStatus;
  /** 候选标题（快照，与 payload.title 一致；单独成列便于列表渲染与去重）。 */
  title: string;
  payload: ReviewPayload;
  /** 撞上的目标条目：彻底删除后置 NULL，靠 targetTitle 保持历史可读。 */
  targetConceptId: string | null;
  targetTitle: string | null;
  /** 目标条目当前正文（已删除/无目标时为 null）——裁决页的差异对比用。 */
  targetBody: string | null;
  similarity: number | null;
  score: number | null;
  reason: string | null;
  resolvedAction: ReviewAction | null;
  resolvedConceptId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface EnqueueReviewInput {
  kind: ReviewKind;
  source: ReviewSource;
  /** 完整候选内容（正文不截断：裁决时必须看到全文才能判断）。 */
  payload: ConceptInput;
  targetConceptId?: string | null;
  targetTitle?: string | null;
  similarity?: number | null;
  score?: number | null;
  reason?: string | null;
}

interface ReviewRow {
  id: string;
  kind: string;
  source: string;
  status: string;
  title: string;
  payload: unknown;
  target_concept_id: string | null;
  target_title: string | null;
  target_body: string | null;
  similarity: number | null;
  score: number | null;
  reason: string | null;
  resolved_action: string | null;
  resolved_concept_id: string | null;
  resolved_at: string | Date | null;
  created_at: string | Date;
}

function toItem(row: ReviewRow): ReviewItem {
  return {
    id: row.id,
    kind: isReviewKind(row.kind) ? row.kind : "near_duplicate",
    source: (REVIEW_SOURCES as readonly string[]).includes(row.source)
      ? (row.source as ReviewSource)
      : "api",
    status: row.status === "resolved" ? "resolved" : "pending",
    title: row.title,
    payload: normalizePayload(row.payload),
    targetConceptId: row.target_concept_id,
    targetTitle: row.target_title,
    targetBody: row.target_body,
    similarity: row.similarity,
    score: row.score,
    reason: row.reason,
    resolvedAction: isReviewAction(row.resolved_action) ? row.resolved_action : null,
    resolvedConceptId: row.resolved_concept_id,
    resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** 列表与详情共用的读取面：目标条目的当前正文一并带出（差异对比要用）。
 * 目标已被彻底删除时两个 JOIN 都落空，行仍然返回（LEFT JOIN）。 */
const SELECT_ITEM = `
  SELECT r.id, r.kind, r.source, r.status, r.title, r.payload,
         r.target_concept_id, r.target_title, r.similarity, r.score, r.reason,
         r.resolved_action, r.resolved_concept_id, r.resolved_at, r.created_at,
         v.body_markdown AS target_body
    FROM review_items r
    LEFT JOIN concepts c ON c.id = r.target_concept_id
    LEFT JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version`;

/**
 * 入队。幂等：同一 owner 下「同一目标 + 同一正文哈希」若已有待裁决记录，
 * 返回 null 而不是再插一行（ingest 重跑、导入重试都不会灌满队列）。
 * 目标为 NULL 的去重由 WHERE NOT EXISTS 承担（唯一索引不覆盖 NULL）。
 */
export async function enqueueReview(
  user: ScopeUser,
  input: EnqueueReviewInput
): Promise<string | null> {
  const payload: ReviewPayload = normalizePayload(input.payload);
  const contentHash = sha256Hex(input.payload.body);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO review_items
       (owner_id, kind, source, title, payload, content_hash,
        target_concept_id, target_title, similarity, score, reason)
     SELECT $1, $2, $3, $4, $5::jsonb, $6, $7::uuid, $8, $9, $10, $11
      WHERE NOT EXISTS (
        SELECT 1 FROM review_items
         WHERE owner_id = $1 AND status = 'pending' AND content_hash = $6
           AND target_concept_id IS NOT DISTINCT FROM $7::uuid)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      user.id,
      input.kind,
      input.source,
      payload.title || "(无标题)",
      JSON.stringify(payload),
      contentHash,
      input.targetConceptId ?? null,
      input.targetTitle ?? null,
      input.similarity ?? null,
      input.score ?? null,
      input.reason ?? null,
    ]
  );
  return rows[0]?.id ?? null;
}

export async function listReviewItems(
  user: ScopeUser,
  opts: { status: ReviewStatus; limit?: number; offset?: number }
): Promise<ReviewItem[]> {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? 50)), 200);
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
  const scope = user.role === "admin" ? "" : "AND r.owner_id = $1";
  const order = opts.status === "pending" ? "r.created_at DESC" : "r.resolved_at DESC NULLS LAST";
  const { rows } = await query<ReviewRow>(
    `${SELECT_ITEM} WHERE r.status = $2 ${scope} ORDER BY ${order} LIMIT $3 OFFSET $4`,
    [user.id, opts.status, limit, offset]
  );
  return rows.map(toItem);
}

export async function countReviewItems(user: ScopeUser, status: ReviewStatus): Promise<number> {
  const scope = user.role === "admin" ? "" : "AND owner_id = $1";
  const { rows } = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM review_items WHERE status = $2 ${scope}`,
    [user.id, status]
  );
  return Number(rows[0]?.n ?? 0);
}

export async function getReviewItem(id: string, user: ScopeUser): Promise<ReviewItem | null> {
  const scope = user.role === "admin" ? "" : "AND r.owner_id = $2";
  const { rows } = await query<ReviewRow>(`${SELECT_ITEM} WHERE r.id = $1 ${scope}`, [user.id, id]);
  return rows.length ? toItem(rows[0]) : null;
}

export type ResolveReviewResult =
  | {
      ok: true;
      action: ReviewAction;
      /** 被修改/新建的条目（kept_old 为 null）。 */
      conceptId: string | null;
      /** 是否真的产生了新版本：正文与目标当前版本逐字节相同时为 false。 */
      versionCreated: boolean | null;
    }
  | { ok: false; reason: "not-found" | "already-resolved" | "target-missing" | "target-out-of-scope" | "empty-body" };

export interface ResolveReviewOptions {
  /** merged 用：人工编辑后的正文（缺省回落候选正文）。 */
  body?: string;
  /** kept_both 用：新条目的标题（缺省沿用候选标题）。 */
  title?: string;
}

/**
 * 裁决。先写知识库、后落状态：任何写入失败都让记录留在待裁决区（异常直接
 * 冒泡给路由），绝不出现「状态已裁决、内容却没落地」的假成功。
 * 目标条目的归属在写入前用 getConceptDetail 复核——getReviewItem 只保证
 * 记录本身在作用域内，写入目标必须另行验证。
 */
export async function resolveReview(
  id: string,
  action: ReviewAction,
  user: AuthUser,
  opts: ResolveReviewOptions = {}
): Promise<ResolveReviewResult> {
  const item = await getReviewItem(id, user);
  if (!item) return { ok: false, reason: "not-found" };
  if (item.status !== "pending") return { ok: false, reason: "already-resolved" };

  const edited = typeof opts.body === "string" ? opts.body : null;
  const nextBody = (edited ?? item.payload.body).trim();
  let conceptId: string | null = null;
  let versionCreated: boolean | null = null;

  if (action === "adopted_new" || action === "merged") {
    if (!nextBody) return { ok: false, reason: "empty-body" };
    if (!item.targetConceptId) return { ok: false, reason: "target-missing" };
    const target = await getConceptDetail(item.targetConceptId, user);
    if (!target) return { ok: false, reason: "target-out-of-scope" };
    // 元数据沿用候选内容（采纳新内容就是采纳它的标题/分类/标签），
    // 唯一例外是 merged 允许改正文——标题合并的语义留给用户下一次编辑。
    const saved = await addConceptVersion(
      item.targetConceptId,
      {
        type: item.payload.type,
        title: item.payload.title || target.title,
        description: item.payload.description,
        category: item.payload.category,
        tags: item.payload.tags,
        status: item.payload.status,
        body: nextBody,
        generatedBy: `human:${user.username}`,
      },
      user.username
    );
    conceptId = item.targetConceptId;
    versionCreated = saved.created;
  } else if (action === "kept_both") {
    if (!nextBody) return { ok: false, reason: "empty-body" };
    conceptId = await createConcept(
      {
        type: item.payload.type,
        title: (opts.title ?? item.payload.title).trim() || item.title,
        description: item.payload.description,
        category: item.payload.category,
        tags: item.payload.tags,
        status: item.payload.status,
        body: nextBody,
      },
      user
    );
  }

  await query(
    `UPDATE review_items
        SET status = 'resolved', resolved_action = $2, resolved_concept_id = $3, resolved_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [id, action, conceptId]
  );
  return { ok: true, action, conceptId, versionCreated };
}
