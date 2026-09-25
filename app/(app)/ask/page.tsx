import Link from "next/link";
import { AskPanel } from "@/components/ask-panel";
import { CollapsibleSection } from "@/components/collapsible-section";
import { ConceptBody } from "@/components/concept-body";
import type { AskPayload, AskResult } from "@/lib/ask";
import { requireUser } from "@/lib/requireUser";
import { listTasks } from "@/lib/tasks";

/** 问答页：提出问题，答案与出处都留在任务行里（可回看）。
 *
 * 这里是唯一渲染答案的地方——答案的 Markdown 走 ConceptBody，与条目正文同一套
 * 渲染路径（服务端渲染，客户端不引 markdown 库）。引用以 [n] 原样留在答案文本里，
 * 下面再给出可点的来源清单。 */

const HISTORY_LIMIT = 20;

export default async function AskPage() {
  const user = await requireUser();
  const tasks = await listTasks<AskResult, AskPayload>(user, { kind: "ask", limit: HISTORY_LIMIT });
  const history = tasks.filter((t) => t.status === "done" && t.result);
  const failed = tasks.filter((t) => t.status === "failed");
  const running = tasks.filter((t) => t.status === "queued" || t.status === "running");

  return (
    <div className="space-y-6">
      <div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          基于库内条目的检索增强问答：先混合检索（BM25 + 语义），再让模型**只依据检索结果**作答，
          每条结论标出 [n] 来源编号。检索不到就直说，不会编。
        </p>
      </div>

      <AskPanel />

      {running.length > 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {running.length} 个问题正在生成中——刷新本页可看结果。
        </p>
      )}

      {failed.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <p className="font-medium">最近 {failed.length} 次提问未完成</p>
          <ul className="mt-1 space-y-0.5">
            {failed.slice(0, 3).map((t) => (
              <li key={t.id}>
                「{t.payload.question}」：{t.error ?? "未知错误"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <CollapsibleSection
        title="问答历史"
        count={history.length}
        newest={history[0]?.createdAt ?? null}
        newestLabel="最近提问"
      >
        {history.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">还没有问答记录</p>
        ) : (
          <ul className="divide-y border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
            {history.map((task) => (
              <li key={task.id} className="space-y-2 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{task.payload.question}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {new Date(task.createdAt).toLocaleString("zh-CN")}
                  </span>
                  {task.result && (
                    <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
                      检索 {task.result.sources.length} 条资料 · {task.result.model} · {task.result.tookMs}ms
                    </span>
                  )}
                </div>
                {task.result && (
                  <div className="prose prose-sm prose-zinc max-w-none rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 dark:prose-invert [&>pre]:overflow-x-auto">
                    <ConceptBody body={task.result.answer} titleToId={new Map()} />
                  </div>
                )}
                {task.result && task.result.citations.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">来源：</span>
                    {task.result.citations.map((c) => (
                      <Link
                        key={c.id}
                        href={`/knowledge/${c.id}`}
                        className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 hover:underline dark:bg-blue-900 dark:text-blue-300"
                      >
                        [{c.marker}] {c.title}
                      </Link>
                    ))}
                  </div>
                )}
                {task.result && task.result.sources.length > 0 && task.result.citations.length === 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">本次检索到的资料（答案未标注引用）：</span>
                    {task.result.sources.map((s) => (
                      <Link
                        key={s.id}
                        href={`/knowledge/${s.id}`}
                        className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 hover:underline dark:bg-zinc-800 dark:text-zinc-300"
                      >
                        {s.title}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
    </div>
  );
}
