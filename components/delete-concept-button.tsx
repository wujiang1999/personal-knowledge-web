"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteConceptButton({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onDelete() {
    if (!window.confirm("删除后条目移入回收站（可随时恢复，搜索/列表/导出立即不可见）。确定删除吗？")) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/concepts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        alert("删除失败");
        return;
      }
      router.push("/trash");
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
      {loading ? "删除中…" : "移入回收站"}
    </button>
  );
}