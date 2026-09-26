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
      <div className="ui-panel p-6">
        <ConceptForm
          mode="create"
          initial={initialTitle ? { title: initialTitle } : undefined}
        />
      </div>
    </div>
  );
}