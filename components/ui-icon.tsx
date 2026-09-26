import type { SVGProps } from "react";

const paths = {
  book: "M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4V4Zm16 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3V4Z",
  dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  folder: "M3 7V5h6l2 2h10v13H3V7Z",
  graph: "M12 5v5m-2 3-5 5m9-5 5 5M9 2h6v5H9zM2 17h5v5H2zM17 17h5v5h-5zM9 10h6v5H9z",
  source: "M7 3h10l4 4v14H7V3ZM3 7v14m10-18v6h8M10 13h8m-8 4h6",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  ask: "M21 11a8 8 0 0 1-8 8H8l-5 3V11a9 9 0 0 1 18 0ZM7 10h10m-10 4h6",
  check: "m8 12 3 3 5-6M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z",
  review: "M9 4H5v17h14V4h-4M9 2h6v4H9zM8 11l2 2 5-4m-7 8h8",
  stats: "M4 3v18h17M8 16v-5m5 5V7m5 9V4",
  logs: "M8 3h13v18H8M3 6h2m-2 6h2m-2 6h2m7-12h5m-5 6h5m-5 6h5",
  history: "M3 10a9 9 0 1 1 2 8M3 4v6h6m3-4v6l4 2",
  users:
    "M8 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM1 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3m1-17a4 4 0 0 1 0 8m2 3a5 5 0 0 1 4 5v1",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  search: "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm5 12 6 6",
  plus: "M12 5v14M5 12h14",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  sun: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1",
  moon: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z",
  paperclip: "m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9m-6 12 8-8",
} as const;
export type IconName = keyof typeof paths;

export function UiIcon({
  name,
  className = "h-4 w-4",
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function routeIcon(href: string): IconName {
  const icons: Record<string, IconName> = {
    dashboard: "dashboard",
    knowledge: "book",
    graph: "graph",
    sources: "source",
    trash: "trash",
    ask: "ask",
    quality: "check",
    reviews: "review",
    stats: "stats",
    logs: "logs",
    version: "history",
    users: "users",
    settings: "settings",
  };
  return icons[href.split("/")[1]?.split("?")[0]] ?? "book";
}
