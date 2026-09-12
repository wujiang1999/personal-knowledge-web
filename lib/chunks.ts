/**
 * Deterministic, source-offset-preserving markdown chunks.  Offsets are JS
 * UTF-16 string offsets, suitable for JavaScript `slice()` in the web UI.
 * PostgreSQL character offsets use a different unit for astral Unicode, so
 * database consumers should return these stored offsets to JavaScript rather
 * than try to recompute them in SQL. Every source character belongs to at
 * least one chunk; neighboring chunks intentionally overlap for context.
 */
export interface ConceptChunk {
  ordinal: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

export const CHUNK_TARGET_CHARS = 1800;
export const CHUNK_OVERLAP_CHARS = 200;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Keep UTF-16 boundaries outside an astral-code-point surrogate pair. */
function safeEndOffset(body: string, offset: number): number {
  return offset > 0 && offset < body.length &&
    isHighSurrogate(body.charCodeAt(offset - 1)) && isLowSurrogate(body.charCodeAt(offset))
    ? offset + 1
    : offset;
}

function safeStartOffset(body: string, offset: number): number {
  return offset > 0 && offset < body.length &&
    isHighSurrogate(body.charCodeAt(offset - 1)) && isLowSurrogate(body.charCodeAt(offset))
    ? offset - 1
    : offset;
}

/**
 * Prefer blank-line boundaries close to the target size, falling back to a
 * hard window for a single overlong paragraph.  The next window begins about
 * `overlapChars` before the previous end, so a paragraph that crosses a
 * boundary remains searchable with its surrounding context.
 */
export function splitConceptBody(
  body: string,
  targetChars = CHUNK_TARGET_CHARS,
  overlapChars = CHUNK_OVERLAP_CHARS,
): ConceptChunk[] {
  if (!body) return [{ ordinal: 0, startOffset: 0, endOffset: 0, text: "" }];
  const target = Math.max(1, Math.trunc(targetChars));
  const overlap = Math.max(0, Math.min(target - 1, Math.trunc(overlapChars)));
  const out: ConceptChunk[] = [];
  let start = 0;

  while (start < body.length) {
    const targetEnd = Math.min(body.length, start + target);
    let end = targetEnd;
    if (targetEnd < body.length) {
      // A paragraph boundary is two newlines. Do not let a very early
      // boundary create tiny chunks merely because the preceding chunk ended
      // near it; hard-split an exceptional long paragraph instead.
      const paragraphBoundary = body.lastIndexOf("\n\n", targetEnd);
      if (paragraphBoundary >= start + Math.floor(target / 2)) {
        end = paragraphBoundary + 2;
      }
    }
    if (end <= start) end = Math.min(body.length, start + target);
    end = safeEndOffset(body, end);
    out.push({ ordinal: out.length, startOffset: start, endOffset: end, text: body.slice(start, end) });
    if (end >= body.length) break;

    const overlapStart = Math.max(start + 1, end - overlap);
    // Start at the preceding paragraph boundary when possible. This can make
    // the overlap larger than the nominal 200 characters, but never loses a
    // paragraph tail and keeps normal markdown paragraphs intact.
    const priorBoundary = body.lastIndexOf("\n\n", overlapStart);
    start = safeStartOffset(body, priorBoundary >= start ? priorBoundary + 2 : overlapStart);
  }
  return out;
}

/** Include stable concept metadata in each vector without truncating body text. */
export function chunkEmbeddingText(title: string, description: string | null, chunk: ConceptChunk): string {
  return `${title}\n${description ?? ""}\n${chunk.text}`;
}

/** Used before publishing an async embedding result after a later save. */
export function embeddingSourceMatches(
  current: { contentHash: string; title: string; description: string | null },
  expected: { contentHash: string; title: string; description: string | null },
): boolean {
  return (
    current.contentHash === expected.contentHash &&
    current.title === expected.title &&
    current.description === expected.description
  );
}

/** Reusable completeness predicate for backfill. Any endpoint, model,
 * dimensions, source metadata, offset, or text mismatch forces a rebuild. */
export function chunkProfileMatches(
  row: {
    contentHash: string;
    title: string;
    description: string | null;
    endpoint: string;
    model: string;
    dimensions: number;
    startOffset: number;
    endOffset: number;
    text: string;
  },
  source: { contentHash: string; title: string; description: string | null },
  space: { endpoint: string; model: string; dimensions: number },
  chunk: ConceptChunk,
): boolean {
  return (
    row.contentHash === source.contentHash &&
    row.title === source.title &&
    row.description === source.description &&
    row.endpoint === space.endpoint &&
    row.model === space.model &&
    row.dimensions === space.dimensions &&
    row.startOffset === chunk.startOffset &&
    row.endOffset === chunk.endOffset &&
    row.text === chunk.text
  );
}
