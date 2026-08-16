import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next.js 15.5 buffers request bodies at 10MB by default when middleware is
    // present. Raise it so attachment uploads can stream up to our 100MB cap
    // (app-level limit is enforced separately in lib/attachments.ts).
    middlewareClientMaxBodySize: "110mb",
  },
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    // Pragmatic CSP for a single-user app. 'unsafe-inline' for script-src is
    // required by (a) the static theme init script in app/layout.tsx and
    // (b) Next.js App Router's inline hydration bootstrap. Markdown is rendered
    // as plain text (<pre>), never HTML, so the XSS surface this exposes is
    // minimal. style-src 'unsafe-inline' is required for SSR-inlined CSS.
    // Applied only in production to avoid dev-mode HMR/eval breakage.
    if (isProd) {
      securityHeaders.push({
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self'; frame-src 'self'; object-src 'none'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
