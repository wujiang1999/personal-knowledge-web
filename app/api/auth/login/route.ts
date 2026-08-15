import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";
import { isThrottled, recordFailure, clearFailures, THROTTLE_LOCK_SECONDS } from "@/lib/throttle";

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

  if (isThrottled(body.username)) {
    return NextResponse.json(
      { error: "too many attempts, please wait" },
      { status: 429, headers: { "Retry-After": String(THROTTLE_LOCK_SECONDS) } }
    );
  }

  const { rows } = await query<{ id: string; username: string; password_hash: string; token_version: number }>(
    "SELECT id, username, password_hash, token_version FROM users WHERE username = $1",
    [body.username]
  );

  if (rows.length === 0) {
    recordFailure(body.username);
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const user = rows[0];
  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok) {
    recordFailure(body.username);
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  clearFailures(body.username);
  await createSession({ id: user.id, username: user.username, tokenVersion: user.token_version });
  return NextResponse.json({ ok: true, username: user.username });
}