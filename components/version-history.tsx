"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { diffLines, type DiffLine } from "@/lib/diff";

interface VersionRow {
  id: string;
  version_number: number;
  title: string | null;
  body_markdown: string;
  content_hash: string;
  generated_by: string | null;
  created_at: string;
}

/** 版本历史（只读列表 + 与当前版本对比 + 一键回滚）。回滚不重写任何历史：
 * 它把所选版本的内容与元数据生成为新版本，因此回滚本身也可再回滚。 */
export function VersionHistory({
  conceptId,
  currentVersion,
  versions,
}: {
  conceptId: string;
  currentVersion: number;
  versions: VersionRow[];
}) {
  const router = useRouter();
  const [diffFor, setDiffFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // 版本可以累积到几十条：默认只展开最近几条，其余「显示全部」一键展开。
  const [showAll, setShowAll] = useState(false);
  const COLLAPSED_COUNT = 5;
  const current = versions.find((v) => v.version_number === currentVersion);

  async function rollback(n: number) {
    if (
      !window.confirm(
        `回滚到 v${n}？将以新版本（v${currentVersion + 1}）恢复该版本的内容与元数据；当前内容仍保留在版本历史中。`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/concepts/${conceptId}/versions/${n}/restore`, { method: "POST" });
      if (!res.ok) {
        alert("回滚失败");
        return;
      }
      setDiffFor(null);
      router.refresh();
    } catch {
      alert("回滚失败（网络错误）");
    } finally {
      setBusy(false);
    }
  }

  const visible = showAll ? versions : versions.slice(0, COLLAPSED_COUNT);
  const hiddenCount = versions.length - visible.length;
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {visible.map((v) => (
          <li key={v.id} className="px-4 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono">v{v.version_number}</span>
              {v.version_number === currentVersion && (
                <span className="text-xs text-green-600 dark:text-green-400">当前</span>
              )}
              <span className="text-zinc-500 dark:text-zinc-400">{new Date(v.created_at).toLocaleString("zh-CN")}</span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">{v.content_hash.slice(7, 19)}</span>
              {v.generated_by && <span className="text-xs text-zinc-400 dark:text-zinc-500">{v.generated_by}</span>}
              <span className="ml-auto flex items-center gap-2">
                {v.version_number !== currentVersion && current && (
                  <button
                    onClick={() => setDiffFor(diffFor === v.version_number ? null : v.version_number)}
                    className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    {diffFor === v.version_number ? "收起对比" : "对比当前"}
                  </button>
                )}
                {v.version_number !== currentVersion && (
                  <button
                    onClick={() => rollback(v.version_number)}
                    disabled={busy}
                    className="text-xs text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
                  >
                    回滚到此版本
                  </button>
                )}
              </span>
            </div>
            {diffFor === v.version_number && current && (
              <DiffView oldVersion={v.version_number} currentVersion={currentVersion} lines={diffLines(v.body_markdown, current.body_markdown)} />
            )}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          显示全部 {versions.length} 条版本（还有 {hiddenCount} 条更早的）
        </button>
      )}
    </div>
  );
}

function DiffView({
  oldVersion,
  currentVersion,
  lines,
}: {
  oldVersion: number;
  currentVersion: number;
  lines: DiffLine[];
}) {
  const changes = lines.filter((l) => l.kind !== "same").length;
  return (
    <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-950">
      <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">
        v{oldVersion} → 当前 v{currentVersion}（{changes} 处差异）：
        <span className="text-red-600 dark:text-red-400"> − 为旧版内容（回滚会恢复）</span>，+
        为当前内容（回滚会移除）
      </p>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === "add"
                ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
                : l.kind === "del"
                  ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                  : "text-zinc-500 dark:text-zinc-500"
            }
          >
            {l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
