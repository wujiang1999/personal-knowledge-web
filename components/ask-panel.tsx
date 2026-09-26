"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pollTask } from "@/lib/task-poll";

/** 提问框 + 轮询。答案由服务端任务行承载：这里只负责提交、盯着任务状态、
 * 完成后让服务端重新渲染（答案的 Markdown 由 ConceptBody 在服务端渲染，
 * 与条目正文同一套渲染路径，客户端不引 markdown 库）。 */

const POLL_INTERVAL_MS = 1200;
/** 60 次 × 1.2s ≈ 72 秒：够一次 5-30 秒的合成，也不至于让页面无限等。 */
const POLL_ATTEMPTS = 60;

const inputCls =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500";

export function AskPanel() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setStage("正在检索知识库…");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? `提问失败（HTTP ${res.status}）`);
        return;
      }
      setStage("正在检索知识库…");
      const task = await pollTask(data.id, {
        intervalMs: POLL_INTERVAL_MS,
        maxAttempts: POLL_ATTEMPTS,
        onTick: (t) => setStage(t.status === "queued" ? "排队中…" : "正在依据检索结果生成答案…"),
      });
      if (task.status === "done") {
        setQuestion("");
        router.refresh();
        return;
      }
      if (task.status === "failed") {
        setError(task.error ?? "生成失败");
        return;
      }
      setError("生成超时：任务仍在后台执行，稍后刷新本页即可看到答案");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提问失败（网络错误）");
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="ui-panel p-6">
      <label className="mb-1 block text-sm text-zinc-600 dark:text-zinc-300" htmlFor="ask-question">
        问点什么（答案只依据知识库里检索到的条目，并逐句标注来源）
      </label>
      <textarea
        id="ask-question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        maxLength={500}
        placeholder="例如：知识库里关于 KV cache 的显存开销是怎么说的？"
        className={inputCls}
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || question.trim().length === 0}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60 dark:bg-brand-300 dark:text-brand-950 dark:hover:bg-brand-200"
        >
          {busy ? "生成中…" : "提问"}
        </button>
        {stage && <p className="text-sm text-zinc-500 dark:text-zinc-400">{stage}</p>}
      </div>
      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
