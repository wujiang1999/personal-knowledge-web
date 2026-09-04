import { requireUser } from "@/lib/requireUser";
import { listLlmCalls, listSearchLogs, type LlmCallRow, type SearchLogRow } from "@/lib/logs";

const LOG_LIMIT = 100;

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
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无查询记录。</p>;
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
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无调用记录。</p>;
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

export default async function LogsPage() {
  const user = await requireUser();
  const [searches, calls] = await Promise.all([
    listSearchLogs(user, LOG_LIMIT),
    listLlmCalls(user, LOG_LIMIT),
  ]);
  const showUser = user.role === "admin";

  return (
    <div className="space-y-8">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        查询记录与 LLM / Embedding 调用记录，各显示最新 {LOG_LIMIT} 条（{showUser ? "全部用户" : "本人"}）。
      </p>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">查询记录</h2>
        <SearchTable rows={searches} showUser={showUser} />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">LLM / Embedding 调用记录</h2>
        <CallTable rows={calls} showUser={showUser} />
      </section>
    </div>
  );
}
