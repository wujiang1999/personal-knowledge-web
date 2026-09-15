import { describe, expect, it } from "vitest";
import { safeSameOriginPath } from "../lib/publicUrl";

/**
 * Regression for the `?next=` open redirect on /login.
 *
 * The old guard was `next.startsWith("/") && !next.startsWith("//")`. URL
 * parsers normalize a backslash to a slash, so `/\evil.com` passed both tests
 * and resolved to https://evil.com/ — a crafted login link sent the user
 * off-site immediately after they authenticated. Resolving against a throwaway
 * origin and requiring it to come back unchanged covers every spelling at
 * once instead of enumerating them.
 */

/** Every accepted value must resolve to this origin — no off-site target. */
const ORIGIN = "https://sjtuai.art";

const OFF_SITE = [
  "/\\evil.com", // backslash normalizes to "/" — the reported bypass
  "\\\\evil.com",
  "//evil.com",
  "//evil.com/dashboard",
  "/\\/evil.com",
  "https://evil.com",
  "http://evil.com/x",
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
];

/** Paths that LOOK like an attack but are genuinely same-origin, so they must
 * be honoured: the off-site string is inert query/path text, not the target.
 * Asserting a fallback here would be asserting wrong behaviour. */
const SAME_ORIGIN_LOOKING_SUSPICIOUS = [
  "evil.com", // no scheme, no leading slash → resolves as a relative path
  "/redirect?url=https://evil.com",
  "/%2f%2fevil.com", // encoded slashes stay encoded, not a scheme-relative URL
];

describe("safeSameOriginPath", () => {
  it.each(OFF_SITE)("falls back for an off-site or non-http target %s", (raw) => {
    expect(safeSameOriginPath(raw, "/dashboard")).toBe("/dashboard");
  });

  it("honours ordinary in-app paths", () => {
    expect(safeSameOriginPath("/dashboard")).toBe("/dashboard");
    expect(safeSameOriginPath("/knowledge/77450e2d-58d8")).toBe("/knowledge/77450e2d-58d8");
    expect(safeSameOriginPath("/reviews")).toBe("/reviews");
  });

  it("preserves query and hash on an accepted path", () => {
    expect(safeSameOriginPath("/knowledge?id=1")).toBe("/knowledge?id=1");
    expect(safeSameOriginPath("/ask#top")).toBe("/ask#top");
    expect(safeSameOriginPath("/logs?days=7#chart")).toBe("/logs?days=7#chart");
  });

  it("falls back on missing or empty input", () => {
    expect(safeSameOriginPath(null)).toBe("/dashboard");
    expect(safeSameOriginPath(undefined)).toBe("/dashboard");
    expect(safeSameOriginPath("")).toBe("/dashboard");
    expect(safeSameOriginPath(undefined, "/login")).toBe("/login");
  });

  it("honours a custom fallback", () => {
    expect(safeSameOriginPath("//evil.com", "/login")).toBe("/login");
  });

  it("honours same-origin paths whose text merely looks off-site", () => {
    // These are not redirects off-site; blocking them would break legitimate
    // deep links. The contract is "resolves to this origin", not "contains no
    // external-looking string".
    for (const raw of SAME_ORIGIN_LOOKING_SUSPICIOUS) {
      const dest = safeSameOriginPath(raw);
      expect(dest.startsWith("/")).toBe(true);
      expect(new URL(dest, ORIGIN).origin).toBe(ORIGIN);
    }
    expect(safeSameOriginPath("evil.com")).toBe("/evil.com");
    expect(safeSameOriginPath("/redirect?url=https://evil.com")).toBe(
      "/redirect?url=https://evil.com"
    );
  });

  it("never returns a value that resolves off-origin", () => {
    // The invariant that actually matters, checked over every vector at once:
    // whatever comes back must stay on this origin once the router resolves it.
    for (const raw of [...OFF_SITE, ...SAME_ORIGIN_LOOKING_SUSPICIOUS, "/dashboard", "/knowledge?id=1"]) {
      const dest = safeSameOriginPath(raw);
      expect(new URL(dest, ORIGIN).origin).toBe(ORIGIN);
    }
  });
});
