import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";
import { insertLlmCall, llmCallLogSchema } from "@/lib/logs";

/** Ingest endpoint for REMOTE LLM-call records — the MCP judge reports its
 * chat calls here so /logs shows the full picture (server-side calls are
 * logged directly by lib/llm.ts). Attributed to the API key's owner. */
export const POST = withRoute("POST /api/logs/llm", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const parsed = llmCallLogSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  // Third arg is server-side attribution (the authenticated key) — remote
  // clients never send it; the MCP contract above is unchanged.
  await insertLlmCall(user.id, parsed.data, user.apiKeyId);
  return NextResponse.json({ ok: true });
});
