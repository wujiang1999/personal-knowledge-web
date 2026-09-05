import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { query } from "./db";
import type { ScopeUser } from "./requireUser";

/** Aggregations behind the /stats page and GET /api/stats — pure reads over
 * the usage tables (request_log, search_logs, llm_calls) and catalog counters.
 * Owner scoping follows the /logs convention: admins see the whole library,
 * other users only their own rows; library-wide infra health is admin-only. */

const execFileAsync = promisify(execFile);

/** Clamp the ?days= window. Absent (null/empty) means the 30-day default;
 * unparsable strings also fall back to it; sane bounds 1–365. */
export function clampDays(v: unknown): number {
  if (v === null || v === undefined || v === "") return 30;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(365, n)) : 30;
}

// -------------------------------
// traffic (request_log)
// -------------------------------

export interface TrafficSummary {
  total: number;
  ok: number;
  failed: number;
  /** Percentage 0–100, one decimal. 100 when there is no traffic yet. */
  successRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}

export async function getTrafficSummary(user: ScopeUser, days: number): Promise<TrafficSummary> {
  const isAdmin = user.role === "admin";
  const { rows } = await query<{
    total: number;
    ok: number;
    failed: number;
    avg_ms: number;
    p50_ms: number;
    p95_ms: number;
  }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status < 400)::int AS ok,
            count(*) FILTER (WHERE status >= 400)::int AS failed,
            COALESCE(round(avg(took_ms))::int, 0) AS avg_ms,
            COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY took_ms), 0)::int AS p50_ms,
            COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY took_ms), 0)::int AS p95_ms
     FROM request_log
     WHERE created_at >= now() - make_interval(days => $1)
       ${isAdmin ? "" : "AND user_id = $2"}`,
    isAdmin ? [days] : [days, user.id]
  );
  const r = rows[0];
  return {
    total: r.total,
    ok: r.ok,
    failed: r.failed,
    successRate: r.total > 0 ? Math.round((r.ok / r.total) * 1000) / 10 : 100,
    avgMs: r.avg_ms,
    p50Ms: r.p50_ms,
    p95Ms: r.p95_ms,
  };
}

// -------------------------------
// retrieval quality (search_logs)
// -------------------------------

export interface SearchQuality {
  searches: number;
  zeroResults: number;
  /** Percentage 0–100 of searches that returned nothing. */
  zeroRate: number;
  avgHits: number;
  p50Ms: number;
  p95Ms: number;
  modes: { mode: string; count: number; zero: number }[];
}

export async function getSearchQuality(user: ScopeUser, days: number): Promise<SearchQuality> {
  const isAdmin = user.role === "admin";
  const scopeSql = isAdmin ? "" : "AND user_id = $2";
  const params: unknown[] = isAdmin ? [days] : [days, user.id];

  const [summary, modes] = await Promise.all([
    query<{
      searches: number;
      zero: number;
      avg_hits: number | null;
      p50_ms: number;
      p95_ms: number;
    }>(
      `SELECT count(*)::int AS searches,
              count(*) FILTER (WHERE result_count = 0)::int AS zero,
              round(avg(result_count)::numeric, 1)::float8 AS avg_hits,
              COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY took_ms), 0)::int AS p50_ms,
              COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY took_ms), 0)::int AS p95_ms
       FROM search_logs
       WHERE created_at >= now() - make_interval(days => $1) ${scopeSql}`,
      params
    ),
    query<{ mode: string; count: number; zero: number }>(
      `SELECT mode, count(*)::int AS count,
              count(*) FILTER (WHERE result_count = 0)::int AS zero
       FROM search_logs
       WHERE created_at >= now() - make_interval(days => $1) ${scopeSql}
       GROUP BY mode ORDER BY count DESC`,
      params
    ),
  ]);
  const s = summary.rows[0];
  return {
    searches: s.searches,
    zeroResults: s.zero,
    zeroRate: s.searches > 0 ? Math.round((s.zero / s.searches) * 1000) / 10 : 0,
    avgHits: s.avg_hits ?? 0,
    p50Ms: s.p50_ms,
    p95Ms: s.p95_ms,
    modes: modes.rows,
  };
}

// -------------------------------
// per-key usage (admin, request_log)
// -------------------------------

export interface KeyUsageRow {
  keyId: string;
  name: string;
  username: string;
  lastUsedAt: string | null;
  calls: number;
  okCalls: number;
  /** Non-GET writes under /api/concepts or /api/capture — the "knowledge
   * contribution" column: creates/updates/deletes/captures through this key. */
  contributions: number;
}

export async function getApiKeyUsage(user: ScopeUser, days: number): Promise<KeyUsageRow[]> {
  if (user.role !== "admin") return [];
  const { rows } = await query<{
    id: string;
    name: string;
    username: string;
    last_used_at: string | null;
    calls: number;
    ok_calls: number;
    contributions: number;
  }>(
    `SELECT k.id, k.name, u.username, k.last_used_at,
            count(r.id)::int AS calls,
            count(r.id) FILTER (WHERE r.status < 400)::int AS ok_calls,
            count(r.id) FILTER (
              WHERE r.method <> 'GET'
                AND (r.path LIKE '/api/concepts%' OR r.path LIKE '/api/capture%')
            )::int AS contributions
     FROM api_keys k
     JOIN users u ON u.id = k.user_id
     LEFT JOIN request_log r
       ON r.api_key_id = k.id AND r.created_at >= now() - make_interval(days => $1)
     WHERE k.revoked_at IS NULL
     GROUP BY k.id, k.name, u.username, k.last_used_at
     ORDER BY calls DESC, k.created_at`,
    [days]
  );
  return rows.map((r) => ({
    keyId: r.id,
    name: r.name,
    username: r.username,
    lastUsedAt: r.last_used_at,
    calls: r.calls,
    okCalls: r.ok_calls,
    contributions: r.contributions,
  }));
}

// -------------------------------
// hot entries (concepts.retrieval_count)
// -------------------------------

export interface TopRetrievedRow {
  id: string;
  title: string;
  status: string;
  retrievalCount: number;
  lastRetrievedAt: string | null;
}

export async function getTopRetrieved(user: ScopeUser, limit = 10): Promise<TopRetrievedRow[]> {
  const isAdmin = user.role === "admin";
  const { rows } = await query<{
    id: string;
    title: string;
    status: string;
    retrieval_count: number;
    last_retrieved_at: string | null;
  }>(
    `SELECT id, title, status, retrieval_count, last_retrieved_at
     FROM concepts
     WHERE deleted_at IS NULL AND retrieval_count > 0
       ${isAdmin ? "" : "AND owner_id = $1"}
     ORDER BY retrieval_count DESC, last_retrieved_at DESC NULLS LAST
     LIMIT ${Math.max(1, Math.min(50, limit))}`,
    isAdmin ? [] : [user.id]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    retrievalCount: r.retrieval_count,
    lastRetrievedAt: r.last_retrieved_at,
  }));
}

// -------------------------------
// library health (admin, global)
// -------------------------------

export interface LibraryHealth {
  conceptsTotal: number;
  deprecatedTotal: number;
  trashTotal: number;
  neverRetrieved: number;
  versionRows: number;
  attachmentRows: number;
  attachmentBytes: number;
  embeddingRows: number;
  /** Live concepts whose current version differs from the embedded one. */
  embeddingStale: number;
  /** Percentage of live concepts that have an embedding at all. */
  embeddingCoverage: number;
  dbSize: string;
}

export async function getLibraryHealth(user: ScopeUser): Promise<LibraryHealth | null> {
  if (user.role !== "admin") return null;
  const { rows } = await query<{
    concepts_total: number;
    deprecated_total: number;
    trash_total: number;
    never_retrieved: number;
    version_rows: number;
    attachment_rows: number;
    attachment_bytes: string;
    embedding_rows: number;
    embedding_stale: number;
    db_size: string;
  }>(
    `SELECT
       (SELECT count(*) FROM concepts WHERE deleted_at IS NULL)::int AS concepts_total,
       (SELECT count(*) FROM concepts WHERE deleted_at IS NULL AND status = 'deprecated')::int AS deprecated_total,
       (SELECT count(*) FROM concepts WHERE deleted_at IS NOT NULL)::int AS trash_total,
       (SELECT count(*) FROM concepts WHERE deleted_at IS NULL AND retrieval_count = 0)::int AS never_retrieved,
       (SELECT count(*) FROM concept_versions)::int AS version_rows,
       (SELECT count(*) FROM attachments)::int AS attachment_rows,
       (SELECT COALESCE(sum(size_bytes), 0)::text FROM attachments) AS attachment_bytes,
       (SELECT count(*) FROM concept_embeddings e
          JOIN concepts c ON c.id = e.concept_id AND c.deleted_at IS NULL)::int AS embedding_rows,
       (SELECT count(*) FROM concept_embeddings e
          JOIN concepts c ON c.id = e.concept_id AND c.deleted_at IS NULL
          JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
          WHERE e.content_hash IS DISTINCT FROM v.content_hash)::int AS embedding_stale,
       pg_size_pretty(pg_database_size(current_database())) AS db_size`
  );
  const r = rows[0];
  const live = r.concepts_total;
  return {
    conceptsTotal: live,
    deprecatedTotal: r.deprecated_total,
    trashTotal: r.trash_total,
    neverRetrieved: r.never_retrieved,
    versionRows: r.version_rows,
    attachmentRows: r.attachment_rows,
    attachmentBytes: Number(r.attachment_bytes),
    embeddingRows: r.embedding_rows,
    embeddingStale: r.embedding_stale,
    embeddingCoverage: live > 0 ? Math.round((r.embedding_rows / live) * 100) : 0,
    dbSize: r.db_size,
  };
}

// -------------------------------
// build info
// -------------------------------

export interface BuildInfo {
  /** Deployed git commit (full sha), 'unknown' outside a git checkout. */
  commit: string;
  /** Process start time — effectively the last deploy/restart. */
  startedAt: string;
}

let commitPromise: Promise<string> | null = null;

/** Resolved once per process: the running checkout's HEAD. Cached because the
 * answer cannot change without a deploy, and a deploy restarts the process. */
export function getBuildCommit(): Promise<string> {
  commitPromise ??= execFileAsync("git", ["-C", process.cwd(), "rev-parse", "HEAD"])
    .then((r) => (r.stdout.trim() || "unknown"))
    .catch(() => "unknown");
  return commitPromise;
}

export async function getBuildInfoAsync(): Promise<BuildInfo> {
  const commit = await getBuildCommit();
  return { commit, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() };
}
