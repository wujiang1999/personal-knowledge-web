"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface UserItem {
  id: string;
  username: string;
  role: "user" | "admin";
  createdAt: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
  entryCount: number;
  keyCount: number;
}

function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—";
}

const th =
  "border-b border-zinc-200 px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400";
const td = "border-b border-zinc-100 px-3 py-2 align-top dark:border-zinc-800/60";
const btn =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

/** Admin console for accounts. Mutations hit /api/users and then
 * router.refresh() so the server component re-queries the live list; the
 * guards (no self-lockout, last admin preserved) live server-side and any
 * rejection is surfaced verbatim. */
export function UserAdmin({ users, actingUsername }: { users: UserItem[]; actingUsername: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; password: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", role: "user" });

  async function call(url: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `请求失败（HTTP ${res.status}）`);
        return null;
      }
      router.refresh();
      return data;
    } catch {
      setError("网络错误，请稍后重试");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    const data = await call("/api/users", "POST", {
      username: form.username.trim(),
      password: form.password || undefined,
      role: form.role,
    });
    if (!data) return;
    setSecret({
      title: `账号 ${form.username.trim()} 已创建`,
      password: String(data.initialPassword ?? ""),
    });
    setForm({ username: "", password: "", role: "user" });
    setShowForm(false);
  }

  async function resetPassword(u: UserItem) {
    if (!confirm(`重置 ${u.username} 的密码？该账号所有已登录会话将立即失效。`)) return;
    const data = await call(`/api/users/${u.id}`, "PATCH", { action: "reset_password" });
    if (data) setSecret({ title: `${u.username} 的新密码`, password: String(data.oneTimePassword ?? "") });
  }

  async function toggleRole(u: UserItem) {
    const next = u.role === "admin" ? "user" : "admin";
    if (!confirm(`把 ${u.username} 的角色从${u.role === "admin" ? "管理员" : "普通用户"}改为${next === "admin" ? "管理员" : "普通用户"}？`)) return;
    await call(`/api/users/${u.id}`, "PATCH", { action: "set_role", role: next });
  }

  async function toggleDisable(u: UserItem) {
    if (u.disabledAt) {
      if (!confirm(`重新启用 ${u.username}？启用后可正常登录（之前下发的密码继续有效）。`)) return;
      await call(`/api/users/${u.id}`, "PATCH", { action: "enable" });
      return;
    }
    if (!confirm(`禁用 ${u.username}？登录会被拒绝、所有会话与 API key 立即失效；知识数据保留，可随时重新启用。`)) return;
    await call(`/api/users/${u.id}`, "PATCH", { action: "disable" });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          共 {users.length} 个账号；禁用立即生效（登录被拒、会话与 API key 全部失效），数据保留可恢复。
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {showForm ? "收起" : "+ 新建账号"}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {secret && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{secret.title}</p>
          <p className="mt-1 break-all font-mono text-lg text-amber-900 dark:text-amber-100">{secret.password}</p>
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            只显示这一次，请立即复制保存；建议对方登录后在「设置」中改为自己的密码。
            <button onClick={() => setSecret(null)} className="ml-2 underline hover:no-underline">
              我已保存
            </button>
          </p>
        </div>
      )}

      {showForm && (
        <form onSubmit={createUser} className="flex flex-wrap items-end gap-3 ui-panel p-4">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">用户名（2-32 位，可中文，不含空格和符号）</span>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-44 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              required
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">初始密码（留空自动生成）</span>
            <input
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="自动生成"
              className="w-44 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">角色</span>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            创建
          </button>
        </form>
      )}

      <div className="overflow-x-auto ui-panel">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr>
              <th className={th}>用户名</th>
              <th className={th}>角色</th>
              <th className={th}>状态</th>
              <th className={th}>知识条目</th>
              <th className={th}>活跃密钥</th>
              <th className={th}>最近登录</th>
              <th className={th}>创建时间</th>
              <th className={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.username === actingUsername;
              return (
                <tr key={u.id} className={u.disabledAt ? "opacity-60" : undefined}>
                  <td className={`${td} font-medium`}>
                    {u.username}
                    {self && <span className="ml-1 text-xs text-zinc-400">（当前登录）</span>}
                  </td>
                  <td className={td}>{u.role === "admin" ? "管理员" : "普通用户"}</td>
                  <td className={td}>
                    {u.disabledAt ? (
                      <span className="text-red-600 dark:text-red-400">已禁用</span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">正常</span>
                    )}
                  </td>
                  <td className={td}>{u.entryCount}</td>
                  <td className={td}>{u.keyCount}</td>
                  <td className={`${td} whitespace-nowrap text-zinc-500 dark:text-zinc-400`}>{fmtTime(u.lastLoginAt)}</td>
                  <td className={`${td} whitespace-nowrap text-zinc-500 dark:text-zinc-400`}>{fmtTime(u.createdAt)}</td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      <button onClick={() => resetPassword(u)} disabled={busy} className={btn}>
                        重置密码
                      </button>
                      {!self && (
                        <>
                          <button onClick={() => toggleRole(u)} disabled={busy} className={btn}>
                            {u.role === "admin" ? "降为用户" : "设为管理员"}
                          </button>
                          <button onClick={() => toggleDisable(u)} disabled={busy} className={btn}>
                            {u.disabledAt ? "启用" : "禁用"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
