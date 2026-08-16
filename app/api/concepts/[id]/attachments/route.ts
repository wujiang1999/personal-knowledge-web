import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireApiUser } from "@/lib/requireUser";
import {
  AttachmentTooLargeError,
  insertAttachment,
  listAttachments,
  saveAttachmentStream,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/attachments";

export const runtime = "nodejs";

/** List attachments for a concept. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const owned = await query("SELECT 1 FROM concepts WHERE id = $1 AND owner_id = $2", [id, user.id]);
  if (!owned.rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const attachments = await listAttachments(id);
  return NextResponse.json({ attachments });
}

/**
 * Upload one attachment as a raw binary body (no multipart): the client sends
 * the file bytes directly with `X-Filename` and `X-Mime` headers. Streaming the
 * body to disk keeps a 100 MB upload out of memory.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const found = await query("SELECT 1 FROM concepts WHERE id = $1 AND owner_id = $2", [id, user.id]);
  if (!found.rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!req.body) return NextResponse.json({ error: "missing body" }, { status: 400 });

  // Fast pre-check when the client sent a Content-Length; the streaming meter
  // is still authoritative for chunked bodies.
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "attachment exceeds 100 MB" }, { status: 413 });
  }

  let originalName = "file";
  try {
    originalName = decodeURIComponent(req.headers.get("x-filename") ?? "file");
  } catch {
    /* keep fallback */
  }
  if (!originalName.trim()) originalName = "file";
  const mimeType = req.headers.get("x-mime")?.trim() || "application/octet-stream";

  let saved;
  try {
    saved = await saveAttachmentStream(req.body);
  } catch (err) {
    if (err instanceof AttachmentTooLargeError) {
      return NextResponse.json({ error: "attachment exceeds 100 MB" }, { status: 413 });
    }
    throw err;
  }

  const attachment = await insertAttachment({
    conceptId: id,
    originalName,
    mimeType,
    sizeBytes: saved.sizeBytes,
    storageKey: saved.storageKey,
    hash: saved.hash,
  });
  return NextResponse.json({ attachment }, { status: 201 });
}
