import { NextResponse } from "next/server";
import { listConceptsForExport } from "@/lib/concepts";
import { buildOkfZip } from "@/lib/okf";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

// The exporter uses jszip + Buffer, which need the Node runtime (not Edge).
export const runtime = "nodejs";

export const GET = withRoute("GET /api/export/okf", async () => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const concepts = await listConceptsForExport(user);
  const zipBuffer = await buildOkfZip(concepts, user.username);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  // Uint8Array (not Buffer) so the body type-checks against DOM BodyInit.
  return new NextResponse(new Uint8Array(zipBuffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="okf-export-${stamp}.zip"`,
    },
  });
});