import Link from "next/link";
import { requireUser } from "@/lib/requireUser";
import { listConcepts, countSources, listFolders, buildCategoryTree, type CategoryTreeNode } from "@/lib/concepts";
import { countReviewItems } from "@/lib/reviews";
import { getLibraryHealth } from "@/lib/stats";
import { DirectoryTree, type DirectoryTreeFolder } from "@/components/directory-tree";

function countSubtree(node: CategoryTreeNode): number {
  return node.concepts.length + node.children.reduce((s, ch) => s + countSubtree(ch), 0);
}

/** Reduce a category node to what the client tree needs (keeps the RSC payload light). */
function toFolder(node: CategoryTreeNode): DirectoryTreeFolder {
  return {
    key: node.path,
    name: node.name,
    total: countSubtree(node),
    concepts: node.concepts.map((c) => ({ id: c.id, title: c.title, attachments: c.attachment_count })),
    children: node.children.map(toFolder),
  };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [allConcepts, sources, folderPaths, health, pendingReviews, qualityRisks] = await Promise.all([
    listConcepts({ user }),
    countSources(user),
    listFolders(user),
    getLibraryHealth(user),
    countReviewItems(user, { status: "pending" }),
    countReviewItems(user, { status: "pending", kind: "quality_risk" }),
  ]);
  // listConcepts orders by updated_at DESC, so the top 10 are the most recent.
  const recent = allConcepts.slice(0, 10);

  const stats: { label: string; value: string | number; hint?: string; href: string }[] = [
    { label: "知识条目", value: allConcepts.length, href: "/knowledge" },
    { label: "原始来源", value: sources, href: "/sources" },
    { label: "待审阅", value: pendingReviews, hint: "进入审核", href: "/reviews" },
    { label: "质量风险", value: qualityRisks, hint: "抽查与自动审阅", href: "/reviews?kind=quality_risk" },
    // Library-wide ops tiles (admin only — getLibraryHealth is null otherwise).
    ...(health
      ? [
          {
            label: "向量覆盖",
            value: `${health.embeddingCoverage}%`,
            hint: `${health.embeddingRows}/${health.conceptsTotal}${health.embeddingStale > 0 ? `，陈旧 ${health.embeddingStale}` : ""}`,
            href: "/stats",
          },
          { label: "回收站", value: String(health.trashTotal), hint: "待清理", href: "/trash" },
        ]
      : []),
  ];

  const { roots, rootConcepts } = buildCategoryTree(allConcepts, folderPaths);

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">浏览知识目录、处理审核，并继续记录新的想法。</p>
        <Link
          href="/knowledge/new"
          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:ring-offset-zinc-950"
        >
          + 新建知识
        </Link>
      </div>

      <div className={`grid grid-cols-2 gap-3 ${health ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="group flex min-h-[112px] min-w-0 flex-col justify-between rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/70"
          >
            <div className="flex items-start justify-between gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
              <span>{s.label}</span>
              <span aria-hidden="true" className="text-zinc-400 transition-transform group-hover:translate-x-0.5 dark:text-zinc-500">→</span>
            </div>
            <div>
              <div className="text-3xl font-semibold tracking-tight">{s.value}</div>
              {s.hint && <div className="mt-1 text-xs leading-4 text-zinc-500 dark:text-zinc-400">{s.hint}</div>}
            </div>
          </Link>
        ))}
      </div>

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">知识目录</h2>
            <Link href="/knowledge" className="shrink-0 text-sm text-zinc-500 hover:underline dark:text-zinc-400">
              查看全部 →
            </Link>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            {roots.length === 0 && rootConcepts.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">还没有知识条目，点击「新建知识」开始</p>
            ) : (
              <DirectoryTree roots={roots.map(toFolder)} rootConcepts={rootConcepts.map((c) => ({ id: c.id, title: c.title, attachments: c.attachment_count }))} />
            )}
          </div>
        </section>

        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">最近更新</h2>
            <Link href="/knowledge" className="shrink-0 text-sm text-zinc-500 hover:underline dark:text-zinc-400">
              查看全部 →
            </Link>
          </div>
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {recent.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">还没有任何知识条目</li>}
            {recent.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/knowledge/${c.id}`}
                  className="group block px-4 py-3 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500 dark:hover:bg-zinc-800/70"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-medium leading-6 group-hover:underline">{c.title}</span>
                    <span aria-hidden="true" className="shrink-0 text-sm text-zinc-400 dark:text-zinc-500">→</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {c.category && <span className="break-all">{c.category}</span>}
                    <span>{c.type}</span>
                    {c.attachment_count > 0 && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">📎 {c.attachment_count}</span>
                    )}
                    {c.status === "deprecated" && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-600 dark:bg-red-900/40 dark:text-red-300">已废弃</span>
                    )}
                    <span className="ml-auto whitespace-nowrap">{new Date(c.updated_at).toLocaleDateString("zh-CN")}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
