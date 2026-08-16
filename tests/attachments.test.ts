import { describe, expect, it } from "vitest";
import {
  isInlinePreviewable,
  safeContentType,
  sniffMime,
  validateDeclaredMime,
} from "../lib/attachments";

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PDF_HEAD = Buffer.from("%PDF-1.7 hello");
const SVG_HEAD = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("isInlinePreviewable", () => {
  it("allows safe bitmaps and pdf", () => {
    expect(isInlinePreviewable("image/png")).toBe(true);
    expect(isInlinePreviewable("image/jpeg")).toBe(true);
    expect(isInlinePreviewable("image/webp")).toBe(true);
    expect(isInlinePreviewable("application/pdf")).toBe(true);
  });

  it("never inlines svg / html / xml / ico", () => {
    expect(isInlinePreviewable("image/svg+xml")).toBe(false);
    expect(isInlinePreviewable("text/html")).toBe(false);
    expect(isInlinePreviewable("image/x-icon")).toBe(false);
    expect(isInlinePreviewable("image/tiff")).toBe(false);
  });
});

describe("safeContentType", () => {
  it("downgrades script-capable and unknown images to octet-stream", () => {
    expect(safeContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(safeContentType("image/x-icon")).toBe("application/octet-stream");
    expect(safeContentType("image/tiff")).toBe("application/octet-stream");
    expect(safeContentType("text/html")).toBe("application/octet-stream");
  });

  it("passes safe types through", () => {
    expect(safeContentType("image/png")).toBe("image/png");
    expect(safeContentType("application/pdf")).toBe("application/pdf");
    expect(safeContentType("text/plain")).toBe("text/plain");
  });
});

describe("sniffMime", () => {
  it("detects png / jpeg / pdf", () => {
    expect(sniffMime(PNG_HEAD)).toBe("image/png");
    expect(sniffMime(JPEG_HEAD)).toBe("image/jpeg");
    expect(sniffMime(PDF_HEAD)).toBe("application/pdf");
  });

  it("returns null for svg and unrecognized bytes", () => {
    expect(sniffMime(SVG_HEAD)).toBeNull();
    expect(sniffMime(Buffer.from("plain text"))).toBeNull();
  });
});

describe("validateDeclaredMime", () => {
  it("accepts a bitmap whose content matches", () => {
    expect(validateDeclaredMime("image/png", PNG_HEAD)).toEqual({ mime: "image/png" });
  });

  it("rejects a bitmap whose content does not match", () => {
    expect(validateDeclaredMime("image/png", JPEG_HEAD).error).toBeTruthy();
    expect(validateDeclaredMime("application/pdf", PNG_HEAD).error).toBeTruthy();
  });

  it("downgrades svg to octet-stream regardless of content", () => {
    expect(validateDeclaredMime("image/svg+xml", SVG_HEAD)).toEqual({
      mime: "application/octet-stream",
    });
  });

  it("downgrades non-whitelisted images", () => {
    expect(validateDeclaredMime("image/tiff", PNG_HEAD)).toEqual({
      mime: "application/octet-stream",
    });
  });

  it("accepts pdf only with a matching header", () => {
    expect(validateDeclaredMime("application/pdf", PDF_HEAD)).toEqual({
      mime: "application/pdf",
    });
  });

  it("accepts text and media types as declared", () => {
    expect(validateDeclaredMime("text/markdown", Buffer.from("# hi"))).toEqual({
      mime: "text/markdown",
    });
    expect(validateDeclaredMime("video/mp4", Buffer.alloc(64))).toEqual({ mime: "video/mp4" });
  });
});