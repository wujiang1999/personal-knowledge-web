import Link from "next/link";
import { requireUser } from "@/lib/requireUser";
import { listConcepts, listSources } from "@/lib/concepts";

export default async function DashboardPage() {
  await requireUser();
  const [concepts, sources] = await Promise.all([listConcepts({ limit: 10 }), listSources()]);

  const stats = [
    { label: "知识条目", value: concepts.length },
    { label: "原始来源", value: sources.length },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-3xl font-semibold">{s.value}</div>
            <div className="text-sm text-zinc-500">{s.label}</div>
          </div>
        ))}
        <Link
          href="/knowledge/new"
          className="flex items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white text-zinc-500 hover:border-zinc-500 hover:text-zinc-800"
        >
          + 新建知识
        </Link>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">最近更新</h2>
          <Link href="/knowledge" className="text-sm text-zinc-500 hover:underline">
            查看全部 →
          </Link>
        </div>
        <ul className="divide-y rounded-lg border border-zinc-200 bg-white">
          {concepts.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-400">还没有任何知识条目</li>}
          {concepts.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3">
              <Link href={`/knowledge/${c.id}`} className="hover:underline">
                <span className="font-medium">{c.title}</span>
                <span className="ml-2 text-xs text-zinc-400">{c.type}</span>
              </Link>
              <span className="text-xs text-zinc-400">{new Date(c.updated_at).toLocaleDateString("zh-CN")}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}