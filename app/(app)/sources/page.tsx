import Link from "next/link";
import { requireUser } from "@/lib/requireUser";
import { listSources } from "@/lib/concepts";
import { CollapsibleSection } from "@/components/collapsible-section";

const DAY_RANGES = [1, 7, 30, 90];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; date?: string }>;
}) {
  const user = await requireUser();
  const { days: daysParam, date: dateParam } = await searchParams;

  // Same validated-window pattern as /logs and /stats; `date` (single Beijing
  // calendar day) wins over `days` when both are present.
  const days = DAY_RANGES.includes(Number(daysParam)) ? Number(daysParam) : null;
  const date =
    dateParam && DATE_RE.test(dateParam) && !Number.isNaN(Date.parse(dateParam)) ? dateParam : null;
  const filter = date ? { date } : days ? { days } : undefined;

  const sources = await listSources(user, filter);
  const newest = sources[0]?.created_at ?? null;

  const chip = (label: string, params: Record<string, string | undefined>, active: boolean) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) sp.set(k, v);
    }
    const href = sp.toString() ? `/sources?${sp.toString()}` : "/sources";
    return (
      <Link
        key={label}
        href={href}
        className={`rounded-md px-3 py-1.5 text-sm ${
          active
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        }`}
      >
        {label}
      </Link>
    );
  };

  const filterLabel = date
    ? `筛选：${date}（北京时间当日）`
    : days
      ? `筛选：最近 ${days} 天`
      : null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        每次知识录入的原始输入都会保留，用于可追溯与去重（各显示最新 200 条，{filterLabel ?? "无时间筛选"}）。
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          {chip("全部", {}, !days && !date)}
          {chip("今天", { days: "1" }, !date && days === 1)}
          {chip("近 7 天", { days: "7" }, !date && days === 7)}
          {chip("近 30 天", { days: "30" }, !date && days === 30)}
          {chip("近 90 天", { days: "90" }, !date && days === 90)}
        </div>
        <form method="get" action="/sources" className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="source-date" className="text-zinc-500 dark:text-zinc-400">
            按日期（北京时间当日）：
          </label>
          <input
            id="source-date"
            type="date"
            name="date"
            defaultValue={date ?? ""}
            className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
          />
          <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1.5 text-white dark:bg-zinc-100 dark:text-zinc-900">
            应用
          </button>
          {(date || daysParam) && (
            <Link href="/sources" className="text-zinc-500 hover:underline dark:text-zinc-400">
              清除筛选
            </Link>
          )}
        </form>
      </div>

      <CollapsibleSection title="来源记录" count={sources.length} newest={newest}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">类型</th>
                <th className="px-4 py-2 font-medium">名称 / 哈希</th>
                <th className="px-4 py-2 font-medium">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {sources.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-zinc-400 dark:text-zinc-500">
                    当前筛选范围内没有来源记录
                  </td>
                </tr>
              )}
              {sources.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2">{s.source_type}</td>
                  <td className="px-4 py-2">
                    {s.original_name ? <div>{s.original_name}</div> : <span className="text-zinc-400 dark:text-zinc-500">（正文）</span>}
                    <div className="font-mono text-xs text-zinc-400 dark:text-zinc-500">{String(s.content_hash).slice(7, 27)}</div>
                  </td>
                  <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">{new Date(s.created_at).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </div>
  );
}
