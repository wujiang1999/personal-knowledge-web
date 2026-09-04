import { query } from "./db";
import type { ScopeUser } from "./requireUser";

/** Usage logs: search queries (search_logs) + LLM/embedding calls (llm_calls),
 * rendered on /logs. All writers are fire-and-forget — logging must never
 * slow or fail the primary flow, so every insert swallows its own error into
 * console.error. A missing table (migration not applied yet) therefore
 * degrades logging only. */

export interface SearchLogInput {
  userId: string;
  query: string;
  /** Caller surface: ui | api | ingest. */
  source: string;
  /** Which lexical/semantic path answered: bm25 | trgm-fallback | semantic-only. */
  mode: string;
  resultCount: number;
  total: number;
  tookMs: number;
}

export function logSearch(input: SearchLogInput): void {
  void query(
    `INSERT INTO search_logs (user_id, query, source, mode, result_count, total, took_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.userId,
      input.query.slice(0, 500),
      input.source.slice(0, 20),
      input.mode.slice(0, 30),
      Math.max(0, Math.trunc(input.resultCount)),
      Math.max(0, Math.trunc(input.total)),
      Math.max(0, Math.trunc(input.tookMs)),
    ]
  ).catch((err: unknown) => {
    console.error("[logs] search log failed:", err instanceof Error ? err.message : err);
  });
}

export interface LlmCallLogInput {
  /** null = system/script call (backfill). */
  userId: string | null;
  kind: "llm" | "embedding";
  purpose: string;
  model: string;
  inputChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  tookMs: number;
  ok: boolean;
  error: string | null;
}

export function logLlmCall(input: LlmCallLogInput): void {
  void query(
    `INSERT INTO llm_calls
       (user_id, kind, purpose, model, input_chars, prompt_tokens, completion_tokens, took_ms, ok, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.userId,
      input.kind,
      input.purpose.slice(0, 50),
      input.model.slice(0, 100) || "unknown",
      Math.max(0, Math.trunc(input.inputChars)),
      input.promptTokens === null ? null : Math.max(0, Math.trunc(input.promptTokens)),
      input.completionTokens === null ? null : Math.max(0, Math.trunc(input.completionTokens)),
      Math.max(0, Math.trunc(input.tookMs)),
      input.ok,
      input.error === null ? null : input.error.slice(0, 500),
    ]
  ).catch((err: unknown) => {
    console.error("[logs] llm call log failed:", err instanceof Error ? err.message : err);
  });
}

/** Coerce a provider usage field (unknown JSON) into a non-negative int. */
export function usageInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

export interface SearchLogRow {
  id: string;
  query: string;
  source: string;
  mode: string;
  result_count: number;
  total: number;
  took_ms: number;
  created_at: string;
  username: string | null;
}

/** Newest search queries, owner-scoped (admin sees all). */
export async function listSearchLogs(user: ScopeUser, limit = 100): Promise<SearchLogRow[]> {
  const { rows } = await query<SearchLogRow>(
    `SELECT s.id, s.query, s.source, s.mode, s.result_count, s.total, s.took_ms, s.created_at,
            u.username
     FROM search_logs s
     LEFT JOIN users u ON u.id = s.user_id
     ${user.role === "admin" ? "" : "WHERE s.user_id = $1"}
     ORDER BY s.created_at DESC
     LIMIT ${Math.max(1, Math.min(500, limit))}`,
    user.role === "admin" ? [] : [user.id]
  );
  return rows;
}

export interface LlmCallRow {
  id: string;
  kind: string;
  purpose: string;
  model: string;
  input_chars: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  took_ms: number | null;
  ok: boolean;
  error: string | null;
  created_at: string;
  username: string | null;
}

/** Newest LLM/embedding calls, owner-scoped (admin sees all; null-user rows
 * are system/script calls visible to admins only). */
export async function listLlmCalls(user: ScopeUser, limit = 100): Promise<LlmCallRow[]> {
  const { rows } = await query<LlmCallRow>(
    `SELECT l.id, l.kind, l.purpose, l.model, l.input_chars, l.prompt_tokens,
            l.completion_tokens, l.took_ms, l.ok, l.error, l.created_at,
            u.username
     FROM llm_calls l
     LEFT JOIN users u ON u.id = l.user_id
     ${
       user.role === "admin"
         ? ""
         : "WHERE l.user_id = $1"
     }
     ORDER BY l.created_at DESC
     LIMIT ${Math.max(1, Math.min(500, limit))}`,
    user.role === "admin" ? [] : [user.id]
  );
  return rows;
}
