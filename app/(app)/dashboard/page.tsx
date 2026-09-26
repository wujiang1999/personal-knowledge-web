import Link from "next/link";
import { UiIcon, routeIcon } from "@/components/ui-icon";
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
      <section className="dashboard-hero flex flex-col justify-between gap-6 p-6 sm:flex-row sm:items-center sm:p-7">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.2em] text-brand-700 dark:text-brand-300">COLLECT · CONNECT · CREATE</p>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">把灵感，留给未来的自己。</h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">记录新的发现，连接已有知识，继续你的探索。</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href="/knowledge/new" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 dark:bg-brand-300 dark:text-brand-950 dark:hover:bg-brand-200"><UiIcon name="plus" />新建知识</Link>
          <Link href="/ask" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brand-200 bg-white/60 px-4 text-sm font-medium text-brand-800 hover:bg-white dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-200 dark:hover:bg-brand-950"><UiIcon name="ask" />向知识库提问</Link>
        </div>
      </section>

      <div className={`grid grid-cols-2 gap-3 ${health ? "sm:grid-cols-3 xl:grid-cols-6" : "sm:grid-cols-4"}`}>
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="dashboard-stat ui-panel group flex min-w-0 flex-col justify-between gap-3 p-4 focus-visible:outline-brand-500"
          >
            <div className="flex items-start justify-between gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
              <span className="stat-icon"><UiIcon name={routeIcon(s.href)} /></span>
              <span aria-hidden="true" className="text-zinc-400 transition-transform group-hover:translate-x-0.5 dark:text-zinc-500">→</span>
            </div>
            <div>
              <div className="text-[27px] font-semibold leading-none tracking-tight tabular-nums">{s.value}</div>
              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{s.label}</div>
              <div className="mt-1 min-h-4 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">{s.hint ?? (s.href === "/knowledge" ? "持续积累" : "可追溯的资料")}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="ui-panel min-w-0">
          <div className="dashboard-section-heading">
            <h2 className="text-base font-semibold">知识目录</h2>
            <Link href="/knowledge" className="shrink-0 text-sm text-zinc-500 hover:underline dark:text-zinc-400">
              查看全部 →
            </Link>
          </div>
          <div className="p-4">
            {roots.length === 0 && rootConcepts.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">还没有知识条目，点击「新建知识」开始</p>
            ) : (
              <DirectoryTree roots={roots.map(toFolder)} rootConcepts={rootConcepts.map((c) => ({ id: c.id, title: c.title, attachments: c.attachment_count }))} />
            )}
          </div>
        </section>

        <section className="ui-panel min-w-0">
          <div className="dashboard-section-heading">
            <h2 className="text-base font-semibold">最近更新</h2>
            <Link href="/knowledge" className="shrink-0 text-sm text-zinc-500 hover:underline dark:text-zinc-400">
              查看全部 →
            </Link>
          </div>
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-b-2xl dark:divide-zinc-800">
            {recent.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">还没有任何知识条目</li>}
            {recent.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/knowledge/${c.id}`}
                  className="group block px-5 py-4 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500 dark:hover:bg-zinc-800/70"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-sm font-medium leading-6 group-hover:text-brand-600 dark:group-hover:text-brand-300">{c.title}</span>
                    <span aria-hidden="true" className="shrink-0 text-sm text-zinc-400 dark:text-zinc-500">→</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {c.category && <span className="break-all">{c.category}</span>}
                    <span>{c.type}</span>
                    {c.attachment_count > 0 && (
                      <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800"><UiIcon name="paperclip" className="h-3 w-3" /> {c.attachment_count}</span>
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
