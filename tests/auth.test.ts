import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

/**
 * Tests for the primary session boundary (lib/auth.ts), which had no coverage
 * while lower-stakes modules did. These pin the properties the app's security
 * rests on: signature verification, the `token_version` revocation fallback
 * (the mechanism behind "change password logs every device out"), cookie
 * hardening flags, and expiry.
 */

const SECRET = "test-session-secret-at-least-32-bytes-long!!";
const USER_ID = "4b41b8cb-49b1-48a7-9030-99148b7e4b03";

type CookieValue = { value: string; options?: Record<string, unknown> };
const store = new Map<string, CookieValue>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => store.get(name),
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      store.set(name, { value, options }),
    delete: (name: string) => store.delete(name),
  }),
}));

const auth = await import("../lib/auth");

/** Mint a token with arbitrary claims, signed with the app secret. */
async function mint(claims: Record<string, unknown>, secret = SECRET, expiresIn = "7d") {
  const parts = Object.entries(claims);
  let jwt = new SignJWT(Object.fromEntries(parts.filter(([k]) => k !== "sub"))).setProtectedHeader({
    alg: "HS256",
  });
  const sub = claims.sub;
  if (typeof sub === "string") jwt = jwt.setSubject(sub);
  return jwt.setIssuedAt().setExpirationTime(expiresIn).sign(new TextEncoder().encode(secret));
}

beforeEach(() => {
  store.clear();
  process.env.SESSION_SECRET = SECRET;
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createSession", () => {
  it("sets a hardened session cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await auth.createSession({ id: USER_ID, username: "admin", tokenVersion: 3 });

    const cookie = store.get("session");
    expect(cookie).toBeDefined();
    expect(cookie?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  });

  it("omits Secure only when explicitly disabled for plain-HTTP serving", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_COOKIE_SECURE", "false");
    await auth.createSession({ id: USER_ID, username: "admin", tokenVersion: 1 });
    expect(store.get("session")?.options?.secure).toBe(false);
  });

  it("round-trips through getSession with the same token version", async () => {
    await auth.createSession({ id: USER_ID, username: "admin", tokenVersion: 7 });
    const session = await auth.getSession();
    expect(session).toEqual({ sub: USER_ID, username: "admin", tokenVersion: 7 });
  });
});

describe("getSession", () => {
  it("returns null when there is no cookie", async () => {
    expect(await auth.getSession()).toBeNull();
  });

  it("returns null for a malformed token", async () => {
    store.set("session", { value: "not-a-jwt" });
    expect(await auth.getSession()).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    // Forged HS256 token — the whole point of verifying rather than decoding.
    store.set("session", { value: await mint({ username: "admin", tv: 1, sub: USER_ID }, "attacker-secret-value-32-bytes-min!!!") });
    expect(await auth.getSession()).toBeNull();
  });

  it("rejects an expired token", async () => {
    store.set("session", { value: await mint({ username: "admin", tv: 1, sub: USER_ID }, SECRET, "-1s") });
    expect(await auth.getSession()).toBeNull();
  });

  it("rejects a token with no subject", async () => {
    store.set("session", { value: await mint({ username: "admin", tv: 1 }) });
    expect(await auth.getSession()).toBeNull();
  });

  it("falls back to tokenVersion -1 when tv is absent or not a number", async () => {
    // A token issued before token_version existed must never match a DB row
    // whose token_version is >= 1 — that is what makes revocation effective
    // for old sessions instead of silently letting them through.
    store.set("session", { value: await mint({ username: "admin", sub: USER_ID }) });
    expect((await auth.getSession())?.tokenVersion).toBe(-1);

    store.set("session", { value: await mint({ username: "admin", tv: "nope", sub: USER_ID }) });
    expect((await auth.getSession())?.tokenVersion).toBe(-1);
  });

  it("accepts tokenVersion 0 and reports it verbatim", async () => {
    // Guards against an `||`-style fallback turning a legitimate 0 into -1.
    store.set("session", { value: await mint({ username: "admin", tv: 0, sub: USER_ID }) });
    expect((await auth.getSession())?.tokenVersion).toBe(0);
  });

  it("tolerates a missing username claim", async () => {
    store.set("session", { value: await mint({ tv: 1, sub: USER_ID }) });
    expect((await auth.getSession())?.username).toBe("");
  });
});

describe("destroySession", () => {
  it("removes the cookie", async () => {
    await auth.createSession({ id: USER_ID, username: "admin", tokenVersion: 1 });
    expect(store.has("session")).toBe(true);
    await auth.destroySession();
    expect(store.has("session")).toBe(false);
  });
});
