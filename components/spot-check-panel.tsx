"use client";

import Link from "next/link";
import { useState } from "react";
import {
  MANUAL_ISSUE_LABEL,
  MANUAL_ISSUE_TYPES,
  SPOT_CHECK_DEFAULT_SIZE,
  type ManualIssueType,
  type QualitySample,
} from "@/lib/quality-review-contract";

const btn = "rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function SpotCheckPanel({ initialSamples }: { initialSamples: QualitySample[] }) {
  const [samples, setSamples] = useState(initialSamples);
  const [size, setSize] = useState(SPOT_CHECK_DEFAULT_SIZE);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, "ok" | "reported">>({});
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [issueType, setIssueType] = useState<ManualIssueType>("factual");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadSamples() {
    setLoading(true);
    setError("");
    setNotice("");
    setChecked({});
    setReportFor(null);
    try {
      const res = await fetch(`/api/quality/spot-check?limit=${size}`);
      const data = (await res.json().catch(() => ({}))) as { samples?: QualitySample[]; error?: string };
      if (!res.ok || !data.samples) throw new Error(data.error ?? `抽查失败（HTTP ${res.status}）`);
      setSamples(data.samples);
    } catch (err) {
      setError(err instanceof Error ? err.message : "抽查失败（网络错误）");
    } finally {
      setLoading(false);
    }
  }

  async function report(sample: QualitySample) {
    if (!note.trim()) {
      setError("请先写明问题");
      return;
    }
    setBusyId(sample.id);
    setError("");
    try {
      const res = await fetch("/api/quality/spot-check/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conceptId: sample.id, issueType, note: note.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `报告失败（HTTP ${res.status}）`);
      setChecked((current) => ({ ...current, [sample.id]: "reported" }));
      setReportFor(null);
      setNote("");
      setNotice(`已把「${sample.title}」加入审核队列。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "报告失败（网络错误）");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">人工抽查</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">每次从当前知识库重新随机取样。确认无误只记录在本次页面会话；报告问题会进入审核队列。</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            aria-label="抽查样本数"
          >
            {[1, 3, 5].map((value) => <option key={value} value={value}>{value} 条</option>)}
          </select>
          <button onClick={loadSamples} disabled={loading} className={btn}>{loading ? "抽取中…" : "换一批"}</button>
        </div>
      </div>

      {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {notice && <p className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">{notice} <Link href="/reviews" className="underline">前往审核</Link></p>}

      {samples.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700">当前没有可抽查的条目</p>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {samples.map((sample) => {
            const state = checked[sample.id];
            const preview = sample.body.slice(0, 1200);
            return (
              <article key={sample.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/knowledge/${sample.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">{sample.title}</Link>
                  {sample.category && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{sample.category}</span>}
                  <span className="ml-auto text-xs text-zinc-400">v{sample.version}</span>
                </div>
                {sample.description && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sample.description}</p>}
                <div className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-xs leading-5 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                  {preview}{sample.body.length > preview.length ? "…" : ""}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button onClick={() => setChecked((current) => ({ ...current, [sample.id]: "ok" }))} disabled={state === "reported"} className={btn}>
                    {state === "ok" ? "已确认无问题" : "无问题"}
                  </button>
                  <button onClick={() => { setReportFor(reportFor === sample.id ? null : sample.id); setError(""); }} disabled={state === "reported"} className={btn}>
                    {state === "reported" ? "已报告" : "报告问题"}
                  </button>
                  <Link href={`/knowledge/${sample.id}`} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">查看完整条目</Link>
                </div>
                {reportFor === sample.id && (
                  <div className="mt-3 space-y-2">
                    <select value={issueType} onChange={(event) => setIssueType(event.target.value as ManualIssueType)} className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900">
                      {MANUAL_ISSUE_TYPES.map((type) => <option key={type} value={type}>{MANUAL_ISSUE_LABEL[type]}</option>)}
                    </select>
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} placeholder="说明具体问题；后续可在审核页编辑正确内容。" className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900" />
                    <button onClick={() => report(sample)} disabled={busyId === sample.id} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
                      {busyId === sample.id ? "提交中…" : "加入审核队列"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-zinc-400">抽查不会自动修改知识内容；所有修改都需在审核页确认，并保留为可回滚的新版本。</p>
    </section>
  );
}
