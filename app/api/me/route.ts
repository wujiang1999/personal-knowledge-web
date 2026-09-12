import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

/** Identify the authenticated caller (cookie session or Bearer API key). The
 * role here is the effective request role, so an admin-owned write key reports
 * `user` and cannot trick a machine client into treating itself as admin. */
export const GET = withRoute("GET /api/me", async () => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ username: user.username, role: user.role });
});
