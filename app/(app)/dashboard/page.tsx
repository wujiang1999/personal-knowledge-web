import Link from "next/link";
import { requireUser } from "@/lib/requireUser";
import { listConcepts, listSources, buildCategoryTree, type CategoryTreeNode, type Concept } from "@/lib/concepts";

function countSubtree(node: CategoryTreeNode): number {
  return node.concepts.length + node.children.reduce((s, ch) => s + countSubtree(ch), 0);
}

function TreeNode({ node, depth }: { node: CategoryTreeNode; depth: number }) {
  return (
    <div className={depth > 0 ? "ml-4 border-l border-zinc-200 pl-3 dark:border-zinc-700" : ""}>
      <Link
        href={`/knowledge?category=${encodeURIComponent(node.path)}`}
        className="font-medium text-zinc-800 hover:underline dark:text-zinc-100"
      >
        📁 {node.name}
      </Link>
      <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">({countSubtree(node)})</span>
      {node.concepts.map((c) => (
        <div key={c.id} className="ml-5 py-0.5">
          <Link href={`/knowledge/${c.id}`} className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
            {c.title}
          </Link>
        </div>
      ))}
      {node.children.map((ch) => (
        <TreeNode key={ch.path} node={ch} depth={depth + 1} />
      ))}
    </div>
  );
}

function DirectoryTree({ roots, rootConcepts }: { roots: CategoryTreeNode[]; rootConcepts: Concept[] }) {
  return (
    <div>
      {roots.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} />
      ))}
      {rootConcepts.length > 0 && (
        <div className="mt-2">
          <p className="font-medium text-zinc-700 dark:text-zinc-300">根目录 ({rootConcepts.length})</p>
          {rootConcepts.map((c) => (
            <div key={c.id} className="ml-5 py-0.5">
              <Link href={`/knowledge/${c.id}`} className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
                {c.title}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [allConcepts, sources] = await Promise.all([listConcepts({ ownerId: user.id }), listSources(user.id)]);
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
            <DirectoryTree roots={roots} rootConcepts={rootConcepts} />
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