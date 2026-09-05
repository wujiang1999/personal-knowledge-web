"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Top-nav links with an active-section pill: layouts persist across
 * navigations, so only a client component can see the live pathname.
 * A section stays highlighted on its child routes too (e.g. a concept
 * detail page keeps 「知识」 lit); exact match covers section roots.
 */
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${
              active
                ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
