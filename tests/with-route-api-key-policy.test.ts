import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  class ApiKeyAuthenticationError extends Error {}
  class ApiKeyAccessError extends Error {}
  return {
    enforce: vi.fn(),
    resolveKeyContext: vi.fn(),
    logRequest: vi.fn(),
    ApiKeyAuthenticationError,
    ApiKeyAccessError,
  };
});

vi.mock("../lib/key-policy", () => ({
  enforceApiKeyAccess: state.enforce,
  ApiKeyAuthenticationError: state.ApiKeyAuthenticationError,
  ApiKeyAccessError: state.ApiKeyAccessError,
}));
vi.mock("../lib/apiKey", () => ({ resolveKeyContext: state.resolveKeyContext }));
vi.mock("../lib/logs", () => ({ logRequest: state.logRequest }));

import { withRoute } from "../lib/withRoute";

describe("withRoute API-key policy integration", () => {
  it("passes the declared method, template path, and actual request to policy enforcement", async () => {
    state.enforce.mockResolvedValue(undefined);
    state.resolveKeyContext.mockResolvedValue(null);
    const req = new Request("https://kb.example/api/concepts/id?purge=1");
    const handler = vi.fn(async (request: Request) => {
      void request;
      return new Response("ok");
    });

    const response = await withRoute("DELETE /api/concepts/[id]", handler)(req);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(req);
    expect(state.enforce).toHaveBeenCalledWith("DELETE", "/api/concepts/[id]", req);
  });

  it("maps rejected and forbidden Bearer credentials to 401 and 403", async () => {
    const handler = vi.fn(async (request: Request) => {
      void request;
      return new Response("should not run");
    });

    state.enforce.mockRejectedValueOnce(new state.ApiKeyAuthenticationError());
    state.resolveKeyContext.mockResolvedValue(null);
    const unauthorized = await withRoute("GET /api/search", handler)(new Request("https://kb.example/api/search"));
    expect(unauthorized.status).toBe(401);

    state.enforce.mockRejectedValueOnce(new state.ApiKeyAccessError());
    const forbidden = await withRoute("POST /api/concepts", handler)(new Request("https://kb.example/api/concepts"));
    expect(forbidden.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
