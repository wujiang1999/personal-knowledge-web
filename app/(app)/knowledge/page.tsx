import Link from "next/link";
import { requireUser } from "@/lib/requireUser";
import { countConcepts, listConcepts, searchConcepts, type Concept } from "@/lib/concepts";

/** Page-size options for the knowledge list (selectable per request via the
 * `per` searchParam; 20 keeps URL cleanup when unset). */
const PER_OPTIONS = [20, 50, 100];
const DATELESS = /^\d{4}-\d{2}-\d{2}$/;

/** Pager items: all page numbers when the list is short, otherwise a window
 * around the current page with the first/last pinned ("1 … 4 5 6 … 12"). */
function pagerItems(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 15) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const items: (number | "…")[] = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(totalPages - 1, page + 1);
  if (lo > 2) items.push("…");
  for (let p = lo; p <= hi; p++) items.push(p);
  if (hi < totalPages - 1) items.push("…");
  items.push(totalPages);
  return items;
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; page?: string; per?: string }>;
}) {
  const user = await requireUser();
  const { q, category, page: pageParam, per: perParam } = await searchParams;
  const query = q?.trim();
  const page = Math.max(1, Number(pageParam) || 1);
  const per = PER_OPTIONS.includes(Number(perParam)) ? Number(perParam) : PER_OPTIONS[0];

  let results: (Concept & { body_markdown?: string })[];
  let total: number | null = null;
  let hasMore = false;
  if (query) {
    // Ranked search, paginated the same way as the list view; the query also
    // returns the total match count for the pager.
    const { results: r, total: t } = await searchConcepts(user, query, per, (page - 1) * per, "ui");
    results = r;
    total = t;
    hasMore = page * per < t;
  } else {
    // Fetch one extra row to detect "has more", then slice to the page; the
    // pager needs the exact total, which countConcepts provides cheaply.
    const fetched = await listConcepts({
      user,
      category: category?.trim() || undefined,
      limit: per + 1,
      offset: (page - 1) * per,
    });
    hasMore = fetched.length > per;
    results = fetched.slice(0, per);
  }
  if (total === null) {
    total = await countConcepts(user, category?.trim() || undefined);
  }
  const totalPages = Math.max(1, Math.ceil(total / per));

  const hrefFor = (p: number) => {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (category) sp.set("category", category);
    if (per !== PER_OPTIONS[0]) sp.set("per", String(per));
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/knowledge?${s}` : "/knowledge";
  };

  const perHref = (option: number) => {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (category) sp.set("category", category);
    if (option !== PER_OPTIONS[0]) sp.set("per", String(option));
    const s = sp.toString();
    return s ? `/knowledge?${s}` : "/knowledge";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <form method="get" action="/knowledge" className="flex flex-1 gap-2">
          {category && <input type="hidden" name="category" value={category} />}
          {per !== PER_OPTIONS[0] && <input type="hidden" name="per" value={per} />}
          <input
            name="q"
            defaultValue={query ?? ""}
            placeholder="搜索…支持 tag: category: status: type: 算子"
            className="w-full max-w-md rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            搜索
          </button>
          {query && (
            <Link
              href="/knowledge"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              清除
            </Link>
          )}
        </form>
        <Link
          href="/knowledge/new"
          className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + 新建
        </Link>
      </div>

      {query && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          “{query}” 的搜索结果：{total ?? results.length} 条 · 共 {totalPages} 页
        </p>
      )}
      {!query && category && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          目录 {category}：共 {total} 条 · 共 {totalPages} 页
        </p>
      )}
      {!query && !category && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          共 {total} 条 · 共 {totalPages} 页
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1 text-sm">
        <span className="mr-1 text-zinc-500 dark:text-zinc-400">每页条数</span>
        {PER_OPTIONS.map((option) => (
          <Link
            key={option}
            href={perHref(option)}
            className={`rounded-md px-3 py-1.5 ${
              option === per
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {option}
          </Link>
        ))}
      </div>

      <ul className="divide-y rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {results.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
            {query ? "没有匹配的结果" : category ? "该目录下还没有知识" : "还没有知识条目，点击「新建」开始"}
          </li>
        )}
        {results.map((c) => (
          <li key={c.id} className="px-4 py-3">
            <Link href={`/knowledge/${c.id}`} className="group block">
              <div className="flex items-center gap-2">
                <span className="font-medium group-hover:underline">{c.title}</span>
                {c.category && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">📁 {c.category}</span>}
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{c.type}</span>
                {c.attachment_count > 0 && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    📎 {c.attachment_count} 附件
                  </span>
                )}
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">v{c.current_version}</span>
                {c.status === "deprecated" && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-600 dark:bg-red-900/40 dark:text-red-300">
                    已废弃
                  </span>
                )}
                {user.role === "admin" && c.owner_id && c.owner_id !== user.id && (
                  <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                    👤 {c.owner_username ?? "其他账号"}
                  </span>
                )}
              </div>
              {c.description && <p className="mt-0.5 text-sm text-zinc-500 line-clamp-1 dark:text-zinc-400">{c.description}</p>}
              {c.body_markdown && (
                <p className="mt-1 text-sm text-zinc-400 line-clamp-2 dark:text-zinc-500">{c.body_markdown}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {(page > 1 || hasMore) && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">
            第 {page} / {totalPages} 页
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {page > 1 && (
              <Link
                href={hrefFor(page - 1)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                ← 上一页
              </Link>
            )}
            {pagerItems(page, totalPages).map((p, i) =>
              p === "…" ? (
                <span key={`gap-${i}`} className="px-1 text-zinc-400 dark:text-zinc-500">
                  …
                </span>
              ) : p === page ? (
                <span key={p} className="rounded-md bg-zinc-900 px-3 py-1.5 text-white dark:bg-zinc-100 dark:text-zinc-900">
                  {p}
                </span>
              ) : (
                <Link
                  key={p}
                  href={hrefFor(p)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {p}
                </Link>
              )
            )}
            {hasMore && (
              <Link
                href={hrefFor(page + 1)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                下一页 →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
