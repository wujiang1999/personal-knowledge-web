import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/requireUser";
import { getConceptDetail } from "@/lib/concepts";
import { ConceptForm } from "@/components/concept-form";

export default async function ConceptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const concept = await getConceptDetail(id);
  if (!concept) notFound();

  const current = concept.versions.find((v) => v.version_number === concept.current_version);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/knowledge" className="text-sm text-zinc-500 hover:underline">
          ← 返回
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{concept.title}</h1>
          <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs">{concept.type}</span>
          <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs">{concept.status}</span>
          <span className="text-xs text-zinc-400">v{concept.current_version}</span>
        </div>
        {concept.description && <p className="mt-1 text-zinc-600">{concept.description}</p>}
        {concept.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {concept.tags.map((t) => (
              <span key={t} className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-3 font-medium">编辑（保存生成新版本 v{concept.current_version + 1}）</h2>
        <div className="rounded-lg border border-zinc-200 bg-white p-6">
          <ConceptForm
            mode="edit"
            initial={{
              id: concept.id,
              type: concept.type,
              title: concept.title,
              description: concept.description ?? "",
              tags: concept.tags,
              status: concept.status,
              body: current?.body_markdown ?? "",
            }}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">当前正文（v{concept.current_version}）</h2>
        <pre className="whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-white p-4 text-sm leading-relaxed">
          {current?.body_markdown ?? ""}
        </pre>
      </section>

      <section>
        <h2 className="mb-2 font-medium">版本历史</h2>
        <ul className="divide-y rounded-lg border border-zinc-200 bg-white">
          {concept.versions.map((v) => (
            <li key={v.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="font-mono">v{v.version_number}</span>
              {v.version_number === concept.current_version && (
                <span className="text-xs text-green-600">当前</span>
              )}
              <span className="text-zinc-500">{new Date(v.created_at).toLocaleString("zh-CN")}</span>
              <span className="text-xs text-zinc-400">{v.content_hash.slice(7, 19)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}