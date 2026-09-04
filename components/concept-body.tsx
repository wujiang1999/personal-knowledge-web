import Link from "next/link";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { embedWikiLinks, splitBodyBlocks } from "@/lib/links";

/** Render a concept body as Markdown (GFM: tables, strikethrough, task
 * lists). Raw HTML is not interpreted — react-markdown skips HTML nodes by
 * default, keeping the previous `<pre>` rendering's XSS-safe-by-construction
 * property. `[[标题]]` wiki references are embedded as `wiki:`-scheme links
 * (lib/links.ts `embedWikiLinks`) and resolved here against `titleToId`:
 * resolved targets link to the concept page; unresolved ones render as
 * dotted links that open the create form prefilled with the missing title
 * (Obsidian's click-to-create pattern). Block-level `![[标题]]` embeds are
 * transcluded from `embeds` (viewer-scoped bodies, depth 1 — nested embeds
 * render a placeholder, which also makes cycles impossible). Server
 * component — react-markdown never ships to the client bundle. */

interface BodyProps {
  body: string;
  titleToId: Map<string, string>;
  /** Resolved embed targets for `![[标题]]` blocks (title → current body).
   * Absent/missing titles render a dim placeholder instead of transcluding. */
  embeds?: Map<string, { id: string; body: string }>;
}

function renderAFor(titleToId: Map<string, string>) {
  return ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (href?.startsWith("wiki:")) {
      const title = decodeURIComponent(href.slice("wiki:".length));
      const targetId = titleToId.get(title.toLowerCase());
      if (targetId) {
        return (
          <Link
            href={`/knowledge/${targetId}`}
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {children}
          </Link>
        );
      }
      return (
        <Link
          href={`/knowledge/new?title=${encodeURIComponent(title)}`}
          className="text-zinc-400 underline decoration-dotted underline-offset-2 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          title="未找到同名条目，点击创建"
        >
          {children}
        </Link>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  };
}

// react-markdown's default URL sanitizer strips unknown schemes like
// `wiki:`; pass our own scheme through and sanitize everything else as
// usual.
const urlTransform = (url: string) =>
  url.startsWith("wiki:") ? url : defaultUrlTransform(url);

function MarkdownChunk({ body, titleToId }: { body: string; titleToId: Map<string, string> }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: renderAFor(titleToId) }} urlTransform={urlTransform}>
      {embedWikiLinks(body)}
    </ReactMarkdown>
  );
}

function EmbedBox({
  title,
  display,
  titleToId,
  embeds,
}: {
  title: string;
  display: string;
  titleToId: Map<string, string>;
  embeds?: Map<string, { id: string; body: string }>;
}) {
  const target = embeds?.get(title.toLowerCase());
  if (!target) {
    return (
      <div className="my-3 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-500">
        嵌入未找到：<span className="line-through">{display}</span>
        <Link
          href={`/knowledge/new?title=${encodeURIComponent(title)}`}
          className="ml-2 underline decoration-dotted"
          title="未找到同名条目，点击创建"
        >
          创建
        </Link>
      </div>
    );
  }
  return (
    <div className="my-3 rounded-md border-l-4 border-zinc-300 bg-zinc-50 py-2 pl-3 pr-2 dark:border-zinc-600 dark:bg-zinc-800/60">
      <p className="mb-1 text-xs text-zinc-400 dark:text-zinc-500">
        <Link href={`/knowledge/${target.id}`} className="font-medium hover:underline">
          📄 {display}
        </Link>
        <span className="ml-1">· 嵌入</span>
      </p>
      <div className="prose prose-sm prose-zinc max-w-none dark:prose-invert [&>pre]:overflow-x-auto">
        {/* Depth 1: nested embeds render as placeholders (embeds=undefined),
         * which also makes reference cycles impossible. */}
        <MarkdownBlocks body={target.body} titleToId={titleToId} embeds={undefined} />
      </div>
    </div>
  );
}

function MarkdownBlocks({ body, titleToId, embeds }: BodyProps) {
  const blocks = splitBodyBlocks(body);
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "markdown" ? (
          <MarkdownChunk key={i} body={b.text} titleToId={titleToId} />
        ) : (
          <EmbedBox key={i} title={b.title} display={b.display} titleToId={titleToId} embeds={embeds} />
        )
      )}
    </>
  );
}

export function ConceptBody({ body, titleToId, embeds }: BodyProps) {
  return (
    <div className="prose prose-sm prose-zinc max-w-none rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 dark:prose-invert [&>pre]:overflow-x-auto">
      <MarkdownBlocks body={body} titleToId={titleToId} embeds={embeds} />
    </div>
  );
}
