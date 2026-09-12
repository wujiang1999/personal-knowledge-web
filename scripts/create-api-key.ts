import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { loadEnv } from "./load-env";

loadEnv();

/**
 * Create a Bearer API key for a machine client (e.g. the personal-kb MCP).
 *
 * Usage (run from the project root):
 *   npm run db:create-api-key                          # binds to the first user
 *   KEY_USER=admin KEY_NAME="MCP laptop" npm run db:create-api-key
 *   KEY_ACCESS_MODE=read KEY_EXPIRES_AT=2026-12-31T00:00:00Z npm run db:create-api-key
 *
 * The plaintext key (pkb_<48 hex>) is printed ONCE to stdout — only its
 * SHA-256 hash is stored. Revoke with:
 *   UPDATE api_keys SET revoked_at = now() WHERE name = '...';
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const name = process.env.KEY_NAME?.trim() || "personal-kb-mcp";
  const username = process.env.KEY_USER?.trim();
  const accessMode = process.env.KEY_ACCESS_MODE?.trim() || "write";
  const expiresAt = process.env.KEY_EXPIRES_AT?.trim() || null;
  if (accessMode !== "read" && accessMode !== "write" && accessMode !== "admin") {
    throw new Error("KEY_ACCESS_MODE must be read, write, or admin");
  }
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    throw new Error("KEY_EXPIRES_AT must be an ISO timestamp in the future");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const user = username
      ? await pool.query("SELECT id, role FROM users WHERE username = $1", [username])
      : await pool.query("SELECT id, role FROM users ORDER BY created_at, id LIMIT 1");
    if (user.rows.length === 0) {
      throw new Error(username ? `user "${username}" not found` : "no users exist yet");
    }
    if (accessMode === "admin" && user.rows[0].role !== "admin") {
      throw new Error("an admin-scoped key requires an admin owner");
    }

    const key = `pkb_${randomBytes(24).toString("hex")}`;
    const keyHash = createHash("sha256").update(key).digest("hex");

    const inserted = await pool.query(
      `INSERT INTO api_keys (user_id, name, key_hash, access_mode, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at, access_mode, expires_at`,
      [user.rows[0].id, name, keyHash, accessMode, expiresAt]
    );

    console.log(
      `API key created: id=${inserted.rows[0].id} user=${username ?? "(first user)"} name="${name}" ` +
        `access=${inserted.rows[0].access_mode} expires=${inserted.rows[0].expires_at ?? "never"}`
    );
    console.log("Plaintext key (shown ONCE, store it in the client config now):");
    console.log(key);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
