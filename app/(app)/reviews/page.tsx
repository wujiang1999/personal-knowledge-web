import Link from "next/link";
import { CollapsibleSection } from "@/components/collapsible-section";
import { ReviewQueue, type ReviewCardItem } from "@/components/review-queue";
import { REVIEW_ACTION_LABEL, REVIEW_KIND_LABEL, REVIEW_SOURCE_LABEL } from "@/lib/review-labels";
import { requireUser } from "@/lib/requireUser";
import {
  countReviewItems,
  listReviewItems,
  mergeDraft,
  REVIEW_KINDS,
  REVIEW_SOURCES,
  type ReviewKind,
  type ReviewSource,
} from "@/lib/reviews";

/** 审核队列页：写路径拦下的内容在这里等一个人来裁决。
 *
 * 页面只读两份列表（待裁决 / 已裁决），合并草稿由服务端算好随卡片下发——
 * 合并规则只定义在 lib/reviews，客户端不复制一份。 */

const PENDING_LIMIT = 50;

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; source?: string }>;
}) {
  const user = await requireUser();
  const filters = await searchParams;
  const kind = (REVIEW_KINDS as readonly string[]).includes(filters.kind ?? "")
    ? (filters.kind as ReviewKind)
    : undefined;
  const source = (REVIEW_SOURCES as readonly string[]).includes(filters.source ?? "")
    ? (filters.source as ReviewSource)
    : undefined;
  const [pending, resolved, pendingTotal] = await Promise.all([
    listReviewItems(user, { status: "pending", kind, source, limit: PENDING_LIMIT }),
    listReviewItems(user, { status: "resolved", kind, source, limit: 20 }),
    countReviewItems(user, { status: "pending", kind, source }),
  ]);

  const cards: ReviewCardItem[] = pending.map((item) => ({
    id: item.id,
    kind: item.kind,
    source: item.source,
    title: item.title,
    targetId: item.targetConceptId,
    targetTitle: item.targetTitle,
    targetBody: item.targetBody ?? "",
    stale: item.stale,
    newBody: item.payload.body,
    mergedDraft: mergeDraft(item.targetBody ?? "", item.payload.body),
    similarity: item.similarity,
    score: item.score,
    reason: item.reason,
    createdAt: item.createdAt,
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          写路径拦下的内容与知识质检风险都在这里等人工裁决：近似重复、同名异内容、agent 判出的冲突，以及人工/模型发现的质量问题。
          采用建议或保存人工修订都会生成可回滚的新版本；保留旧内容只结案，冲突候选也可分别保留。
        </p>
      </div>

      <form method="get" action="/reviews" className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="text-xs text-zinc-500 dark:text-zinc-400">
          <span className="mb-1 block">风险类型</span>
          <select name="kind" defaultValue={kind ?? ""} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">全部类型</option>
            {REVIEW_KINDS.map((value) => <option key={value} value={value}>{REVIEW_KIND_LABEL[value]}</option>)}
          </select>
        </label>
        <label className="text-xs text-zinc-500 dark:text-zinc-400">
          <span className="mb-1 block">来源</span>
          <select name="source" defaultValue={source ?? ""} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">全部来源</option>
            {REVIEW_SOURCES.map((value) => <option key={value} value={value}>{REVIEW_SOURCE_LABEL[value]}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">筛选</button>
        {(kind || source) && <Link href="/reviews" className="px-2 py-2 text-sm text-zinc-500 hover:underline dark:text-zinc-400">清除</Link>}
      </form>

      {cards.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-10 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500">
          队列是空的——没有符合当前筛选条件的待裁决内容
        </p>
      ) : (
        <>
          <ReviewQueue items={cards} />
          {pendingTotal > cards.length && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              还有 {pendingTotal - cards.length} 条待裁决未显示（本页最多 {PENDING_LIMIT} 条）。
            </p>
          )}
        </>
      )}

      <CollapsibleSection
        title="已裁决"
        count={resolved.length}
        newest={resolved[0]?.resolvedAt ?? null}
        newestLabel="最近裁决"
      >
        {resolved.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">{kind || source ? "当前筛选下没有已裁决记录" : "还没有裁决记录"}</p>
        ) : (
          <ul className="divide-y border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
            {resolved.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {item.resolvedAction ? REVIEW_ACTION_LABEL[item.resolvedAction] ?? item.resolvedAction : "—"}
                </span>
                <span className="font-medium">{item.title}</span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {REVIEW_SOURCE_LABEL[item.source] ?? item.source}
                </span>
                {item.resolvedConceptId && (
                  <Link
                    href={`/knowledge/${item.resolvedConceptId}`}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    查看条目
                  </Link>
                )}
                <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
                  {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString("zh-CN") : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
    </div>
  );
}
