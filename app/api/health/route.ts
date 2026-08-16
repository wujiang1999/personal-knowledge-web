import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// Lightweight liveness probe for deploy.sh / uptime monitors.
// No data is exposed; a DB roundtrip confirms the pool is alive.
export const runtime = "nodejs";

export async function GET() {
  try {
    await query("SELECT 1");
    return NextResponse.json({ ok: true, db: "up" });
  } catch (err) {
    console.error("health check failed", err);
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}