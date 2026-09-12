import { NextResponse } from "next/server";
import { z } from "zod";
import { judgeConcept } from "@/lib/judge";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

const judgeSchema = z.object({
  operation: z.enum(["create", "update"]),
  newTitle: z.string().trim().min(1).max(500),
  newBody: z.string().min(1).max(500_000),
  newCategory: z.string().max(200).optional(),
  newTags: z.array(z.string().max(64)).max(30).optional(),
  candidateIds: z.array(z.string().min(1).max(64)).max(5),
});

/** Authenticated server-side judge. The client supplies only IDs from its
 * search response; bodies are reloaded with owner and soft-delete guards. */
export const POST = withRoute("POST /api/judge", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const parsed = judgeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  return NextResponse.json(await judgeConcept(parsed.data, user));
});
