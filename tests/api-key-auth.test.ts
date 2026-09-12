import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorization: null as string | null,
  getSession: vi.fn(),
  query: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(state.authorization ? { authorization: state.authorization } : undefined),
}));
vi.mock("../lib/auth", () => ({ getSession: state.getSession }));
vi.mock("../lib/db", () => ({ query: state.query }));

import { getUserByApiKey } from "../lib/apiKey";
import { requireApiUser } from "../lib/requireUser";

const KEY = `pkb_${"a".repeat(48)}`;

describe("Bearer authentication precedence", () => {
  beforeEach(() => {
    state.authorization = null;
    state.getSession.mockReset();
    state.query.mockReset();
  });

  it("does not fall back to a valid cookie when a presented Bearer key is rejected", async () => {
    state.authorization = "Bearer malformed";
    state.getSession.mockResolvedValue({ sub: "cookie-user", username: "admin", tokenVersion: 1 });

    await expect(requireApiUser()).resolves.toBeNull();
    expect(state.getSession).not.toHaveBeenCalled();
  });

  it("queries only unexpired keys, so an expired key authenticates as nothing", async () => {
    state.authorization = `Bearer ${KEY}`;
    state.query.mockResolvedValue({ rows: [] });

    await expect(getUserByApiKey()).resolves.toBeNull();
    expect(state.query).toHaveBeenCalledWith(
      expect.stringContaining("expires_at > now()"),
      expect.any(Array),
    );
  });

  it("does not fall back to a cookie after an expired-key lookup returns no row", async () => {
    state.authorization = `Bearer ${KEY}`;
    state.query.mockResolvedValue({ rows: [] });
    state.getSession.mockResolvedValue({ sub: "cookie-user", username: "admin", tokenVersion: 1 });

    await expect(requireApiUser()).resolves.toBeNull();
    expect(state.getSession).not.toHaveBeenCalled();
  });
});
