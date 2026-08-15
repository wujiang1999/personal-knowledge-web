import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const sql = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");
  await pool.query(sql);
  console.log("schema applied OK");
  await pool.end();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});