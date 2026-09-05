"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 回收站操作按钮：恢复 / 彻底删除 / 清空回收站。彻底删除是唯一真正销毁
 * 数据（全部版本 + 附件）的操作，因此始终带显式确认且只在回收站可用。 */

export function RestoreConceptButton({ id, label = "恢复" }: { id: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onRestore() {
    setBusy(true);
    try {
      const res = await fetch(`/api/concepts/${id}/restore`, { method: "POST" });
      if (!res.ok) {
        alert("恢复失败");
        return;
      }
      router.refresh();
    } catch {
      alert("恢复失败（网络错误）");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onRestore}
      disabled={busy}
      className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {busy ? "恢复中…" : label}
    </button>
  );
}

export function PurgeConceptButton({ id, label = "彻底删除" }: { id: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onPurge() {
    if (!window.confirm("彻底删除将永久清除该条目的全部版本与附件，无法恢复。确定继续吗？")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/concepts/${id}?purge=1`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? "彻底删除失败");
        return;
      }
      router.refresh();
    } catch {
      alert("彻底删除失败（网络错误）");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onPurge}
      disabled={busy}
      className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
    >
      {busy ? "删除中…" : label}
    </button>
  );
}

export function EmptyTrashButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onEmpty() {
    if (!window.confirm("清空回收站将永久删除其中所有条目（含全部版本与附件），无法恢复。确定继续吗？")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/trash", { method: "DELETE" });
      if (!res.ok) {
        alert("清空失败");
        return;
      }
      router.refresh();
    } catch {
      alert("清空失败（网络错误）");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onEmpty}
      disabled={busy || disabled}
      className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
    >
      {busy ? "清空中…" : "清空回收站"}
    </button>
  );
}
