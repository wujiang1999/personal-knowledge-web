import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/requireUser";
import { query } from "@/lib/db";

/**
 * Log out the current session. Bumping token_version invalidates *every*
 * previously issued JWT for this user immediately (no jti/blacklist needed for
 * a single-user app), so a stolen cookie becomes useless the moment the owner
 * logs out. The browser cookie is still cleared as well.
 */
export async function POST() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [user.id]);
  return NextResponse.json({ ok: true });
}
