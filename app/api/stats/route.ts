import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";
import {
  clampDays,
  getApiKeyUsage,
  getBuildInfoAsync,
  getLibraryHealth,
  getSearchQuality,
  getTopRetrieved,
  getTrafficSummary,
} from "@/lib/stats";

/** Operational stats for the /stats console (and scripts/MCP): traffic
 * overview from request_log, retrieval quality from search_logs, per-key
 * usage attribution, hot entries from the retrieval counters, and — admins
 * only — library-wide health (embedding coverage/staleness, trash, sizes).
 * `keys`/`library` come back null for non-admin callers. Read-only. */
export const GET = withRoute("GET /api/stats", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const days = clampDays(new URL(req.url).searchParams.get("days"));
  const [traffic, search, topRetrieved, keys, library, build] = await Promise.all([
    getTrafficSummary(user, days),
    getSearchQuality(user, days),
    getTopRetrieved(user, 10),
    getApiKeyUsage(user, days),
    getLibraryHealth(user),
    getBuildInfoAsync(),
  ]);

  return NextResponse.json({ days, build, traffic, search, topRetrieved, keys, library });
});
