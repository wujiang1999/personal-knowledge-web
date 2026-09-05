import { NextResponse } from "next/server";
import { emptyTrash, listTrash } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

/** Recycle bin surface for API clients (the web UI renders /trash directly):
 * GET lists soft-deleted concepts, DELETE empties the bin (hard-delete all). */
export const GET = withRoute("GET /api/trash", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
  const items = await listTrash(user, limit, offset);
  return NextResponse.json({ items });
});

export const DELETE = withRoute("DELETE /api/trash", async () => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const purged = await emptyTrash(user);
  return NextResponse.json({ ok: true, purged });
});
