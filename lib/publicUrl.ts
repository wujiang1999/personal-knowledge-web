import type { NextRequest } from "next/server";

/**
 * Absolute URL for redirects that survives the reverse proxy: `next start`
 * binds 127.0.0.1, so req.nextUrl's origin is the private upstream address.
 * Caddy forwards the public host/proto via x-forwarded-* headers; prefer
 * them so Location headers keep the public HTTPS origin instead of leaking
 * 127.0.0.1:3000 to the browser.
 */
export function publicRequestUrl(req: NextRequest): URL {
  const url = req.nextUrl.clone();
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();

  if (forwardedHost) {
    url.host = forwardedHost;
    url.port = "";
  }
  if (forwardedProto === "http" || forwardedProto === "https") {
    url.protocol = `${forwardedProto}:`;
  }
  return url;
}

/** Resolve a caller-supplied redirect target to a same-origin path, or return
 * `fallback` when it is not one.
 *
 * Used for the `?next=` parameter on /login. The previous check was a
 * hand-rolled blacklist — `next.startsWith("/") && !next.startsWith("//")` —
 * which blocked `//evil.com` but not `/\evil.com`: URL parsers normalize a
 * backslash to `/`, so that string resolves to `https://evil.com/` and a
 * crafted login link redirected the user off-site after authenticating.
 *
 * Resolving against a throwaway origin and requiring the origin to come back
 * unchanged covers every variant at once (`//host`, `/\host`, `\\host`,
 * absolute URLs, `javascript:`, `data:`) instead of enumerating spellings.
 * Note the returned path is URL-normalized, which is what a redirect needs.
 */
export function safeSameOriginPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  let resolved: URL;
  try {
    resolved = new URL(raw, "https://same-origin.invalid");
  } catch {
    return fallback;
  }
  if (resolved.origin !== "https://same-origin.invalid") return fallback;
  return resolved.pathname + resolved.search + resolved.hash;
}
