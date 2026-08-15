import { redirect } from "next/navigation";
import { getSession } from "./auth";
import { query } from "./db";

export interface AuthUser {
  id: string;
  username: string;
}

/**
 * Load the authenticated user or redirect to /login.
 * Call this in every protected server component.
 */
export async function requireUser(): Promise<AuthUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  const { rows } = await query<AuthUser>("SELECT id, username FROM users WHERE id = $1", [session.sub]);
  if (rows.length === 0) redirect("/login");
  return rows[0];
}

/**
 * Load the authenticated user for an API route, returning null instead of
 * redirecting so the handler can return a JSON 401.
 */
export async function requireApiUser(): Promise<AuthUser | null> {
  const session = await getSession();
  if (!session) return null;
  const { rows } = await query<AuthUser>("SELECT id, username FROM users WHERE id = $1", [session.sub]);
  if (rows.length === 0) return null;
  return rows[0];
}