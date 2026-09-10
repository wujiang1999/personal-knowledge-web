"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pollTask, startTask } from "@/lib/task-poll";

/** 批量补齐缺失描述：入队一个 resummarize 任务，边跑边显示 x/y。
 *
 * 长任务不占请求生命周期（见 lib/tasks 的执行租约）——所以按钮只负责提交与
 * 轮询，真正的进度与逐条结果都落在任务行里，刷新页面也能接着看。 */

interface Progress {
  done: number;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
}

const RESUMMARIZE_MAX_BATCH = 50;

export function ResummarizeButton({ missing }: { missing: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onRun() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setProgress({ done: 0, total: Math.min(missing, RESUMMARIZE_MAX_BATCH), updated: 0, skipped: 0, failed: 0 });
    try {
      const id = await startTask({ kind: "resummarize", limit: Math.min(missing, RESUMMARIZE_MAX_BATCH) });
      const task = await pollTask(id, {
        intervalMs: 1500,
        maxAttempts: 120, // 每条约 0.2-0.6s，50 条留足 3 分钟
        onTick: (t) => {
          const r = (t.result ?? {}) as Partial<Progress>;
          setProgress({
            done: r.done ?? 0,
            total: r.total ?? 0,
            updated: r.updated ?? 0,
            skipped: r.skipped ?? 0,
            failed: r.failed ?? 0,
          });
        },
      });
      if (task.status === "done") {
        const r = (task.result ?? {}) as Partial<Progress>;
        setNotice(`已处理 ${r.done ?? 0}/${r.total ?? 0} 条：写入 ${r.updated ?? 0}、跳过 ${r.skipped ?? 0}、失败 ${r.failed ?? 0}`);
        setProgress(null);
        router.refresh();
        return;
      }
      if (task.status === "failed") {
        setError(task.error ?? "任务失败");
        return;
      }
      setError("任务仍在后台执行：稍后刷新本页查看结果（同一批不会重复启动）");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败（网络错误）");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={onRun}
        disabled={busy || missing === 0}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {busy ? "正在补齐…" : missing === 0 ? "没有缺失描述" : `补齐缺失描述（${missing} 条）`}
      </button>
      {progress && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          进度 {progress.done}/{progress.total}：写入 {progress.updated}、跳过 {progress.skipped}、失败 {progress.failed}
        </p>
      )}
      {notice && <p className="text-sm text-green-600 dark:text-green-400">{notice}</p>}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
