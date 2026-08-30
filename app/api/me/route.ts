import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

/** Identify the authenticated caller (cookie session or Bearer API key). */
export const GET = withRoute("GET /api/me", async () => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ username: user.username });
});
