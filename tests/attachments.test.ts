import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isInlinePreviewable,
  safeContentType,
  sniffMime,
  validateDeclaredMime,
} from "../lib/attachments";
import { previewKindFor } from "../lib/attachment-mime";

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

describe("previewKindFor", () => {
  it("classifies renderable kinds", () => {
    expect(previewKindFor("image/png")).toBe("image");
    expect(previewKindFor("application/pdf")).toBe("pdf");
    expect(previewKindFor("text/plain")).toBe("text");
    expect(previewKindFor("audio/mpeg")).toBe("audio");
    expect(previewKindFor("video/mp4")).toBe("video");
  });

  it("is download-only exactly when inline preview is refused", () => {
    // The client UI derives its preview buttons from this function; the
    // server refuses inline for the same set. SVG used to drift (UI offered
    // an <img> preview the server answered with a download).
    for (const m of ["image/svg+xml", "text/html", "image/x-icon", "image/tiff", "application/zip", ""]) {
      expect(previewKindFor(m)).toBe("other");
      expect(isInlinePreviewable(m)).toBe(false);
    }
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

describe("parameterized MIME cannot smuggle a script-capable type", () => {
  // Regression: every safety check is exact-equality or a prefix test, so a
  // trailing `; charset=…` used to carry text/html past the blocklist, get
  // stored, and then be served inline — same-origin script execution.
  const HTML_DOC = Buffer.from("<html><script>alert(document.cookie)</script></html>");

  it("downgrades text/html regardless of parameters", () => {
    expect(validateDeclaredMime("text/html; charset=utf-8", HTML_DOC)).toEqual({
      mime: "application/octet-stream",
    });
    expect(validateDeclaredMime("TEXT/HTML;charset=UTF-8", HTML_DOC)).toEqual({
      mime: "application/octet-stream",
    });
  });

  it("downgrades svg / xml / xhtml with parameters", () => {
    expect(validateDeclaredMime("image/svg+xml; charset=utf-8", SVG_HEAD).mime).toBe(
      "application/octet-stream",
    );
    expect(validateDeclaredMime("application/xml; charset=utf-8", HTML_DOC).mime).toBe(
      "application/octet-stream",
    );
    expect(validateDeclaredMime("application/xhtml+xml; charset=utf-8", HTML_DOC).mime).toBe(
      "application/octet-stream",
    );
  });

  it("still sniffs a bitmap declared with parameters", () => {
    expect(validateDeclaredMime("image/png; charset=binary", PNG_HEAD)).toEqual({
      mime: "image/png",
    });
    // parameters must not defeat the content match either
    expect(validateDeclaredMime("image/png; charset=binary", JPEG_HEAD).error).toBeTruthy();
  });

  it("stores the bare base type so serve and validate agree", () => {
    expect(validateDeclaredMime("text/plain; charset=utf-8", Buffer.from("hi"))).toEqual({
      mime: "text/plain",
    });
    expect(validateDeclaredMime("video/mp4; codecs=avc1", Buffer.alloc(64))).toEqual({
      mime: "video/mp4",
    });
  });

  it("serves a pre-existing parameterized row as a forced download", () => {
    // Rows written before normalization can still hold the parameterized form;
    // the serve path must not trust the stored string.
    expect(safeContentType("text/html; charset=utf-8")).toBe("application/octet-stream");
    expect(isInlinePreviewable("text/html; charset=utf-8")).toBe(false);
    expect(previewKindFor("image/svg+xml; charset=utf-8")).toBe("other");
  });

  it("fails closed on malformed MIME", () => {
    expect(safeContentType("; charset=utf-8")).toBe("application/octet-stream");
    expect(safeContentType("text/html")).toBe("application/octet-stream");
    expect(isInlinePreviewable("nonsense")).toBe(false);
    expect(isInlinePreviewable("")).toBe(false);
    expect(validateDeclaredMime("text/html; charset=utf-8; boundary=x", HTML_DOC).mime).toBe(
      "application/octet-stream",
    );
  });
});

describe("per-user attachment quota clamp", () => {
  // MAX_TOTAL_ATTACHMENT_BYTES is computed at module load from process.env, so
  // each case needs a fresh import — a static import cannot observe the clamp
  // (the test-load-boundary exception). The prior assertion here compared two
  // module constants and could not fail: the value is either clamped by the
  // guard or the 2 GiB default. These pin the clamp itself.
  async function quotaWith(value: string | undefined) {
    vi.resetModules();
    if (value === undefined) delete process.env.MAX_TOTAL_ATTACHMENT_BYTES;
    else process.env.MAX_TOTAL_ATTACHMENT_BYTES = value;
    const m = await import("../lib/attachments");
    return { total: m.MAX_TOTAL_ATTACHMENT_BYTES, perFile: m.MAX_ATTACHMENT_BYTES };
  }

  afterEach(() => {
    delete process.env.MAX_TOTAL_ATTACHMENT_BYTES;
  });

  it("defaults to 2 GiB when unset", async () => {
    const { total } = await quotaWith(undefined);
    expect(total).toBe(2 * 1024 * 1024 * 1024);
  });

  it("honours a configured quota above the per-file cap", async () => {
    const { total } = await quotaWith(String(20 * 1024 * 1024 * 1024));
    expect(total).toBe(20 * 1024 * 1024 * 1024);
  });

  it("falls back to the default rather than a below-file-cap quota", async () => {
    // A quota smaller than one file would reject every upload; clamp instead.
    const { total, perFile } = await quotaWith("1024");
    expect(total).toBe(2 * 1024 * 1024 * 1024);
    expect(total).toBeGreaterThan(perFile);
  });

  it("falls back to the default on a non-numeric or fractional value", async () => {
    expect((await quotaWith("abc")).total).toBe(2 * 1024 * 1024 * 1024);
    expect((await quotaWith("1.5")).total).toBe(2 * 1024 * 1024 * 1024);
  });
});
