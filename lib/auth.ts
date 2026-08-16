import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getSessionSecret } from "./config";

export interface SessionPayload {
  sub: string; // user id
  username: string;
  tokenVersion: number;
}

const COOKIE_NAME = "session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function createSession(user: {
  id: string;
  username: string;
  tokenVersion: number;
}): Promise<void> {
  const token = await new SignJWT({ username: user.username, tv: user.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSessionSecret());

  const store = await cookies();
  // Secure by default in production; override with SESSION_COOKIE_SECURE=false
  // only when the app is served over plain HTTP (e.g. direct public-IP access).
  const secure = process.env.SESSION_COOKIE_SECURE !== undefined
    ? process.env.SESSION_COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production";
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    if (!payload.sub) return null;
    // Missing/unknown tv (-1) can never match a DB token_version >= 1, so
    // tokens issued before token_version was introduced are invalidated.
    const tokenVersion = typeof payload.tv === "number" ? payload.tv : -1;
    return { sub: payload.sub, username: (payload.username as string) ?? "", tokenVersion };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
