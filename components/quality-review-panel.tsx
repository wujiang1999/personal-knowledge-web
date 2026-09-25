import { AutoReviewPanel } from "@/components/auto-review-panel";
import type { ReviewCardItem } from "@/components/review-queue";
import { SpotCheckPanel } from "@/components/spot-check-panel";
import type { AutoReviewTaskResult, QualitySample } from "@/lib/quality-review-contract";
import type { Task } from "@/lib/tasks";

/** Server-safe composition root. The two interactive mechanisms stay isolated in
 * child components so the page can grow without turning the whole screen into a
 * single client boundary. */
export function QualityReviewPanel({
  initialSamples,
  latestTask,
  autoReviewItems,
}: {
  initialSamples: QualitySample[];
  latestTask: Task<AutoReviewTaskResult> | null;
  autoReviewItems: ReviewCardItem[];
}) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">知识质检</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">用人工抽查发现上下文问题，用模型审阅扩大样本覆盖。两者共用审核队列，任何内容修改都需明确批准并保留版本历史。</p>
      </header>
      <SpotCheckPanel initialSamples={initialSamples} />
      <AutoReviewPanel latestTask={latestTask} items={autoReviewItems} />
    </div>
  );
}
