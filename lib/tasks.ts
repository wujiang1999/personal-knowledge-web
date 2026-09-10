import { query } from "./db";
import type { ScopeUser } from "./requireUser";

/** 异步任务表（迁移 0019）：让「比一次请求更久的活」有可轮询的持久记录。
 *
 * 状态机：queued → running → done | failed。执行者是进程内 fire-and-forget
 * （与自动摘要/用量日志同一套约定，本部署没有 worker），因此：
 *  · 领用（claim）是单条原子 UPDATE —— 重复调用只会有一个执行者拿到；
 *  · 进程若在执行中消失，任务会停在 running，靠**执行租约**在下次读取时被判失败，
 *    不会永远显示「进行中」；
 *  · 本批不自动重试（见迁移注释的取舍）。
 * 租约清理挂在读取路径上（getTask/listTasks 先清后读），没有定时器。 */

export const TASK_KINDS = ["ask"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ["queued", "running", "done", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** 执行租约：超过它仍未结束的任务视为执行者已消失。问答正常 5-30 秒完成，
 * 5 分钟足够宽裕，也足够快地不让用户对着「进行中」干等。 */
export const TASK_LEASE_SECONDS = 300;

export interface Task<TResult = unknown, TPayload = unknown> {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  payload: TPayload;
  result: TResult | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface TaskRow {
  id: string;
  kind: string;
  status: string;
  payload: unknown;
  result: unknown;
  error: string | null;
  attempts: number;
  created_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
}

const isTaskKind = (v: string): v is TaskKind => (TASK_KINDS as readonly string[]).includes(v);
const isTaskStatus = (v: string): v is TaskStatus => (TASK_STATUSES as readonly string[]).includes(v);
const at = (v: string | Date | null): string | null => (v === null ? null : new Date(v).toISOString());

function toTask<TResult, TPayload>(row: TaskRow): Task<TResult, TPayload> {
  return {
    id: row.id,
    kind: isTaskKind(row.kind) ? row.kind : "ask",
    status: isTaskStatus(row.status) ? row.status : "failed",
    payload: row.payload as TPayload,
    result: (row.result ?? null) as TResult | null,
    error: row.error,
    attempts: row.attempts,
    createdAt: new Date(row.created_at).toISOString(),
    startedAt: at(row.started_at),
    finishedAt: at(row.finished_at),
  };
}

/**
 * 超期未结束的任务判失败。挂在读取路径上（无定时器）：`coalesce(started_at,
 * created_at)` 让「入队后执行者没起来」与「执行中进程消失」走同一条规则，
 * 只是错误文案不同——排查时这两者要能分开。
 */
export async function reapStaleTasks(): Promise<number> {
  const { rowCount } = await query(
    `UPDATE tasks
        SET status = 'failed',
            error = CASE WHEN started_at IS NULL
                         THEN '入队后未被启动（进程重启或执行未触发）'
                         ELSE '执行进程在完成前退出（租约超时）' END,
            finished_at = now()
      WHERE status IN ('queued', 'running')
        AND coalesce(started_at, created_at) < now() - make_interval(secs => $1)`,
    [TASK_LEASE_SECONDS]
  );
  return rowCount ?? 0;
}

export async function enqueueTask(
  user: ScopeUser,
  input: { kind: TaskKind; payload: unknown }
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    "INSERT INTO tasks (owner_id, kind, payload) VALUES ($1, $2, $3::jsonb) RETURNING id",
    [user.id, input.kind, JSON.stringify(input.payload)]
  );
  return rows[0].id;
}

/** 原子领用：只有一次 queued → running 的转换能成功（并发/重复调用都只会有一个
 * 执行者）。返回 false 表示任务已被领走或已结束。 */
export async function claimTask(id: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE tasks SET status = 'running', started_at = now(), attempts = attempts + 1
      WHERE id = $1 AND status = 'queued'`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}

export async function finishTask(id: string, result: unknown): Promise<void> {
  await query(
    "UPDATE tasks SET status = 'done', result = $2::jsonb, error = NULL, finished_at = now() WHERE id = $1",
    [id, JSON.stringify(result)]
  );
}

export async function failTask(id: string, error: string): Promise<void> {
  await query(
    "UPDATE tasks SET status = 'failed', error = $2, finished_at = now() WHERE id = $1",
    [id, error.slice(0, 500)]
  );
}

/** 同一 owner 正在飞行中的同类任务（用于挡重复提交：双击、客户端重试）。
 * 只认 queued/running，且只在超期判定之后查，避免把僵尸任务当成"进行中"。 */
export async function findLiveTask(
  user: ScopeUser,
  kind: TaskKind,
  matches: (payload: Record<string, unknown>) => boolean
): Promise<Task | null> {
  await reapStaleTasks();
  const { rows } = await query<TaskRow>(
    `SELECT * FROM tasks WHERE owner_id = $1 AND kind = $2 AND status IN ('queued', 'running')
      ORDER BY created_at DESC LIMIT 20`,
    [user.id, kind]
  );
  const hit = rows.find((row) => matches((row.payload ?? {}) as Record<string, unknown>));
  return hit ? toTask(hit) : null;
}

export async function getTask<TResult = unknown, TPayload = unknown>(
  id: string,
  user: ScopeUser
): Promise<Task<TResult, TPayload> | null> {
  await reapStaleTasks();
  const scope = user.role === "admin" ? "" : "AND owner_id = $2";
  const scopeParams = user.role === "admin" ? [] : [user.id];
  const { rows } = await query<TaskRow>(`SELECT * FROM tasks WHERE id = $1 ${scope}`, [id, ...scopeParams]);
  return rows.length ? toTask<TResult, TPayload>(rows[0]) : null;
}

export async function listTasks<TResult = unknown, TPayload = unknown>(
  user: ScopeUser,
  opts: { kind?: TaskKind; limit?: number; offset?: number } = {}
): Promise<Task<TResult, TPayload>[]> {
  await reapStaleTasks();
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? 20)), 100);
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.kind) {
    params.push(opts.kind);
    where.push(`kind = $${params.length}`);
  }
  if (user.role !== "admin") {
    params.push(user.id);
    where.push(`owner_id = $${params.length}`);
  }
  params.push(limit, offset);
  const { rows } = await query<TaskRow>(
    `SELECT * FROM tasks
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map((row) => toTask<TResult, TPayload>(row));
}
