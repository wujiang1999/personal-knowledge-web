import { NextResponse } from "next/server";
import { restoreConceptVersion } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";
import { isUuid, withRoute } from "@/lib/withRoute";

/** Rollback: re-create the content+metadata of a historical version as a NEW
 * version (version rows are immutable, so a rollback is itself revertible). */
export const POST = withRoute(
  "POST /api/concepts/[id]/versions/[version]/restore",
  async (_req: Request, { params }: { params: Promise<{ id: string; version: string }> }) => {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id, version } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const versionNumber = Number(version);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      return NextResponse.json({ error: "invalid version" }, { status: 400 });
    }
    const result = await restoreConceptVersion(id, versionNumber, user, user.username);
    return NextResponse.json({ version: result.version, created: result.created });
  }
);
