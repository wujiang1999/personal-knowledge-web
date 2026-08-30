import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { getDatabaseUrl } from "./config";

// Reuse a single pool across serverless warm invocations.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.pgPool) {
    globalForDb.pgPool = new Pool({
      connectionString: getDatabaseUrl(),
      // Tunable so a busier co-hosted box can be accommodated without a code
      // change; 5 fits this app's single-node scale.
      max: Number(process.env.PG_POOL_MAX ?? 5),
      statement_timeout: 10_000, // kill slow queries instead of hanging requests
    });
    // Without a listener, an idle-client connection reset (e.g. a tunnel blip
    // on the ECS host) throws an uncaught error and crashes the process.
    globalForDb.pgPool.on("error", (err) => {
      console.error("Unexpected error on idle pg client", err);
    });
  }
  return globalForDb.pgPool;
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as never[]);
}

/** Close the shared pool for one-off maintenance scripts. */
export async function closePool(): Promise<void> {
  if (globalForDb.pgPool) {
    const pool = globalForDb.pgPool;
    globalForDb.pgPool = undefined;
    await pool.end();
  }
}
