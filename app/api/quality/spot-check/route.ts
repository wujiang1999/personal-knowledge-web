import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/requireUser";
import { sampleConcepts } from "@/lib/quality-checks";
import { SPOT_CHECK_DEFAULT_SIZE, SPOT_CHECK_MAX_SIZE, SPOT_CHECK_PREVIEW_CHARS } from "@/lib/quality-review-contract";
import { withRoute } from "@/lib/withRoute";

export const GET = withRoute("GET /api/quality/spot-check", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const raw = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0
    ? Math.min(Math.trunc(raw), SPOT_CHECK_MAX_SIZE)
    : SPOT_CHECK_DEFAULT_SIZE;
  const samples = await sampleConcepts(user, limit);
  return NextResponse.json({
    samples: samples.map((sample) => ({ ...sample, body: sample.body.slice(0, SPOT_CHECK_PREVIEW_CHARS) })),
  });
});
