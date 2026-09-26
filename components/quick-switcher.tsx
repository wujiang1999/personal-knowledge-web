"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UiIcon } from "@/components/ui-icon";
import { useRouter } from "next/navigation";

interface TitleItem {
  id: string;
  title: string;
  category: string | null;
}

/** Ctrl/Cmd+K quick switcher (Obsidian pattern): filter concept titles and
 * jump. Titles are fetched once per open (30s client cache) and filtered
 * client-side — a personal KB is hundreds of rows, so zero server cost and
 * zero search-log pollution. */
export function QuickSwitcher({ expanded = false }: { expanded?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<TitleItem[]>([]);
  const [sel, setSel] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fetchedAt = useRef(0);
  const [loadError, setLoadError] = useState(false);

  const fetchItems = useCallback(async (force = false) => {
    if (!force && Date.now() - fetchedAt.current < 30_000) return;
    try {
      const all: TitleItem[] = [];
      let offset = 0;
      let total = 0;
      do {
        const response = await fetch(`/api/concepts?limit=200&offset=${offset}`);
        if (!response.ok) throw new Error("quick switcher request failed");
        const data = (await response.json()) as {
          concepts?: { id: string; title: string; category?: string | null }[];
          total?: number;
        };
        const page = (data.concepts ?? []).map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category ?? null,
        }));
        all.push(...page);
        offset += page.length;
        total = data.total ?? all.length;
        if (page.length === 0) break;
      } while (offset < total);
      setItems(all);
      setLoadError(false);
      fetchedAt.current = Date.now();
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!triggerRef.current?.getClientRects().length) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          const next = !o;
          if (next) {
            setQ("");
            setSel(0);
            void fetchItems();
          }
          return next;
        });
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fetchItems]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const needle = q.trim().toLowerCase();
  const filtered = (
    needle
      ? items
          .filter(
            (c) =>
              c.title.toLowerCase().includes(needle) ||
              (c.category ?? "").toLowerCase().includes(needle)
          )
          .sort(
            (a, b) =>
              (a.title.toLowerCase().startsWith(needle) ? 0 : 1) -
              (b.title.toLowerCase().startsWith(needle) ? 0 : 1)
          )
      : items
  ).slice(0, 12);

  function jump(id: string) {
    setOpen(false);
    router.push(`/knowledge/${id}`);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen(true);
          setQ("");
          setSel(0);
          void fetchItems(true);
        }}
        className={`flex min-h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-500 hover:border-brand-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 ${expanded ? "w-full" : ""}`}
        aria-label="快速查找知识"
        title="快速跳转 (Ctrl+K)"
      >
        {expanded && <><UiIcon name="search" /><span className="flex-1 text-left">查找知识</span></>}<kbd className="text-[10px]">⌘ K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="快速查找知识"
            className="mx-auto mt-20 w-[min(560px,92vw)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSel(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && filtered.length > 0) {
                  e.preventDefault();
                  setSel((s) => Math.min(s + 1, filtered.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSel((s) => Math.max(s - 1, 0));
                } else if (e.key === "Enter" && filtered[sel]) {
                  e.preventDefault();
                  jump(filtered[sel].id);
                }
              }}
              placeholder="输入标题过滤，↑↓ 选择，Enter 跳转，Esc 关闭"
              className="w-full border-b border-zinc-200 bg-transparent px-4 py-3 text-sm outline-none dark:border-zinc-700"
            />
            <ul className="max-h-80 overflow-auto">
              {loadError && <li className="px-4 py-3 text-sm text-red-600 dark:text-red-400">快速跳转加载失败，请稍后重试</li>}
              {!loadError && filtered.length === 0 && <li className="px-4 py-3 text-sm text-zinc-400 dark:text-zinc-500">无匹配条目</li>}
              {filtered.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      jump(c.id);
                    }}
                    onMouseEnter={() => setSel(i)}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm ${
                      i === sel ? "bg-zinc-100 dark:bg-zinc-800" : ""
                    }`}
                  >
                    <span className="truncate">{c.title}</span>
                    {c.category && (
                      <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">{c.category}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {!loadError && items.length > 0 && (
              <div className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                已加载全部 {items.length} 条知识
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
