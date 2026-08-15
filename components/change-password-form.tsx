"use client";

import { useState } from "react";

const inputCls =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500";

const labelCls = "mb-1 block text-sm text-zinc-600 dark:text-zinc-300";

export function ChangePasswordForm() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    const newPassword = String(fd.get("newPassword") || "");
    const confirm = String(fd.get("confirm") || "");
    if (newPassword !== confirm) {
      setMessage({ ok: false, text: "两次输入的新密码不一致" });
      setLoading(false);
      return;
    }
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: fd.get("currentPassword"),
        newPassword,
      }),
    });
    setLoading(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMessage({ ok: true, text: "密码已修改" });
      (e.target as HTMLFormElement).reset();
    } else {
      setMessage({ ok: false, text: data.error ?? "修改失败" });
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-4">
      <div>
        <label className={labelCls}>当前密码</label>
        <input name="currentPassword" type="password" required autoComplete="current-password" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>新密码（至少 8 位）</label>
        <input name="newPassword" type="password" required minLength={8} autoComplete="new-password" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>确认新密码</label>
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={inputCls} />
      </div>
      {message && (
        <p className={`text-sm ${message.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{message.text}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {loading ? "提交中…" : "修改密码"}
      </button>
    </form>
  );
}