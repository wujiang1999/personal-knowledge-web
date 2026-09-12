import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { query } from "./db";
import type { AuthUser } from "./requireUser";

export const API_KEY_ACCESS_MODES = ["read", "write", "admin"] as const;
export type ApiKeyAccessMode = (typeof API_KEY_ACCESS_MODES)[number];

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
  if (!hasBearerAuthorization(authHeader)) return null;
  const key = authHeader!.replace(/^Bearer\s*/i, "").trim();
  return /^pkb_[0-9a-f]{32,}$/.test(key) ? key : null;
}

/** True when a request attempted Bearer authentication, even if the supplied
 * credential is malformed. Callers must not then fall back to a cookie. */
export function hasBearerAuthorization(authHeader: string | null): boolean {
  return /^Bearer(?:\s|$)/i.test(authHeader ?? "");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Effective role for a Bearer-authenticated request. Keeping this separate
 * makes the no-admin-escalation rule auditable and unit-testable. */
export function effectiveApiKeyRole(
  ownerRole: string,
  accessMode: ApiKeyAccessMode,
): "user" | "admin" {
  return accessMode === "admin" && ownerRole === "admin" ? "admin" : "user";
}

/**
 * Resolve the caller from the `Authorization: Bearer pkb_...` header.
 * Returns null when no usable key is present, or when it is unknown, revoked,
 * or expired. Callers use hasBearerAuthorization() to distinguish no Bearer
 * credential (cookie fallback is allowed) from a rejected Bearer credential.
 */
export async function getUserByApiKey(): Promise<AuthUser | null> {
  const h = await headers();
  const key = extractBearerKey(h.get("authorization"));
  if (!key) return null;

  const hash = hashApiKey(key);
  const { rows } = await query<{
    id: string;
    username: string;
    token_version: number;
    role: string;
    api_key_id: string;
    access_mode: ApiKeyAccessMode;
  }>(
    `SELECT u.id, u.username, u.token_version, u.role, k.id AS api_key_id, k.access_mode
     FROM api_keys k
     JOIN users u ON u.id = k.user_id AND u.disabled_at IS NULL
     WHERE k.key_hash = $1
       AND k.revoked_at IS NULL
       AND (k.expires_at IS NULL OR k.expires_at > now())`,
    [hash]
  );
  if (rows.length === 0) return null;

  // Best-effort usage stamp, not awaited: auth latency stays flat and a
  // failed stamp can never fail the request.
  void query("UPDATE api_keys SET last_used_at = now() WHERE key_hash = $1", [hash]).catch(
    () => {}
  );

  const accessMode = rows[0].access_mode;
  // A machine credential is never implicitly administrative merely because
  // its owner is. Only an explicit admin-scoped key owned by an admin account
  // carries the effective admin role.
  const role = effectiveApiKeyRole(rows[0].role, accessMode);

  return {
    id: rows[0].id,
    username: rows[0].username,
    tokenVersion: rows[0].token_version,
    role,
    apiKeyId: rows[0].api_key_id,
    apiKeyAccessMode: accessMode,
  };
}

/**
 * Best-effort attribution lookup for request logging (lib/withRoute):
 * resolves the Bearer key's id + owner in one indexed SELECT, without the
 * session fallback. Null when no well-formed Bearer header is present or the
 * key is unknown/revoked — request_log rows for cookie sessions stay
 * unattributed (search_logs/llm_calls carry user attribution for those).
 */
export async function resolveKeyContext(
  authHeader: string | null
): Promise<{ apiKeyId: string; userId: string } | null> {
  const key = extractBearerKey(authHeader);
  if (!key) return null;
  const { rows } = await query<{ id: string; user_id: string }>(
    `SELECT k.id, k.user_id
     FROM api_keys k JOIN users u ON u.id = k.user_id AND u.disabled_at IS NULL
     WHERE k.key_hash = $1
       AND k.revoked_at IS NULL
       AND (k.expires_at IS NULL OR k.expires_at > now())`,
    [hashApiKey(key)]
  );
  return rows.length > 0 ? { apiKeyId: rows[0].id, userId: rows[0].user_id } : null;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  accessMode: ApiKeyAccessMode;
  expiresAt: string | null;
}

/** One account's keys for the /settings self-service panel (never the hash).
 * Revoked keys sort last so live ones stay on top. */
export async function listApiKeys(userId: string): Promise<ApiKeyRow[]> {
  const { rows } = await query<{
    id: string;
    name: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
    access_mode: ApiKeyAccessMode;
    expires_at: string | null;
  }>(
    `SELECT id, name, created_at, last_used_at, revoked_at, access_mode, expires_at
     FROM api_keys WHERE user_id = $1
     ORDER BY (revoked_at IS NULL) DESC, created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    accessMode: r.access_mode,
    expiresAt: r.expires_at,
  }));
}
