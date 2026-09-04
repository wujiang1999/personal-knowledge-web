import { NextResponse } from "next/server";
import { z } from "zod";
import { createConcept } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

const captureSchema = z.object({
  text: z.string().min(1).max(5000),
  title: z.string().min(1).max(200).optional(),
  category: z.string().max(200).optional(),
});

/** Quick capture (Obsidian quick-capture pattern): one authenticated POST
 * lands a draft note under 捕获/ with a timestamped title (first line of the
 * text becomes the title tail unless a title is given). Meant for
 * bookmarklets, phone shortcuts and cron snippets. GET is deliberately
 * unsupported — API keys in URLs leak into access logs. Status starts at
 * draft so the triage pass (edit/链接/归档) is explicit. */
export const POST = withRoute("POST /api/capture", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof captureSchema>;
  try {
    body = captureSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const now = new Date();
  const firstLine = body.text.split("\n")[0].trim().slice(0, 60);
  const title =
    body.title?.trim() ||
    `速记 ${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)} ${firstLine}`.trim().slice(0, 200);

  const id = await createConcept(
    {
      type: "Note",
      title,
      category: body.category?.trim() || process.env.CAPTURE_CATEGORY?.trim() || "捕获",
      status: "draft",
      body: body.text,
    },
    { id: user.id, username: user.username, role: user.role }
  );
  return NextResponse.json({ id }, { status: 201 });
});
