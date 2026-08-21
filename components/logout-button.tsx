"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        // Server invalidated the token_version; clear the now-dead cookie so
        // the next request doesn't briefly appear signed-in before middleware
        // catches it. httpOnly cookies can't be deleted via JS, but middleware
        // redirects to /login anyway once the session is stale.
        router.push("/login");
        router.refresh();
        return;
      }
    } catch {
      // 网络/服务失败时 httpOnly cookie 无法在客户端清除；仍跳登录页，
      // 由服务端 middleware 决定后续（token 已失效则弹回 login）。
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      onClick={logout}
      title="退出后所有设备的会话会立即失效"
      className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      退出
    </button>
  );
}