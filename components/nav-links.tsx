"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * App navigation links with an active-section pill. The layout persists across
 * navigations, so only a client component can see the live pathname. A section
 * stays highlighted on its child routes too (e.g. a concept detail page keeps
 * 「知识」 lit); exact match covers section roots. `badge` is the waiting-count
 * pill (审核队列的待办数): a queue nobody knows about never gets emptied.
 */
export function NavLinks({
  items,
  vertical = false,
}: {
  items: { href: string; label: string; badge?: number }[];
  vertical?: boolean;
}) {
  const pathname = usePathname();
  return (
    <>
      {items.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg text-sm ${
              vertical
                ? "w-full border px-3 py-2.5 shadow-sm"
                : "border border-transparent px-3 py-1.5"
            } ${
              active
                ? "border-zinc-900 bg-zinc-900 font-semibold text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : vertical
                  ? "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            }`}
          >
            <span className={vertical ? "min-w-0 flex-1" : undefined}>{link.label}</span>
            {link.badge ? (
              <span
                className={
                  active
                    ? `rounded-full bg-white/20 px-1.5 text-xs font-medium${vertical ? " ml-auto" : ""}`
                    : `rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300${vertical ? " ml-auto" : ""}`
                }
              >
                {link.badge > 99 ? "99+" : link.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </>
  );
}
