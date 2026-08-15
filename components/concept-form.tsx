"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
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

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "保存失败");
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (mode === "edit" && data.created === false) {
      setError("");
      setNotice("正文没有变化，未生成新版本；标题 / 标签等元信息已保存。");
      router.refresh(); // 让服务端组件重新渲染，标题/标签等元信息立即更新
      return;
    }

    router.push(mode === "create" ? "/knowledge" : `/knowledge/${initial?.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>标题 *</label>
          <input name="title" required maxLength={200} defaultValue={initial?.title ?? ""} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>类型</label>
          <input name="type" list="okf-types" defaultValue={initial?.type ?? "Note"} className={inputCls} />
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

      <div>
        <label className={labelCls}>正文（Markdown）*</label>
        <textarea
          name="body"
          required
          rows={16}
          defaultValue={initial?.body ?? ""}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {notice && <p className="text-sm text-blue-600 dark:text-blue-400">{notice}</p>}

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