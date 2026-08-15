import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/password";
import { requireApiUser } from "@/lib/requireUser";
import { createSession } from "@/lib/auth";

const schema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

export async function POST(req: Request) {
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
  // Bump token_version so every previously issued JWT dies, then re-issue a
  // fresh session so the current user isn't logged out by the change.
  await query("UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2", [newHash, user.id]);
  const { rows: fresh } = await query<{ id: string; username: string; token_version: number }>(
    "SELECT id, username, token_version FROM users WHERE id = $1",
    [user.id]
  );
  await createSession({ id: fresh[0].id, username: fresh[0].username, tokenVersion: fresh[0].token_version });
  return NextResponse.json({ ok: true });
}