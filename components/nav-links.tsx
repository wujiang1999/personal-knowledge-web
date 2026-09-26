"use client";

import Link from "next/link";
import { UiIcon, routeIcon } from "@/components/ui-icon";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV_GROUP_STATE_KEY = "knowledge-nav-group-state";

/** Flat list used for the overview shortcut and expanded group children. */
export function NavLinks({
  items,
  variant = "card",
}: {
  items: NavItem[];
  variant?: "card" | "nested";
}) {
  const pathname = usePathname();
  return (
    <div className="space-y-1.5">
      {items.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`nav-link w-full ${variant === "nested" ? "pl-3" : ""}`}
          >
            <UiIcon name={routeIcon(link.href)} /><span className="min-w-0 flex-1">{link.label}</span>
            {link.badge ? (
              <span
                className={
                  active
                    ? "ml-auto rounded-full bg-white/20 px-1.5 text-xs font-medium"
                    : "ml-auto rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                }
              >
                {link.badge > 99 ? "99+" : link.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

/** Five top-level destinations with lazily expanded children. Overrides persist
 * locally; core groups are discoverable by default. */
export function GroupedNavLinks({
  overview,
  groups,
}: {
  overview: NavItem;
  groups: NavGroup[];
}) {
  const pathname = usePathname();
  const instanceId = useId();
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = JSON.parse(window.localStorage.getItem(NAV_GROUP_STATE_KEY) ?? "{}") as unknown;
        if (typeof stored === "object" && stored !== null) {
          setOpenOverrides(stored as Record<string, boolean>);
        }
      } catch {
        // Invalid or unavailable storage falls back to current-route defaults.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleGroup(group: NavGroup, open: boolean) {
    const next = { ...openOverrides, [group.id]: open };
    setOpenOverrides(next);
    try {
      window.localStorage.setItem(NAV_GROUP_STATE_KEY, JSON.stringify(next));
    } catch {
      // The menu remains interactive when storage is unavailable.
    }
  }

  return (
    <div className="space-y-4" data-testid="grouped-navigation">
      <NavLinks items={[overview]} />

      {groups.map((group) => {
        const groupActive = group.items.some(
          (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
        );
        const open = openOverrides[group.id] ?? (groupActive || group.id !== "system");
        const badge = group.items.reduce((total, item) => total + (item.badge ?? 0), 0);
        const panelId = `${instanceId}-nav-group-${group.id}`;

        return (
          <section key={group.id} data-nav-group={group.id}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggleGroup(group, !open)}
              className="nav-group flex w-full items-center gap-2 rounded-lg text-left"
            >
              <span className="min-w-0 flex-1">{group.label}</span>
              {badge > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              >
                <path
                  fill="currentColor"
                  d="M5.5 7.5 10 12l4.5-4.5 1 1L10 13.5 4.5 8.5l1-1Z"
                />
              </svg>
            </button>
            {open && (
              <div id={panelId} className="mt-1 space-y-1">
                <NavLinks
                  items={group.items}
                  variant="nested"
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
