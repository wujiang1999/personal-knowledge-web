import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { client, pool: { connect: vi.fn(async () => client) }, query: vi.fn() };
});

vi.mock("../lib/db", () => ({ getPool: () => state.pool, query: state.query }));

import { ModelLimitError } from "../lib/usage-guard";
import { checkTaskAdmission, enqueueTask } from "../lib/tasks";

const user = { id: "4b41b8cb-49b1-48a7-9030-99148b7e4b03", role: "user" as const };

beforeEach(() => {
  vi.clearAllMocks();
  state.pool.connect.mockResolvedValue(state.client);
});
afterEach(() => vi.unstubAllEnvs());

describe("task admission policy", () => {
  it("rejects the configured number of non-expired active tasks", () => {
    expect(() => checkTaskAdmission({ active: 1, minuteCalls: 0 })).not.toThrow();
    expect(() => checkTaskAdmission({ active: 2, minuteCalls: 0 })).toThrow(ModelLimitError);
  });

  it("counts all recently created task statuses against the owner rate limit", () => {
    expect(() => checkTaskAdmission({ active: 0, minuteCalls: 9 })).not.toThrow();
    expect(() => checkTaskAdmission({ active: 0, minuteCalls: 10 })).toThrow(ModelLimitError);
  });

  it("uses one per-owner transaction lock and inserts only after admission", async () => {
    state.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("count(*) FILTER")) return { rows: [{ active: 0, minuteCalls: 0 }] };
      if (sql.startsWith("INSERT INTO tasks")) return { rows: [{ id: "task-id" }] };
      return { rows: [] };
    });

    await expect(enqueueTask(user, { kind: "ask", payload: { question: "q" } })).resolves.toBe("task-id");

    const calls = state.client.query.mock.calls.map(([sql]) => String(sql));
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toContain("pg_advisory_xact_lock(hashtextextended");
    expect(calls[2]).toContain("owner_id = $1");
    expect(calls[2]).toContain("coalesce(started_at, created_at) > now()");
    expect(calls[2]).toContain("count(*) FILTER (WHERE created_at > now() - interval '1 minute')");
    expect(calls[3]).toContain("INSERT INTO tasks");
    expect(calls[4]).toBe("COMMIT");
    expect(state.client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and never inserts when admission rejects", async () => {
    state.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("count(*) FILTER")) return { rows: [{ active: 2, minuteCalls: 0 }] };
      return { rows: [] };
    });

    await expect(enqueueTask(user, { kind: "ask", payload: { question: "q" } })).rejects.toThrow(ModelLimitError);

    const calls = state.client.query.mock.calls.map(([sql]) => String(sql));
    expect(calls.some((sql) => sql.startsWith("INSERT INTO tasks"))).toBe(false);
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(state.client.release).toHaveBeenCalledOnce();
  });
});
