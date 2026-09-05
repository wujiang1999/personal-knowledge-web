import { describe, expect, it } from "vitest";
import {
  checkAdminGuard,
  generatePassword,
  validatePassword,
  validateUsername,
} from "../lib/users";

describe("validateUsername", () => {
  it("accepts unicode letters incl. Chinese, 2-32 chars", () => {
    expect(validateUsername("alice")).toBeNull();
    expect(validateUsername("a_1-B.c")).toBeNull();
    expect(validateUsername("同学甲")).toBeNull(); // \p{L} covers Chinese
  });

  it("rejects empty, too long, whitespace and shell-unfriendly characters", () => {
    expect(validateUsername("")).not.toBeNull();
    expect(validateUsername("a")).not.toBeNull(); // too short
    expect(validateUsername("x".repeat(33))).not.toBeNull();
    expect(validateUsername("bad name")).not.toBeNull(); // space
    expect(validateUsername("bad;name")).not.toBeNull();
    expect(validateUsername(null)).not.toBeNull();
    expect(validateUsername(42)).not.toBeNull();
  });
});

describe("validatePassword", () => {
  it("accepts 8-128 chars and rejects shorter/longer/non-strings", () => {
    expect(validatePassword("12345678")).toBeNull();
    expect(validatePassword("x".repeat(128))).toBeNull();
    expect(validatePassword("1234567")).not.toBeNull();
    expect(validatePassword("x".repeat(129))).not.toBeNull();
    expect(validatePassword(undefined)).not.toBeNull();
  });
});

describe("generatePassword", () => {
  it("makes 12 unambiguous characters", () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(12);
    expect(pw).not.toMatch(/[0O1lI]/);
  });

  it("is random across calls", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe("checkAdminGuard", () => {
  const acting = "u-admin";
  const other = "u-other";

  it("allows disarming another admin while others remain", () => {
    expect(
      checkAdminGuard({ actingUserId: acting, targetUserId: other, adminCount: 2 })
    ).toBeNull();
  });

  it("blocks disarming the last admin", () => {
    expect(
      checkAdminGuard({ actingUserId: acting, targetUserId: other, adminCount: 1 })
    ).not.toBeNull();
  });

  it("blocks acting on the caller's own account", () => {
    expect(
      checkAdminGuard({ actingUserId: acting, targetUserId: acting, adminCount: 3 })
    ).not.toBeNull();
  });

  it("skips the admin-count check when the target is not an admin (null)", () => {
    expect(
      checkAdminGuard({ actingUserId: acting, targetUserId: other, adminCount: null })
    ).toBeNull();
  });
});
