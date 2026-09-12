import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { listApiKeys, type ApiKeyAccessMode } from "@/lib/apiKey";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

/** Self-service API key management: any authenticated account manages its own
 * keys here (the CLI `db:create-api-key` stays for bootstrap/CI). The
 * plaintext is returned exactly once at creation; only SHA-256 hashes live in
 * the database. Admins managing OTHER users' keys is deliberately not exposed
 * — keys are personal credentials. */

const MAX_ACTIVE_KEYS = 10;

export const GET = withRoute("GET /api/keys", async () => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ keys: await listApiKeys(user.id) });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
  // The browser console only creates least-privilege read/write keys. An
  // admin-scoped credential is an explicit operational action (CLI) and its
  // owner must already be an admin account.
  accessMode: z.enum(["read", "write"]).optional().default("write"),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const POST = withRoute("POST /api/keys", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (body.expiresAt && new Date(body.expiresAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: "expiresAt must be in the future" }, { status: 400 });
  }

  const { rows: active } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM api_keys
     WHERE user_id = $1 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())`,
    [user.id]
  );
  if (active[0].n >= MAX_ACTIVE_KEYS) {
    return NextResponse.json(
      { error: `活跃密钥已达上限（${MAX_ACTIVE_KEYS} 个），请先吊销不用的密钥` },
      { status: 409 }
    );
  }

  // Same shape as the CLI minted: pkb_ + 48 hex chars.
  const key = `pkb_${randomBytes(24).toString("hex")}`;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const { rows } = await query<{
    id: string;
    created_at: string;
    access_mode: ApiKeyAccessMode;
    expires_at: string | null;
  }>(
    `INSERT INTO api_keys (user_id, name, key_hash, access_mode, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at, access_mode, expires_at`,
    [user.id, body.name, keyHash, body.accessMode, body.expiresAt ?? null]
  );

  return NextResponse.json(
    {
      id: rows[0].id,
      name: body.name,
      created_at: rows[0].created_at,
      accessMode: rows[0].access_mode,
      expiresAt: rows[0].expires_at,
      key,
    },
    { status: 201 }
  );
});
