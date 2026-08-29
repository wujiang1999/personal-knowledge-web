import { NextResponse } from "next/server";
import { searchConcepts } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";

export async function GET(req: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const k = Math.max(3, Math.min(50, Number(searchParams.get("k") ?? 20) || 20));

  const results = await searchConcepts(user, q, k);
  return NextResponse.json({ results });
}