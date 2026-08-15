import { requireUser } from "@/lib/requireUser";
import { listSources } from "@/lib/concepts";

export default async function SourcesPage() {
  await requireUser();
  const sources = await listSources();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">原始来源</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">每次知识录入的原始输入都会保留，用于可追溯与去重。</p>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
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
                  暂无来源记录
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
    </div>
  );
}