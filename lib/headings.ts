/** ATX heading discovery over a markdown body, used to label a hit with the
 * section it lives in ("第4章 > 4.2 检索") instead of a character window.
 *
 * The scan is deliberately fence-aware. Bodies in this KB are full of fenced
 * code whose lines start with `#` (shell comments, `# 启动服务`), and a naive
 * /^#+/ line scan reports those as headings — the same trap lib/chunks.ts
 * avoids by only splitting on blank lines. Headings inside fenced blocks are
 * ignored; indented code is ignored for free because ATX headings allow at
 * most three leading spaces (CommonMark), the rule both checks below encode.
 *
 * Offsets are UTF-16 indices into the *current* body, so callers must resolve
 * them against the version they read the offset from (search anchors and chunk
 * offsets both come from the current version).
 *
 * This runs once per search result and once per ask source, so the line loop
 * reads characters directly and only slices the handful of lines that actually
 * start a fence or a heading.
 */

export interface Heading {
  level: number;
  text: string;
  /** Offset of the heading's first character. */
  startOffset: number;
}

/** ATX heading: 1–6 `#`, then a space or end of line. */
const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;

/** True when the body's first non-blank line is an H1 that repeats the title.
 *
 * Every surface that renders an entry shows the title itself (detail page
 * header, exported `# title` wrapper), so a body that opens with the same H1
 * renders one heading twice. Callers use this to avoid adding a second one
 * (lib/okf.ts) and to report the redundancy at its source (`npm run curate`).
 * Comparison ignores case and collapses internal whitespace, because the
 * duplicate is semantic, not byte-level. */
export function opensWithTitleHeading(body: string, title: string): boolean {
  // Whitespace is dropped entirely rather than collapsed: these titles are
  // mostly CJK ("部署笔记" vs "部署 笔记"), where a stray space is a typo, not
  // a different heading.
  const wanted = title.replace(/\s+/g, "").toLowerCase();
  if (!wanted) return false;
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    const heading = /^ {0,3}#[ \t]+(.*?)[ \t]*$/.exec(line);
    if (!heading) return false;
    return heading[1].replace(/\s+/g, "").toLowerCase() === wanted;
  }
  return false;
}

/** The heading path in effect at `offset`: the deepest heading at or above the
 * offset, preceded by its ancestors (text only — levels drive the nesting but
 * are not part of the label). Empty when the region has no heading above it:
 * a body that is untitled prose, or a hit in the preamble before the first
 * `#`. A leading H1 that merely repeats the entry title is *not* filtered out
 * — the label reports what the body says, and `npm run curate` reports the
 * redundancy itself. */
export function headingPathAt(body: string, offset: number): string[] {
  const clamped = Math.max(0, Math.min(Math.trunc(offset), body.length));
  const stack: Heading[] = [];
  let fence: { char: string; length: number } | null = null;
  let at = 0;

  for (;;) {
    const newline = body.indexOf("\n", at);
    const end = newline === -1 ? body.length : newline;
    if (at > clamped) break;

    // Up to three leading spaces; more makes it indented code, never a marker.
    let i = at;
    while (i < end && body[i] === " ") i++;
    const marker = i - at <= 3 && i < end ? body[i] : "";

    if (marker === "`" || marker === "~") {
      const line = body.slice(at, end);
      const run = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (run) {
        const char = run[1][0];
        const length = run[1].length;
        const trailing = run[2];
        if (!fence) {
          // A backtick fence's info string must not contain a backtick; a line
          // like "```js`x" is paragraph text, not a fence opener.
          if (char !== "`" || !trailing.includes("`")) fence = { char, length };
        } else if (char === fence.char && length >= fence.length && trailing.trim() === "") {
          fence = null;
        }
      }
    } else if (marker === "#" && !fence) {
      const heading = HEADING_RE.exec(body.slice(at, end));
      if (heading) {
        const level = heading[1].length;
        // Strip a CommonMark closing sequence ("## 标题 ##").
        const text = (heading[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
        while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
        stack.push({ level, text: text || "#".repeat(level), startOffset: at });
      }
    }

    if (newline === -1) break;
    at = newline + 1;
  }

  return stack.map((h) => h.text);
}
