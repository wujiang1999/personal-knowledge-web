import { redirect } from "next/navigation";
import { getSession } from "./auth";
import { getUserByApiKey } from "./apiKey";
import { query } from "./db";

export interface AuthUser {
  id: string;
  username: string;
  tokenVersion: number;
  /** 'admin' accounts bypass owner scoping and see/act on all users' data. */
  role: "user" | "admin";
  /** Set only when the caller authenticated via a Bearer API key — the
   * attribution handle that search/LLM/request logs store for per-key usage
   * stats. Cookie sessions leave it unset. */
  apiKeyId?: string;
}

/** Owner-scoping only needs identity + role; lib functions take this shape.
 * apiKeyId rides along when present so logging calls can attribute usage. */
export type ScopeUser = Pick<AuthUser, "id" | "role"> & { apiKeyId?: string };

/**
 * Load the authenticated user or redirect to /login.
 * Call this in every protected server component.
 */
export async function requireUser(): Promise<AuthUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  const { rows } = await query<{ id: string; username: string; token_version: number; role: string }>(
    "SELECT id, username, token_version, role FROM users WHERE id = $1",
    [session.sub]
  );
  // token_version is the authoritative revocation check: middleware only
  // verifies the JWT signature (it runs on Edge and cannot reach pg). A token
  // whose tv is out of date (e.g. after a password change or a logout on
  // another device) is rejected here. Redirect to the expire endpoint, not
  // /login: the proxy would bounce a signature-valid cookie straight back to
  // /dashboard, so /login would loop forever (renders as a black screen).
  // /api/auth/expire deletes the cookie so the next hop reaches the form.
  if (rows.length === 0 || rows[0].token_version !== session.tokenVersion) redirect("/api/auth/expire");
  return {
    id: rows[0].id,
    username: rows[0].username,
    tokenVersion: rows[0].token_version,
    role: rows[0].role === "admin" ? "admin" : "user",
  };
}

/**
 * Load the authenticated user for an API route, returning null instead of
 * redirecting so the handler can return a JSON 401.
 *
 * Accepts two credential types: `Authorization: Bearer pkb_...` API keys
 * (machine clients, e.g. the MCP server) take precedence when present — an
 * invalid key is answered as-is and never falls back to the cookie — and
 * browser requests keep using the httpOnly session cookie.
 */
export async function requireApiUser(): Promise<AuthUser | null> {
  const viaKey = await getUserByApiKey();
  if (viaKey) return viaKey;
  const session = await getSession();
  if (!session) return null;
  const { rows } = await query<{ id: string; username: string; token_version: number; role: string }>(
    "SELECT id, username, token_version, role FROM users WHERE id = $1",
    [session.sub]
  );
  if (rows.length === 0 || rows[0].token_version !== session.tokenVersion) return null;
  return {
    id: rows[0].id,
    username: rows[0].username,
    tokenVersion: rows[0].token_version,
    role: rows[0].role === "admin" ? "admin" : "user",
  };
}
