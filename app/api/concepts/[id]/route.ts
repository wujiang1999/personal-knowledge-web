import { NextResponse } from "next/server";
import { z } from "zod";
import { addConceptVersion, deleteConcept, getConceptDetail, NotFoundError, type ConceptInput } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";

const updateSchema = z.object({
  type: z.string().min(1).max(64).default("Note"),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(64)).max(30).optional(),
  status: z.enum(["draft", "stable", "deprecated"]).optional(),
  body: z.string().min(1),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const concept = await getConceptDetail(id, user);
  if (!concept) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ concept });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const owned = await getConceptDetail(id, user);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const input: ConceptInput = {
    type: body.type,
    title: body.title,
    description: body.description,
    category: body.category,
    tags: body.tags,
    status: body.status,
    body: body.body,
  };

  try {
    const result = await addConceptVersion(id, input, user.username);
    return NextResponse.json({ version: result.version, created: result.created });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ok = await deleteConcept(id, user);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}