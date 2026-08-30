import { NextResponse } from "next/server";
import { searchConcepts } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

export const GET = withRoute("GET /api/search", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const k = Math.max(3, Math.min(50, Number(searchParams.get("k") ?? 20) || 20));
  const offsetRaw = Number(searchParams.get("offset"));
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0;

  const { results, total } = await searchConcepts(user, q, k, offset);
  return NextResponse.json({ results, total });
});
