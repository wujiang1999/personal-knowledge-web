import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    // 1) idempotent base schema: full state on fresh installs, no-op on
    //    existing databases.
    const base = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");
    await pool.query(base);
    console.log("base schema OK");

    // 2) migration bookkeeping
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    integer PRIMARY KEY,
         name       text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );

    // 3) apply pending migrations in ascending order, one transaction each
    const dir = resolve(process.cwd(), "db/migrations");
    if (!existsSync(dir)) {
      console.log("migrations OK (no db/migrations dir)");
      return;
    }
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = Number(file.split("_")[0]);
      if (!Number.isInteger(version)) throw new Error(`invalid migration filename: ${file}`);
      const done = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
      if (done.rowCount) continue;

      const sql = readFileSync(resolve(dir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [version, file]);
        await client.query("COMMIT");
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
    console.log("migrations OK");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
