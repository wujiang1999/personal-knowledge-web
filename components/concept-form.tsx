"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ConceptFormInitial {
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  tags?: string[];
  status?: string;
  body?: string;
}

const inputCls =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400";

export function ConceptForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: ConceptFormInitial;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
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

    router.push(mode === "create" ? "/knowledge" : `/knowledge/${initial?.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm text-zinc-600">标题 *</label>
          <input name="title" required maxLength={200} defaultValue={initial?.title ?? ""} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-600">类型</label>
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
          <label className="mb-1 block text-sm text-zinc-600">标签（逗号分隔）</label>
          <input
            name="tags"
            defaultValue={initial?.tags?.join(", ") ?? ""}
            placeholder="llm, cuda"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-600">状态</label>
          <select name="status" defaultValue={initial?.status ?? "stable"} className={inputCls}>
            <option value="stable">stable</option>
            <option value="draft">draft</option>
            <option value="deprecated">deprecated</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-zinc-600">描述</label>
        <input
          name="description"
          maxLength={1000}
          defaultValue={initial?.description ?? ""}
          className={inputCls}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-zinc-600">正文（Markdown）*</label>
        <textarea
          name="body"
          required
          rows={16}
          defaultValue={initial?.body ?? ""}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
        >
          {loading ? "保存中…" : mode === "create" ? "创建" : "保存新版本"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
        >
          取消
        </button>
      </div>
    </form>
  );
}