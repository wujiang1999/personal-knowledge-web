"use client";

import { UiIcon } from "@/components/ui-icon";
import { useSyncExternalStore } from "react";

// The `dark` class on <html> is owned by the inline theme-init script in
// app/layout.tsx and by toggle() below. Subscribe to it as an external store
// (instead of a mount-effect setState) so the icon renders the real theme
// right after hydration and stays in sync if the class changes elsewhere.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): boolean | null {
  return document.documentElement.classList.contains("dark");
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, () => null);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      title={dark === null ? "切换深色/浅色模式" : dark ? "切换到浅色" : "切换到深色"}
      aria-label="切换深色/浅色模式"
      className="flex h-10 w-10 items-center justify-center rounded-md text-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <UiIcon name={dark ? "sun" : "moon"} className="h-[18px] w-[18px]" />
    </button>
  );
}
