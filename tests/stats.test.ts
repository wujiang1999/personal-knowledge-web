import { describe, expect, it } from "vitest";
import { clampDays } from "../lib/stats";
import { parseRouteName } from "../lib/withRoute";

describe("clampDays", () => {
  it("accepts the documented range and clamps outliers", () => {
    expect(clampDays("7")).toBe(7);
    expect(clampDays("30")).toBe(30);
    expect(clampDays(90)).toBe(90);
    expect(clampDays("0")).toBe(1);
    expect(clampDays("-5")).toBe(1);
    expect(clampDays("4000")).toBe(365);
    expect(clampDays("abc")).toBe(30);
    expect(clampDays(null)).toBe(30);
    expect(clampDays(undefined)).toBe(30);
  });

  it("truncates fractional values instead of rounding up", () => {
    expect(clampDays("7.9")).toBe(7);
  });
});

describe("parseRouteName", () => {
  it("splits withRoute names into method + path for request_log", () => {
    expect(parseRouteName("GET /api/search")).toEqual({ method: "GET", path: "/api/search" });
    expect(parseRouteName("POST /api/concepts")).toEqual({ method: "POST", path: "/api/concepts" });
    expect(parseRouteName("DELETE /api/trash")).toEqual({ method: "DELETE", path: "/api/trash" });
  });

  it("falls back to GET + raw name when the name has no method prefix", () => {
    expect(parseRouteName("weird")).toEqual({ method: "GET", path: "weird" });
  });
});
