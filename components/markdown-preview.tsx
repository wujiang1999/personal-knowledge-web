"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { remarkPlugins, rehypePlugins } from "@/lib/markdown";
import { embedWikiLinks } from "@/lib/links";
import type { EditorTitle, PreviewProps } from "./markdown-editor";

/** Client-side draft preview with the same wiki-link semantics as the
 * server-rendered ConceptBody: `[[标题]]` resolves against the loaded
 * titles, `![[标题]]` embeds render as 📄 links (resolved transclusion is
 * the detail page's job), and `$…$` / `$$…$$` render as KaTeX exactly like
 * the detail page (shared pipeline, lib/markdown.ts). Loaded lazily by
 * MarkdownEditor on first 预览. */
export function MarkdownPreview({ body, getTitles }: PreviewProps) {
  const [titleToId, setTitleToId] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let alive = true;
    getTitles()
      .then((titles: EditorTitle[]) => {
        if (!alive) return;
        setTitleToId(new Map(titles.map((t) => [t.title.toLowerCase(), t.id])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [getTitles]);

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
        <span
          className="text-zinc-400 underline decoration-dotted underline-offset-2"
          title="未找到同名条目"
        >
          {children}
        </span>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  };

  const urlTransform = (url: string) =>
    url.startsWith("wiki:") ? url : defaultUrlTransform(url);

  return (
    <div className="min-h-[380px] overflow-auto rounded-md border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="prose prose-sm prose-zinc max-w-none dark:prose-invert [&>pre]:overflow-x-auto [&>.katex-display]:overflow-x-auto">
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={{ a: renderA }}
          urlTransform={urlTransform}
        >
          {embedWikiLinks(body)}
        </ReactMarkdown>
      </div>
    </div>
  );
}
