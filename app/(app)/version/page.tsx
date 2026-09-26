import { requireUser } from "@/lib/requireUser";
import { getBuildCommit } from "@/lib/stats";
import {
  CHANGE_KIND_LABELS,
  CHANGELOG,
  CURRENT_VERSION,
  groupChanges,
  type ChangeKind,
} from "@/lib/changelog";

/** 版本页：这台知识库现在跑的是哪一版、每一版改了什么。
 *
 * 数据来自 lib/changelog（随代码发布，同一次提交里一起改），不读数据库——
 * 它是"代码的事实"，回滚代码时记录也应随之回滚。当前运行的提交号来自
 * getBuildCommit()（与 /stats 同源，每进程缓存一次，部署重启自然失效）。
 * 上表历史批次见 DEPLOYMENT.md「变更历史」。 */

/** 分类徽标配色。与 lib/changelog 的中文标签分开：标签是数据，颜色是呈现。 */
const KIND_BADGE: Record<ChangeKind, string> = {
  security: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  fix: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  feature: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  perf: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  ops: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  docs: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const card = "ui-panel";

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function VersionPage() {
  await requireUser();
  const commit = await getBuildCommit();

  return (
    <div className="space-y-6">
      <div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          当前版本 <span className="font-medium text-zinc-900 dark:text-zinc-100">{CURRENT_VERSION}</span>
          <span className="mx-2 text-zinc-300 dark:text-zinc-700">·</span>
          运行提交 <span className="font-mono">{commit.slice(0, 7)}</span>
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          记录随代码一起发布；本页启用（2026-09-15）之前的批次见 DEPLOYMENT.md 的变更历史。
        </p>
      </div>

      <ol className="space-y-4">
        {CHANGELOG.map((entry, index) => (
          <li key={entry.version} className={`${card} p-5`}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-base font-semibold">{entry.version}</span>
              {index === 0 ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  当前
                </span>
              ) : null}
              <span className="text-sm text-zinc-500 dark:text-zinc-400">{fmtDate(entry.date)}</span>
            </div>
            <p className="mt-1 text-sm font-medium">{entry.title}</p>

            <div className="mt-3 space-y-3">
              {groupChanges(entry).map((group) => (
                <div key={group.kind}>
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${KIND_BADGE[group.kind]}`}
                  >
                    {CHANGE_KIND_LABELS[group.kind]}
                  </span>
                  <ul className="mt-1.5 space-y-1.5">
                    {group.texts.map((text) => (
                      <li
                        key={text}
                        className="flex gap-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
                      >
                        <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                        <span>{text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
