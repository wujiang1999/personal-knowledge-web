import { NextResponse } from "next/server";
import { listSources } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";

export async function GET() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sources = await listSources();
  return NextResponse.json({ sources });
}