/** 任务轮询（客户端共用）：提交任务后按 id 反复读 `GET /api/tasks/[id]`，
 * 直到 done / failed 或超时。问答面板与批量维护按钮共用这一份——轮询的
 * 间隔、超时与"超时不等于失败"的语义只有一处定义。 */

export interface PolledTask {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed";
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface PollOptions {
  intervalMs?: number;
  /** 轮询次数上限；超时返回最后一次快照（status 仍是 queued/running）。 */
  maxAttempts?: number;
  onTick?: (task: PolledTask) => void;
}

export async function readTask(id: string): Promise<PolledTask> {
  const res = await fetch(`/api/tasks/${id}`);
  const data = (await res.json().catch(() => ({}))) as { task?: PolledTask; error?: string };
  if (!res.ok || !data.task) throw new Error(data.error ?? `读取任务失败（HTTP ${res.status}）`);
  return data.task;
}

export async function pollTask(id: string, opts: PollOptions = {}): Promise<PolledTask> {
  const intervalMs = opts.intervalMs ?? 1200;
  const maxAttempts = opts.maxAttempts ?? 60;
  let task = await readTask(id);
  opts.onTick?.(task);
  for (let i = 0; i < maxAttempts && (task.status === "queued" || task.status === "running"); i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, intervalMs);
    await promise;
    task = await readTask(id);
    opts.onTick?.(task);
  }
  return task;
}

/** 提交一个任务（POST /api/tasks），返回任务 id。 */
export async function startTask(body: Record<string, unknown>): Promise<string> {
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !data.id) throw new Error(data.error ?? `提交任务失败（HTTP ${res.status}）`);
  return data.id;
}
