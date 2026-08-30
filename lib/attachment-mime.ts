/**
 * Pure MIME-classification shared by the server (lib/attachments.ts serving
 * decisions) and the browser components (preview rendering) so both can never
 * drift apart on what is safe to render inline. No Node built-ins here — this
 * file is imported by "use client" components.
 */

/**
 * MIME types that may be rendered inline in the browser without executing
 * scripts. Deliberately excludes image/svg+xml and any `image/*+xml` (stored
 * XSS: an SVG opened as a same-origin top-level document runs its inline
 * <script>), image/x-icon, text/html, etc.
 */
export const INLINE_SAFE_IMAGES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export type AttachmentPreviewKind = "image" | "pdf" | "text" | "audio" | "video" | "other";

/** How a stored mime type should be presented in the browser. Script-capable
 * or unrecognized types are "other" = download-only. */
export function previewKindFor(mime: string): AttachmentPreviewKind {
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return INLINE_SAFE_IMAGES.has(m) ? "image" : "other";
  if (m.startsWith("text/") && m !== "text/html") return "text";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "other";
}

/** Whether a mime type should render inline in the browser (vs. download). */
export function isInlinePreviewable(mime: string): boolean {
  return previewKindFor(mime) !== "other";
}
