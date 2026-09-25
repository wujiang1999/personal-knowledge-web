import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/requireUser";
import { reportSpotCheckIssue } from "@/lib/quality-checks";
import { MANUAL_ISSUE_TYPES } from "@/lib/quality-review-contract";
import { isUuid, withRoute } from "@/lib/withRoute";

const reportSchema = z.object({
  conceptId: z.string().uuid(),
  issueType: z.enum(MANUAL_ISSUE_TYPES),
  note: z.string().trim().min(1).max(2000),
});

export const POST = withRoute("POST /api/quality/spot-check/report", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: z.infer<typeof reportSchema>;
  try {
    body = reportSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!isUuid(body.conceptId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const result = await reportSpotCheckIssue(user, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Concept not found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw error;
  }
});
