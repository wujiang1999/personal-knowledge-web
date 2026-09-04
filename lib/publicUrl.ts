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
