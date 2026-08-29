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
}

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
  // whose tv is out of date (e.g. after a password change) is rejected here.
  if (rows.length === 0 || rows[0].token_version !== session.tokenVersion) redirect("/login");
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
