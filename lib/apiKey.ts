import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { query } from "./db";
import type { AuthUser } from "./requireUser";

/**
 * Bearer API-key authentication for machine clients (personal-kb MCP).
 *
 * Keys look like `pkb_<48 hex>` and are stored as SHA-256 hashes in the
 * api_keys table — the plaintext is shown once at creation
 * (scripts/create-api-key.ts) and can be revoked independently of the
 * account password. Resolution happens in the route handler (Node runtime,
 * DB access) rather than the Edge middleware, which only detects the
 * header's presence and defers to the route.
 */

/** Minimum shape of a well-formed key: prefix + 32 hex chars. */
export function extractBearerKey(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const key = authHeader.slice("Bearer ".length).trim();
  return /^pkb_[0-9a-f]{32,}$/.test(key) ? key : null;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Resolve the caller from the `Authorization: Bearer pkb_...` header.
 * Returns null when no (well-formed) Bearer header is present — the caller
 * should fall back to the cookie session — or when the key is unknown or
 * revoked. A request that PRESENTS a key is answered by that key alone:
 * an invalid key never falls back to cookies.
 */
export async function getUserByApiKey(): Promise<AuthUser | null> {
  const h = await headers();
  const key = extractBearerKey(h.get("authorization"));
  if (!key) return null;

  const hash = hashApiKey(key);
  const { rows } = await query<{ id: string; username: string; token_version: number }>(
    `SELECT u.id, u.username, u.token_version
     FROM api_keys k
     JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [hash]
  );
  if (rows.length === 0) return null;

  // Best-effort usage stamp, not awaited: auth latency stays flat and a
  // failed stamp can never fail the request.
  void query("UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1", [hash]).catch(
    () => {}
  );

  return { id: rows[0].id, username: rows[0].username, tokenVersion: rows[0].token_version };
}
