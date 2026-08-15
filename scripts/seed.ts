import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const username = process.env.ADMIN_USERNAME ?? "admin";
  const password = process.env.ADMIN_PASSWORD ?? "990327";

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const hash = await bcrypt.hash(password, 12);
  // ON CONFLICT DO NOTHING: re-running the seed never resets an existing admin password.
  const res = await pool.query(
    `INSERT INTO users (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username) DO NOTHING
     RETURNING id`,
    [username, hash]
  );
  console.log(res.rowCount ? `seeded user "${username}"` : `user "${username}" already exists — skipped`);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});