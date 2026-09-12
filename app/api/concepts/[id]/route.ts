import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addConceptVersion,
  getConceptDetail,
  purgeConcept,
  trashConcept,
  type ConceptInput,
} from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";
import { isUuid, withRoute } from "@/lib/withRoute";
import { maybeQueueAutoSummary } from "@/lib/summary";

const updateSchema = z.object({
  type: z.string().min(1).max(64).default("Note"),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(64)).max(30).optional(),
  status: z.enum(["draft", "stable", "deprecated"]).optional(),
  body: z.string().min(1),
});

export const GET = withRoute(
  "GET /api/concepts/[id]",
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const concept = await getConceptDetail(id, user);
    if (!concept) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ concept });
  },
);

export const PATCH = withRoute(
  "PATCH /api/concepts/[id]",
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
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

    // A NotFoundError from the version race (row deleted mid-request) maps to
    // 404 in withRoute.
    const result = await addConceptVersion(id, input, user.username, user);
    if (result.created) maybeQueueAutoSummary(id);
    return NextResponse.json({ version: result.version, created: result.created });
  },
);

export const DELETE = withRoute(
  "DELETE /api/concepts/[id]",
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Two-step destruction (规划 §三「不自动覆盖」): DELETE moves to the recycle
    // bin; `?purge=1` hard-deletes, and only succeeds on already-trashed rows.
    const purge = new URL(req.url).searchParams.get("purge");
    if (purge === "1" || purge === "true") {
      const result = await purgeConcept(id, user);
      if (!result.ok) {
        if (result.reason === "not-found")
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(
          { error: "条目不在回收站中：先 DELETE（软删除），再彻底删除" },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true, purged: true });
    }

    const ok = await trashConcept(id, user);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, trashed: true });
  },
);
