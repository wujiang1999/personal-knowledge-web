import { NextResponse } from "next/server";
import { AttachmentTooLargeError } from "./attachments";
import { NotFoundError } from "./concepts";

type Handler<A extends unknown[]> = (...args: A) => Promise<Response>;

/**
 * Wrap an API route handler so unexpected errors become a logged JSON 500
 * instead of Next.js's silent generic 500 (which leaves no server-side log).
 * Domain errors map to their HTTP status; zod validation stays inline in the
 * routes because 400 responses need request-specific messages.
 */
export function withRoute<A extends unknown[]>(name: string, handler: Handler<A>): Handler<A> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (err instanceof AttachmentTooLargeError) {
        return NextResponse.json({ error: err.message || "attachment too large" }, { status: 413 });
      }
      console.error(`[api] ${name} failed:`, err);
      return NextResponse.json({ error: "internal error" }, { status: 500 });
    }
  };
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
