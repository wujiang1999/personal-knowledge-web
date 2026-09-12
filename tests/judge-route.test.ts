import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiUser = vi.hoisted(() => vi.fn());
const judgeConcept = vi.hoisted(() => vi.fn());

vi.mock("@/lib/requireUser", () => ({ requireApiUser }));
vi.mock("@/lib/judge", () => ({ judgeConcept }));
// Endpoint behavior is the concern here; request logging has independent tests.
vi.mock("@/lib/withRoute", () => ({ withRoute: <A extends unknown[]>(_: string, handler: (...args: A) => Promise<Response>) => handler }));

import { POST } from "../app/api/judge/route";

const body = {
  operation: "create",
  newTitle: "新条目",
  newBody: "正文",
  candidateIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/judge", () => {
  it("requires an authenticated API user", async () => {
    requireApiUser.mockResolvedValue(null);
    const response = await POST(new Request("https://kb.example/api/judge", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(401);
    expect(judgeConcept).not.toHaveBeenCalled();
  });

  it("validates the request and passes the authenticated scope to the judge", async () => {
    const user = { id: "u1", role: "user" as const, apiKeyId: "key1" };
    requireApiUser.mockResolvedValue(user);
    judgeConcept.mockResolvedValue({ verdict: "ok", reason: "无候选" });
    const response = await POST(new Request("https://kb.example/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ verdict: "ok", reason: "无候选" });
    expect(judgeConcept).toHaveBeenCalledWith(body, user);
  });

  it("rejects malformed candidate input before reaching the model", async () => {
    requireApiUser.mockResolvedValue({ id: "u1", role: "user" });
    const response = await POST(new Request("https://kb.example/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, candidateIds: ["x".repeat(65)] }),
    }));
    expect(response.status).toBe(400);
    expect(judgeConcept).not.toHaveBeenCalled();
  });
});
