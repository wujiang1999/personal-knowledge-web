import { requireUser } from "@/lib/requireUser";
import { ConceptForm } from "@/components/concept-form";

export default async function NewConceptPage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string }>;
}) {
  await requireUser();
  const { title } = await searchParams;
  const initialTitle = typeof title === "string" ? title.trim().slice(0, 200) : "";
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">新建知识</h1>
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <ConceptForm
          mode="create"
          initial={initialTitle ? { title: initialTitle } : undefined}
        />
      </div>
    </div>
  );
}