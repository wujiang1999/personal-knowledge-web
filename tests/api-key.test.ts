import { describe, expect, it } from "vitest";
import { extractBearerKey, hashApiKey } from "../src/apiKey.js";

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
