import { NextResponse } from "next/server";
import { listSources } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

export const GET = withRoute("GET /api/sources", async () => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sources = await listSources(user);
  return NextResponse.json({ sources });
});
