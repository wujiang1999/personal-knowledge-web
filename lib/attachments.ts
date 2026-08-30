import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { query } from "./db";

/** Upload cap: 100 MB. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/**
 * Per-user storage cap. It can be raised for a self-hosted installation with
 * MAX_TOTAL_ATTACHMENT_BYTES, but cannot be set below the single-file limit.
 */
function attachmentQuotaFromEnv(): number {
  const configured = Number(process.env.MAX_TOTAL_ATTACHMENT_BYTES);
  if (!Number.isSafeInteger(configured) || configured < MAX_ATTACHMENT_BYTES) {
    return 2 * 1024 * 1024 * 1024; // 2 GiB
  }
  return configured;
}

export const MAX_TOTAL_ATTACHMENT_BYTES = attachmentQuotaFromEnv();

/**
 * Absolute directory where uploaded attachment bytes are stored.
 * Lives here (not in lib/config.ts) because this module is Node-only — config.ts
 * is also bundled for the Edge middleware, which has no `node:path`.
 */
export function getAttachmentRoot(): string {
  return process.env.ATTACHMENT_DIR || join(process.cwd(), "data", "attachments");
}

export interface Attachment {
  id: string;
  concept_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  content_hash: string;
  created_at: string;
}

export class AttachmentTooLargeError extends Error {}

function attachmentDir(): string {
  return getAttachmentRoot();
}

async function ensureDir(): Promise<void> {
  await mkdir(attachmentDir(), { recursive: true });
}

/** Absolute path for a stored file. storage_key is server-generated; guard traversal. */
export function attachmentFilePath(storageKey: string): string {
  if (storageKey !== basename(storageKey) || storageKey.includes("..") || storageKey === "") {
    throw new Error("invalid storage key");
  }
  return join(attachmentDir(), storageKey);
}

/** Stream a web ReadableStream to disk under a fresh uuid, hashing and counting bytes. */
export async function saveAttachmentStream(
  webBody: ReadableStream<Uint8Array>,
): Promise<{ storageKey: string; sizeBytes: number; hash: string }> {
  await ensureDir();
  const storageKey = randomUUID();
  const tmpPath = join(attachmentDir(), `${storageKey}.uploading`);
  const hash = createHash("sha256");
  let size = 0;

  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > MAX_ATTACHMENT_BYTES) {
        cb(new AttachmentTooLargeError("attachment exceeds 100 MB"));
        return;
      }
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  try {
    const nodeStream = Readable.fromWeb(webBody as Parameters<typeof Readable.fromWeb>[0]);
    await pipeline(nodeStream, meter, createWriteStream(tmpPath));
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }

  await rename(tmpPath, join(attachmentDir(), storageKey));
  return { storageKey, sizeBytes: size, hash: hash.digest("hex") };
}

export async function deleteAttachmentFile(storageKey: string): Promise<void> {
  try {
    await rm(attachmentFilePath(storageKey), { force: true });
  } catch (err) {
    // Callers usually delete the DB row first; log instead of silently
    // leaking an orphaned file (up to 100 MB each).
    console.error("failed to delete attachment file", storageKey, err);
  }
}

export async function attachmentStat(storageKey: string) {
  return stat(attachmentFilePath(storageKey));
}

export function openAttachmentReadStream(storageKey: string, opts?: { start?: number; end?: number }) {
  return createReadStream(attachmentFilePath(storageKey), opts);
}

// ---------- DB rows ----------

function rowToAttachment(r: Attachment): Attachment {
  return { ...r, size_bytes: Number(r.size_bytes) };
}

export async function listAttachments(conceptId: string): Promise<Attachment[]> {
  const { rows } = await query<Attachment>(
    `SELECT id, concept_id, original_name, mime_type, size_bytes, storage_key, content_hash, created_at
     FROM attachments WHERE concept_id = $1 ORDER BY created_at DESC`,
    [conceptId],
  );
  return rows.map(rowToAttachment);
}

export async function getAttachment(id: string): Promise<Attachment | null> {
  const { rows } = await query<Attachment>(
    `SELECT id, concept_id, original_name, mime_type, size_bytes, storage_key, content_hash, created_at
     FROM attachments WHERE id = $1`,
    [id],
  );
  return rows.length ? rowToAttachment(rows[0]) : null;
}

/** Total attachment bytes owned by a user, across all of their concepts. */
export async function attachmentBytesForOwner(ownerId: string): Promise<number> {
  const { rows } = await query<{ total_bytes: string }>(
    `SELECT COALESCE(SUM(a.size_bytes), 0)::text AS total_bytes
     FROM attachments a
     JOIN concepts c ON c.id = a.concept_id
     WHERE c.owner_id = $1`,
    [ownerId],
  );
  return Number(rows[0]?.total_bytes ?? 0);
}

export async function insertAttachment(input: {
  conceptId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  hash: string;
}): Promise<Attachment> {
  const { rows } = await query<Attachment>(
    `INSERT INTO attachments (concept_id, original_name, mime_type, size_bytes, storage_key, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, concept_id, original_name, mime_type, size_bytes, storage_key, content_hash, created_at`,
    [input.conceptId, input.originalName, input.mimeType, input.sizeBytes, input.storageKey, input.hash],
  );
  return rowToAttachment(rows[0]);
}

/** Delete the row and return it (so the caller can remove the file). */
export async function deleteAttachmentRecord(id: string): Promise<Attachment | null> {
  const { rows } = await query<Attachment>(
    `DELETE FROM attachments WHERE id = $1
     RETURNING id, concept_id, original_name, mime_type, size_bytes, storage_key, content_hash, created_at`,
    [id],
  );
  return rows.length ? rowToAttachment(rows[0]) : null;
}

// Inline-safety classification lives in the shared pure module (the browser
// components import the same logic); re-exported here for the API routes.
import { INLINE_SAFE_IMAGES } from "./attachment-mime";
export { isInlinePreviewable, previewKindFor } from "./attachment-mime";

/** Sanitize a stored mime before serving it back to the browser. */
export function safeContentType(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (!m || m === "text/html") return "application/octet-stream";
  // Any script-capable image format (SVG, XML-based, ICO, …) is served only as
  // a download, never inline: the browser must not render it as a same-origin
  // top-level document.
  if (m.startsWith("image/") && !INLINE_SAFE_IMAGES.has(m)) return "application/octet-stream";
  return m;
}

// ---------- upload magic-byte validation ----------

function readAscii(buf: Buffer, start: number, len: number): string {
  return buf.subarray(start, start + len).toString("latin1");
}

/**
 * Sniff the true type of a file from its first bytes. Supports the types we
 * are willing to inline; returns null when the content is unrecognized.
 */
export function sniffMime(head: Buffer): string | null {
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return "image/png";
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }
  if (head.length >= 6 && (readAscii(head, 0, 6) === "GIF87a" || readAscii(head, 0, 6) === "GIF89a")) {
    return "image/gif";
  }
  if (head.length >= 12 && readAscii(head, 0, 4) === "RIFF" && readAscii(head, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (head.length >= 12 && readAscii(head, 4, 4) === "ftyp" && (readAscii(head, 8, 4) === "avif" || readAscii(head, 8, 4) === "avis")) {
    return "image/avif";
  }
  if (head.length >= 5 && readAscii(head, 0, 5) === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

const ALWAYS_DOWNLOAD = new Set(["text/html", "application/xhtml+xml", "application/xml", "image/x-icon", "image/svg+xml"]);

/**
 * Validate a client-declared MIME against the actual file header.
 *
 * - image/* (whitelisted bitmaps) and application/pdf: content must match the
 *   declaration, otherwise the upload is rejected (a spoofed inline type).
 * - script-capable types (svg/xml/html/ico) and any unrecognized image: the
 *   stored mime is downgraded to application/octet-stream so the file can only
 *   be downloaded, never rendered inline.
 * - text/audio/video/octet-stream: accepted as declared (they render safely:
 *   text as <pre>, media without a script interpreter).
 *
 * Returns the (possibly downgraded) mime to store, or { error } to reject.
 */
export function validateDeclaredMime(declared: string, head: Buffer): { mime?: string; error?: string } {
  const m = (declared || "").toLowerCase().trim();
  if (!m) return { mime: "application/octet-stream" };

  if (ALWAYS_DOWNLOAD.has(m) || (m.startsWith("image/") && !INLINE_SAFE_IMAGES.has(m) && m !== "application/pdf")) {
    return { mime: "application/octet-stream" };
  }

  if ((INLINE_SAFE_IMAGES.has(m) || m === "application/pdf")) {
    const sniffed = sniffMime(head);
    if (sniffed !== m) {
      return { error: "file content does not match the declared type" };
    }
    return { mime: m };
  }

  // text/*, audio/*, video/*, application/octet-stream, and anything else:
  if (m.startsWith("text/") && m !== "text/html") return { mime: m };
  if (m.startsWith("audio/") || m.startsWith("video/")) return { mime: m };
  return { mime: m };
}
