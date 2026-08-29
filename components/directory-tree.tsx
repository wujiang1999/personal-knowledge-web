"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export interface DirectoryTreeConcept {
  id: string;
  title: string;
}

export interface DirectoryTreeFolder {
  /** Stable identity for expand/collapse state; category path, or the ROOT_KEY pseudo-folder. */
  key: string;
  name: string;
  /** Concepts in the whole subtree, shown next to the folder name. */
  total: number;
  concepts: DirectoryTreeConcept[];
  children: DirectoryTreeFolder[];
}

const ROOT_KEY = "__root__";

type FolderAction = "rename" | "move" | "delete";

type FolderDialog =
  | { type: "rename"; key: string; name: string }
  | { type: "move"; key: string; parent: string }
  | { type: "delete"; key: string };

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function lastSegment(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** Client-side mirror of the server's rename/move path composition. */
function plannedNewPath(d: Exclude<FolderDialog, { type: "delete" }>): string {
  if (d.type === "rename") {
    const segs = d.key.split("/");
    segs[segs.length - 1] = d.name.trim();
    return segs.filter(Boolean).join("/");
  }
  const parent = d.parent.split("/").filter(Boolean).join("/");
  return parent ? `${parent}/${lastSegment(d.key)}` : lastSegment(d.key);
}

function FolderNode({
  node,
  depth,
  open,
  toggle,
  menuFor,
  onMenuToggle,
  onAction,
}: {
  node: DirectoryTreeFolder;
  depth: number;
  open: Set<string>;
  toggle: (key: string) => void;
  menuFor: string | null;
  onMenuToggle: (key: string | null) => void;
  onAction: (action: FolderAction, node: DirectoryTreeFolder) => void;
}) {
  const isOpen = open.has(node.key);
  const hasMenu = menuFor === node.key;
  return (
    <div className={depth > 0 ? "ml-4 border-l border-zinc-200 pl-3 dark:border-zinc-700" : ""}>
      <div className="group flex items-center gap-1 py-0.5">
        <button
          type="button"
          onClick={() => toggle(node.key)}
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "收起" : "展开"} ${node.name}`}
          className="flex items-center gap-1 rounded text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <Caret open={isOpen} />
          <span aria-hidden="true">{isOpen ? "📂" : "📁"}</span>
        </button>
        <Link
          href={`/knowledge?category=${encodeURIComponent(node.key)}`}
          className="font-medium text-zinc-800 hover:underline dark:text-zinc-100"
        >
          {node.name}
        </Link>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">({node.total})</span>
        <div className="relative">
          <button
            type="button"
            aria-label={`文件夹操作 ${node.name}`}
            aria-haspopup="menu"
            aria-expanded={hasMenu}
            onClick={() => onMenuToggle(hasMenu ? null : node.key)}
            className="rounded px-1 text-xs text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-700 focus:opacity-100 group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            ⋯
          </button>
          {hasMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => onMenuToggle(null)} aria-hidden="true" />
              <div
                role="menu"
                className="absolute left-0 top-6 z-20 w-32 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onAction("rename", node)}
                  className="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  重命名
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onAction("move", node)}
                  className="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  移动到…
                </button>
                <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onAction("delete", node)}
                  className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                >
                  删除文件夹
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {isOpen && (
        <div>
          {node.concepts.map((c) => (
            <div key={c.id} className="ml-5 py-0.5">
              <Link href={`/knowledge/${c.id}`} className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
                {c.title}
              </Link>
            </div>
          ))}
          {node.children.map((ch) => (
            <FolderNode
              key={ch.key}
              node={ch}
              depth={depth + 1}
              open={open}
              toggle={toggle}
              menuFor={menuFor}
              onMenuToggle={onMenuToggle}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RootConceptsNode({
  concepts,
  open,
  toggle,
}: {
  concepts: DirectoryTreeConcept[];
  open: Set<string>;
  toggle: (key: string) => void;
}) {
  const isOpen = open.has(ROOT_KEY);
  return (
    <div className="mt-1">
      <div className="flex items-center gap-1 py-0.5">
        <button
          type="button"
          onClick={() => toggle(ROOT_KEY)}
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "收起" : "展开"} 根目录`}
          className="flex items-center gap-1 rounded text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <Caret open={isOpen} />
          <span aria-hidden="true">{isOpen ? "📂" : "📁"}</span>
        </button>
        <span className="font-medium text-zinc-700 dark:text-zinc-300">根目录</span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">({concepts.length})</span>
      </div>
      {isOpen &&
        concepts.map((c) => (
          <div key={c.id} className="ml-5 py-0.5">
            <Link href={`/knowledge/${c.id}`} className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
              {c.title}
            </Link>
          </div>
        ))}
    </div>
  );
}

function DialogShell({
  title,
  busy,
  confirmLabel,
  danger,
  onClose,
  onConfirm,
  children,
}: {
  title: string;
  busy: boolean;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  const confirmClasses = danger
    ? "rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-60"
    : "rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <h3 className="mb-3 font-medium text-zinc-900 dark:text-zinc-100">{title}</h3>
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            取消
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={confirmClasses}>
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * File-explorer-style collapsible category tree. All folders start collapsed;
 * the chevron toggles a folder, the folder name still links to the filtered
 * knowledge list. The ⋯ button opens rename / move / delete actions; folders
 * are derived views over concept categories, so delete uncategorizes entries
 * (content is never removed here).
 */
export function DirectoryTree({ roots, rootConcepts }: { roots: DirectoryTreeFolder[]; rootConcepts: DirectoryTreeConcept[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FolderDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (nodes: DirectoryTreeFolder[]) => {
      for (const n of nodes) {
        keys.push(n.key);
        walk(n.children);
      }
    };
    walk(roots);
    return keys;
  }, [roots]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    const walk = (nodes: DirectoryTreeFolder[]) => {
      for (const n of nodes) {
        map.set(n.key, n.total);
        walk(n.children);
      }
    };
    walk(roots);
    return map;
  }, [roots]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const allOpen = allKeys.length > 0 && allKeys.every((k) => open.has(k));

  function openAction(action: FolderAction, node: DirectoryTreeFolder) {
    setMenuFor(null);
    setError(null);
    if (action === "rename") {
      setDialog({ type: "rename", key: node.key, name: lastSegment(node.key) });
    } else if (action === "move") {
      setDialog({ type: "move", key: node.key, parent: "" });
    } else {
      setDialog({ type: "delete", key: node.key });
    }
  }

  async function submitDialog() {
    if (!dialog || busy) return;
    setBusy(true);
    setError(null);
    const body =
      dialog.type === "rename"
        ? { op: "rename", path: dialog.key, name: dialog.name }
        : dialog.type === "move"
          ? { op: "move", path: dialog.key, parent: dialog.parent }
          : { op: "delete", path: dialog.key };
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { affected?: number; error?: string };
      if (!res.ok) {
        setError(data.error || "操作失败，请重试");
        return;
      }
      if (dialog.type !== "delete") {
        // Keep the moved/renamed subtree open under its new path.
        const from = dialog.key;
        const to = plannedNewPath(dialog);
        setOpen((prev) => {
          const next = new Set<string>();
          for (const k of prev) {
            if (k === from) next.add(to);
            else if (k.startsWith(from + "/")) next.add(to + k.slice(from.length));
            else next.add(k);
          }
          return next;
        });
      }
      setDialog(null);
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  const dialogTotal = dialog ? totals.get(dialog.key) ?? 0 : 0;
  const moveTargets = dialog?.type === "move" ? allKeys.filter((k) => k !== dialog.key && !k.startsWith(dialog.key + "/")) : [];
  const inputClass =
    "mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <div>
      {allKeys.length > 1 && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(allOpen ? new Set() : new Set(allKeys))}
            className="text-xs text-zinc-400 hover:text-zinc-700 hover:underline dark:text-zinc-500 dark:hover:text-zinc-200"
          >
            {allOpen ? "收起全部" : "展开全部"}
          </button>
        </div>
      )}
      {roots.map((node) => (
        <FolderNode
          key={node.key}
          node={node}
          depth={0}
          open={open}
          toggle={toggle}
          menuFor={menuFor}
          onMenuToggle={setMenuFor}
          onAction={openAction}
        />
      ))}
      {rootConcepts.length > 0 && <RootConceptsNode concepts={rootConcepts} open={open} toggle={toggle} />}

      {dialog?.type === "rename" && (
        <DialogShell
          title="重命名文件夹"
          busy={busy}
          confirmLabel="重命名"
          onClose={() => setDialog(null)}
          onConfirm={submitDialog}
        >
          <label className="block text-sm text-zinc-600 dark:text-zinc-300">
            新名称（仅最后一级，父目录不变）
            <input
              autoFocus
              value={dialog.name}
              onChange={(e) => setDialog({ ...dialog, name: e.target.value })}
              className={inputClass}
            />
          </label>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </DialogShell>
      )}
      {dialog?.type === "move" && (
        <DialogShell
          title="移动文件夹"
          busy={busy}
          confirmLabel="移动"
          onClose={() => setDialog(null)}
          onConfirm={submitDialog}
        >
          <label className="block text-sm text-zinc-600 dark:text-zinc-300">
            目标位置（连同所有子文件夹一起移动）
            <select
              autoFocus
              value={dialog.parent}
              onChange={(e) => setDialog({ ...dialog, parent: e.target.value })}
              className={inputClass}
            >
              <option value="">（根目录）</option>
              {moveTargets.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </DialogShell>
      )}
      {dialog?.type === "delete" && (
        <DialogShell
          title="删除文件夹"
          busy={busy}
          confirmLabel="删除文件夹"
          danger
          onClose={() => setDialog(null)}
          onConfirm={submitDialog}
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            将移除文件夹「{dialog.key}」及其所有子文件夹。其中 {dialogTotal} 个知识条目
            <span className="font-medium text-zinc-900 dark:text-zinc-100">不会被删除</span>
            ，而是移动到根目录（取消分类）。
          </p>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </DialogShell>
      )}
    </div>
  );
}
