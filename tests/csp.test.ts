import { describe, expect, it } from "vitest";
import { buildCsp } from "../lib/csp";

/**
 * Regression for the production CSP downgrade (verified live 2026-09-14).
 *
 * `next.config.ts` and `proxy.ts` both emit Content-Security-Policy, and the
 * middleware's `headers.set()` REPLACES the config's header instead of merging.
 * When the middleware set only `frame-ancestors 'none'`, every route its
 * matcher covered — the whole authenticated app plus /login — lost
 * default-src/script-src/object-src/base-uri/form-action. Routes the matcher
 * excludes (static assets) kept the full policy, which is how the gap stayed
 * invisible in review: the two layers looked consistent in isolation.
 *
 * These tests pin the invariant that makes that impossible to reintroduce:
 * whatever the framing value, the policy must always be complete.
 */

/** Directives that must survive in every response regardless of framing. */
const REQUIRED_DIRECTIVES = [
  "default-src 'self'",
  "script-src",
  "style-src",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
];

describe("buildCsp", () => {
  it.each(["self", "none"] as const)(
    "emits the complete policy for frame-ancestors '%s'",
    (frame) => {
      const csp = buildCsp(frame);
      for (const directive of REQUIRED_DIRECTIVES) {
        expect(csp).toContain(directive);
      }
      expect(csp).toContain(`frame-ancestors '${frame}'`);
    }
  );

  it("is never just a frame-ancestors fragment", () => {
    // The literal string the middleware used to set on its own.
    for (const frame of ["self", "none"] as const) {
      expect(buildCsp(frame)).not.toBe(`frame-ancestors '${frame}'`);
      expect(buildCsp(frame).startsWith("frame-ancestors")).toBe(false);
    }
  });

  it("differs only in the frame-ancestors value", () => {
    const self = buildCsp("self");
    const none = buildCsp("none");
    expect(self.replace("frame-ancestors 'self'", "X")).toBe(
      none.replace("frame-ancestors 'none'", "X")
    );
  });

  it("blocks object embedding and keeps script/style inline allowances", () => {
    const csp = buildCsp("none");
    // object-src 'none' is what stops a same-origin plugin/Flash-style embed.
    expect(csp).toMatch(/object-src 'none'/);
    // Both inline allowances are required by the theme-init script and the
    // App Router hydration bootstrap; dropping them breaks every page.
    expect(csp).toMatch(/script-src 'self' 'unsafe-inline'/);
    expect(csp).toMatch(/style-src 'self' 'unsafe-inline'/);
  });

  it("is a single well-formed directive list", () => {
    for (const frame of ["self", "none"] as const) {
      const parts = buildCsp(frame).split("; ").filter(Boolean);
      // No empty or duplicated directive names.
      const names = parts.map((p) => p.split(" ")[0]);
      expect(names.every((n) => n.length > 0)).toBe(true);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
