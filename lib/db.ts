import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { getDatabaseUrl } from "./config";

// Reuse a single pool across serverless warm invocations.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.pgPool) {
    globalForDb.pgPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 5,
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