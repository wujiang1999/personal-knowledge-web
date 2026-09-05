import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/auth";
import { isThrottled, recordFailure, clearFailures, THROTTLE_LOCK_SECONDS } from "@/lib/throttle";
import { withRoute } from "@/lib/withRoute";

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

export const POST = withRoute("POST /api/auth/login", async (req: NextRequest) => {
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

  const { rows } = await query<{ id: string; username: string; password_hash: string; token_version: number; disabled_at: string | null }>(
    "SELECT id, username, password_hash, token_version, disabled_at FROM users WHERE username = $1",
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
  // Disabled account: the password matched, but the account is switched off.
  // Explicit message (admin-managed private KB) and a recorded failure so a
  // credential-stuffing loop against a disabled account still gets throttled.
  if (user.disabled_at) {
    recordFailure(body.username, ip);
    return NextResponse.json({ error: "该账号已被管理员禁用" }, { status: 403 });
  }

  clearFailures(body.username, ip);
  // Best-effort activity stamp for the /users console; a failed stamp never
  // blocks a successful login.
  void query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]).catch(() => {});
  await createSession({ id: user.id, username: user.username, tokenVersion: user.token_version });
  return NextResponse.json({ ok: true, username: user.username });
});
