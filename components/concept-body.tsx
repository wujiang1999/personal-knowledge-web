import Link from "next/link";
import { segmentBodyWithLinks, type BodySegment } from "@/lib/links";

/** Render a concept body as preserved plain text (`<pre>` semantics: no HTML
 * interpretation, XSS-safe by construction) while turning `[[标题]]` wiki
 * references into navigable links. Resolved targets link to the concept page;
 * unresolved ones render dimmed so the reader sees a broken reference instead
 * of silent text. */
export function ConceptBody({
  body,
  titleToId,
}: {
  body: string;
  titleToId: Map<string, string>;
}) {
  const segments: BodySegment[] = segmentBodyWithLinks(body, titleToId);
  return (
    <pre className="whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-white p-4 text-sm leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
      {segments.map((seg, i) => {
        if (seg.kind === "text") return seg.text;
        if (seg.targetId) {
          return (
            <Link
              key={i}
              href={`/knowledge/${seg.targetId}`}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              [[{seg.title}]]
            </Link>
          );
        }
        return (
          <span
            key={i}
            className="text-zinc-400 line-through decoration-zinc-300 dark:text-zinc-500"
            title="未找到同名条目"
          >
            [[{seg.title}]]
          </span>
        );
      })}
    </pre>
  );
}
