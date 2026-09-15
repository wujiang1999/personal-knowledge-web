import type { NextConfig } from "next";
import { buildCsp } from "./lib/csp";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next.js buffers request bodies at 10MB by default when the proxy is
    // present. Raise it so attachment uploads can stream up to our 100MB cap
    // (app-level limit is enforced separately in lib/attachments.ts).
    proxyClientMaxBodySize: "110mb",
  },
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    // NOTE: X-Frame-Options and the per-path CSP frame-ancestors value are set
    // in proxy.ts — the attachment endpoint must stay frameable by our own PDF
    // preview <iframe> (frame-ancestors 'self') while everything else is
    // denied. The middleware's headers.set() REPLACES this header rather than
    // merging with it, so both sides must emit the COMPLETE policy from the
    // shared builder in lib/csp.ts; a fragment here or there silently strips
    // every other directive from the live response.
    //
    // The baseline below covers routes the middleware matcher excludes (static
    // assets), which never get the proxy's header.
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    // Applied only in production to avoid dev-mode HMR/eval breakage.
    if (isProd) {
      securityHeaders.push({
        key: "Content-Security-Policy",
        value: buildCsp("none"),
      });
    }
    return [
      // Every API response (auth'd or not) is private — never cache it.
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      { source: "/:path*", headers: securityHeaders },
    ];
  },
};

export default nextConfig;
