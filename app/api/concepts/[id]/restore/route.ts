import { NextResponse } from "next/server";
import { restoreConcept } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";
import { isUuid, withRoute } from "@/lib/withRoute";

/** Restore a soft-deleted concept from the recycle bin. */
export const POST = withRoute(
  "POST /api/concepts/[id]/restore",
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ok = await restoreConcept(id, user);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
);
