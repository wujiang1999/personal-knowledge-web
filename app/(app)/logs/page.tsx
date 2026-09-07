import Link from "next/link";
import { requireUser } from "@/lib/requireUser";
import {
  listLlmCalls,
  listSearchLogs,
  type LlmCallRow,
  type LogFilter,
  type SearchLogRow,
} from "@/lib/logs";

const LOG_LIMIT = 100;
/** Preset rolling windows for the /logs filter chips (same pattern as /stats). */
const DAY_RANGES = [1, 7, 30, 90];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Static display labels for the two enumerated columns (mode / purpose). */
const MODE_LABEL: Record<string, string> = {
  bm25: "BM25",
  "trgm-fallback": "模糊兜底",
  "semantic-only": "纯语义",
  none: "无结果",
};
const PURPOSE_LABEL: Record<string, string> = {
  "auto-summary": "自动摘要",
  "search-embed": "检索向量化",
  "ingest-atomize": "录入原子化",
  backfill: "向量回填",
  judge: "查重判别",
  chat: "对话",
  embed: "向量化",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function fmtMs(ms: number | null): string {
  return ms === null ? "—" : `${ms} ms`;
}

const th = "border-b border-zinc-200 px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400";
const td = "border-b border-zinc-100 px-3 py-2 align-top dark:border-zinc-800/60";

function SearchTable({ rows, showUser }: { rows: SearchLogRow[]; showUser: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">当前筛选范围内没有查询记录。</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr>
            <th className={th}>时间</th>
            {showUser && <th className={th}>用户</th>}
            <th className={th}>查询词</th>
            <th className={th}>来源</th>
            <th className={th}>路径</th>
            <th className={th}>命中</th>
            <th className={th}>耗时</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={`${td} whitespace-nowrap text-zinc-500 dark:text-zinc-400`}>{fmtTime(r.created_at)}</td>
              {showUser && <td className={td}>{r.username ?? "—"}</td>}
              <td className={`${td} max-w-[280px] break-all`}>{r.query}</td>
              <td className={td}>{r.source}</td>
              <td className={td}>{MODE_LABEL[r.mode] ?? r.mode}</td>
              <td className={td}>
                {r.result_count}/{r.total}
              </td>
              <td className={td}>{fmtMs(r.took_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CallTable({ rows, showUser }: { rows: LlmCallRow[]; showUser: boolean }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">当前筛选范围内没有调用记录。</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr>
            <th className={th}>时间</th>
            {showUser && <th className={th}>用户</th>}
            <th className={th}>类型</th>
            <th className={th}>用途</th>
            <th className={th}>模型</th>
            <th className={th}>输入字符</th>
            <th className={th}>Tokens(入/出)</th>
            <th className={th}>耗时</th>
            <th className={th}>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={`${td} whitespace-nowrap text-zinc-500 dark:text-zinc-400`}>{fmtTime(r.created_at)}</td>
              {showUser && <td className={td}>{r.username ?? "系统"}</td>}
              <td className={td}>{r.kind === "llm" ? "LLM" : "Embedding"}</td>
              <td className={td}>{PURPOSE_LABEL[r.purpose] ?? r.purpose}</td>
              <td className={`${td} max-w-[160px] break-all font-mono text-xs`}>{r.model}</td>
              <td className={td}>{r.input_chars ?? "—"}</td>
              <td className={td}>
                {r.prompt_tokens ?? "—"}/{r.completion_tokens ?? "—"}
              </td>
              <td className={td}>{fmtMs(r.took_ms)}</td>
              <td className={td}>
                {r.ok ? (
                  <span className="text-emerald-600 dark:text-emerald-400">成功</span>
                ) : (
                  <span className="text-red-600 dark:text-red-400" title={r.error ?? ""}>
                    失败
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Collapsible log section: collapsed by default (the tables run 100+ rows),
 * the summary always shows the row count and the newest timestamp so the
 * section stays scannable without expanding. */
function LogSection({
  title,
  count,
  newest,
  children,
}: {
  title: string;
  count: number;
  newest: string | null;
  children: React.ReactNode;
}) {
  const summary = `${title} · ${count} 条${newest ? ` · 最新 ${fmtTime(newest)}` : ""}`;
  return (
    <details className="group rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <span className="text-xs text-zinc-500 group-open:hidden dark:text-zinc-400">点击展开</span>
        <span className="hidden text-xs text-zinc-500 group-open:inline dark:text-zinc-400">点击收起</span>
      </summary>
      <div className="border-t border-zinc-100 p-4 dark:border-zinc-800">{children}</div>
    </details>
  );
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; date?: string }>;
}) {
  const user = await requireUser();
  const { days: daysParam, date: dateParam } = await searchParams;

  // Same validated-window pattern as /stats; `date` (single Beijing calendar
  // day) wins over `days` when both are present.
  const days = DAY_RANGES.includes(Number(daysParam)) ? Number(daysParam) : null;
  const date = dateParam && DATE_RE.test(dateParam) && !Number.isNaN(Date.parse(dateParam)) ? dateParam : null;
  const filter: LogFilter | undefined = date ? { date } : days ? { days } : undefined;

  const [searches, calls] = await Promise.all([
    listSearchLogs(user, LOG_LIMIT, filter),
    listLlmCalls(user, LOG_LIMIT, filter),
  ]);
  const showUser = user.role === "admin";

  const chip = (label: string, params: Record<string, string | undefined>, active: boolean) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) sp.set(k, v);
    }
    const href = sp.toString() ? `/logs?${sp.toString()}` : "/logs";
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          查询记录与 LLM / Embedding 调用记录，各显示最新 {LOG_LIMIT} 条（{showUser ? "全部用户" : "本人"}）。
          {filterLabel && <span className="ml-1 font-medium text-zinc-700 dark:text-zinc-300">{filterLabel}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {chip("全部", {}, !days && !date)}
          {chip("今天", { days: "1" }, !date && days === 1)}
          {chip("近 7 天", { days: "7" }, !date && days === 7)}
          {chip("近 30 天", { days: "30" }, !date && days === 30)}
          {chip("近 90 天", { days: "90" }, !date && days === 90)}
        </div>
      </div>

      <form method="get" action="/logs" className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <label htmlFor="log-date" className="text-zinc-500 dark:text-zinc-400">
          按日期筛选（北京时间当日）：
        </label>
        <input
          id="log-date"
          type="date"
          name="date"
          defaultValue={date ?? ""}
          className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
        />
        <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1.5 text-white dark:bg-zinc-100 dark:text-zinc-900">
          应用
        </button>
        {(date || daysParam) && (
          <Link href="/logs" className="text-zinc-500 hover:underline dark:text-zinc-400">
            清除筛选
          </Link>
        )}
      </form>

      <section className="space-y-3">
        <LogSection title="查询记录" count={searches.length} newest={searches[0]?.created_at ?? null}>
          <SearchTable rows={searches} showUser={showUser} />
        </LogSection>
      </section>

      <section className="space-y-3">
        <LogSection title="LLM / Embedding 调用记录" count={calls.length} newest={calls[0]?.created_at ?? null}>
          <CallTable rows={calls} showUser={showUser} />
        </LogSection>
      </section>
    </div>
  );
}
