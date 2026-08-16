import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { requireApiUser } from "@/lib/requireUser";
import {
  attachmentFilePath,
  deleteAttachmentFile,
  deleteAttachmentRecord,
  getAttachment,
  isInlinePreviewable,
  openAttachmentReadStream,
  safeContentType,
} from "@/lib/attachments";

export const runtime = "nodejs";

function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(name);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Serve the file bytes (inline preview by default; ?download=1 forces download). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const att = await getAttachment(id);
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const download = new URL(req.url).searchParams.get("download") === "1";
  const contentType = safeContentType(att.mime_type);
  const inline = !download && isInlinePreviewable(att.mime_type);
  const disposition = contentDisposition(inline ? "inline" : "attachment", att.original_name);

  let fileStat;
  try {
    fileStat = await stat(attachmentFilePath(att.storage_key));
  } catch {
    return NextResponse.json({ error: "file missing on disk" }, { status: 404 });
  }

  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };

  // Range support so <video>/<audio> can seek.
  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      const total = fileStat.size;
      let start: number;
      let end: number;
      if (m[1] === "") {
        const suffix = Number(m[2]);
        start = Math.max(0, total - suffix);
        end = total - 1;
      } else {
        start = Number(m[1]);
        end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
      }
      const stream = openAttachmentReadStream(att.storage_key, { start, end });
      return new NextResponse(Readable.toWeb(stream) as unknown as BodyInit, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
  }

  const stream = openAttachmentReadStream(att.storage_key);
  return new NextResponse(Readable.toWeb(stream) as unknown as BodyInit, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(fileStat.size) },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const att = await deleteAttachmentRecord(id);
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await deleteAttachmentFile(att.storage_key);
  return NextResponse.json({ ok: true });
}
