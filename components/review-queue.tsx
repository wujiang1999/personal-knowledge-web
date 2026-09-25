"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { diffLines } from "@/lib/diff";
import { DiffView } from "@/components/diff-view";
import { REVIEW_ACTION_LABEL, REVIEW_KIND_LABEL, REVIEW_SOURCE_LABEL } from "@/lib/review-labels";

/** 一条待裁决记录在客户端的形态：两份正文 + 服务端算好的合并草稿。
 * 草稿由服务端给出而不是客户端拼接，合并规则因此只有一处定义。 */
export interface ReviewCardItem {
  id: string;
  kind: string;
  source: string;
  title: string;
  targetId: string | null;
  targetTitle: string | null;
  targetBody: string;
  newBody: string;
  mergedDraft: string;
  similarity: number | null;
  score: number | null;
  reason: string | null;
  stale: boolean;
  createdAt: string;
}

const btnPrimary =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const btnSecondary =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";
const textareaCls =
  "mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500";

/** 待裁决卡片列表。每张卡片就是一次「写路径被拦下」的完整上下文：候选内容、
 * 它撞上的条目、判别信号，以及四个出口。裁决成功即刷新（卡片从队列消失，
 * 内容已落到不可变版本上，仍可从条目详情页回滚）。 */
export function ReviewQueue({ items }: { items: ReviewCardItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [mergeFor, setMergeFor] = useState<string | null>(null);
  const [mergeText, setMergeText] = useState("");

  async function resolve(item: ReviewCardItem, action: string, extra?: { body?: string }) {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${item.id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError({ id: item.id, message: data.error ?? `裁决失败（HTTP ${res.status}）` });
        return;
      }
      setMergeFor(null);
      setDiffFor(null);
      setNotice(`已裁决「${item.title}」：${REVIEW_ACTION_LABEL[action] ?? action}`);
      router.refresh();
    } catch {
      setError({ id: item.id, message: "裁决失败（网络错误）" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {notice && <p className="text-sm text-green-600 dark:text-green-400">{notice}</p>}
      {items.map((item) => {
        const lines = diffLines(item.targetBody, item.newBody);
        const changes = lines.filter((l) => l.kind !== "same").length;
        const busy = busyId === item.id;
        const qualityRisk = item.kind === "quality_risk";
        const canApply = item.newBody.trim() !== item.targetBody.trim();
        const stale = qualityRisk && item.stale;
        return (
          <article
            key={item.id}
            className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {REVIEW_KIND_LABEL[item.kind] ?? item.kind}
              </span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {REVIEW_SOURCE_LABEL[item.source] ?? item.source}
              </span>
              <span className="font-medium">{item.title}</span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                {new Date(item.createdAt).toLocaleString("zh-CN")}
              </span>
              <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
                撞上：
                {item.targetId ? (
                  <Link href={`/knowledge/${item.targetId}`} className="text-blue-600 hover:underline dark:text-blue-400">
                    {item.targetTitle ?? "（无标题）"}
                  </Link>
                ) : (
                  <span className="text-zinc-400 dark:text-zinc-500">
                    {item.targetTitle ?? "目标条目已不存在"}
                  </span>
                )}
              </span>
            </div>

            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {item.similarity !== null && `相似度 ${item.similarity.toFixed(2)}；`}
              {item.score !== null && `检索分 ${Math.round(item.score)}；`}
              {item.reason ?? "无判别理由"}
            </p>

            <div className="mt-2">
              <button
                onClick={() => setDiffFor(diffFor === item.id ? null : item.id)}
                className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                {diffFor === item.id ? "收起差异" : `查看差异（${changes} 处）`}
              </button>
              {diffFor === item.id && (
                <DiffView
                  heading={
                    <>
                      目标条目当前正文 → 候选内容（{changes} 处差异）：
                      <span className="text-red-600 dark:text-red-400"> − 只在旧内容里</span>，+
                      只在候选里
                    </>
                  }
                  lines={lines}
                />
              )}
            </div>
            {stale && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                目标条目在本次审阅后已经变化。为避免覆盖新修改，批准与编辑已停用；请忽略此风险并重新运行审阅。
              </p>
            )}

            {error?.id === item.id && (
              <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {error.message}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => resolve(item, "adopted_new")}
                disabled={busy || !item.targetId || stale || (qualityRisk && !canApply)}
                title={stale ? "目标条目在审阅后已经变化" : qualityRisk && !canApply ? "没有可直接采用的修订；请用“编辑建议”人工修改" : undefined}
                className={btnPrimary}
              >
                {busy ? "处理中…" : stale ? "目标已变化" : qualityRisk ? "批准建议（生成新版本）" : "采用新内容（生成新版本）"}
              </button>
              <button
                onClick={() => {
                  setMergeFor(mergeFor === item.id ? null : item.id);
                  setMergeText(qualityRisk ? item.newBody : item.mergedDraft);
                }}
                disabled={busy || !item.targetId || stale}
                className={btnSecondary}
              >
                {mergeFor === item.id ? "取消编辑" : qualityRisk ? "编辑建议…" : "合并…"}
              </button>
              {!qualityRisk && (
                <button
                  onClick={() => {
                    if (
                      item.targetTitle === item.title &&
                      !window.confirm(
                        "候选与目标同名，分别保留会产生两条同名条目。继续吗？"
                      )
                    ) {
                      return;
                    }
                    resolve(item, "kept_both");
                  }}
                  disabled={busy}
                  className={btnSecondary}
                >
                  分别保留（新建条目）
                </button>
              )}
              <button onClick={() => resolve(item, "kept_old")} disabled={busy} className={btnSecondary}>
                {qualityRisk ? "忽略风险" : "保留旧内容"}
              </button>
            </div>

            {mergeFor === item.id && !stale && (
              <div className="mt-2">
                <textarea
                  value={mergeText}
                  onChange={(e) => setMergeText(e.target.value)}
                  rows={12}
                  className={textareaCls}
                />
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {qualityRisk
                    ? "请在当前建议稿上核对并编辑；保存后进入目标条目的新版本（可回滚）。"
                    : "草稿是「旧正文 + 分隔线 + 候选正文」的拼接，请删减成最终版本；保存后进入目标条目的新版本（可回滚）。"}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => resolve(item, "merged", { body: mergeText })}
                    disabled={busy || mergeText.trim().length === 0}
                    className={btnPrimary}
                  >
                    {busy ? "处理中…" : qualityRisk ? "保存修订" : "保存合并结果"}
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
