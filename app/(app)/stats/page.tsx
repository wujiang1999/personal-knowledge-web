import Link from "next/link";
import { requireUser } from "@/lib/requireUser";
import {
  getApiKeyUsage,
  getBuildInfoAsync,
  getLibraryHealth,
  getSearchQuality,
  getTopRetrieved,
  getTrafficSummary,
  type KeyUsageRow,
  type LibraryHealth,
  type TopRetrievedRow,
} from "@/lib/stats";

const MODE_LABEL: Record<string, string> = {
  bm25: "BM25",
  "trgm-fallback": "模糊兜底",
  "semantic-only": "纯语义",
  operators: "算子过滤",
  none: "无结果",
};

const RANGES = [7, 30, 90];

function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

const tile =
  "ui-panel p-4";
const tileLabel = "text-sm text-zinc-500 dark:text-zinc-400";
const tileValue = "text-3xl font-semibold";
const th =
  "border-b border-zinc-200 px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400";
const td = "border-b border-zinc-100 px-3 py-2 align-top dark:border-zinc-800/60";

function Tiles({ items }: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((s) => (
        <div key={s.label} className={tile}>
          <div className={tileValue}>{s.value}</div>
          <div className={tileLabel}>
            {s.label}
            {s.hint && <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">{s.hint}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function KeyUsageTable({ rows }: { rows: KeyUsageRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">还没有 API key。</p>;
  }
  return (
    <div className="overflow-x-auto ui-panel">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr>
            <th className={th}>密钥</th>
            <th className={th}>所属用户</th>
            <th className={th}>调用量</th>
            <th className={th}>成功率</th>
            <th className={th}>知识贡献</th>
            <th className={th}>最近使用</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rate = r.calls > 0 ? `${Math.round((r.okCalls / r.calls) * 100)}%` : "—";
            return (
              <tr key={r.keyId}>
                <td className={`${td} font-medium`}>{r.name}</td>
                <td className={td}>{r.username}</td>
                <td className={td}>{r.calls}</td>
                <td className={td}>{rate}</td>
                <td className={td}>{r.contributions}</td>
                <td className={`${td} whitespace-nowrap text-zinc-500 dark:text-zinc-400`}>
                  {fmtTime(r.lastUsedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TopRetrievedTable({ rows }: { rows: TopRetrievedRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        还没有检索命中记录（本次部署后每次真实返回会累计）。
      </p>
    );
  }
  return (
    <div className="overflow-x-auto ui-panel">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr>
            <th className={th}>条目</th>
            <th className={th}>状态</th>
            <th className={th}>被检索次数</th>
            <th className={th}>最近被检索</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>
                <Link href={`/knowledge/${r.id}`} className="hover:underline">
                  {r.title}
                </Link>
              </td>
              <td className={td}>
                {r.status === "deprecated" ? (
                  <span className="text-red-600 dark:text-red-400">已废弃</span>
                ) : (
                  "稳定"
                )}
              </td>
              <td className={td}>{r.retrievalCount}</td>
              <td className={`${td} whitespace-nowrap text-zinc-500 dark:text-zinc-400`}>
                {fmtTime(r.lastRetrievedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HealthGrid({ health, commit, startedAt }: { health: LibraryHealth; commit: string; startedAt: string }) {
  const items: { label: string; value: string; hint?: string }[] = [
    { label: "在库条目", value: String(health.conceptsTotal) },
    { label: "已失效条目", value: String(health.deprecatedTotal) },
    { label: "回收站", value: String(health.trashTotal) },
    { label: "零检索条目", value: String(health.neverRetrieved), hint: "整理候选" },
    { label: "版本行", value: String(health.versionRows) },
    {
      label: "附件",
      value: `${health.attachmentRows} 个`,
      hint: fmtBytes(health.attachmentBytes),
    },
    {
      label: "向量覆盖",
      value: `${health.embeddingCoverage}%`,
      hint: `${health.embeddingRows}/${health.conceptsTotal}${health.embeddingStale > 0 ? `，陈旧 ${health.embeddingStale}` : ""}`,
    },
    { label: "数据库体积", value: health.dbSize },
    { label: "部署版本", value: commit.slice(0, 7) },
    { label: "服务启动", value: fmtTime(startedAt) },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((s) => (
        <div key={s.label} className={tile}>
          <div className="text-xl font-semibold">{s.value}</div>
          <div className={tileLabel}>
            {s.label}
            {s.hint && <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">{s.hint}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await requireUser();
  const { days: daysParam } = await searchParams;
  const days = RANGES.includes(Number(daysParam)) ? Number(daysParam) : 30;

  const [traffic, search, keys, topRetrieved, health, build] = await Promise.all([
    getTrafficSummary(user, days),
    getSearchQuality(user, days),
    getApiKeyUsage(user, days),
    getTopRetrieved(user, 10),
    getLibraryHealth(user),
    getBuildInfoAsync(),
  ]);
  const isAdmin = user.role === "admin";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          API 流量、检索质量与库健康（{isAdmin ? "全库" : "本人"}口径，request_log 自部署起积累）。
        </p>
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/stats?days=${r}`}
              className={`rounded-md px-3 py-1.5 text-sm ${
                r === days
                  ? "bg-brand-700 text-white dark:bg-brand-300 dark:text-brand-950"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              近 {r} 天
            </Link>
          ))}
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">流量概览</h2>
        {traffic.total === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            时间范围内没有 API 请求记录。
          </p>
        ) : (
          <Tiles
            items={[
              { label: "请求总数", value: String(traffic.total) },
              { label: "成功率", value: `${traffic.successRate}%`, hint: "HTTP < 400" },
              { label: "失败请求", value: String(traffic.failed), hint: "HTTP ≥ 400" },
              { label: "P50 耗时", value: `${traffic.p50Ms} ms` },
              { label: "P95 耗时", value: `${traffic.p95Ms} ms`, hint: `均值 ${traffic.avgMs} ms` },
            ]}
          />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">检索质量</h2>
        {search.searches === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">时间范围内没有检索记录。</p>
        ) : (
          <div className="space-y-3">
            <Tiles
              items={[
                { label: "检索次数", value: String(search.searches) },
                { label: "零结果率", value: `${search.zeroRate}%`, hint: `${search.zeroResults} 次` },
                { label: "平均命中", value: String(search.avgHits) },
                { label: "P50 耗时", value: `${search.p50Ms} ms` },
                { label: "P95 耗时", value: `${search.p95Ms} ms` },
              ]}
            />
            <div className="overflow-x-auto ui-panel">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr>
                    <th className={th}>检索路径</th>
                    <th className={th}>次数</th>
                    <th className={th}>其中零结果</th>
                  </tr>
                </thead>
                <tbody>
                  {search.modes.map((m) => (
                    <tr key={m.mode}>
                      <td className={td}>{MODE_LABEL[m.mode] ?? m.mode}</td>
                      <td className={td}>{m.count}</td>
                      <td className={td}>{m.zero}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              「模糊兜底 / 纯语义」占比高说明 BM25 词面没接住这类查询，是语料或分词的改进信号。
            </p>
          </div>
        )}
      </section>

      {isAdmin && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">密钥用量</h2>
          <KeyUsageTable rows={keys} />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">高频被检索条目</h2>
        <TopRetrievedTable rows={topRetrieved} />
      </section>

      {health && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">库健康</h2>
          <HealthGrid health={health} commit={build.commit} startedAt={build.startedAt} />
        </section>
      )}
    </div>
  );
}
