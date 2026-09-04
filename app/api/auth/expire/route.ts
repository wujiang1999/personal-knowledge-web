import { NextResponse, type NextRequest } from "next/server";
import { destroySession } from "@/lib/auth";
import { publicRequestUrl } from "@/lib/publicUrl";
import { withRoute } from "@/lib/withRoute";

/**
 * Escape hatch for a stale session cookie (signature still valid but
 * token_version outdated, e.g. after a logout on another device or a
 * password change). The proxy runs on Edge without DB access, so it keeps
 * treating the cookie as valid and bounces /login back to /dashboard, while
 * requireUser on every page bounces /dashboard back to /login — an infinite
 * redirect loop that renders as a black screen. requireUser redirects here
 * instead; deleting the cookie lets the next request reach the real form.
 */
export const GET = withRoute("GET /api/auth/expire", async (req: NextRequest) => {
  await destroySession();
  const url = publicRequestUrl(req);
  url.pathname = "/login";
  url.search = "";
  const res = NextResponse.redirect(url);
  res.headers.set("Cache-Control", "no-store");
  return res;
});
