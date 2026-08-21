/**
 * In-memory login throttle for a single-process, single-user deployment
 * (`npm start` on one host). Per-process state resets on restart, which is
 * acceptable for a personal tool. Revisit (DB-backed) only if this ever moves
 * to multi-instance/serverless.
 *
 * Keyed by `username|ip` so a flood against a known username (e.g. `admin`)
 * can only lock out the *attacking* IP, not every client — this prevents the
 * "lock a victim out of their own account with no credentials" DoS from the
 * original username-only key. The username is lowercased/trimmed so the key
 * can't be fragmented by case/spacing tricks.
 */

type ThrottleState = { count: number; resetAt: number };

const store = new Map<string, ThrottleState>();
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCK_MS = 15 * 60 * 1000; // lockout equals the window

// Bound the map so an attacker can't fill memory by hammering many usernames.
const MAX_KEYS = 10_000;

/** Normalize a username the same way the login query matches it. */
function normUser(username: string): string {
  return username.trim().toLowerCase();
}

function keyFor(username: string, ip: string): string {
  return `${normUser(username)}|${ip}`;
}

export function isThrottled(username: string, ip: string): boolean {
  const k = keyFor(username, ip);
  const s = store.get(k);
  if (!s) return false;
  if (Date.now() > s.resetAt) {
    store.delete(k);
    return false;
  }
  return s.count >= MAX_FAILURES;
}

export function recordFailure(username: string, ip: string): void {
  // Drop the oldest entries if we're about to blow the cap. Avoids unbounded
  // growth from an attacker cycling through many usernames/IPs.
  if (store.size >= MAX_KEYS && !store.has(keyFor(username, ip))) {
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) store.delete(firstKey);
  }
  const k = keyFor(username, ip);
  const s = store.get(k);
  if (!s || Date.now() > s.resetAt) {
    store.set(k, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    s.count += 1;
  }
}

export function clearFailures(username: string, ip: string): void {
  store.delete(keyFor(username, ip));
}

export const THROTTLE_LOCK_SECONDS = Math.floor(LOCK_MS / 1000);
