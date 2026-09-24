/** Shared markdown pipeline for every rendered body — concept detail pages,
 * transcluded embeds, ask answers, and the editor preview all run through it
 * so they cannot drift apart. GFM (tables, task lists, strikethrough) plus
 * math: `remark-math` parses `$…$` (inline) and fenced `$$…$$` (block), and
 * `rehype-katex` renders both to KaTeX HTML at render time — no client JS.
 *
 * Single-dollar inline math is deliberately ON (Obsidian/Pandoc convention):
 * it also means paired plain-text dollars (`价格 $5，优惠 $3`, `$HOME … $PATH`)
 * parse as math; authors escape with a backtick span or `\$`.
 *
 * Importing the stylesheet here means anywhere the pipeline is used the CSS
 * (and its fonts, bundled by Next — no CDN) comes with it. */
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Options as MarkdownOptions } from "react-markdown";
import "katex/dist/katex.min.css";

// react-markdown types its plugin lists as unified's PluggableList but does
// not re-export it; derive from the public Options type instead of importing
// the undeclared transitive `unified` package.
type PluginList = NonNullable<MarkdownOptions["remarkPlugins"]>;

export const remarkPlugins: PluginList = [remarkGfm, remarkMath];

/** `throwOnError: false` — a malformed formula renders its source in red
 * instead of taking the whole page down (server render would otherwise throw).
 * `strict: false` — tolerate the lenient LaTeX people paste from other tools
 * rather than painting the entire formula red over a warning-level nit. */
export const rehypePlugins: PluginList = [
  [rehypeKatex, { throwOnError: false, strict: false }],
];
