import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";
import { isThrottled, recordFailure, clearFailures, THROTTLE_LOCK_SECONDS } from "@/lib/throttle";

const schema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

// A fixed well-formed bcrypt hash used only to equalize timing for unknown
// users. Never a real credential; just a sink for the dummy compare so a
// missing user costs the same (~250ms) as a real one, defeating enumeration.
const DUMMY_HASH =
  "$2a$12$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * Client IP for rate-limiting. Behind a reverse proxy (Caddy/nginx per README)
 * the real client is the first entry of X-Forwarded-For; fall back to
 * X-Real-IP, then "unknown". The throttle keys on `username|ip`, so a flood
 * from one IP can't lock out other clients.
 */
function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const ip = clientIp(req);
  if (isThrottled(body.username, ip)) {
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
    // Constant-time dummy compare so a non-existent user costs the same as a
    // real one — defeats username enumeration via response-time side channel.
    await verifyPassword(body.password, DUMMY_HASH);
    recordFailure(body.username, ip);
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const user = rows[0];
  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok) {
    recordFailure(body.username, ip);
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  clearFailures(body.username, ip);
  await createSession({ id: user.id, username: user.username, tokenVersion: user.token_version });
  return NextResponse.json({ ok: true, username: user.username });
}
