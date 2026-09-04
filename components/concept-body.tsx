import Link from "next/link";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { embedWikiLinks } from "@/lib/links";

/** Render a concept body as Markdown (GFM: tables, strikethrough, task
 * lists). Raw HTML is not interpreted — react-markdown skips HTML nodes by
 * default, keeping the previous `<pre>` rendering's XSS-safe-by-construction
 * property. `[[标题]]` wiki references are embedded as `wiki:`-scheme links
 * (lib/links.ts `embedWikiLinks`) and resolved here against `titleToId`:
 * resolved targets link to the concept page; unresolved ones render as
 * dotted links that open the create form prefilled with the missing title
 * (Obsidian's click-to-create pattern). Server component — react-markdown
 * never ships to the client bundle. */
export function ConceptBody({
  body,
  titleToId,
}: {
  body: string;
  titleToId: Map<string, string>;
}) {
  const renderA = ({ href, children }: { href?: string; children?: React.ReactNode }) => {
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

  // react-markdown's default URL sanitizer strips unknown schemes like
  // `wiki:`; pass our own scheme through and sanitize everything else as
  // usual.
  const urlTransform = (url: string) =>
    url.startsWith("wiki:") ? url : defaultUrlTransform(url);

  return (
    <div className="prose prose-sm prose-zinc max-w-none rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 dark:prose-invert [&>pre]:overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: renderA }} urlTransform={urlTransform}>
        {embedWikiLinks(body)}
      </ReactMarkdown>
    </div>
  );
}
