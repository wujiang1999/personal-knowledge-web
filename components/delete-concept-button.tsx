"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteConceptButton({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onDelete() {
    if (!window.confirm("确定删除这条知识吗？正文和所有历史版本都会被删除，无法恢复。")) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/concepts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        alert("删除失败");
        return;
      }
      router.push("/knowledge");
      router.refresh();
    } catch {
      alert("删除失败（网络错误）");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={onDelete}
      disabled={loading}
      className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
    >
      {loading ? "删除中…" : "删除"}
    </button>
  );
}