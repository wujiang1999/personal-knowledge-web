import { requireUser } from "@/lib/requireUser";
import { ConceptForm } from "@/components/concept-form";

export default async function NewConceptPage() {
  await requireUser();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">新建知识</h1>
      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <ConceptForm mode="create" />
      </div>
    </div>
  );
}