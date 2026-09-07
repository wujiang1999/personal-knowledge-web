import Link from "next/link";
import { requireUser } from "@/lib/requireUser";
import { CollapsibleSection } from "@/components/collapsible-section";
import { listTrash } from "@/lib/concepts";
import { EmptyTrashButton, PurgeConceptButton, RestoreConceptButton } from "@/components/concept-action-buttons";

/** 回收站：软删除条目的唯一入口。这里的「彻底删除」才是真正的数据销毁；
 * 列表/搜索/图谱/导出从不包含这些条目。 */
export default async function TrashPage() {
  const user = await requireUser();
  const items = await listTrash(user, 200);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">回收站</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            删除的知识先进入这里（搜索、列表、图谱与导出不再包含它们）；「彻底删除」才会永久清除全部版本与附件。
          </p>
        </div>
        <EmptyTrashButton disabled={items.length === 0} />
      </div>

<CollapsibleSection
        title="已删除条目"
        count={items.length}
        newest={items[0]?.deleted_at ?? null}
        newestLabel="最新删除"
      >
{items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">回收站是空的</p>
        ) : (
          <ul className="divide-y border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
            {items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <Link href={`/knowledge/${c.id}`} className="font-medium hover:underline">
                  {c.title}
                </Link>
                {c.category && <span className="text-xs text-zinc-400 dark:text-zinc-500">📁 {c.category}</span>}
                {c.attachment_count > 0 && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    📎 {c.attachment_count}
                  </span>
                )}
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  删除于 {new Date(c.deleted_at).toLocaleString("zh-CN")}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <RestoreConceptButton id={c.id} />
                  <PurgeConceptButton id={c.id} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
    </div>
  );
}
