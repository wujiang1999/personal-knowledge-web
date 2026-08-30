import { NextResponse } from "next/server";
import { open } from "node:fs/promises";
import { query } from "@/lib/db";
import { requireApiUser } from "@/lib/requireUser";
import { isUuid, withRoute } from "@/lib/withRoute";
import {
  AttachmentTooLargeError,
  attachmentBytesForOwner,
  attachmentFilePath,
  deleteAttachmentFile,
  insertAttachment,
  listAttachments,
  saveAttachmentStream,
  validateDeclaredMime,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "@/lib/attachments";

export const runtime = "nodejs";

/** List attachments for a concept. */
export const GET = withRoute(
  "GET /api/concepts/[id]/attachments",
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const owned =
      user.role === "admin" ||
      (await query("SELECT 1 FROM concepts WHERE id = $1 AND owner_id = $2", [id, user.id])).rowCount === 1;
    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const attachments = await listAttachments(id);
    return NextResponse.json({ attachments });
  }
);

/**
 * Upload one attachment as a raw binary body (no multipart): the client sends
 * the file bytes directly with `X-Filename` and `X-Mime` headers. Streaming the
 * body to disk keeps a 100 MB upload out of memory.
 */
export const PUT = withRoute(
  "PUT /api/concepts/[id]/attachments",
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const found =
      user.role === "admin" ||
      (await query("SELECT 1 FROM concepts WHERE id = $1 AND owner_id = $2", [id, user.id])).rowCount === 1;
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!req.body) return NextResponse.json({ error: "missing body" }, { status: 400 });

  // Fast pre-check when the client sent a Content-Length; the streaming meter
  // is still authoritative for chunked bodies.
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "attachment exceeds 100 MB" }, { status: 413 });
  }
  const usedBytes = await attachmentBytesForOwner(user.id);
  if (usedBytes + len > MAX_TOTAL_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "attachment storage quota exceeded" }, { status: 413 });
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

  // Post-write MIME validation: sniff the first bytes of the stored file so a
  // spoofed X-Mime can never turn a script-capable payload (SVG/XML/HTML) into
  // an inline-rendered attachment. Downgrade or reject as appropriate.
  let head = Buffer.alloc(0);
  let fh;
  try {
    fh = await open(attachmentFilePath(saved.storageKey), "r");
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    head = buf.subarray(0, bytesRead);
  } finally {
    await fh?.close();
  }
  const validated = validateDeclaredMime(mimeType, head);
  if (validated.error) {
    await deleteAttachmentFile(saved.storageKey);
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  // The Content-Length pre-check above is not available for chunked uploads.
  // Check the measured size before creating the DB row, and remove the bytes
  // if the per-user quota would be exceeded.
  if (usedBytes + saved.sizeBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    await deleteAttachmentFile(saved.storageKey);
    return NextResponse.json({ error: "attachment storage quota exceeded" }, { status: 413 });
  }

  const attachment = await insertAttachment({
    conceptId: id,
    originalName,
    mimeType: validated.mime ?? mimeType,
    sizeBytes: saved.sizeBytes,
    storageKey: saved.storageKey,
    hash: saved.hash,
  }).catch(async (err) => {
    // DB row insert failed — don't leave the already-written bytes on disk.
    await deleteAttachmentFile(saved.storageKey);
    throw err;
  });
  return NextResponse.json({ attachment }, { status: 201 });
  }
);
