"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { GroupedNavLinks, type NavGroup, type NavItem } from "@/components/nav-links";
import { QuickSwitcher } from "@/components/quick-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/logout-button";

export function MobileNavigation({
  overview,
  groups,
}: {
  overview: NavItem;
  groups: NavGroup[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setOpen(false));
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 md:hidden">
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label={open ? "收起导航" : "展开导航"}
            aria-expanded={open}
            aria-controls="mobile-main-navigation"
            onClick={() => setOpen((value) => !value)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5">
              {open ? <path d="M5 5l14 14M19 5 5 19" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
          <span className="truncate font-semibold">知识库</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <QuickSwitcher />
          <ThemeToggle />
          <LogoutButton />
        </div>
      </div>
      <nav
        id="mobile-main-navigation"
        aria-label="主导航"
        hidden={!open}
        className="app-scrollbar max-h-[60vh] overflow-y-auto border-t border-zinc-200 px-3 py-3 dark:border-zinc-800"
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        <GroupedNavLinks overview={overview} groups={groups} />
      </nav>
    </header>
  );
}
