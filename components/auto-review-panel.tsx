"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ReviewQueue, type ReviewCardItem } from "@/components/review-queue";
import { pollTask, startTask, type PolledTask } from "@/lib/task-poll";
import {
  AUTO_REVIEW_DEFAULT_SIZE,
  AUTO_REVIEW_MAX_SIZE,
  type AutoReviewTaskResult,
} from "@/lib/quality-review-contract";
import type { Task } from "@/lib/tasks";

export function AutoReviewPanel({
  latestTask,
  items,
}: {
  latestTask: Task<AutoReviewTaskResult> | null;
  items: ReviewCardItem[];
}) {
  const router = useRouter();
  const [size, setSize] = useState(AUTO_REVIEW_DEFAULT_SIZE);
  const [liveTask, setLiveTask] = useState<PolledTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const polling = useRef(false);

  const visibleTask = liveTask ?? latestTask;
  const result = visibleTask?.result ? (visibleTask.result as AutoReviewTaskResult) : null;
  const completedAt = visibleTask && "finishedAt" in visibleTask ? visibleTask.finishedAt : null;
  const running = visibleTask?.status === "queued" || visibleTask?.status === "running";

  useEffect(() => {
    if (!latestTask || (latestTask.status !== "queued" && latestTask.status !== "running") || polling.current) return;
    polling.current = true;
    let active = true;
    void pollTask(latestTask.id, {
      maxAttempts: 180,
      onTick: (task) => { if (active) setLiveTask(task); },
    })
      .then((task) => {
        if (!active) return;
        setLiveTask(task);
        if (task.status === "done") router.refresh();
        if (task.status === "failed") setError(task.error ?? "自动审阅失败");
      })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "读取自动审阅进度失败"); })
      .finally(() => { polling.current = false; });
    return () => { active = false; };
  }, [latestTask, router]);

  async function run() {
    setBusy(true);
    setError("");
    setLiveTask(null);
    try {
      const id = await startTask({ kind: "auto-review", limit: size });
      const task = await pollTask(id, {
        maxAttempts: 180,
        onTick: (tick) => setLiveTask(tick),
      });
      setLiveTask(task);
      if (task.status === "failed") throw new Error(task.error ?? "自动审阅失败");
      if (task.status !== "done") throw new Error("自动审阅仍在后台运行，请稍后刷新");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "自动审阅失败（网络错误）");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">自动审阅</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">模型只标风险并给出可选修订草稿；不会直接写知识库。批准后才生成新版本。</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={size} onChange={(event) => setSize(Number(event.target.value))} disabled={running} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" aria-label="自动审阅样本数">
            {[1, 3, 5].map((value) => <option key={value} value={value}>{value} 条</option>)}
          </select>
          <button onClick={run} disabled={busy || running} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
            {running ? "审阅中…" : busy ? "提交中…" : "开始自动审阅"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {result && (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span>样本 <strong>{result.completed}/{result.total}</strong></span>
            <span>发现风险 <strong>{result.flagged}</strong></span>
            <span>新入队 <strong>{result.queued}</strong></span>
            {result.skippedOversized > 0 && <span>超长跳过 <strong>{result.skippedOversized}</strong></span>}
            {result.failed > 0 && <span className="text-red-600 dark:text-red-400">失败 <strong>{result.failed}</strong></span>}
          </div>
          {running && result.currentTitle && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">正在检查：{result.currentTitle}</p>}
          {!running && visibleTask?.status === "done" && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">最近完成：{completedAt ? new Date(completedAt).toLocaleString("zh-CN") : "刚刚"}</p>}
        </div>
      )}

      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">待处理风险 <span className="text-zinc-400">{items.length}</span></h3>
          <Link href="/reviews" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">查看全部审核记录</Link>
        </div>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">当前没有待处理的自动审阅风险</p>
        ) : (
          <ReviewQueue items={items} />
        )}
      </div>
      <p className="mt-4 text-xs text-zinc-400">单次最多 {AUTO_REVIEW_MAX_SIZE} 条；过长正文会跳过，避免截断后生成不完整修订。</p>
    </section>
  );
}
