"use client";

import { useCallback, useEffect, useState } from "react";
// Same classification the server uses to decide inline vs download, so the
// UI can never offer a preview the API will refuse to render.
import { previewKindFor as previewKind } from "@/lib/attachment-mime";

interface Attachment {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const MAX_BYTES = 100 * 1024 * 1024;

export function AttachmentsPanel({ conceptId }: { conceptId: string }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/concepts/${conceptId}/attachments`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.attachments ?? []);
      } else {
        setError("加载附件列表失败");
      }
    } catch {
      setError("加载附件列表失败（网络错误）");
    } finally {
      setLoading(false);
    }
  }, [conceptId]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("附件不能超过 100 MB");
      return;
    }
    setUploading(true);
    setError("");
    setProgress(0);
    try {
      // XMLHttpRequest (not fetch) so we can observe upload.onprogress for a
      // real progress bar; fetch has no upload-progress event yet.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `/api/concepts/${conceptId}/attachments`);
        xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
        xhr.setRequestHeader("X-Mime", file.type || "application/octet-stream");
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setProgress(Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setProgress(100);
            resolve();
            return;
          }
          let message = "上传失败";
          try {
            message = JSON.parse(xhr.responseText).error ?? message;
          } catch {
            /* keep default */
          }
          reject(new Error(message));
        };
        xhr.onerror = () => reject(new Error("上传失败（网络错误）"));
        xhr.onabort = () => reject(new Error("上传已取消"));
        xhr.send(file);
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("删除该附件？")) return;
    try {
      const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
      if (res.ok) {
        setPreview(null);
        await refresh();
      } else {
        setError("删除附件失败");
      }
    } catch {
      setError("删除附件失败（网络错误）");
    }
  }

  async function toggleText(id: string, url: string) {
    if (text[id] === undefined) {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.text();
        setText((t) => ({ ...t, [id]: body }));
      }
    }
    setPreview((p) => (p === id ? null : id));
  }

  const url = (id: string) => `/api/attachments/${id}`;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium">附件</h2>
        <label className="cursor-pointer rounded-md bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
          {uploading ? (
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="block h-1.5 w-24 overflow-hidden rounded-full bg-zinc-500/40 dark:bg-zinc-400/40"
              >
                <span
                  className="block h-full rounded-full bg-blue-500 transition-[width] duration-200"
                  style={{ width: `${progress ?? 0}%` }}
                />
              </span>
              <span>{progress ?? 0}%</span>
            </span>
          ) : (
            "上传附件（≤100MB）"
          )}
          <input type="file" className="hidden" onChange={onPick} disabled={uploading} />
        </label>
      </div>

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无附件</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            const kind = previewKind(a.mime_type);
            const u = url(a.id);
            return (
              <li key={a.id} className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="break-all text-sm font-medium">{a.original_name}</span>
                  <span className="text-xs text-zinc-400">{formatBytes(a.size_bytes)}</span>
                  <span className="text-xs text-zinc-400">{a.mime_type}</span>
                  <span className="text-xs text-zinc-400">{new Date(a.created_at).toLocaleString("zh-CN")}</span>
                  <div className="ml-auto flex gap-2">
                    {(kind === "pdf" || kind === "text") && (
                      <button onClick={() => (kind === "text" ? toggleText(a.id, u) : setPreview(preview === a.id ? null : a.id))} className="text-xs text-blue-600 hover:underline">
                        预览
                      </button>
                    )}
                    <a href={`${u}?download=1`} className="text-xs text-blue-600 hover:underline">
                      下载
                    </a>
                    <button onClick={() => onDelete(a.id)} className="text-xs text-red-600 hover:underline">
                      删除
                    </button>
                  </div>
                </div>

                {kind === "image" && (
                  <img src={u} alt={a.original_name} loading="lazy" className="mt-3 max-h-80 rounded border dark:border-zinc-700" />
                )}
                {preview === a.id && kind === "pdf" && (
                  <iframe src={u} title={a.original_name} className="mt-3 h-96 w-full rounded border dark:border-zinc-700" />
                )}
                {preview === a.id && kind === "text" && (
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-50 p-3 text-xs dark:bg-zinc-800">
                    {text[a.id] ?? "加载中…"}
                  </pre>
                )}
                {kind === "audio" && <audio controls src={u} className="mt-3 w-full" />}
                {kind === "video" && (
                  <video controls src={u} className="mt-3 max-h-96 w-full rounded border dark:border-zinc-700" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
