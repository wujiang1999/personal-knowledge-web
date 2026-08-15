import { NextResponse } from "next/server";
import { listConceptsForExport } from "@/lib/concepts";
import { buildOkfZip } from "@/lib/okf";
import { requireApiUser } from "@/lib/requireUser";

export async function GET() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const concepts = await listConceptsForExport();
  const zipBuffer = await buildOkfZip(concepts, user.username);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new NextResponse(zipBuffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="okf-export-${stamp}.zip"`,
    },
  });
}