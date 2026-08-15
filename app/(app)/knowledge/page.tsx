import Link from "next/link";
import { requireUser } from "@/lib/requireUser";
import { listConcepts, searchConcepts } from "@/lib/concepts";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireUser();
  const { q } = await searchParams;
  const query = q?.trim();
  const results = query ? await searchConcepts(query, 50) : await listConcepts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <form method="get" action="/knowledge" className="flex flex-1 gap-2">
          <input
            name="q"
            defaultValue={query ?? ""}
            placeholder="搜索知识（标题 / 正文 / 标签）…"
            className="w-full max-w-md rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
          <button type="submit" className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700">
            搜索
          </button>
          {query && (
            <Link href="/knowledge" className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50">
              清除
            </Link>
          )}
        </form>
        <Link
          href="/knowledge/new"
          className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          + 新建
        </Link>
      </div>

      {query && <p className="text-sm text-zinc-500">“{query}” 的搜索结果：{results.length} 条</p>}

      <ul className="divide-y rounded-lg border border-zinc-200 bg-white">
        {results.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-zinc-400">
            {query ? "没有匹配的结果" : "还没有知识条目，点击「新建」开始"}
          </li>
        )}
        {results.map((c) => (
          <li key={c.id} className="px-4 py-3">
            <Link href={`/knowledge/${c.id}`} className="group block">
              <div className="flex items-center gap-2">
                <span className="font-medium group-hover:underline">{c.title}</span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">{c.type}</span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">v{c.current_version}</span>
              </div>
              {c.description && <p className="mt-0.5 text-sm text-zinc-500 line-clamp-1">{c.description}</p>}
              {"body_markdown" in c && (
                <p className="mt-1 text-sm text-zinc-400 line-clamp-2">{(c as { body_markdown: string }).body_markdown}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}