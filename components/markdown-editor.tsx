"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { autocompletion, type CompletionContext, type Completion } from "@codemirror/autocomplete";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
// CodeMirror's language-data registry loads individual grammars on demand
// through its own runtime loader — a genuine runtime-selected plugin case;
// every other module here is author-time known and statically imported.
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup } from "codemirror";

export interface EditorTitle {
  id: string;
  title: string;
  category: string | null;
}

export interface PreviewProps {
  body: string;
  getTitles: () => Promise<EditorTitle[]>;
}

// The `dark` class on <html> is owned by the inline theme-init script and
// ThemeToggle; subscribe via MutationObserver so the CodeMirror theme and
// the preview follow live theme switches.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function useDarkTheme(): boolean {
  const get = () => document.documentElement.classList.contains("dark");
  return useSyncExternalStore(subscribe, get, () => false);
}

/**
 * CodeMirror 6 Markdown editor for the concept form. All CodeMirror
 * packages are SSR-safe (view/state guard for headless environments), so
 * they import statically and fail at build time, not under load.
 *
 * - `[[标题]]` completion (titles via `getTitles`, client-side filtered;
 *   `![[标题]]` embeds completed too, and a typed `|alias` suffix survives).
 * - 编辑/预览 toggle: the CodeMirror view stays mounted (state preserved);
 *   the preview renders with the same wiki-link semantics as ConceptBody
 *   (block-level `![[…]]` embeds show as 📄 links — the final render with
 *   resolved transclusion is the detail page).
 * - A hidden `<textarea name="body">` mirrors the doc so FormData and the
 *   draft persistence keep working unchanged.
 */
export function MarkdownEditor({
  value,
  onChange,
  getTitles,
  focusRef,
}: {
  value: string;
  onChange: (next: string) => void;
  getTitles: () => Promise<EditorTitle[]>;
  focusRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const getTitlesRef = useRef(getTitles);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    getTitlesRef.current = getTitles;
  }, [getTitles]);

  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [PreviewComp, setPreviewComp] = useState<React.ComponentType<PreviewProps> | null>(null);
  const [ready, setReady] = useState(false);
  const dark = useDarkTheme();
  const themeComp = useRef(new Compartment());

  useEffect(() => {
    if (focusRef) focusRef.current = () => viewRef.current?.focus();
  }, [focusRef, ready]);

  // Mount once; only the theme compartment reconfigures on dark toggles
  // (no view recreation, state preserved).
  useEffect(() => {
    if (!hostRef.current) return;

    // `[[` / `![[` completion source. `from` points at the first typed char
    // after the two-char opener; apply writes the closing `]]` and keeps any
    // `|alias` the user already typed.
    const wikiSource = async (context: CompletionContext) => {
      const m = context.matchBefore(/!?\[\[[^\[\]\n]*/);
      if (!m || (m.from === m.to && context.explicit === false)) return null;
      const embed = m.text.startsWith("!");
      const typed = m.text.slice(embed ? 3 : 2);
      const from = m.to - typed.length;
      const q = typed.slice(0, typed.indexOf("|")).trim().toLowerCase();
      const titles = await getTitlesRef.current();
      const options: Completion[] = titles
        .filter((t) => !q || t.title.toLowerCase().includes(q))
        .sort(
          (a, b) =>
            (a.title.toLowerCase().startsWith(q) ? 0 : 1) -
              (b.title.toLowerCase().startsWith(q) ? 0 : 1) ||
            a.title.length - b.title.length
        )
        .slice(0, 8)
        .map((t) => ({
          label: t.title,
          detail: t.category ?? undefined,
          apply: (view, _completion, applyFrom, applyTo) => {
            const aliasIdx = typed.indexOf("|");
            const suffix = aliasIdx === -1 ? "" : typed.slice(aliasIdx);
            view.dispatch({
              changes: { from: applyFrom, to: applyTo, insert: `${t.title}${suffix}]]` },
              selection: { anchor: applyFrom + t.title.length + suffix.length },
            });
          },
        }));
      if (options.length === 0) return null;
      return { from, options, validFor: /^[^\[\]\n]*$/ };
    };

    const view = new EditorView({
      doc: valueRef.current,
      parent: hostRef.current,
      extensions: [
        // Must precede basicSetup: CodeMirror keeps only the FIRST
        // autocompletion instance, and ours carries the [[ override source.
        autocompletion({ override: [wikiSource] }),
        basicSetup,
        keymap.of([indentWithTab]),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        themeComp.current.of(dark ? oneDark : []),
        EditorView.theme({
          "&": { backgroundColor: "transparent", height: "100%" },
          ".cm-scroller": { fontFamily: "inherit" },
        }),
        syntaxHighlighting(HighlightStyle.define([])),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          const v = u.state.doc.toString();
          valueRef.current = v;
          if (taRef.current) taRef.current.value = v;
          onChangeRef.current(v);
        }),
      ],
    });
    viewRef.current = view;
    if (taRef.current && taRef.current.value !== valueRef.current) {
      taRef.current.value = valueRef.current;
    }
    setReady(true);
    return () => {
      view.destroy();
      viewRef.current = null;
      setReady(false);
    };
    // Mount-once on purpose: value flows through the sync effect below and
    // dark through the compartment effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: themeComp.current.reconfigure(dark ? oneDark : []) });
  }, [dark]);

  // External value pushes (template insert, draft restore) flow into the
  // editor; editor-driven changes come back through onChange and skip here.
  useEffect(() => {
    if (value === valueRef.current) return;
    valueRef.current = value;
    const ta = taRef.current;
    if (ta) ta.value = value;
    const view = viewRef.current;
    if (view) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  function togglePreview(next: boolean) {
    setMode(next ? "preview" : "edit");
    if (next && !PreviewComp) {
      // Static import of the preview module is what this lazy toggle avoids:
      // react-markdown (~100KB gz) must not join the editor chunk before the
      // user ever opens 预览 — a genuine runtime-selected module boundary.
      import("./markdown-preview").then((m) => setPreviewComp(() => m.MarkdownPreview));
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-end gap-1 text-xs">
        <button
          type="button"
          onClick={() => togglePreview(false)}
          className={`rounded px-2 py-1 ${
            mode === "edit"
              ? "bg-zinc-200 font-medium dark:bg-zinc-700"
              : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          编辑
        </button>
        <button
          type="button"
          onClick={() => togglePreview(true)}
          className={`rounded px-2 py-1 ${
            mode === "preview"
              ? "bg-zinc-200 font-medium dark:bg-zinc-700"
              : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          预览
        </button>
      </div>
      <div className={mode === "edit" ? "" : "hidden"}>
        <div
          ref={hostRef}
          className={`min-h-[380px] overflow-auto rounded-md border border-zinc-300 bg-white text-sm dark:border-zinc-700 dark:bg-zinc-900 ${
            ready ? "" : "hidden"
          }`}
        />
        {!ready && (
          <div className="flex min-h-[380px] items-center justify-center rounded-md border border-zinc-300 text-sm text-zinc-400 dark:border-zinc-700">
            编辑器加载中…
          </div>
        )}
        <textarea ref={taRef} name="body" className="hidden" aria-hidden tabIndex={-1} />
      </div>
      {mode === "preview" &&
        (PreviewComp ? (
          <PreviewComp body={value} getTitles={getTitles} />
        ) : (
          <div className="flex min-h-[380px] items-center justify-center rounded-md border border-zinc-200 text-sm text-zinc-400 dark:border-zinc-800">
            预览加载中…
          </div>
        ))}
    </div>
  );
}
