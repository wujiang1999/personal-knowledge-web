import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/requireUser";
import {
  findBacklinks,
  findUnlinkedMentions,
  getBodiesByTitles,
  getConceptDetail,
  resolveLinkTargets,
} from "@/lib/concepts";
import { parseWikiLinks } from "@/lib/links";
import { ConceptBody } from "@/components/concept-body";
import { ConceptForm } from "@/components/concept-form";
import { DeleteConceptButton } from "@/components/delete-concept-button";
import { AttachmentsPanel } from "@/components/attachments-panel";
import { VersionHistory } from "@/components/version-history";
import { PurgeConceptButton, RestoreConceptButton } from "@/components/concept-action-buttons";

export default async function ConceptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const concept = await getConceptDetail(id, user);
  if (!concept) notFound();

  const current = concept.versions.find((v) => v.version_number === concept.current_version);
  const bodyText = current?.body_markdown ?? "";
  // Bidirectional link network (§3.3.2): resolve outgoing [[标题]] targets and
  // look up incoming backlinks in parallel. Repeated mentions of the same
  // target collapse to one panel row (first-mention order kept).
  const outgoingRefs = parseWikiLinks(bodyText);
  const uniqueOutgoing = [...new Map(outgoingRefs.map((r) => [r.title, r])).values()];
  const embedTitles = outgoingRefs.filter((r) => r.embed).map((r) => r.title);
  const [titleToId, backlinks, unlinked, embedBodies] = await Promise.all([
    resolveLinkTargets(user, uniqueOutgoing.map((r) => r.title)),
    findBacklinks(user, concept.id, concept.title),
    findUnlinkedMentions(user, concept.id, concept.title),
    getBodiesByTitles(user, embedTitles),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center justify-between">
          <Link href="/knowledge" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
            ← 返回
          </Link>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{concept.title}</h2>
          <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs dark:bg-zinc-700">{concept.type}</span>
          <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs dark:bg-zinc-700">{concept.status}</span>
          {concept.attachment_count > 0 && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              📎 {concept.attachment_count} 附件
            </span>
          )}
          <span className="text-xs text-zinc-400 dark:text-zinc-500">v{concept.current_version}</span>
        </div>
        {concept.description && <p className="mt-1 text-zinc-600 dark:text-zinc-300">{concept.description}</p>}
        {concept.category && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            📁{" "}
            <Link href={`/knowledge?category=${encodeURIComponent(concept.category)}`} className="hover:underline">
              {concept.category}
            </Link>
          </p>
        )}
        {concept.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {concept.tags.map((t) => (
              <span key={t} className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {concept.deleted_at && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-sm text-amber-700 dark:text-amber-300">
            该条目在回收站中（{new Date(concept.deleted_at).toLocaleString("zh-CN")} 删除），搜索、列表与导出不再包含它。
          </p>
          <RestoreConceptButton id={concept.id} label="恢复到知识库" />
        </div>
      )}

      <section>
        <h2 className="mb-2 font-medium">当前正文（v{concept.current_version}）</h2>
        <ConceptBody body={bodyText} titleToId={titleToId} embeds={embedBodies} />
      </section>

      <section>
        <h2 className="mb-3 font-medium">编辑（保存生成新版本 v{concept.current_version + 1}）</h2>
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <ConceptForm
            mode="edit"
            initial={{
              id: concept.id,
              type: concept.type,
              title: concept.title,
              description: concept.description ?? "",
              category: concept.category ?? "",
              tags: concept.tags,
              status: concept.status,
              body: current?.body_markdown ?? "",
            }}
          />
        </div>
      </section>

      {backlinks.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">被引用（{backlinks.length}）</h2>
          <ul className="divide-y rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {backlinks.map((b) => (
              <li key={b.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <Link href={`/knowledge/${b.id}`} className="hover:underline">
                  {b.title}
                </Link>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {new Date(b.updated_at).toLocaleDateString("zh-CN")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {uniqueOutgoing.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">链接到（{uniqueOutgoing.length}）</h2>
          <ul className="divide-y rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {uniqueOutgoing.map((ref) => {
              const targetId = titleToId.get(ref.title.toLowerCase());
              return (
                <li key={ref.title} className="flex items-center justify-between px-4 py-2 text-sm">
                  {targetId ? (
                    <Link
                      href={`/knowledge/${targetId}`}
                      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {ref.title}
                    </Link>
                  ) : (
                    <Link
                      href={`/knowledge/new?title=${encodeURIComponent(ref.title)}`}
                      className="text-zinc-400 underline decoration-dotted underline-offset-2 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                      title="未创建，点击创建"
                    >
                      {ref.title}
                    </Link>
                  )}
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {targetId ? "已创建" : "未创建"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {unlinked.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">未链接提及（{unlinked.length}）</h2>
          <p className="mb-2 text-xs text-zinc-400 dark:text-zinc-500">
            以下条目正文提到了本条目标题但尚未加{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">[[链接]]</code>
            ，可在对应条目的编辑器里补上。
          </p>
          <ul className="divide-y rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {unlinked.map((m) => (
              <li key={m.id} className="px-4 py-2 text-sm">
                <Link href={`/knowledge/${m.id}`} className="hover:underline">
                  {m.title}
                </Link>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{m.snippet}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AttachmentsPanel conceptId={concept.id} />

      <section>
        <h2 className="mb-2 font-medium">版本历史（可对比、可回滚）</h2>
        <VersionHistory
          conceptId={concept.id}
          currentVersion={concept.current_version}
          versions={concept.versions}
        />
      </section>

      <section className="rounded-lg border border-red-200 bg-white p-6 dark:border-red-900 dark:bg-zinc-900">
        <h2 className="mb-2 font-medium text-red-600 dark:text-red-400">危险区</h2>
        {concept.deleted_at ? (
          <>
            <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
              该条目已在回收站中。彻底删除将永久清除全部历史版本与附件（原始来源记录会保留作审计），无法恢复。
            </p>
            <PurgeConceptButton id={concept.id} />
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
              删除会先把条目移入回收站（搜索/列表/导出立即不可见，可在回收站恢复）；只有回收站中的「彻底删除」才会永久清除全部版本与附件。
            </p>
            <DeleteConceptButton id={concept.id} />
          </>
        )}
      </section>
    </div>
  );
}