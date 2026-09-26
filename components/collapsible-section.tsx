/** Collapsible section shared by the record-heavy pages (/logs, /trash,
 * /sources): collapsed by default — the tables run 100+ rows — while the
 * summary always shows the row count and the newest timestamp so the section
 * stays scannable without expanding. Server component: pure markup, no state. */
export function CollapsibleSection({
  title,
  count,
  newest,
  newestLabel = "最新",
  children,
}: {
  title: string;
  count: number;
  newest: string | null;
  /** Wording for the newest timestamp, e.g. "最新" / "最新删除". */
  newestLabel?: string;
  children: React.ReactNode;
}) {
  const summary = `${title} · ${count} 条${newest ? ` · ${newestLabel} ${newest}` : ""}`;
  return (
    <details className="group ui-panel">
      <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <span className="text-xs text-zinc-500 group-open:hidden dark:text-zinc-400">点击展开</span>
        <span className="hidden text-xs text-zinc-500 group-open:inline dark:text-zinc-400">点击收起</span>
      </summary>
      <div className="border-t border-zinc-100 p-4 dark:border-zinc-800">{children}</div>
    </details>
  );
}
