import { NextResponse } from "next/server";
import { z } from "zod";
import { createConcept, listConcepts, type ConceptInput } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";

const createSchema = z.object({
  type: z.string().min(1).max(64).default("Note"),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(64)).max(30).optional(),
  status: z.enum(["draft", "stable", "deprecated"]).optional(),
  body: z.string().min(1),
});

export async function GET() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const concepts = await listConcepts();
  return NextResponse.json({ concepts });
}

export async function POST(req: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
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
  const id = await createConcept(input, user.username);
  return NextResponse.json({ id }, { status: 201 });
}