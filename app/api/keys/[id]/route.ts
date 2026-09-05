import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireApiUser } from "@/lib/requireUser";
import { isUuid, withRoute } from "@/lib/withRoute";

/** Revoke one of the caller's OWN API keys. Owner-scoped on purpose — the
 * WHERE clause matches the key id AND the caller, so a foreign/unknown/already
 * revoked id all answer 404 without leaking which. Revocation is immediate:
 * the auth lookup filters revoked_at. */
export const DELETE = withRoute(
  "DELETE /api/keys/[id]",
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const res = await query(
      "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
      [id, user.id]
    );
    if (!res.rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
);
