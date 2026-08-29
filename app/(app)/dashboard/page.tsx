import Link from "next/link";
import { requireUser } from "@/lib/requireUser";
import { listConcepts, listSources, buildCategoryTree, type CategoryTreeNode } from "@/lib/concepts";
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
    concepts: node.concepts.map((c) => ({ id: c.id, title: c.title })),
    children: node.children.map(toFolder),
  };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [allConcepts, sources] = await Promise.all([listConcepts({ user }), listSources(user)]);
  // listConcepts orders by updated_at DESC, so the top 10 are the most recent.
  const recent = allConcepts.slice(0, 10);

  const stats = [
    { label: "知识条目", value: allConcepts.length },
    { label: "原始来源", value: sources.length },
  ];

  const { roots, rootConcepts } = buildCategoryTree(allConcepts);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-3xl font-semibold">{s.value}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">{s.label}</div>
          </div>
        ))}
        <Link
          href="/knowledge/new"
          className="flex items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white text-zinc-500 hover:border-zinc-500 hover:text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-400 dark:hover:text-zinc-100"
        >
          + 新建知识
        </Link>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">知识目录</h2>
          <Link href="/knowledge" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
            查看全部 →
          </Link>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          {roots.length === 0 && rootConcepts.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">还没有知识条目，点击「新建知识」开始</p>
          ) : (
            <DirectoryTree roots={roots.map(toFolder)} rootConcepts={rootConcepts.map((c) => ({ id: c.id, title: c.title }))} />
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">最近更新</h2>
          <Link href="/knowledge" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
            查看全部 →
          </Link>
        </div>
        <ul className="divide-y rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {recent.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">还没有任何知识条目</li>}
          {recent.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3">
              <Link href={`/knowledge/${c.id}`} className="hover:underline">
                <span className="font-medium">{c.title}</span>
                {c.category && <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{c.category}</span>}
                <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{c.type}</span>
              </Link>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">{new Date(c.updated_at).toLocaleDateString("zh-CN")}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}