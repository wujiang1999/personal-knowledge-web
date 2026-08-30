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

export interface LlmConfig {
  /** OpenAI-compatible base URL, trailing slashes stripped (e.g. https://api.deepseek.com/v1). */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Optional OpenAI-compatible chat LLM used by ingest atomization and auto
 * summary. Returns null when any of LLM_BASE_URL / LLM_API_KEY / LLM_MODEL is
 * unset — callers must degrade gracefully (features are opt-in).
 */
export function getLlmChatConfig(): LlmConfig | null {
  const baseUrl = (process.env.LLM_BASE_URL ?? "").trim();
  const apiKey = (process.env.LLM_API_KEY ?? "").trim();
  const model = (process.env.LLM_MODEL ?? "").trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model };
}

/**
 * Optional embedding endpoint for semantic search. Falls back to the chat
 * LLM_* values when LLM_EMBEDDING_* are unset, but requires an explicit
 * LLM_EMBEDDING_DIMENSIONS because the pgvector column/index is dimensioned
 * on first backfill. Returns null when incomplete — semantic search stays off.
 */
export function getLlmEmbeddingConfig(): (LlmConfig & { dimensions: number }) | null {
  const baseUrl = (process.env.LLM_EMBEDDING_BASE_URL ?? process.env.LLM_BASE_URL ?? "").trim();
  const apiKey = (process.env.LLM_EMBEDDING_API_KEY ?? process.env.LLM_API_KEY ?? "").trim();
  const model = (process.env.LLM_EMBEDDING_MODEL ?? "").trim();
  const dimensions = Math.trunc(Number(process.env.LLM_EMBEDDING_DIMENSIONS ?? 0)) || 0;
  if (!baseUrl || !apiKey || !model || dimensions <= 0) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model, dimensions };
}

/** Auto summary runs only when explicitly enabled (LLM_AUTO_SUMMARY=1/on/true). */
export function isAutoSummaryEnabled(): boolean {
  const v = (process.env.LLM_AUTO_SUMMARY ?? "").trim().toLowerCase();
  return v === "1" || v === "on" || v === "true";
}