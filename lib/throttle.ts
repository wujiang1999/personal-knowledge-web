/**
 * In-memory login throttle for a single-process, single-user deployment
 * (`npm start` on one host). Per-process state resets on restart, which is
 * acceptable for a personal tool. Revisit (DB-backed) only if this ever moves
 * to multi-instance/serverless.
 */

type ThrottleState = { count: number; resetAt: number };

const store = new Map<string, ThrottleState>();
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCK_MS = 15 * 60 * 1000; // lockout equals the window

function keyFor(username: string): string {
  return `login:${username.trim().toLowerCase()}`;
}

export function isThrottled(username: string): boolean {
  const s = store.get(keyFor(username));
  if (!s) return false;
  if (Date.now() > s.resetAt) {
    store.delete(keyFor(username));
    return false;
  }
  return s.count >= MAX_FAILURES;
}

export function recordFailure(username: string): void {
  const k = keyFor(username);
  const s = store.get(k);
  if (!s || Date.now() > s.resetAt) {
    store.set(k, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    s.count += 1;
  }
}

export function clearFailures(username: string): void {
  store.delete(keyFor(username));
}

export const THROTTLE_LOCK_SECONDS = Math.floor(LOCK_MS / 1000);
