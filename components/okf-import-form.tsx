"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ImportReport {
  total: number;
  imported: { id: string; title: string }[];
  duplicates: { title: string; existingId: string; existingTitle: string }[];
  conflicts: { title: string; existingId: string; existingTitle: string }[];
  errors: { path: string; error: string }[];
}

/** OKF 导入表单：选择导出的 ZIP，原始字节 POST 到 /api/import/okf，
 * 逐项展示 新建/重复/冲突/错误 报告（冲突绝不静默覆盖，留在报告里人工裁决）。 */
export function OkfImportForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重选同一文件
    if (!file) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/import/okf", {
        method: "POST",
        headers: { "X-Filename": file.name },
        body: file,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `导入失败（HTTP ${res.status}）`);
        return;
      }
      setReport((await res.json()) as ImportReport);
      router.refresh();
    } catch {
      setError("导入失败（网络错误）");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        type="file"
        accept=".zip"
        onChange={onPick}
        disabled={busy}
        className="block w-full cursor-pointer rounded-md border border-zinc-300 bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-white dark:border-zinc-700 dark:bg-zinc-900 dark:file:bg-zinc-100 dark:file:text-zinc-900"
      />
      {busy && <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">导入中…</p>}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {report && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-zinc-500 dark:text-zinc-400">
            共解析 {report.total} 个条目：新建 {report.imported.length}、重复 {report.duplicates.length}、冲突{" "}
            {report.conflicts.length}、失败 {report.errors.length}
          </p>
          {report.imported.length > 0 && (
            <div>
              <p className="font-medium">✅ 已导入</p>
              <ul className="mt-1 space-y-0.5">
                {report.imported.map((r) => (
                  <li key={r.id}>
                    <a href={`/knowledge/${r.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                      {r.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.duplicates.length > 0 && (
            <div>
              <p className="font-medium">⏭️ 内容完全相同，已复用已有条目</p>
              <ul className="mt-1 space-y-0.5 text-zinc-500 dark:text-zinc-400">
                {report.duplicates.map((r) => (
                  <li key={r.existingId + r.title}>
                    <a href={`/knowledge/${r.existingId}`} className="hover:underline">
                      {r.title}
                    </a>
                    <span className="ml-1">（同「{r.existingTitle}」）</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.conflicts.length > 0 && (
            <div>
              <p className="font-medium text-amber-600 dark:text-amber-400">⚠️ 同名但内容不同，未导入（请人工裁决）</p>
              <ul className="mt-1 space-y-0.5 text-zinc-500 dark:text-zinc-400">
                {report.conflicts.map((r) => (
                  <li key={r.existingId + r.title}>
                    <a href={`/knowledge/${r.existingId}`} className="hover:underline">
                      {r.title}
                    </a>
                    <span className="ml-1">（已有条目内容不同，可打开后手动合并）</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.errors.length > 0 && (
            <div>
              <p className="font-medium text-red-600 dark:text-red-400">❌ 解析失败</p>
              <ul className="mt-1 space-y-0.5 text-zinc-500 dark:text-zinc-400">
                {report.errors.map((r) => (
                  <li key={r.path}>
                    <span className="font-mono text-xs">{r.path}</span> — {r.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
