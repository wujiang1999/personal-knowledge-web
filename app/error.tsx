"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">出了点问题</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{error.message || "未知错误"}</p>
      <button
        onClick={reset}
        className="rounded-md bg-brand-700 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        重试
      </button>
    </div>
  );
}
