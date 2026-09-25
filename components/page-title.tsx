"use client";

import { usePathname } from "next/navigation";
import type { NavGroup, NavItem } from "@/components/nav-links";

/** Page heading resolved from the same label objects rendered by the sidebar. */
export function PageTitle({
  overview,
  groups,
}: {
  overview: NavItem;
  groups: NavGroup[];
}) {
  const pathname = usePathname();
  const active = [overview, ...groups.flatMap((group) => group.items)].find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );
  if (!active) return null;

  return (
    <div
      data-testid="page-title"
      className="mb-6 border-b border-zinc-200 pb-4 dark:border-zinc-800"
    >
      <h1 className="text-2xl font-semibold">{active.label}</h1>
    </div>
  );
}
