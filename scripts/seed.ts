import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const username = process.env.ADMIN_USERNAME ?? "admin";
  // No fallback: a known default password would defeat the whole point.
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD is not set — set it in .env before running db:seed");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const hash = await bcrypt.hash(password, 12);
  // ON CONFLICT DO NOTHING: re-running the seed never resets an existing admin password.
  //
  // `role = 'admin'` is set explicitly. Migration 0010 promotes any row named
  // 'admin', but on a fresh install migrations run *before* this seed, so the
  // account would otherwise be created with the schema default 'user' — an
  // administrator who cannot open /users, cannot `?purge=1`, and cannot mint
  // admin-scoped keys. The "last remaining admin" guard in lib/users.ts counts
  // zero admins in that state, so there is no UI path to promote anyone either:
  // only hand-written SQL. The seed is the initial-administrator entry point,
  // so it owns the role regardless of the configured ADMIN_USERNAME.
  const res = await pool.query(
    `INSERT INTO users (username, password_hash, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (username) DO NOTHING
     RETURNING id`,
    [username, hash]
  );
  console.log(
    res.rowCount
      ? `seeded admin "${username}"`
      : `user "${username}" already exists — skipped (role unchanged; use npm run db:add-user RESET=1 to manage it)`
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});