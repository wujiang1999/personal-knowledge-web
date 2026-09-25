import { getConceptDetail, type ConceptDetail } from "./concepts";
import { query } from "./db";
import { llmChatJson } from "./llm";
import { enqueueReview, reviewTargetFingerprint } from "./reviews";
import type { ScopeUser } from "./requireUser";
import { claimTask, failTask, finishTask, progressTask } from "./tasks";
import {
  AUTO_REVIEW_MAX_BODY_CHARS,
  AUTO_REVIEW_MAX_SIZE,
  QUALITY_RISK_LABEL,
  SPOT_CHECK_MAX_SIZE,
  MANUAL_ISSUE_LABEL,
  parseAutoReviewAssessment,
  type AutoReviewAssessment,
  type AutoReviewTaskResult,
  type ManualIssueType,
  type QualitySample,
} from "./quality-review-contract";

interface SampleRow {
  id: string;
  current_version: number;
  type: string;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  status: string;
  body_markdown: string;
}

/** Uniform random draw from the caller's live knowledge base. The corpus is a
 * personal library (hundreds of rows), so ORDER BY random() is both simpler and
 * less error-prone than TABLESAMPLE, which can return no row on small tables. */
export async function sampleConcepts(user: ScopeUser, limit: number): Promise<QualitySample[]> {
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), SPOT_CHECK_MAX_SIZE);
  const scope = user.role === "admin" ? "" : "AND c.owner_id = $2";
  const params = user.role === "admin" ? [bounded] : [bounded, user.id];
  const { rows } = await query<SampleRow>(
    `SELECT c.id, c.current_version, c.type, c.title, c.description, c.category,
            c.tags, c.status, v.body_markdown
       FROM concepts c
       JOIN concept_versions v
         ON v.concept_id = c.id AND v.version_number = c.current_version
      WHERE c.deleted_at IS NULL ${scope}
      ORDER BY random()
      LIMIT $1`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    version: row.current_version,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: row.tags,
    status: row.status,
    body: row.body_markdown,
  }));
}

function currentSample(detail: ConceptDetail): QualitySample | null {
  if (detail.deleted_at) return null;
  const version = detail.versions.find((item) => item.version_number === detail.current_version);
  if (!version) return null;
  return {
    id: detail.id,
    version: detail.current_version,
    type: detail.type,
    title: detail.title,
    description: detail.description,
    category: detail.category,
    tags: detail.tags,
    status: detail.status,
    body: version.body_markdown,
  };
}


/** Persist a human spot-check report as a quality-risk review item. The target is
 * re-read server-side; the browser only sends its id and the report fields. */
export async function reportSpotCheckIssue(
  user: ScopeUser,
  input: { conceptId: string; issueType: ManualIssueType; note: string },
): Promise<{ reviewId: string | null; title: string }> {
  const detail = await getConceptDetail(input.conceptId, user);
  if (!detail) throw new Error("Concept not found");
  const sample = currentSample(detail);
  if (!sample) throw new Error("Concept not found");
  const label = MANUAL_ISSUE_LABEL[input.issueType];
  const reviewId = await enqueueReview(user, {
    kind: "quality_risk",
    source: "spot-check",
    payload: {
      type: sample.type,
      title: sample.title,
      description: sample.description ?? undefined,
      category: sample.category ?? undefined,
      tags: sample.tags,
      status: sample.status,
      body: sample.body,
    },
    baseFingerprint: reviewTargetFingerprint(sample),
    targetConceptId: sample.id,
    targetTitle: sample.title,
    reason: `人工抽查 · ${label}：${input.note}`.slice(0, 4000),
  });
  return { reviewId, title: sample.title };
}

function buildAutoReviewMessages(sample: QualitySample) {
  return [
    {
      role: "system" as const,
      content: [
        "你是个人知识库的审阅员。只依据给定样本判断，不声称完成了联网事实核验。",
        "检查明确的事实/数值错误、可能过时、库内自相矛盾、关键条件缺失、隐私敏感信息和明显结构问题；",
        "纯措辞偏好、没有证据的猜测和为了显得具体而编造的内容不算风险。",
        "宁可少报也不要误报。suggestedBody 只在修改有充分依据且能保留全部无关原文时返回完整正文；",
        "无法给出无歧义修改时省略 suggestedBody。",
        "仅返回 JSON：",
        '{"hasRisk":boolean,"riskLevel":"none|low|medium|high","summary":"简短结论",',
        '"findings":[{"type":"风险类型","severity":"low|medium|high","evidence":"样本中的具体证据","recommendation":"建议"}],',
        '"suggestedBody":"可选的完整修订正文"}',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        title: sample.title,
        type: sample.type,
        description: sample.description,
        category: sample.category,
        tags: sample.tags,
        status: sample.status,
        body: sample.body,
      }),
    },
  ];
}

async function assessConcept(user: ScopeUser, sample: QualitySample): Promise<AutoReviewAssessment> {
  const raw = await llmChatJson<unknown>(buildAutoReviewMessages(sample), {
    meta: { purpose: "auto-review", userId: user.id, apiKeyId: user.apiKeyId },
    maxTokens: 1800,
    temperature: 0,
  });
  return parseAutoReviewAssessment(raw);
}


/** Run a user-triggered sample review. Each concept is an independent model
 * call so one malformed answer cannot erase the rest of the batch. Findings are
 * queued only; this function never writes concept content. */
export async function executeAutoReviewTask(
  taskId: string,
  user: ScopeUser,
  limit: number,
): Promise<void> {
  const startedAt = Date.now();
  const result: AutoReviewTaskResult = {
    total: 0,
    completed: 0,
    flagged: 0,
    queued: 0,
    skippedOversized: 0,
    failed: 0,
    currentTitle: null,
    finished: false,
  };
  try {
    if (!(await claimTask(taskId))) return;
    const samples = await sampleConcepts(user, Math.min(limit, AUTO_REVIEW_MAX_SIZE));
    result.total = samples.length;
    await progressTask(taskId, result);

    for (const sample of samples) {
      result.currentTitle = sample.title;
      if (sample.body.length > AUTO_REVIEW_MAX_BODY_CHARS) {
        result.skippedOversized += 1;
        result.completed += 1;
        await progressTask(taskId, result);
        continue;
      }
      try {
        const assessment = await assessConcept(user, sample);
        if (assessment.hasRisk) {
          const details = assessment.findings
            .map((finding) => `• ${finding.type}：${finding.evidence}；建议：${finding.recommendation}`)
            .join("\n");
          const reason = `${QUALITY_RISK_LABEL[assessment.riskLevel]}：${assessment.summary}\n${details}`.slice(0, 4000);
          result.flagged += 1;
          const id = await enqueueReview(user, {
            kind: "quality_risk",
            source: "auto-review",
            payload: {
              type: sample.type,
              title: sample.title,
              description: sample.description ?? undefined,
              category: sample.category ?? undefined,
              tags: sample.tags,
              status: sample.status,
              body: assessment.suggestedBody ?? sample.body,
            },
            baseFingerprint: reviewTargetFingerprint(sample),
            targetConceptId: sample.id,
            targetTitle: sample.title,
            reason: `自动审阅：${reason}`,
          });
          if (id) result.queued += 1;
        }
      } catch (error) {
        result.failed += 1;
        console.error("[quality] 自动审阅样本失败:", sample.title, error instanceof Error ? error.message : error);
      }
      result.completed += 1;
      await progressTask(taskId, result);
    }

    result.finished = true;
    result.tookMs = Date.now() - startedAt;
    if (!(await finishTask(taskId, result))) {
      console.error("[quality] 自动审阅结果被丢弃：任务已不在执行中:", taskId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[quality] 自动审阅任务失败:", message);
    await failTask(taskId, message).catch(() => {});
  }
}
