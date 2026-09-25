import { NextResponse } from "next/server";
import { z } from "zod";
import { countConcepts, createConcept, listConcepts, type ConceptInput } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";
import { maybeQueueAutoSummary } from "@/lib/summary";

const createSchema = z.object({
  type: z.string().min(1).max(64).default("Note"),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(64)).max(30).optional(),
  status: z.enum(["draft", "stable", "deprecated"]).optional(),
  body: z.string().min(1),
});

export const GET = withRoute("GET /api/concepts", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  // Number(null) === 0 in JS: a missing ?limit must not become limit=1.
  const limitRaw = url.searchParams.get("limit");
  const limit =
    limitRaw === null ? 100 : Math.min(200, Math.max(1, Math.trunc(Number(limitRaw)) || 100));
  const offsetRaw = Number(url.searchParams.get("offset"));
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0;
  const statusRaw = url.searchParams.get("status");
  const status =
    statusRaw === "draft" || statusRaw === "stable" || statusRaw === "deprecated"
      ? statusRaw
      : undefined;
  const category = url.searchParams.get("category")?.trim().slice(0, 200) || undefined;
  const [concepts, total] = await Promise.all([
    listConcepts({ user, status, category, limit, offset }),
    countConcepts(user, category, status),
  ]);
  return NextResponse.json({ concepts, total });
});

export const POST = withRoute("POST /api/concepts", async (req: Request) => {
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
  const id = await createConcept(input, user);
  maybeQueueAutoSummary(id);
  return NextResponse.json({ id }, { status: 201 });
});
