import { NextResponse } from "next/server";
import { AttachmentTooLargeError } from "./attachments";
import { DuplicateBodyError, NotFoundError } from "./concepts";
import { UserExistsError } from "./users";
import { logRequest } from "./logs";
import { resolveKeyContext } from "./apiKey";

type Handler<A extends unknown[]> = (...args: A) => Promise<Response>;

/**
 * Wrap an API route handler so unexpected errors become a logged JSON 500
 * instead of Next.js's silent generic 500 (which leaves no server-side log).
 * Domain errors map to their HTTP status; zod validation stays inline in the
 * routes because 400 responses need request-specific messages.
 *
 * Every served response — mapped errors included — also lands in request_log
 * (fire-and-forget) as the traffic row behind /stats: route, status, latency
 * and, for Bearer-keyed calls, the key's identity. The route name doubles as
 * the log's route label, so it must keep the `METHOD /api/...` shape.
 */
export function withRoute<A extends unknown[]>(name: string, handler: Handler<A>): Handler<A> {
  return async (...args: A) => {
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await handler(...args);
    } catch (err) {
      res = mapRouteError(name, err);
    }
    recordRequest(name, res.status, Date.now() - startedAt, args[0]);
    return res;
  };
}

function mapRouteError(name: string, err: unknown): Response {
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (err instanceof AttachmentTooLargeError) {
    return NextResponse.json({ error: err.message || "attachment too large" }, { status: 413 });
  }
  if (err instanceof DuplicateBodyError) {
    return NextResponse.json(
      { error: err.message, existingId: err.existingId, existingTitle: err.existingTitle },
      { status: 409 }
    );
  }
  if (err instanceof UserExistsError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  console.error(`[api] ${name} failed:`, err);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}

const HEALTH_ROUTE = "GET /api/health";

/** Split a withRoute name ('GET /api/search') into its request_log columns. */
export function parseRouteName(route: string): { method: string; path: string } {
  const split = route.indexOf(" ");
  return split > 0
    ? { method: route.slice(0, split), path: route.slice(split + 1) }
    : { method: "GET", path: route };
}

/** Best-effort traffic row: never awaits, never throws into the request path.
 * Attribution resolves the Bearer key when one was presented (one indexed
 * SELECT); cookie sessions stay unattributed here — search_logs/llm_calls
 * carry user attribution for those. /api/health is probe noise and skips. */
function recordRequest(route: string, status: number, tookMs: number, arg0: unknown): void {
  if (route === HEALTH_ROUTE) return;
  const { method, path } = parseRouteName(route);
  const req = arg0 as Request | undefined;
  const authHeader =
    req && typeof req.headers?.get === "function" ? req.headers.get("authorization") : null;
  void (async () => {
    const key = await resolveKeyContext(authHeader);
    logRequest({
      userId: key?.userId ?? null,
      apiKeyId: key?.apiKeyId ?? null,
      route,
      method,
      path,
      status,
      tookMs,
    });
  })().catch((err: unknown) => {
    console.error("[api] request log failed:", err instanceof Error ? err.message : err);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * [id] params must be UUIDs before they reach a `WHERE id = $1` uuid cast —
 * pg answers a malformed id with 22P02, which used to die as a bare 500.
 * A malformed id cannot exist, so it is answered as 404.
 */
export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}
