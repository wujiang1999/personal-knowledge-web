import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getSessionSecret } from "@/lib/config";

const PUBLIC_PATHS = ["/login"];
const LOGIN_API = "/api/auth/login";
const PUBLIC_API_PATHS = ["/api/health"];

async function isValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("session")?.value;
  if (!token) return false;
  try {
    // Fail fast on a missing SESSION_SECRET instead of silently verifying
    // with an empty key (which would disagree with the server-side helpers).
    await jwtVerify(token, getSessionSecret());
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isLoginApi = pathname === LOGIN_API;
  const isPublicApi = PUBLIC_API_PATHS.some((p) => pathname === p);
  const isApi = pathname.startsWith("/api/");

  const valid = await isValidSession(req);

  if (!valid && !isPublic && !isPublicApi && !isLoginApi) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (valid && (pathname === "/login" || pathname === "/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};