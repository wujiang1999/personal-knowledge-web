"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EChartsType } from "echarts/core";

interface GraphNode {
  id: string;
  title: string;
  category: string | null;
}

interface GraphLink {
  source: string;
  target: string;
}

const PALETTE = [
  "#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de",
  "#3ba272", "#fc8452", "#9a60b4", "#ea7ccc",
];

/** Force-directed whole-KB graph (Obsidian graph-view pattern). ECharts is
 * imported dynamically (tree-shaken: core + graph chart + tooltip + canvas
 * renderer) so it stays out of every other page's bundle. Click a node to
 * jump to the concept; drag/zoom via roam. */
export function GraphView() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<{ nodes: number; links: number } | null>(null);

  useEffect(() => {
    let disposed = false;
    let chart: EChartsType | null = null;
    const onResize = () => chart?.resize();

    (async () => {
      const container = containerRef.current;
      if (!container) return;
      try {
        const [echarts, charts, components, renderers] = await Promise.all([
          import("echarts/core"),
          import("echarts/charts"),
          import("echarts/components"),
          import("echarts/renderers"),
        ]);
        if (disposed) return;
        echarts.use([charts.GraphChart, components.TooltipComponent, renderers.CanvasRenderer]);

        const res = await fetch("/api/graph");
        if (!res.ok) throw new Error(`图谱数据加载失败 (HTTP ${res.status})`);
        const data = (await res.json()) as { nodes: GraphNode[]; links: GraphLink[] };
        if (disposed) return;

        const categories = [...new Set(data.nodes.map((n) => n.category ?? "（未分类）"))];
        const catIndex = new Map(categories.map((name, i) => [name, i]));
        const degree = new Map<string, number>();
        for (const l of data.links) {
          degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
          degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
        }

        chart = echarts.init(container);
        chart.setOption({
          tooltip: { show: true },
          legend: {
            data: categories,
            textStyle: { fontSize: 11, color: "#71717a" },
            top: 6,
            type: "scroll",
          },
          series: [
            {
              type: "graph",
              layout: "force",
              data: data.nodes.map((n) => ({
                id: n.id,
                name: n.title,
                category: catIndex.get(n.category ?? "（未分类）"),
                symbolSize: 14 + 4 * (degree.get(n.id) ?? 0),
              })),
              links: data.links,
              categories: categories.map((name, i) => ({
                name,
                itemStyle: { color: PALETTE[i % PALETTE.length] },
              })),
              roam: true,
              draggable: true,
              force: { repulsion: 300, edgeLength: 110, gravity: 0.12 },
              label: { show: true, position: "right", fontSize: 11, color: "#a1a1aa" },
              emphasis: { focus: "adjacency", lineStyle: { width: 3 } },
              lineStyle: { color: "source", curveness: 0.1, opacity: 0.5 },
            },
          ],
        });
        setStats({ nodes: data.nodes.length, links: data.links.length });

        chart.on("click", (params) => {
          const d = params.data as { id?: string } | undefined;
          if (params.dataType === "node" && d?.id) router.push(`/knowledge/${d.id}`);
        });
        window.addEventListener("resize", onResize);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      chart?.dispose();
      chart = null;
    };
  }, [router]);

  return (
    <div className="relative h-full w-full">
      {stats && (
        <div className="absolute right-3 top-3 z-10 rounded-md bg-zinc-100/90 px-2 py-1 text-xs text-zinc-500 dark:bg-zinc-800/90 dark:text-zinc-400">
          {stats.nodes} 节点 · {stats.links} 连线
        </div>
      )}
      {error ? (
        <div className="flex h-full items-center justify-center text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : (
        <div ref={containerRef} className="h-full w-full" />
      )}
    </div>
  );
}
