import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/password";
import { requireApiUser } from "@/lib/requireUser";
import { destroySession } from "@/lib/auth";
import { withRoute } from "@/lib/withRoute";

const schema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

export const POST = withRoute("POST /api/auth/change-password", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { rows } = await query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [user.id]
  );
  if (rows.length === 0) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ok = await verifyPassword(body.currentPassword, rows[0].password_hash);
  if (!ok) return NextResponse.json({ error: "current password is incorrect" }, { status: 400 });

  const newHash = await hashPassword(body.newPassword);
  // Bump token_version: every previously issued JWT dies, including this one.
  // Clear the cookie too (same rationale as logout — the Edge proxy verifies
  // only the signature and would otherwise keep treating the stale cookie as
  // a live session). The UI then redirects to /login, so re-authentication
  // with the new password is mandatory; the old cookie cannot resurrect it.
  await query("UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2", [newHash, user.id]);
  await destroySession();
  return NextResponse.json({ ok: true });
});