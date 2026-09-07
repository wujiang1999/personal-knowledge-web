import { describe, expect, it } from "vitest";
import { llmCallLogSchema, logWhereClause, type LogFilter } from "../lib/logs";
import type { ScopeUser } from "../lib/requireUser";

const user: ScopeUser = { id: "u1", role: "user" };
const admin: ScopeUser = { id: "a1", role: "admin" };

describe("logWhereClause", () => {
  it("scopes non-admins and applies a days window", () => {
    const params: unknown[] = [];
    const where = logWhereClause("s.user_id", "s.created_at", user, { days: 7 }, params);
    expect(where).toContain("s.user_id = $1");
    expect(where).toContain("s.created_at >= now() - ($2 * interval '1 day')");
    expect(params).toEqual(["u1", 7]);
  });

  it("filters a single Beijing calendar day for admins", () => {
    const params: unknown[] = [];
    const where = logWhereClause("l.user_id", "l.created_at", admin, { date: "2026-09-07" }, params);
    expect(where).not.toContain("user_id");
    expect(where).toContain("(l.created_at AT TIME ZONE");
    expect(where).toContain("::date = $1::date");
    expect(params).toEqual(["2026-09-07"]);
  });

  it("combines owner scope, days and date with AND", () => {
    const params: unknown[] = [];
    const where = logWhereClause("s.user_id", "s.created_at", user, { days: 30, date: "2026-09-01" }, params);
    expect((where.match(/ AND /g) ?? []).length).toBe(2);
    expect(where).toContain("::date");
    expect(params).toEqual(["u1", 30, "2026-09-01"]);
  });

  it("returns an empty clause and no params without a filter", () => {
    const params: unknown[] = [];
    expect(logWhereClause("s.user_id", "s.created_at", admin, undefined, params)).toBe("");
    expect(logWhereClause("s.user_id", "s.created_at", admin, {} as LogFilter, params)).toBe("");
    expect(params).toEqual([]);
  });
});

describe("llmCallLogSchema", () => {
  it("parses a valid report and defaults absent numerics to null", () => {
    const p = llmCallLogSchema.parse({
      kind: "llm",
      purpose: "judge",
      model: "deepseek-chat",
      input_chars: 1234,
      took_ms: 800,
      ok: true,
    });
    expect(p).toMatchObject({
      kind: "llm",
      purpose: "judge",
      model: "deepseek-chat",
      input_chars: 1234,
      prompt_tokens: null,
      completion_tokens: null,
      took_ms: 800,
      ok: true,
      error: null,
    });
  });

  it("truncates over-long model and error fields", () => {
    const p = llmCallLogSchema.parse({
      kind: "embedding",
      purpose: "x".repeat(80),
      model: "m".repeat(300),
      ok: false,
      error: "e".repeat(900),
    });
    expect(p.purpose.length).toBeLessThanOrEqual(50);
    expect(p.model.length).toBeLessThanOrEqual(100);
    expect(p.error?.length).toBe(500);
  });

  it("rejects unknown kinds and out-of-range numerics", () => {
    expect(
      llmCallLogSchema.safeParse({ kind: "other", purpose: "p", model: "m", ok: true }).success
    ).toBe(false);
    expect(
      llmCallLogSchema.safeParse({ kind: "llm", purpose: "p", model: "m", ok: true, took_ms: -1 }).success
    ).toBe(false);
    expect(
      llmCallLogSchema.safeParse({ kind: "llm", purpose: "p", model: "m", ok: "yes" }).success
    ).toBe(false);
  });

  it("rejects an empty purpose after clamping", () => {
    expect(
      llmCallLogSchema.safeParse({ kind: "llm", purpose: "   ", model: "m", ok: true }).success
    ).toBe(false);
  });
});
