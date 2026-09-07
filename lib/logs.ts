import { z } from "zod";
import { query } from "./db";
import type { ScopeUser } from "./requireUser";


/** Time-window filter for the /logs tables. `days` = rolling window of the
 * last N days; `date` = a single calendar day (YYYY-MM-DD, Beijing time, to
 * match the zh-CN timestamps the page renders). `date` wins when both are
 * given. Values are validated by the caller (the /logs page). */
export interface LogFilter {
  days?: number;
  date?: string;
}

/** Build the WHERE clause shared by the record-list queries (search_logs,
 * llm_calls, sources): owner scope for non-admins + the optional time filter.
 * Appends bound params to `params` and returns "" or " WHERE ...". The two
 * fully-qualified expressions differ per query — sources join concepts, so
 * ownership and time live on different tables/aliases. */
export function logWhereClause(
  ownerExpr: string,
  timeExpr: string,
  user: ScopeUser,
  filter: LogFilter | undefined,
  params: unknown[]
): string {
  const conds: string[] = [];
  if (user.role !== "admin") {
    params.push(user.id);
    conds.push(`${ownerExpr} = $${params.length}`);
  }
  if (filter?.days != null && filter.days > 0) {
    params.push(filter.days);
    conds.push(`${timeExpr} >= now() - ($${params.length} * interval '1 day')`);
  }
  if (filter?.date) {
    params.push(filter.date);
    conds.push(`(${timeExpr} AT TIME ZONE 'Asia/Shanghai')::date = $${params.length}::date`);
  }
  return conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
}

/** Usage logs: search queries (search_logs) + LLM/embedding calls (llm_calls),
 * rendered on /logs. All writers are fire-and-forget — logging must never
 * slow or fail the primary flow, so every insert swallows its own error into
 * console.error. A missing table (migration not applied yet) therefore
 * degrades logging only. */

export interface SearchLogInput {
  userId: string;
  /** Bearer key attribution when the caller used an API key (null/undefined
   * for cookie sessions). Feeds the per-key usage table on /stats. */
  apiKeyId?: string | null;
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
    `INSERT INTO search_logs (user_id, api_key_id, query, source, mode, result_count, total, took_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.userId,
      input.apiKeyId ?? null,
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

/** Per-entry retrieval counter: one batched UPDATE per search that actually
 * returned results (ui|api sources only — the ingest dedup probe doesn't
 * count, and cache hits never reach the caller). Feeds the /stats hot-entries
 * table and the never-retrieved curation signal. Fire-and-forget. */
export function logRetrievalHits(conceptIds: string[]): void {
  if (conceptIds.length === 0) return;
  void query(
    `UPDATE concepts SET retrieval_count = retrieval_count + 1, last_retrieved_at = now()
     WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [conceptIds]
  ).catch((err: unknown) => {
    console.error("[logs] retrieval count failed:", err instanceof Error ? err.message : err);
  });
}

export interface RequestLogInput {
  userId?: string | null;
  apiKeyId?: string | null;
  /** withRoute name, 'GET /api/search' shape. */
  route: string;
  method: string;
  path: string;
  status: number;
  tookMs: number;
}

/** Retention horizon for request_log — traffic rows are diagnostics, not
 * audit records; 180 days is ample for trend-spotting at personal scale. */
const REQUEST_LOG_RETENTION_DAYS = 180;

export function logRequest(input: RequestLogInput): void {
  void query(
    `INSERT INTO request_log (user_id, api_key_id, route, method, path, status, took_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.userId ?? null,
      input.apiKeyId ?? null,
      input.route.slice(0, 120),
      input.method.slice(0, 10),
      input.path.slice(0, 200),
      Math.trunc(input.status),
      Math.max(0, Math.trunc(input.tookMs)),
    ]
  ).catch((err: unknown) => {
    console.error("[logs] request log failed:", err instanceof Error ? err.message : err);
  });
  // Piggyback retention: ~2% of inserts also drop rows past the horizon, so
  // the table self-heals without a cron job while keeping writes cheap.
  if (Math.random() < 0.02) {
    void query("DELETE FROM request_log WHERE created_at < now() - make_interval(days => $1)", [
      REQUEST_LOG_RETENTION_DAYS,
    ]).catch(() => {});
  }
}

export interface LlmCallLogInput {
  /** null = system/script call (backfill). */
  userId: string | null;
  /** Bearer key attribution when the triggering request used an API key. */
  apiKeyId?: string | null;
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

/** API payload contract for POST /api/logs/llm — the shape remote clients
 * (the MCP judge) report LLM calls with. Validates and clamps: over-long
 * strings are truncated, absent numerics become null, out-of-range values
 * are rejected. */
export const llmCallLogSchema = z.object({
  kind: z.enum(["llm", "embedding"]),
  purpose: z
    .string()
    .transform((s) => s.trim().slice(0, 50))
    .pipe(z.string().min(1)),
  model: z
    .string()
    .transform((s) => s.slice(0, 100))
    .pipe(z.string().min(1)),
  input_chars: z.number().int().min(0).max(100_000_000).nullish().transform((v) => v ?? null),
  prompt_tokens: z.number().int().min(0).max(100_000_000).nullish().transform((v) => v ?? null),
  completion_tokens: z.number().int().min(0).max(100_000_000).nullish().transform((v) => v ?? null),
  took_ms: z.number().int().min(0).max(3_600_000).nullish().transform((v) => v ?? null),
  ok: z.boolean(),
  error: z
    .string()
    .nullish()
    .transform((v) => (typeof v === "string" ? v.slice(0, 500) : null)),
});
export type LlmCallLogPayload = z.output<typeof llmCallLogSchema>;

/** Awaited insert used by the ingest API route (the route returns after the
 * row is durably queued). apiKeyId is server-side attribution only — remote
 * clients never send it; the route passes the authenticated key's id. */
export async function insertLlmCall(
  userId: string | null,
  p: LlmCallLogPayload,
  apiKeyId?: string | null
): Promise<void> {
  await query(
    `INSERT INTO llm_calls
       (user_id, api_key_id, kind, purpose, model, input_chars, prompt_tokens, completion_tokens, took_ms, ok, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [userId, apiKeyId ?? null, p.kind, p.purpose, p.model, p.input_chars, p.prompt_tokens, p.completion_tokens, p.took_ms, p.ok, p.error]
  );
}

export function logLlmCall(input: LlmCallLogInput): void {
  void insertLlmCall(input.userId, {
    kind: input.kind,
    purpose: input.purpose.slice(0, 50),
    model: input.model.slice(0, 100) || "unknown",
    input_chars: Math.max(0, Math.trunc(input.inputChars)),
    prompt_tokens: input.promptTokens === null ? null : Math.max(0, Math.trunc(input.promptTokens)),
    completion_tokens: input.completionTokens === null ? null : Math.max(0, Math.trunc(input.completionTokens)),
    took_ms: Math.max(0, Math.trunc(input.tookMs)),
    ok: input.ok,
    error: input.error === null ? null : input.error.slice(0, 500),
  }, input.apiKeyId).catch((err: unknown) => {
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

/** Newest search queries, owner-scoped (admin sees all). Optional time
 * filter (rolling days window or a single Beijing calendar day). */
export async function listSearchLogs(
  user: ScopeUser,
  limit = 100,
  filter?: LogFilter
): Promise<SearchLogRow[]> {
  const params: unknown[] = [];
  const where = logWhereClause("s.user_id", "s.created_at", user, filter, params);
  const { rows } = await query<SearchLogRow>(
    `SELECT s.id, s.query, s.source, s.mode, s.result_count, s.total, s.took_ms, s.created_at,
            u.username
     FROM search_logs s
     LEFT JOIN users u ON u.id = s.user_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT ${Math.max(1, Math.min(500, limit))}`,
    params
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
 * are system/script calls visible to admins only). Same optional time filter
 * as listSearchLogs. */
export async function listLlmCalls(
  user: ScopeUser,
  limit = 100,
  filter?: LogFilter
): Promise<LlmCallRow[]> {
  const params: unknown[] = [];
  const where = logWhereClause("l.user_id", "l.created_at", user, filter, params);
  const { rows } = await query<LlmCallRow>(
    `SELECT l.id, l.kind, l.purpose, l.model, l.input_chars, l.prompt_tokens,
            l.completion_tokens, l.took_ms, l.ok, l.error, l.created_at,
            u.username
     FROM llm_calls l
     LEFT JOIN users u ON u.id = l.user_id
     ${where}
     ORDER BY l.created_at DESC
     LIMIT ${Math.max(1, Math.min(500, limit))}`,
    params
  );
  return rows;
}
