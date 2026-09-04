import { NextResponse } from "next/server";
import { listConceptsForExport } from "@/lib/concepts";
import { parseWikiLinks } from "@/lib/links";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

/** Whole-KB link graph for /graph: nodes are visible concepts, edges are
 * resolved `[[标题]]` references between current bodies (alias form counts;
 * unresolved titles are skipped — they are dangling links, not edges).
 * Reuses listConceptsForExport: full bodies are already loaded, so
 * title→id resolution happens in memory with zero extra queries. Edges are
 * deduped pair-wise (the rendered graph is undirected). */
export const GET = withRoute("GET /api/graph", async () => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const concepts = await listConceptsForExport(user);
  const idByTitle = new Map<string, string>();
  for (const c of concepts) idByTitle.set(c.title.toLowerCase(), c.id);

  const links: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  for (const c of concepts) {
    for (const ref of parseWikiLinks(c.body_markdown)) {
      const target = idByTitle.get(ref.title.toLowerCase());
      if (!target || target === c.id) continue;
      const key = c.id < target ? `${c.id}|${target}` : `${target}|${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: c.id, target });
    }
  }

  return NextResponse.json({
    nodes: concepts.map((c) => ({ id: c.id, title: c.title, category: c.category ?? null })),
    links,
  });
});
