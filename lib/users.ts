import { randomBytes } from "node:crypto";
import { query } from "./db";
import { hashPassword } from "./password";

/** Admin account administration behind /users + /api/users. Guards follow one
 * rule pair: never let the acting admin lock themselves out, and never leave
 * the library without an admin. Disabled accounts are locked out everywhere at
 * once: login rejects, sessions die (token_version bump), and every API key
 * they own stops resolving (the key lookup joins users and filters disabled). */

export type Role = "user" | "admin";

export class UserExistsError extends Error {
  constructor(username: string) {
    super(`用户名 "${username}" 已存在`);
    this.name = "UserExistsError";
  }
}

// \p{L}\p{N} (unicode letters/numbers) so 中文用户名 work; ASCII-only \w
// would silently reject them. Whitespace and shell/URL-hostile characters
// (/, ?, &, :...) stay rejected.
const USERNAME_RE = /^[\p{L}\p{N}_.-]{2,32}$/u;

/** Validate a username; returns an error message or null when acceptable. */
export function validateUsername(v: unknown): string | null {
  if (typeof v !== "string" || !USERNAME_RE.test(v)) {
    return "用户名需 2-32 位，仅限文字、数字、下划线、点、连字符（可中文）";
  }
  return null;
}

/** Validate a password; returns an error message or null when acceptable. */
export function validatePassword(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 8 || v.length > 128) {
    return "密码长度需在 8-128 位之间";
  }
  return null;
}

/** Password alphabet: unambiguous only (no 0/O/1/l/I) — these get read aloud
 * or hand-typed from the admin console. */
const PW_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";

export function generatePassword(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += PW_ALPHABET[b % PW_ALPHABET.length];
  return out;
}

/**
 * Guard for actions that remove power or access ("disarming" an account:
 * demote admin→user, disable). Returns an error message or null when allowed.
 * - Never act on the calling admin's own account (no self-lockout; password
 *   reset is NOT disarming and stays self-serviceable via settings).
 * - Never disarm the last remaining admin — pass the live admin count when
 *   the target IS an admin, or null when the action cannot affect admin
 *   coverage (e.g. disabling a plain user).
 */
export function checkAdminGuard(opts: {
  actingUserId: string;
  targetUserId: string;
  adminCount: number | null;
}): string | null {
  if (opts.actingUserId === opts.targetUserId) {
    return "不能对当前登录的账号执行此操作（请用其他管理员账号）";
  }
  if (opts.adminCount !== null && opts.adminCount <= 1) {
    return "库内至少要保留一名管理员";
  }
  return null;
}

export interface UserRow {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
  entryCount: number;
  keyCount: number;
}

/** All accounts with activity counters. Admin-only; the route enforces it. */
export async function listUsers(): Promise<UserRow[]> {
  const { rows } = await query<{
    id: string;
    username: string;
    role: string;
    created_at: string;
    last_login_at: string | null;
    disabled_at: string | null;
    entry_count: number;
    key_count: number;
  }>(
    `SELECT u.id, u.username, u.role, u.created_at, u.last_login_at, u.disabled_at,
            (SELECT count(*) FROM concepts c WHERE c.owner_id = u.id AND c.deleted_at IS NULL)::int AS entry_count,
            (SELECT count(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL)::int AS key_count
     FROM users u
     ORDER BY u.created_at, u.id`
  );
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    role: r.role === "admin" ? "admin" : "user",
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
    disabledAt: r.disabled_at,
    entryCount: r.entry_count,
    keyCount: r.key_count,
  }));
}

export async function getUserById(id: string): Promise<{ id: string; username: string; role: Role; disabledAt: string | null } | null> {
  const { rows } = await query<{ id: string; username: string; role: string; disabled_at: string | null }>(
    "SELECT id, username, role, disabled_at FROM users WHERE id = $1",
    [id]
  );
  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    username: rows[0].username,
    role: rows[0].role === "admin" ? "admin" : "user",
    disabledAt: rows[0].disabled_at,
  };
}

export async function countAdmins(): Promise<number> {
  const { rows } = await query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE role = 'admin'");
  return rows[0].n;
}

/** Create an account. password comes pre-validated (the route generates one
 * when the admin left it empty). Hashes server-side; the plaintext travels
 * once in the create response and is never stored. */
export async function createUser(input: { username: string; password: string; role: Role }): Promise<{ id: string }> {
  const passwordHash = await hashPassword(input.password);
  try {
    const { rows } = await query<{ id: string }>(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id",
      [input.username, passwordHash, input.role]
    );
    return { id: rows[0].id };
  } catch (err) {
    // unique_violation on users.username
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
      throw new UserExistsError(input.username);
    }
    throw err;
  }
}

/** Overwrite the password and kill every live session of that account. */
export async function resetPassword(id: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await query(
    "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2",
    [passwordHash, id]
  );
}

export async function setRole(id: string, role: Role): Promise<void> {
  await query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
}

/** Disable/enable. Disabling also bumps token_version so existing sessions
 * die immediately; API keys stop resolving via the disabled_at join filter. */
export async function setDisabled(id: string, disabled: boolean): Promise<void> {
  if (disabled) {
    await query(
      "UPDATE users SET disabled_at = now(), token_version = token_version + 1 WHERE id = $1",
      [id]
    );
  } else {
    await query("UPDATE users SET disabled_at = NULL WHERE id = $1", [id]);
  }
}
