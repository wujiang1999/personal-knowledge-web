import { randomUUID } from "node:crypto";
import { getPool, query } from "./db";

export class ModelLimitError extends Error {
  constructor(message: string) { super(message); this.name = "ModelLimitError"; }
}

export function positiveLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid positive limit: ${name}`);
  return n;
}

export interface BudgetState { active: number; actorActive: number; minuteCalls: number; globalMinuteCalls: number; dailyTokens: number; actorTokens: number }
export function checkBudget(state: BudgetState, reserved: number): void {
  if (state.active >= positiveLimit("MODEL_MAX_CONCURRENT", 4) || state.actorActive >= positiveLimit("MODEL_USER_MAX_CONCURRENT", 2)) {
    throw new ModelLimitError("模型并发已满，请稍后重试");
  }
  if (state.globalMinuteCalls >= positiveLimit("MODEL_CALLS_PER_MINUTE", 120) || state.minuteCalls >= positiveLimit("MODEL_USER_CALLS_PER_MINUTE", 60)) throw new ModelLimitError("模型调用过于频繁，请稍后重试");
  if (state.dailyTokens + reserved > positiveLimit("MODEL_DAILY_TOKENS", 2_000_000) || state.actorTokens + reserved > positiveLimit("MODEL_USER_DAILY_TOKENS", 500_000)) {
    throw new ModelLimitError("模型每日 Token 预算不足，请明日重试或由管理员调整预算");
  }
}

/** Reserve before HTTP. Unknown/failed usage remains conservatively charged;
 * process crashes release concurrency via lease expiry, never reset the budget.
 * UTF-8 bytes + output cap is a conservative token allowance for text requests. */
export async function reserveModelCall(userId: string | null | undefined, kind: "llm" | "embedding", reserved: number): Promise<(actual: number | null) => Promise<void>> {
  const actor = userId ? `user:${userId}` : "system";
  if (!Number.isSafeInteger(reserved) || reserved < 1) throw new Error("Invalid token reservation");
  const c = await getPool().connect();
  const id = randomUUID();
  try {
    await c.query("BEGIN");
    // Every admission uses one global lock: budget/concurrency checks cannot race.
    await c.query("SELECT pg_advisory_xact_lock(184392714)");
    // Bounded in-request retention; no new scheduler and no current budget reset.
    await c.query(`DELETE FROM model_call_reservations WHERE id IN (
      SELECT id FROM model_call_reservations
       WHERE budget_day < (now() AT TIME ZONE 'Asia/Shanghai')::date-30
         AND (finished_at IS NOT NULL OR expires_at < now()) LIMIT 500)`);
    const { rows } = await c.query<BudgetState>(`SELECT
      count(*) FILTER (WHERE finished_at IS NULL AND expires_at > now())::int AS active,
      count(*) FILTER (WHERE finished_at IS NULL AND expires_at > now() AND actor=$1)::int AS "actorActive",
      count(*) FILTER (WHERE started_at > now()-interval '1 minute' AND actor=$1)::int AS "minuteCalls",
      count(*) FILTER (WHERE started_at > now()-interval '1 minute')::int AS "globalMinuteCalls",
      coalesce(sum(coalesce(actual_tokens,reserved_tokens)) FILTER (WHERE budget_day=(now() AT TIME ZONE 'Asia/Shanghai')::date),0)::float8 AS "dailyTokens",
      coalesce(sum(coalesce(actual_tokens,reserved_tokens)) FILTER (WHERE budget_day=(now() AT TIME ZONE 'Asia/Shanghai')::date AND actor=$1),0)::float8 AS "actorTokens"
      FROM model_call_reservations WHERE budget_day >= (now() AT TIME ZONE 'Asia/Shanghai')::date-1`, [actor]);
    checkBudget(rows[0], reserved);
    await c.query(`INSERT INTO model_call_reservations(id,actor,kind,budget_day,reserved_tokens,expires_at)
      VALUES($1,$2,$3,(now() AT TIME ZONE 'Asia/Shanghai')::date,$4,now()+interval '150 seconds')`, [id,actor,kind,reserved]);
    await c.query("COMMIT");
  } catch (err) { await c.query("ROLLBACK"); throw err; }
  finally { c.release(); }
  return async actual => {
    await query("UPDATE model_call_reservations SET actual_tokens=$2,finished_at=now() WHERE id=$1 AND finished_at IS NULL", [id, actual === null ? null : Math.max(0,Math.ceil(actual))]);
  };
}
