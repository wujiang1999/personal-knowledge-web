import type { DiffLine } from "@/lib/diff";

/** 行级差异展示（版本对比、审核队列共用）。纯展示、无状态：调用方用 lib/diff
 * 算出 DiffLine[]，再用 heading 说明左右两侧各是什么内容——同一份差异语义
 * （− 只在旧侧、+ 只在新侧）在两处场景下必须长得一模一样。 */
export function DiffView({ heading, lines }: { heading: React.ReactNode; lines: DiffLine[] }) {
  return (
    <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-950">
      <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">{heading}</p>
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
