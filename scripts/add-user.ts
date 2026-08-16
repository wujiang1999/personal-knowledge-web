import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { loadEnv } from "./load-env";

loadEnv();

/**
 * Add an application user (or reset one's password) without opening the Web UI.
 *
 * Usage (run from the project root):
 *   NEW_USERNAME=alice NEW_PASSWORD=... npm run db:add-user
 *   NEW_USERNAME=alice NEW_PASSWORD=... RESET=1 npm run db:add-user
 *
 * - Without RESET: inserts the user; an existing username is left untouched
 *   (matches `db:seed`'s "never overwrite" contract).
 * - With RESET=1: overwrites the password hash and bumps token_version, which
 *   invalidates every previously issued session for that user.
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const username = process.env.NEW_USERNAME?.trim();
  const password = process.env.NEW_PASSWORD;
  if (!username) throw new Error("NEW_USERNAME is not set");
  if (!password) throw new Error("NEW_PASSWORD is not set");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const hash = await bcrypt.hash(password, 12);
  const reset = process.env.RESET === "1";

  const res = await pool.query(
    reset
      ? `INSERT INTO users (username, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (username) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               token_version = users.token_version + 1
         RETURNING id`
      : `INSERT INTO users (username, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (username) DO NOTHING
         RETURNING id`,
    [username, hash]
  );

  if (res.rowCount) {
    console.log(reset ? `reset password for "${username}"` : `added user "${username}"`);
  } else {
    console.log(`user "${username}" already exists — skipped`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
