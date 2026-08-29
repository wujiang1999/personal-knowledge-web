"use client";

import { useMemo, useState } from "react";
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

function FolderNode({
  node,
  depth,
  open,
  toggle,
}: {
  node: DirectoryTreeFolder;
  depth: number;
  open: Set<string>;
  toggle: (key: string) => void;
}) {
  const isOpen = open.has(node.key);
  return (
    <div className={depth > 0 ? "ml-4 border-l border-zinc-200 pl-3 dark:border-zinc-700" : ""}>
      <div className="flex items-center gap-1 py-0.5">
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
            <FolderNode key={ch.key} node={ch} depth={depth + 1} open={open} toggle={toggle} />
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

/**
 * File-explorer-style collapsible category tree. All folders start collapsed;
 * the chevron toggles a folder, the folder name still links to the filtered
 * knowledge list.
 */
export function DirectoryTree({ roots, rootConcepts }: { roots: DirectoryTreeFolder[]; rootConcepts: DirectoryTreeConcept[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (nodes: DirectoryTreeFolder[]) => {
      for (const n of nodes) {
        keys.push(n.key);
        walk(n.children);
      }
    };
    walk(roots);
    if (rootConcepts.length > 0) keys.push(ROOT_KEY);
    return keys;
  }, [roots, rootConcepts]);

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
        <FolderNode key={node.key} node={node} depth={0} open={open} toggle={toggle} />
      ))}
      {rootConcepts.length > 0 && <RootConceptsNode concepts={rootConcepts} open={open} toggle={toggle} />}
    </div>
  );
}
