import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getSessionSecret } from "@/lib/config";
import { publicRequestUrl } from "@/lib/publicUrl";

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

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isLoginApi = pathname === LOGIN_API;
  const isPublicApi = PUBLIC_API_PATHS.some((p) => pathname === p);
  const isApi = pathname.startsWith("/api/");

  // A Bearer API key cannot be validated here (the proxy has no DB access):
  // let the request reach the route handler, where requireApiUser resolves
  // the key against the database and answers 401 itself. Every protected /api
  // route performs that check.
  const hasBearer = (req.headers.get("authorization") ?? "").startsWith("Bearer ");

  const valid = hasBearer || (await isValidSession(req));

  if (!valid && !isPublic && !isPublicApi && !isLoginApi) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = publicRequestUrl(req);
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (valid && (pathname === "/login" || pathname === "/")) {
    const url = publicRequestUrl(req);
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  // Clickjacking protection is set here (not in next.config headers()) so it can
  // be per-path: the attachment file endpoint must be frameable by our own PDF
  // preview <iframe> (X-Frame-Options: SAMEORIGIN / frame-ancestors 'self'),
  // while every other route keeps DENY / frame-ancestors 'none'.
  const isAttachmentApi = pathname.startsWith("/api/attachments/");
  res.headers.set("X-Frame-Options", isAttachmentApi ? "SAMEORIGIN" : "DENY");
  if (process.env.NODE_ENV === "production") {
    res.headers.set(
      "Content-Security-Policy",
      isAttachmentApi ? "frame-ancestors 'self'" : "frame-ancestors 'none'"
    );
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
