/**
 * Content-Security-Policy for this app — the single source of truth shared by
 * `next.config.ts` and `proxy.ts`.
 *
 * Why a shared builder instead of two literals: Next.js applies BOTH header
 * sources, and `res.headers.set()` in the middleware *replaces* the header the
 * config already set. Two independently written policies therefore do not
 * merge — whichever runs last wins wholesale. With the middleware setting a
 * hand-written `frame-ancestors 'none'` fragment, every route its matcher
 * covered was silently served with ONLY that directive: `default-src`,
 * `script-src`, `object-src 'none'`, `base-uri` and `form-action` were all
 * gone from the live site (verified 2026-09-14 by comparing /login against
 * /icon.png, which the matcher excludes and which kept the full policy).
 *
 * Both callers must therefore emit the COMPLETE policy, differing only in the
 * `frame-ancestors` value.
 *
 * Pure module: no Node built-ins, so the Edge middleware can import it.
 */

/** Framing policy. The attachment endpoint must stay frameable by our own PDF
 * preview `<iframe>`; everything else is denied outright. */
export type FrameAncestors = "self" | "none";

/**
 * Pragmatic CSP for a single-user app. `script-src 'unsafe-inline'` is
 * required by (a) the static theme-init script in `app/layout.tsx` and (b)
 * Next.js App Router's inline hydration bootstrap. Markdown renders as plain
 * text (`<pre>`), never HTML, so the XSS surface this exposes is minimal.
 * `style-src 'unsafe-inline'` is required for SSR-inlined CSS.
 */
export function buildCsp(frameAncestors: FrameAncestors): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors '${frameAncestors}'`,
  ].join("; ");
}
