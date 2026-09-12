import { headers } from "next/headers";
import { getUserByApiKey, hasBearerAuthorization, type ApiKeyAccessMode } from "./apiKey";

export class ApiKeyAuthenticationError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "ApiKeyAuthenticationError";
  }
}

export class ApiKeyAccessError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ApiKeyAccessError";
  }
}

/**
 * Check a Bearer key's route scope. Browser sessions are deliberately outside
 * this policy: their role was authenticated directly and remains unchanged.
 *
 * `request` is optional so the helper stays usable from route wrappers while
 * allowing destructive query variants such as `?purge=1` to be protected.
 */
export async function enforceApiKeyAccess(
  method: string,
  path: string,
  request?: Request,
): Promise<void> {
  const requestHeaders = await headers();
  if (!hasBearerAuthorization(requestHeaders.get("authorization"))) return;

  const user = await getUserByApiKey();
  if (!user || !user.apiKeyAccessMode) throw new ApiKeyAuthenticationError();

  const effectivePath = path.split("?")[0];
  if (user.apiKeyAccessMode === "admin") {
    // getUserByApiKey only gives this mode an admin role when the key owner is
    // an active admin account. Keep this guard local in case the auth shape is
    // changed later.
    if (user.role !== "admin") throw new ApiKeyAccessError();
    return;
  }

  if (!allowsAccess(user.apiKeyAccessMode, method, effectivePath, request)) {
    throw new ApiKeyAccessError();
  }
}

function allowsAccess(mode: Exclude<ApiKeyAccessMode, "admin">, method: string, path: string, request?: Request): boolean {
  const normalizedMethod = method.toUpperCase();

  // Identity, credentials, user administration, and password/session changes
  // must be driven by an authenticated browser session or an explicit admin
  // key. This prevents a standard MCP key from minting or escalating keys.
  if (
    path === "/api/keys" ||
    path.startsWith("/api/keys/") ||
    path === "/api/users" ||
    path.startsWith("/api/users/") ||
    path.startsWith("/api/auth/")
  ) {
    return false;
  }

  if (mode === "read") {
    // Asking consumes the service's LLM budget but is intentionally allowed
    // for read keys; it cannot mutate the knowledge base.
    return normalizedMethod === "GET" || (normalizedMethod === "POST" && path === "/api/ask");
  }

  // A write key can manage its owner's knowledge, but cannot perform the two
  // irreversible delete operations. Soft delete/restore remain reversible.
  if (normalizedMethod === "DELETE" && path === "/api/trash") return false;
  if (normalizedMethod === "DELETE" && path === "/api/concepts/[id]") {
    const url = request ? new URL(request.url) : null;
    if (url?.searchParams.get("purge") === "1" || url?.searchParams.get("purge") === "true") return false;
  }
  return true;
}

/** Exported for unit tests and future policy documentation. */
export function apiKeyAllowsAccess(
  mode: ApiKeyAccessMode,
  method: string,
  path: string,
  request?: Request,
): boolean {
  if (mode === "admin") return true;
  return allowsAccess(mode, method, path, request);
}
