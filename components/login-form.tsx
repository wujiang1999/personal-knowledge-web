"use client";

import { UiIcon } from "@/components/ui-icon";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { safeSameOriginPath } from "@/lib/publicUrl";

const inputCls =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "登录失败");
        return;
      }
      // Only a same-origin path is honoured — see safeSameOriginPath for the
      // `/\evil.com` open-redirect the old startsWith blacklist missed.
      const dest = safeSameOriginPath(next, "/dashboard");
      router.push(dest);
      router.refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm ui-panel p-8 shadow-sm"
    >
      <div className="mb-7 text-center"><span className="brand-mark mb-4"><UiIcon name="book" className="h-5 w-5" /></span><h1 className="text-2xl font-semibold tracking-tight">欢迎回到知识库</h1><p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">继续记录、连接与发现。</p></div>
      <div className="space-y-4">
        <div>
          <label htmlFor="username" className="mb-1 block text-sm text-zinc-600 dark:text-zinc-300">用户名</label>
          <input id="username" name="username" required autoComplete="username" className={inputCls} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm text-zinc-600 dark:text-zinc-300">密码</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={inputCls}
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60 dark:bg-brand-300 dark:text-brand-950 dark:hover:bg-brand-200"
        >
          {loading ? "登录中…" : "登录"}
        </button>
      </div>
    </form>
  );
}