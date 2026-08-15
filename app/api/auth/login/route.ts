import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";

const schema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export async function POST(req: Request) {
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { rows } = await query<{ id: string; username: string; password_hash: string }>(
    "SELECT id, username, password_hash FROM users WHERE username = $1",
    [body.username]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const user = rows[0];
  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  await createSession({ id: user.id, username: user.username });
  return NextResponse.json({ ok: true, username: user.username });
}