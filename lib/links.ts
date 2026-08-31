/** Wiki-style cross-references between concepts: bodies may mention other
 * entries as `[[标题]]`. The book ("深入理解 AI Agent" §3.3.2) calls for a
 * Wikipedia-like bidirectional link network so knowledge doesn't decay into
 * isolated islands — this module is the parsing side; rendering lives in
 * components/concept-body.tsx and backlink lookup in lib/concepts.ts. */

export interface WikiLinkRef {
  /** The referenced title, trimmed (never empty, at most 200 chars). */
  title: string;
  /** Index of the opening `[` in the source text. */
  start: number;
  /** Index one past the closing `]`. */
  end: number;
}

/** `[[...]]` matcher: no nesting, no line breaks inside, length-capped so a
 * runaway `[[` in pasted text cannot build a huge candidate. */
const WIKI_LINK_RE = /\[\[([^\[\]\n]{1,200})\]\]/g;

/** Extract every wiki link in the text, in order of appearance. Titles are
 * trimmed; whitespace-only references are dropped. */
export function parseWikiLinks(text: string): WikiLinkRef[] {
  const out: WikiLinkRef[] = [];
  for (const m of text.matchAll(WIKI_LINK_RE)) {
    const title = m[1].trim();
    if (!title) continue;
    out.push({ title, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "link"; title: string; targetId: string | null };

/** Split a body into text/link segments for rendering. `titleToId` maps
 * lowercased titles of concepts visible to the viewer; links without a match
 * stay segments with `targetId: null` so the UI can render them dim instead
 * of pretending to navigate. */
export function segmentBodyWithLinks(
  body: string,
  titleToId: Map<string, string>
): BodySegment[] {
  const refs = parseWikiLinks(body);
  if (refs.length === 0) return [{ kind: "text", text: body }];

  const segments: BodySegment[] = [];
  let cursor = 0;
  for (const ref of refs) {
    if (ref.start > cursor) {
      segments.push({ kind: "text", text: body.slice(cursor, ref.start) });
    }
    segments.push({
      kind: "link",
      title: ref.title,
      targetId: titleToId.get(ref.title.toLowerCase()) ?? null,
    });
    cursor = ref.end;
  }
  if (cursor < body.length) {
    segments.push({ kind: "text", text: body.slice(cursor) });
  }
  return segments;
}
