import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/requireUser";

/** Identify the authenticated caller (cookie session or Bearer API key). */
export async function GET() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ username: user.username });
}
