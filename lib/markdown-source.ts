/** Source-level normalization of math delimiters, run before Markdown
 * parsing. The knowledge base is full of LaTeX copied from papers, book
 * notes and chat transcripts, which overwhelmingly uses the LaTeX-native
 * delimiters `\(…\)` (inline) and `\[…\]` (display). `remark-math` only
 * parses dollars, and the damage is not recoverable downstream: CommonMark
 * consumes `\` as an escape BEFORE the syntax tree exists (`\(` becomes the
 * bare text `(`), so by the time a remark plugin could run, the delimiters
 * are gone. The conversion therefore has to happen here, on the raw source.
 *
 * Two rewrites:
 * - `\(…\)` → `$…$`; a lone `\[…\]` that shares its line with other text
 *   also becomes inline `$…$` (it cannot be flow math in that position).
 * - A `\[…\]` alone on its line(s) → canonical `$$\n…\n$$` with the closing
 *   fence re-indented to the opener, so display math stays inside its list
 *   item. Single-line `$$…$$` gets the same promotion for the same reason.
 *
 * Never rewritten inside fenced code blocks or inline code spans — a
 * `` `\(x\)` `` example must keep showing its source. Limitation: 4-space
 * indented code blocks are not tracked (their indent is indistinguishable
 * from list continuation without a full block parser), so LaTeX delimiters
 * inside one are converted; fenced blocks are the form used in practice.
 */

interface Fence {
  tick: "`" | "~";
  size: number;
}

/** Length of the run of `tick` characters starting at `at`. */
function runLength(source: string, at: number, tick: string): number {
  let end = at;
  while (end < source.length && source[end] === tick) end += 1;
  return end - at;
}

/** Offset just past the next line ending (or EOF). */
function lineEnd(source: string, at: number): number {
  const nl = source.indexOf("\n", at);
  return nl === -1 ? source.length : nl;
}

/** Offset of the first character of the line containing `at`. */
function lineStart(source: string, at: number): number {
  const nl = source.lastIndexOf("\n", at - 1);
  return nl + 1;
}

/** True when every character in `[from, to)` is a space, tab or CR. */
function onlyBlank(source: string, from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) {
    const code = source[i];
    if (code !== " " && code !== "\t" && code !== "\r") return false;
  }
  return true;
}

/** True when `at` starts a line (or a fence / display block) — up to three
 * spaces of indent, since a tab already reaches column four, which is an
 * indented code block instead. */
function startsBlock(source: string, at: number): boolean {
  const start = lineStart(source, at);
  if (at - start > 3) return false;
  return onlyBlank(source, start, at);
}

function closesFence(line: string, fence: Fence): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  if (!match) return false;
  const run = match[1];
  return run[0] === fence.tick && run.length >= fence.size;
}

/** Index of the delimiter closing the math opened before `from`, or -1.
 * `\\` is content (an `aligned` line break), never a closer. */
function findCloser(source: string, from: number, closeChar: string): number {
  for (let i = from; i < source.length; i += 1) {
    if (source[i] !== "\\") continue;
    const next = source[i + 1];
    if (next === "\\") {
      i += 1;
      continue;
    }
    if (next === closeChar) return i;
  }
  return -1;
}

/** Canonical display math: `$$` fences on their own lines, content dedented
 * to the opener and the closer returned to the opener's indentation. */
function toDisplayMath(content: string, indent: string): string {
  const lines: string[] = [];
  for (const line of content.split("\n")) {
    lines.push(line.startsWith(indent) ? line.slice(indent.length) : line);
  }
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return `$$\n${lines.join("\n")}\n${indent}$$`;
}

export function normalizeMathDelimiters(source: string): string {
  // Nothing to do for the many bodies with neither a backslash nor `$$`.
  if (!source.includes("\\") && !source.includes("$$")) return source;

  let out = "";
  let i = 0;
  let fence: Fence | null = null;
  let codeTicks = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === "\n") {
      out += ch;
      i += 1;
      continue;
    }

    // Fenced code: copy whole lines verbatim until the closing fence.
    if (fence) {
      const end = lineEnd(source, i);
      const line = source.slice(i, end);
      out += line;
      if (closesFence(line, fence)) fence = null;
      i = end;
      continue;
    }

    // Fence opening: up to three spaces of indent, then ``` or ~~~. A
    // backtick fence's info string may not contain a backtick.
    if ((ch === "`" || ch === "~") && startsBlock(source, i)) {
      const size = runLength(source, i, ch);
      const rest = source.slice(i + size, lineEnd(source, i));
      if (size >= 3 && (ch === "~" || !rest.includes("`"))) {
        fence = { tick: ch, size };
        out += source.slice(i, lineEnd(source, i));
        i = lineEnd(source, i);
        continue;
      }
    }

    // Inline code spans: opened and closed by equal-length backtick runs.
    if (ch === "`") {
      const size = runLength(source, i, "`");
      if (codeTicks === 0) codeTicks = size;
      else if (size === codeTicks) codeTicks = 0;
      out += source.slice(i, i + size);
      i += size;
      continue;
    }
    if (codeTicks > 0) {
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "\\") {
      const next = source[i + 1];

      if (next === "\\") {
        out += "\\\\";
        i += 2;
        continue;
      }

      if (next === "(" || next === "[") {
        const close = findCloser(source, i + 2, next === "(" ? ")" : "]");
        if (close !== -1) {
          const content = source.slice(i + 2, close);
          const start = lineStart(source, i);
          const openAlone = onlyBlank(source, start, i);
          const closeAlone = onlyBlank(source, close + 2, lineEnd(source, close + 2));
          if (next === "(" || !(openAlone && closeAlone)) {
            out += `$${content}$`;
          } else {
            out += toDisplayMath(content, source.slice(start, i));
          }
          i = close + 2;
          continue;
        }
      }

      // Any other CommonMark escape (including a lone `\$`) and a trailing
      // backslash: keep the pair verbatim so the parser sees it unchanged.
      if (next !== undefined) {
        out += ch + next;
        i += 2;
        continue;
      }
    }

    // A `$$…$$` run alone on its line is display math by intent; promote it
    // to the canonical form so it centers instead of rendering inline.
    if (ch === "$") {
      const size = runLength(source, i, "$");
      if (size >= 2 && startsBlock(source, i)) {
        const end = lineEnd(source, i);
        const rest = source.slice(i + size, end);
        // First same-length run closes it; anything but blanks after it
        // means the line holds two expressions, not one display block.
        const closeAt = rest.indexOf("$".repeat(size));
        if (closeAt > 0 && onlyBlank(source, i + size + closeAt + size, end)) {
          const content = rest.slice(0, closeAt);
          out += toDisplayMath(content, source.slice(lineStart(source, i), i));
          i = end;
          continue;
        }
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}
