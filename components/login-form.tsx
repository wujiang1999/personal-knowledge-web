"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const inputCls =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "登录失败");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm"
    >
      <h1 className="mb-6 text-center text-xl font-semibold">知识库登录</h1>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-zinc-600">用户名</label>
          <input name="username" required autoComplete="username" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-600">密码</label>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={inputCls}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
        >
          {loading ? "登录中…" : "登录"}
        </button>
      </div>
    </form>
  );
}