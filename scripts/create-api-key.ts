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
 *
 * The plaintext key (pkb_<48 hex>) is printed ONCE to stdout — only its
 * SHA-256 hash is stored. Revoke with:
 *   UPDATE api_keys SET revoked_at = now() WHERE name = '...';
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const name = process.env.KEY_NAME?.trim() || "personal-kb-mcp";
  const username = process.env.KEY_USER?.trim();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const user = username
      ? await pool.query("SELECT id FROM users WHERE username = $1", [username])
      : await pool.query("SELECT id FROM users ORDER BY created_at, id LIMIT 1");
    if (user.rows.length === 0) {
      throw new Error(username ? `user "${username}" not found` : "no users exist yet");
    }

    const key = `pkb_${randomBytes(24).toString("hex")}`;
    const keyHash = createHash("sha256").update(key).digest("hex");

    const inserted = await pool.query(
      "INSERT INTO api_keys (user_id, name, key_hash) VALUES ($1, $2, $3) RETURNING id, created_at",
      [user.rows[0].id, name, keyHash]
    );

    console.log(`API key created: id=${inserted.rows[0].id} user=${username ?? "(first user)"} name="${name}"`);
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
