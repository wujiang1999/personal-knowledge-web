import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Re-import the module fresh per test so the in-memory store starts empty. */
async function freshThrottle() {
  vi.resetModules();
  return import("../lib/throttle");
}

// Use a fixed client IP for the non-IP-specific assertions below.
const IP = "1.2.3.4";

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
    for (let i = 0; i < 5; i++) t.recordFailure("admin", IP);
    expect(t.isThrottled("admin", IP)).toBe(true);
  });

  it("allows attempts below the threshold", async () => {
    const t = await freshThrottle();
    for (let i = 0; i < 4; i++) t.recordFailure("alice", IP);
    expect(t.isThrottled("alice", IP)).toBe(false);
    t.recordFailure("alice", IP); // 5th
    expect(t.isThrottled("alice", IP)).toBe(true);
  });

  it("releases the lock after the window expires", async () => {
    const t = await freshThrottle();
    for (let i = 0; i < 5; i++) t.recordFailure("bob", IP);
    expect(t.isThrottled("bob", IP)).toBe(true);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(t.isThrottled("bob", IP)).toBe(false);
  });

  it("clears failures on success", async () => {
    const t = await freshThrottle();
    t.recordFailure("carol", IP);
    t.clearFailures("carol", IP);
    expect(t.isThrottled("carol", IP)).toBe(false);
  });

  it("keys are case- and space-insensitive", async () => {
    const t = await freshThrottle();
    for (let i = 0; i < 5; i++) t.recordFailure(" Admin ", IP);
    expect(t.isThrottled("admin", IP)).toBe(true);
  });

  it("does not lock out other IPs (per-IP keying)", async () => {
    const t = await freshThrottle();
    for (let i = 0; i < 5; i++) t.recordFailure("admin", "9.9.9.9");
    expect(t.isThrottled("admin", IP)).toBe(false);
    expect(t.isThrottled("admin", "9.9.9.9")).toBe(true);
  });

  it("exposes the Retry-After window in seconds", async () => {
    const t = await freshThrottle();
    expect(t.THROTTLE_LOCK_SECONDS).toBe(900);
  });
});