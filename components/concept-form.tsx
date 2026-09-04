"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BODY_TEMPLATES, type BodyTemplate } from "@/lib/templates";
import { MarkdownEditor, type EditorTitle } from "@/components/markdown-editor";

export interface ConceptFormInitial {
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  status?: string;
  body?: string;
}

const inputCls =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500";

const labelCls = "mb-1 block text-sm text-zinc-600 dark:text-zinc-300";

export function ConceptForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: ConceptFormInitial;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string; title: string } | null>(null);

  // ---- Draft persistence (Obsidian unsaved-changes safety) ----------------
  // Every input debounces (800ms) into localStorage under a per-context key;
  // on mount a draft that differs from the initial values surfaces a restore
  // banner. Cleared on successful save. Best-effort: storage failures are
  // swallowed — losing a draft hint must never break the form.
  interface DraftData {
    title: string;
    type: string;
    description: string;
    category: string;
    tags: string;
    status: string;
    body: string;
    at: number;
  }
  const draftKey = mode === "create" ? "kb-draft:new" : `kb-draft:${initial?.id ?? ""}`;
  const formRef = useRef<HTMLFormElement | null>(null);
  const typeRef = useRef<HTMLInputElement | null>(null);
  const draftTimer = useRef<number | null>(null);
  const [restorable, setRestorable] = useState<{ data: DraftData; at: number } | null>(null);

  useEffect(() => {
    // The draft banner must appear only after mount; defer the state update
    // one tick so the effect body never triggers a cascading render
    // (react-hooks/set-state-in-effect).
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(draftKey);
        if (!raw) return;
        const d = JSON.parse(raw) as Partial<DraftData>;
        if (typeof d.body !== "string" || typeof d.title !== "string") return;
        const sameAsInitial =
          d.title === (initial?.title ?? "") &&
          d.body === (initial?.body ?? "") &&
          d.description === (initial?.description ?? "") &&
          d.category === (initial?.category ?? "") &&
          (d.tags ?? "") === (initial?.tags?.join(", ") ?? "") &&
          d.status === (initial?.status ?? "stable") &&
          d.type === (initial?.type ?? "Note");
        if (!sameAsInitial) {
          setRestorable({
            data: d as DraftData,
            at: typeof d.at === "number" ? d.at : 0,
          });
        }
      } catch {
        /* corrupted draft: ignore */
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // initial is stable per mount; the draft context key is the real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  function onFormInput() {
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      const form = formRef.current;
      if (!form) return;
      const fd = new FormData(form);
      const data: DraftData = {
        title: String(fd.get("title") ?? ""),
        type: String(fd.get("type") ?? "Note"),
        description: String(fd.get("description") ?? ""),
        category: String(fd.get("category") ?? ""),
        tags: String(fd.get("tags") ?? ""),
        status: String(fd.get("status") ?? "stable"),
        body: String(fd.get("body") ?? ""),
        at: Date.now(),
      };
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(data));
      } catch {
        /* storage full/unavailable: best effort */
      }
    }, 800);
  }

  function restoreDraft() {
    if (!restorable) return;
    const d = restorable.data;
    const form = formRef.current;
    if (form) {
      const set = (name: string, value: string) => {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
          el.value = value;
        }
      };
      set("title", d.title);
      set("type", d.type);
      set("description", d.description);
      set("category", d.category);
      set("tags", d.tags);
      set("status", d.status);
    }
    setBody(d.body);
    setRestorable(null);
  }

  function discardDraft() {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      /* best effort */
    }
    setRestorable(null);
  }

  function applyTemplate(t: BodyTemplate) {
    setBody((cur) => (cur.trim() ? `${cur.trimEnd()}\n\n${t.body}` : t.body));
    if (typeRef.current && typeRef.current.value === "Note") typeRef.current.value = t.type;
    editorFocusRef.current?.();
  }

  // ---- [[ completion + live preview (MarkdownEditor) ------------------------
  // Titles come from GET /api/concepts?limit=200 and are filtered CLIENT-side
  // by the editor's completion source (a personal KB is hundreds of rows:
  // zero-latency suggestions, no search-log pollution). Cache 30s, shared by
  // the editor and the preview.
  const editorFocusRef = useRef<(() => void) | null>(null);
  const titlesRef = useRef<{ at: number; items: EditorTitle[] } | null>(null);
  const [body, setBody] = useState(initial?.body ?? "");

  const getTitles = useCallback((): Promise<EditorTitle[]> => {
    const cache = titlesRef.current;
    if (cache && Date.now() - cache.at < 30_000) return Promise.resolve(cache.items);
    return new Promise<EditorTitle[]>((resolve) => {
      fetch("/api/concepts?limit=200")
        .then((r) => (r.ok ? r.json() : { concepts: [] }))
        .then((d: { concepts?: { id: string; title: string; category?: string | null }[] }) => {
          const items: EditorTitle[] = (d.concepts ?? []).map((c) => ({
            id: c.id, title: c.title, category: c.category ?? null,
          }));
          titlesRef.current = { at: Date.now(), items };
          resolve(items);
        })
        .catch(() => resolve(cache?.items ?? []));
    });
  }, []);


  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!body.trim()) {
      setError("正文不能为空");
      editorFocusRef.current?.();
      return;
    }
    setLoading(true);
    setError("");
    setDuplicate(null);
    const fd = new FormData(e.currentTarget);
    const tags = String(fd.get("tags") || "")
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);

    const payload = {
      type: fd.get("type") || "Note",
      title: fd.get("title"),
      description: fd.get("description") || undefined,
      category: fd.get("category") || undefined,
      tags,
      status: fd.get("status") || "stable",
      body: fd.get("body"),
    };

    const url = mode === "create" ? "/api/concepts" : `/api/concepts/${initial?.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.existingId) {
          setDuplicate({ id: data.existingId, title: data.existingTitle ?? "已有条目" });
          setError(data.error ?? "内容与已有条目完全相同");
        } else {
          setError(data.error ?? "保存失败");
        }
        return;
      }

      const data = await res.json().catch(() => ({}));
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        /* best effort */
      }
      if (mode === "edit" && data.created === false) {
        setError("");
        setNotice("正文没有变化，未生成新版本；标题 / 标签等元信息已保存。");
        router.refresh(); // 让服务端组件重新渲染，标题/标签等元信息立即更新
        return;
      }

      router.push(mode === "create" ? `/knowledge/${data.id}` : `/knowledge/${initial?.id}`);
      router.refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form ref={formRef} onInput={onFormInput} onSubmit={onSubmit} className="space-y-4">
      {restorable && (
        <p className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span>
            检测到未保存草稿
            {restorable.at ? `（${new Date(restorable.at).toLocaleString("zh-CN")}）` : ""}。
          </span>
          <button
            type="button"
            onClick={restoreDraft}
            className="rounded bg-amber-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-500"
          >
            恢复
          </button>
          <button
            type="button"
            onClick={discardDraft}
            className="rounded border border-amber-400 px-2 py-0.5 text-xs hover:bg-amber-100 dark:hover:bg-amber-900"
          >
            丢弃
          </button>
        </p>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>标题 *</label>
          <input name="title" required maxLength={200} defaultValue={initial?.title ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>类型</label>
          <input ref={typeRef} name="type" list="okf-types" defaultValue={initial?.type ?? "Note"} className={inputCls} />
          <datalist id="okf-types">
            <option value="Note" />
            <option value="Technical Note" />
            <option value="Definition" />
            <option value="Procedure" />
            <option value="Decision" />
            <option value="Entity" />
            <option value="Reference" />
          </datalist>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>标签（逗号分隔）</label>
          <input
            name="tags"
            defaultValue={initial?.tags?.join(", ") ?? ""}
            placeholder="llm, cuda"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>状态</label>
          <select name="status" defaultValue={initial?.status ?? "stable"} className={inputCls}>
            <option value="stable">stable</option>
            <option value="draft">draft</option>
            <option value="deprecated">deprecated</option>
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>描述</label>
        <input
          name="description"
          maxLength={1000}
          defaultValue={initial?.description ?? ""}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>目录</label>
        <input
          name="category"
          defaultValue={initial?.category ?? ""}
          placeholder="如：技术/部署（用 / 分层级，留空 = 根目录）"
          maxLength={200}
          className={inputCls}
        />
      </div>

      {mode === "create" && (
        <div>
          <label className={labelCls}>模板（插入正文骨架，不覆盖已有内容）</label>
          <select
            defaultValue=""
            onChange={(e) => {
              const t = BODY_TEMPLATES.find((x) => x.id === e.target.value);
              if (t) applyTemplate(t);
              e.currentTarget.value = "";
            }}
            className={inputCls}
          >
            <option value="">选择模板…</option>
            {BODY_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={labelCls}>正文（Markdown）*</label>
        <MarkdownEditor value={body} onChange={setBody} getTitles={getTitles} focusRef={editorFocusRef} />
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          输入 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">[[</code>{" "}
          触发条目补全（↑↓ 选择、Enter 确认）；支持{" "}
          <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">![[条目标题]]</code>{" "}
          嵌入与 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">[[标题|显示名]]</code>{" "}
          别名链接；右上角可切换实时预览。
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notice && <p className="text-sm text-blue-600 dark:text-blue-400">{notice}</p>}
      {duplicate && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          查看重复条目：{" "}
          <Link href={`/knowledge/${duplicate.id}`} className="font-medium underline">
            {duplicate.title}
          </Link>
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {loading ? "保存中…" : mode === "create" ? "创建" : "保存新版本"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          取消
        </button>
      </div>
    </form>
  );
}