"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

const SIDEBAR_DEFAULT_WIDTH = 240;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_KEYBOARD_STEP = 16;
const SIDEBAR_WIDTH_KEY = "knowledge-sidebar-width";

function clampSidebarWidth(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

export function ResizableAppShell({
  navigation,
  footer,
  children,
}: {
  navigation: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ pointerId: -1, x: 0, width: SIDEBAR_DEFAULT_WIDTH });
  const latestWidth = useRef(width);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
        if (Number.isFinite(stored) && stored > 0) setWidth(clampSidebarWidth(stored));
      } catch {
        // Storage may be unavailable in hardened/private browser contexts; drag still works.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    latestWidth.current = width;
  }, [width]);

  function persistWidth(next: number) {
    setWidth(next);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    } catch {
      // Keep the in-memory width when persistence is unavailable.
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    dragStart.current = { pointerId: event.pointerId, x: event.clientX, width };
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragStart.current.pointerId !== event.pointerId) return;
    const next = clampSidebarWidth(dragStart.current.width + event.clientX - dragStart.current.x);
    latestWidth.current = next;
    setWidth(next);
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (dragStart.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStart.current.pointerId = -1;
    setDragging(false);
    persistWidth(latestWidth.current);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -SIDEBAR_KEYBOARD_STEP : SIDEBAR_KEYBOARD_STEP;
    persistWidth(clampSidebarWidth(width + delta));
  }

  return (
    <div
      className="relative min-h-screen md:grid"
      style={{ gridTemplateColumns: `${width}px minmax(0, 1fr)` }}
    >
      <aside
        aria-label="主导航"
        style={{ width }}
        className="sticky top-0 hidden h-screen flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 md:flex"
      >
        <div className="flex h-16 shrink-0 items-center px-5 text-lg font-semibold">知识库</div>
        <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navigation}
        </nav>
        <div className="shrink-0 border-t border-zinc-200 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/90">
          {footer}
        </div>
      </aside>

      {children}

      <div
        role="separator"
        aria-label="调整侧栏宽度"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        title="拖拽调整侧栏宽度；双击恢复默认"
        data-testid="sidebar-resizer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => persistWidth(SIDEBAR_DEFAULT_WIDTH)}
        style={{ left: width }}
        className="group absolute inset-y-0 z-30 hidden w-3 -translate-x-1/2 touch-none select-none cursor-col-resize focus:outline-none md:block"
      >
        <span
          className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${
            dragging ? "bg-blue-600" : "bg-zinc-300 group-hover:bg-blue-500 group-focus-visible:bg-blue-500 dark:bg-zinc-700 dark:group-hover:bg-blue-400 dark:group-focus-visible:bg-blue-400"
          }`}
        />
        <span
          className={`pointer-events-none absolute left-5 top-4 rounded-md bg-zinc-900 px-2 py-1 text-xs text-white opacity-0 shadow-sm transition-opacity dark:bg-zinc-100 dark:text-zinc-900 ${
            dragging ? "opacity-100" : "group-hover:opacity-100 group-focus-visible:opacity-100"
          }`}
        >
          {width}px
        </span>
      </div>
    </div>
  );
}
