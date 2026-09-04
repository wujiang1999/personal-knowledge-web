/** Wiki-style cross-references between concepts: bodies may mention other
 * entries as `[[标题]]`. The book ("深入理解 AI Agent" §3.3.2) calls for a
 * Wikipedia-like bidirectional link network so knowledge doesn't decay into
 * isolated islands — this module is the parsing side; rendering lives in
 * components/concept-body.tsx and backlink lookup in lib/concepts.ts. */

export interface WikiLinkRef {
  /** Link target — the concept title to resolve. Pure: any `|display` alias
   * suffix is stripped here so every downstream lookup (title→id maps,
   * backlink patterns, curate) sees the real title, never the alias text. */
  title: string;
  /** Rendered text. Equals the target when no `|alias` is written. */
  display: string;
  /** Index of the opening `[` in the source text. */
  start: number;
  /** Index one past the closing `]`. */
  end: number;
}

/** `[[...]]` matcher: no nesting, no line breaks inside, length-capped so a
 * runaway `[[` in pasted text cannot build a huge candidate. */
const WIKI_LINK_RE = /\[\[([^\[\]\n]{1,200})\]\]/g;

/** Extract every wiki link in the text, in order of appearance. The target
 * is trimmed; an optional `|display` alias (Obsidian-style) splits at the
 * first `|` — the target stays pure, the alias only affects rendering, and
 * an empty alias falls back to the target. Whitespace-only targets drop. */
export function parseWikiLinks(text: string): WikiLinkRef[] {
  const out: WikiLinkRef[] = [];
  for (const m of text.matchAll(WIKI_LINK_RE)) {
    const inner = m[1];
    const bar = inner.indexOf("|");
    const title = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    if (!title) continue;
    const display = bar === -1 ? title : inner.slice(bar + 1).trim() || title;
    out.push({ title, display, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "link"; title: string; display: string; targetId: string | null };

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
      display: ref.display,
      targetId: titleToId.get(ref.title.toLowerCase()) ?? null,
    });
    cursor = ref.end;
  }
  if (cursor < body.length) {
    segments.push({ kind: "text", text: body.slice(cursor) });
  }
  return segments;
}

/** Replace every `[[标题]]` in `body` with a Markdown link whose destination
 * is the `wiki:` scheme + percent-encoded title. Rendering resolves the
 * scheme against a title→id map (components/concept-body.tsx); unresolvable
 * references render dim. Titles cannot contain `]` (WIKI_LINK_RE), so the
 * link syntax is unambiguous; encodeURIComponent strips spaces/parens from
 * the destination so no `<...>` wrapping is needed. Link text backslash-
 * escapes Markdown inline specials so a title like `a*b` cannot start
 * emphasis. */
export function embedWikiLinks(body: string): string {
  const refs = parseWikiLinks(body);
  if (refs.length === 0) return body;
  let out = "";
  let cursor = 0;
  for (const ref of refs) {
    out += body.slice(cursor, ref.start);
    out += `[${ref.display.replace(/([\\`*_[\]])/g, "\\$1")}](wiki:${encodeURIComponent(ref.title)})`;
    cursor = ref.end;
  }
  out += body.slice(cursor);
  return out;
}
