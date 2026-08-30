"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      // A 401 means the session is already dead — /login is where the user
      // wants to be anyway. Only a real server/network failure stays put, so
      // the user keeps their page and can retry.
      if (res.ok || res.status === 401) {
        // Server invalidated the token_version; clear the now-dead cookie so
        // the next request doesn't briefly appear signed-in before proxy
        // catches it. httpOnly cookies can't be deleted via JS, but the proxy
        // redirects to /login anyway once the session is stale.
        router.push("/login");
        router.refresh();
        return;
      }
      alert("退出失败，请稍后重试");
    } catch {
      alert("退出失败（网络错误），请稍后重试");
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