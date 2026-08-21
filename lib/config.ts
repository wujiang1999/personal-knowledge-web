export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

/**
 * Minimum entropy for the session-signing key. A short or placeholder secret
 * lets an attacker forge JWTs (HS256) and bypass all auth. Fail fast — both at
 * startup and per request — rather than silently signing with a weak key.
 * 32 bytes of base16/hex is the documented floor (openssl rand -hex 32); we
 * also accept any passphrase of >=32 UTF-8 bytes so operators aren't forced
 * into hex. Kept allocation-free on the Edge path (no Buffer usage).
 */
const MIN_SECRET_BYTES = 32;

export function getSessionSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  if (secret.length < MIN_SECRET_BYTES) {
    throw new Error(
      `SESSION_SECRET is too weak: must be at least ${MIN_SECRET_BYTES} bytes. ` +
        `Generate one with \`openssl rand -hex 32\`.`
    );
  }
  return new TextEncoder().encode(secret);
}

export function getAdminUsername(): string {
  return process.env.ADMIN_USERNAME ?? "admin";
}