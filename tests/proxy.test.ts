import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import proxy from "../proxy";

/**
 * Per-path framing policy, exercised against the real middleware.
 *
 * proxy.ts must emit the COMPLETE CSP (lib/csp.ts) because its headers.set()
 * replaces whatever next.config already applied. Emitting only the
 * frame-ancestors fragment stripped default-src/script-src/object-src/
 * base-uri/form-action from every route the matcher covers — the whole
 * authenticated app — while matcher-excluded static assets kept the full
 * policy. Verified live 2026-09-14 by comparing /login against /icon.png.
 *
 * The attachment exception needs an authenticated request to reach (an
 * anonymous /api/* call is answered with an early 401 before the header block
 * runs), so these mint a real session cookie instead of relying on the
 * anonymous path.
 */

const ORIGIN = "https://sjtuai.art";
const SECRET = "test-session-secret-at-least-32-bytes-long!!";

/** A session the middleware's Edge-side jwtVerify accepts (signature only —
 * it has no DB access, so token_version is checked later by requireUser). */
async function sessionCookie(): Promise<string> {
  const token = await new SignJWT({ username: "probe", tv: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("4b41b8cb-49b1-48a7-9030-99148b7e4b03")
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(SECRET));
  return `session=${token}`;
}

function req(path: string, cookie?: string) {
  return new NextRequest(new URL(path, ORIGIN), {
    headers: cookie ? { cookie } : undefined,
  });
}

/** Directives the old fragment dropped; they must survive on every route. */
const REQUIRED_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  // NODE_ENV is typed read-only; vi.stubEnv is the sanctioned way to set it
  // (same pattern as tests/auth.test.ts). The CSP is emitted only in
  // production, so the middleware must see NODE_ENV=production on every case.
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy framing headers", () => {
  it("sends the complete policy with frame-ancestors 'none' for pages", async () => {
    const res = await proxy(req("/login"));
    const csp = res.headers.get("content-security-policy") ?? "";

    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(csp).toContain("frame-ancestors 'none'");
    for (const directive of REQUIRED_DIRECTIVES) expect(csp).toContain(directive);
    // The exact fragment the middleware used to send on its own.
    expect(csp).not.toBe("frame-ancestors 'none'");
  });

  it("answers an anonymous API call 401 without weakening headers", async () => {
    const res = await proxy(req("/api/concepts"));
    expect(res.status).toBe(401);
  });

  it("allows our own PDF preview to frame the attachment endpoint", async () => {
    const res = await proxy(
      req("/api/attachments/77450e2d-58d8-4d89-9437-10bec4ae18c7", await sessionCookie())
    );
    const csp = res.headers.get("content-security-policy") ?? "";

    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("frame-ancestors 'none'");
    // Still a complete policy, not just the frame directive.
    for (const directive of REQUIRED_DIRECTIVES) expect(csp).toContain(directive);
  });

  it("keeps ordinary pages denied for framing when authenticated", async () => {
    const res = await proxy(req("/knowledge", await sessionCookie()));
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("does not treat a prefix-similar path as the attachment endpoint", async () => {
    // /api/attachments-evil/... must not inherit the frameable policy.
    const res = await proxy(req("/api/attachmentsX/1", await sessionCookie()));
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
