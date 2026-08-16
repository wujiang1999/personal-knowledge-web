import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Re-import the module fresh per test so the in-memory store starts empty. */
async function freshThrottle() {
  vi.resetModules();
  return import("../lib/throttle");
}

describe("lib/throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("locks after 5 failures", async () => {
    const t = await freshThrottle();
    for (let i = 0; i < 5; i++) t.recordFailure("admin");
    expect(t.isThrottled("admin")).toBe(true);
  });

  it("allows attempts below the threshold", async () => {
    const t = await freshThrottle();
    for (let i = 0; i < 4; i++) t.recordFailure("alice");
    expect(t.isThrottled("alice")).toBe(false);
    t.recordFailure("alice"); // 5th
    expect(t.isThrottled("alice")).toBe(true);
  });

  it("releases the lock after the window expires", async () => {
    const t = await freshThrottle();
    for (let i = 0; i < 5; i++) t.recordFailure("bob");
    expect(t.isThrottled("bob")).toBe(true);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(t.isThrottled("bob")).toBe(false);
  });

  it("clears failures on success", async () => {
    const t = await freshThrottle();
    t.recordFailure("carol");
    t.clearFailures("carol");
    expect(t.isThrottled("carol")).toBe(false);
  });

  it("keys are case- and space-insensitive", async () => {
    const t = await freshThrottle();
    for (let i = 0; i < 5; i++) t.recordFailure(" Admin ");
    expect(t.isThrottled("admin")).toBe(true);
  });

  it("exposes the Retry-After window in seconds", async () => {
    const t = await freshThrottle();
    expect(t.THROTTLE_LOCK_SECONDS).toBe(900);
  });
});