import { describe, expect, it } from "vitest";
import {
  effectiveApiKeyRole,
  extractBearerKey,
  hasBearerAuthorization,
  hashApiKey,
} from "../lib/apiKey.js";
import { apiKeyAllowsAccess } from "../lib/key-policy.js";

const KEY = `pkb_${"a".repeat(48)}`;

describe("extractBearerKey", () => {
  it("accepts a well-formed pkb_ key", () => {
    expect(extractBearerKey(`Bearer ${KEY}`)).toBe(KEY);
  });

  it("returns null without a Bearer header", () => {
    expect(extractBearerKey(null)).toBeNull();
    expect(extractBearerKey("")).toBeNull();
    expect(extractBearerKey("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("rejects malformed keys", () => {
    expect(extractBearerKey("Bearer nope")).toBeNull();
    expect(extractBearerKey("Bearer sk_0000000000000000000000000000000000000000")).toBeNull();
    expect(extractBearerKey(`Bearer pkb_${"z".repeat(48)}`)).toBeNull(); // non-hex
    expect(extractBearerKey(`Bearer pkb_${"a".repeat(8)}`)).toBeNull(); // too short
  });

  it("recognizes a malformed Bearer attempt so callers cannot fall back to a cookie", () => {
    expect(hasBearerAuthorization("Bearer nope")).toBe(true);
    expect(hasBearerAuthorization("bearer ")).toBe(true);
    expect(extractBearerKey("Bearer nope")).toBeNull();
    expect(hasBearerAuthorization("Basic dXNlcjpwYXNz")).toBe(false);
  });
});

describe("effectiveApiKeyRole", () => {
  it("does not inherit admin from its owner without explicit admin scope", () => {
    expect(effectiveApiKeyRole("admin", "read")).toBe("user");
    expect(effectiveApiKeyRole("admin", "write")).toBe("user");
    expect(effectiveApiKeyRole("user", "admin")).toBe("user");
  });

  it("permits admin only for an explicit admin key of an admin owner", () => {
    expect(effectiveApiKeyRole("admin", "admin")).toBe("admin");
  });
});

describe("API key access policy", () => {
  it("allows read keys to retrieve knowledge and ask, but not mutate it", () => {
    expect(apiKeyAllowsAccess("read", "GET", "/api/search")).toBe(true);
    expect(apiKeyAllowsAccess("read", "POST", "/api/ask")).toBe(true);
    expect(apiKeyAllowsAccess("read", "POST", "/api/concepts")).toBe(false);
  });

  it("blocks account and key management for non-admin credentials", () => {
    for (const mode of ["read", "write"] as const) {
      expect(apiKeyAllowsAccess(mode, "GET", "/api/keys")).toBe(false);
      expect(apiKeyAllowsAccess(mode, "POST", "/api/keys")).toBe(false);
      expect(apiKeyAllowsAccess(mode, "POST", "/api/auth/change-password")).toBe(false);
      expect(apiKeyAllowsAccess(mode, "POST", "/api/users")).toBe(false);
      expect(apiKeyAllowsAccess(mode, "POST", "/api/auth/logout")).toBe(false);
    }
  });

  it("keeps the MCP identity endpoint available to read and write keys", () => {
    expect(apiKeyAllowsAccess("read", "GET", "/api/me")).toBe(true);
    expect(apiKeyAllowsAccess("write", "GET", "/api/me")).toBe(true);
    expect(apiKeyAllowsAccess("read", "POST", "/api/judge")).toBe(false);
    expect(apiKeyAllowsAccess("write", "POST", "/api/judge")).toBe(true);
  });

  it("allows reversible writes but requires admin scope for hard deletes", () => {
    expect(apiKeyAllowsAccess("write", "PATCH", "/api/concepts/[id]")).toBe(true);
    expect(apiKeyAllowsAccess("write", "DELETE", "/api/trash")).toBe(false);
    expect(
      apiKeyAllowsAccess(
        "write",
        "DELETE",
        "/api/concepts/[id]",
        new Request("https://kb.example/api/concepts/id?purge=1"),
      ),
    ).toBe(false);
    expect(apiKeyAllowsAccess("admin", "DELETE", "/api/trash")).toBe(true);
  });
});

describe("hashApiKey", () => {
  it("is deterministic sha256 hex", () => {
    expect(hashApiKey(KEY)).toBe(hashApiKey(KEY));
    expect(hashApiKey(KEY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs per key", () => {
    expect(hashApiKey(KEY)).not.toBe(hashApiKey(`pkb_${"b".repeat(48)}`));
  });
});
