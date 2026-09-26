"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ApiKeyItem {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  accessMode: "read" | "write" | "admin";
  expiresAt: string | null;
}

function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—";
}

/** Self-service API keys on /settings. The minted plaintext shows exactly
 * once (the server stores only a SHA-256 hash), so it renders in a highlighted
 * one-time panel until dismissed. */
export function ApiKeysPanel({ initial }: { initial: ApiKeyItem[] }) {
  const router = useRouter();
  const [keys, setKeys] = useState(initial);
  const [name, setName] = useState("");
  const [accessMode, setAccessMode] = useState<"read" | "write">("write");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/keys");
    if (res.ok) {
      const data = (await res.json()) as { keys: ApiKeyItem[] };
      setKeys(data.keys);
    }
    router.refresh();
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), accessMode }),
      });
      const data = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? `请求失败（HTTP ${res.status}）`);
        return;
      }
      setSecret(data.key ?? "");
      setName("");
      setAccessMode("write");
      await refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(k: ApiKeyItem) {
    if (!confirm(`吊销密钥「${k.name}」？使用它的客户端（MCP、脚本等）会立即 401，且明文无法找回。`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${k.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `请求失败（HTTP ${res.status}）`);
        return;
      }
      await refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {secret && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">新密钥已生成（只显示这一次）</p>
          <p className="mt-1 break-all font-mono text-sm text-amber-900 dark:text-amber-100">{secret}</p>
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            立即复制到客户端配置（KB_API_KEY）；服务器只存哈希，关掉本面板后无法再查看。
            <button onClick={() => setSecret(null)} className="ml-2 underline hover:no-underline">
              我已保存
            </button>
          </p>
        </div>
      )}

      <form onSubmit={createKey} className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="密钥名称，如：MCP 笔记本、注入脚本"
          className="w-56 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          required
        />
        <select
          value={accessMode}
          onChange={(e) => setAccessMode(e.target.value as "read" | "write")}
          aria-label="密钥权限"
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="write">读写</option>
          <option value="read">只读</option>
        </select>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          生成新密钥
        </button>
      </form>

      {keys.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">还没有 API 密钥。</p>
      ) : (
        <ul className="divide-y rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div>
                <span className={`text-sm font-medium ${k.revokedAt ? "line-through opacity-60" : ""}`}>{k.name}</span>
                <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">
                  创建 {fmtTime(k.createdAt)} · 最近使用 {fmtTime(k.lastUsedAt)}
                  · 权限 {k.accessMode === "read" ? "只读" : k.accessMode === "write" ? "读写" : "管理员"}
                  {k.expiresAt && ` · 到期 ${fmtTime(k.expiresAt)}`}
                  {k.revokedAt && ` · 已于 ${fmtTime(k.revokedAt)} 吊销`}
                </span>
              </div>
              {!k.revokedAt && (
                <button
                  onClick={() => revokeKey(k)}
                  disabled={busy}
                  className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                >
                  吊销
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
