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
  /** True for `![[标题]]` embed refs. Embeds are references too: they count
   * for outgoing-link panels, backlinks and the graph, and render as
   * transclusion blocks when they sit alone on their line. */
  embed: boolean;
  /** Index of the opening `[` in the source text (the `!` is one before). */
  start: number;
  /** Index one past the closing `]`. */
  end: number;
}

/** Shared alias split: `target` before the first `|`, `display` after (falls
 * back to the target when the alias is empty). Null when nothing usable. */
function splitRefInner(inner: string): { title: string; display: string } | null {
  const bar = inner.indexOf("|");
  const title = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  if (!title) return null;
  const display = bar === -1 ? title : inner.slice(bar + 1).trim() || title;
  return { title, display };
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
    const ref = splitRefInner(m[1]);
    if (!ref) continue;
    out.push({ ...ref, embed: m.index > 0 && text[m.index - 1] === "!", start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "link"; title: string; display: string; embed: boolean; targetId: string | null };

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
      embed: ref.embed,
      targetId: titleToId.get(ref.title.toLowerCase()) ?? null,
    });
    cursor = ref.end;
  }
  if (cursor < body.length) {
    segments.push({ kind: "text", text: body.slice(cursor) });
  }
  return segments;
}

export type BodyBlock =
  | { kind: "markdown"; text: string }
  | { kind: "embed"; title: string; display: string };

const EMBED_LINE_RE = /^\s*!\[\[([^\[\]\n]{1,200})\]\]\s*$/;

/** Split a body into markdown chunks and BLOCK-LEVEL embeds: a `![[标题]]`
 * that sits alone on its line (surrounding whitespace only) becomes an
 * embed block; any other `![[…]]` stays inline markdown (renderers degrade
 * it to a labeled link). Fence-aware: lines inside ``` / ~~~ fences never
 * split, so embeds pasted into code samples stay literal. Chunks preserve
 * the original text losslessly — embed lines are consumed whole. */
export function splitBodyBlocks(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    if (buf.length) {
      blocks.push({ kind: "markdown", text: buf.join("\n") });
      buf = [];
    }
  };
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      buf.push(line);
      continue;
    }
    const m = inFence ? undefined : EMBED_LINE_RE.exec(line);
    if (!m) {
      buf.push(line);
      continue;
    }
    const ref = splitRefInner(m[1]);
    if (!ref) {
      buf.push(line);
      continue;
    }
    flush();
    blocks.push({ kind: "embed", ...ref });
  }
  flush();
  return blocks;
}

/** Replace every `[[标题]]` in `body` with a Markdown link whose destination
 * is the `wiki:` scheme + percent-encoded title. Rendering resolves the
 * scheme against a title→id map (components/concept-body.tsx); unresolvable
 * references render dim. Titles cannot contain `]` (WIKI_LINK_RE), so the
 * link syntax is unambiguous; encodeURIComponent strips spaces/parens from
 * the destination so no `<...>` wrapping is needed. Link text backslash-
 * escapes Markdown inline specials so a title like `a*b` cannot start
 * emphasis. Inline `![[标题]]` embeds degrade to a 📄-labeled link (block
 * embeds never reach this function — splitBodyBlocks consumes them). */
export function embedWikiLinks(body: string): string {
  const refs = parseWikiLinks(body);
  if (refs.length === 0) return body;
  let out = "";
  let cursor = 0;
  for (const ref of refs) {
    // An embed ref consumes its leading "!"; the label carries the 📄 mark.
    const from = ref.embed && body[ref.start - 1] === "!" ? ref.start - 1 : ref.start;
    out += body.slice(cursor, from);
    const label = (ref.embed ? "📄 " : "") + ref.display;
    out += `[${label.replace(/([\\`*_[\]])/g, "\\$1")}](wiki:${encodeURIComponent(ref.title)})`;
    cursor = ref.end;
  }
  out += body.slice(cursor);
  return out;
}

/** Shorter titles are pure noise for mention scanning: every two-character
 * fragment of a longer word would "mention" them. Shared by the concept
 * detail page and the curate report. */
export const MIN_MENTION_TITLE_CHARS = 2;

/** Escape RegExp metacharacters so a concept title can be embedded in a
 * pattern. Titles are arbitrary user text (`a*b`, `C++`, `(草稿)`, `x[1]`),
 * and `findBacklinks` builds a PostgreSQL `~*` pattern from them. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Offset of the first genuine *unlinked* mention of `title` in `body`, or -1.
 *
 * One predicate, two consumers (concept detail page's 未链接提及 panel and
 * `npm run curate` §5). They had drifted apart:
 *  - the detail-page copy tested `body.slice(idx-2, idx) !== "[["`, so an
 *    Obsidian-style `[[ 标题 ]]` — which `splitRefInner` trims and therefore
 *    renders as a real link — was reported as an *unlinked* mention;
 *  - the curate copy skipped a body wholesale on `body.includes("[[" + title)`,
 *    so one linked occurrence hid every other stray mention in the same note.
 *
 * Spans come from `parseWikiLinks`, so plain / alias (`[[标题|别名]]`) / embed
 * (`![[标题]]`) / whitespace-padded forms are all recognised as linked. ASCII
 * titles additionally require a non-alphanumeric neighbour on both sides, so
 * "AI" cannot match inside "AISLE"; CJK has no word delimiters, so the check
 * does not apply to it. */
export function findUnlinkedMentionOffset(body: string, title: string): number {
  const needle = title.trim();
  if (needle.length < MIN_MENTION_TITLE_CHARS) return -1;

  const lowerBody = body.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  if (!lowerBody.includes(lowerNeedle)) return -1;

  const linkedSpans = parseWikiLinks(body);
  const ascii = isAsciiTitle(needle);

  let idx = lowerBody.indexOf(lowerNeedle);
  while (idx !== -1) {
    const end = idx + lowerNeedle.length;
    const insideLink = linkedSpans.some((r) => idx >= r.start && end <= r.end);
    if (!insideLink) {
      if (!ascii) return idx;
      const before = idx > 0 ? lowerBody[idx - 1] : " ";
      const after = end < lowerBody.length ? lowerBody[end] : " ";
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return idx;
    }
    idx = lowerBody.indexOf(lowerNeedle, idx + 1);
  }
  return -1;
}

/** Pure-ASCII titles are the ones that need word-boundary handling; CJK and
 * other scripts have no delimiter to respect. */
function isAsciiTitle(title: string): boolean {
  return /^[\x20-\x7e]+$/.test(title);
}
