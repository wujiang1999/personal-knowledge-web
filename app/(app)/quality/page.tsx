import { QualityReviewPanel } from "@/components/quality-review-panel";
import type { ReviewCardItem } from "@/components/review-queue";
import { SPOT_CHECK_DEFAULT_SIZE, SPOT_CHECK_PREVIEW_CHARS, type AutoReviewTaskResult } from "@/lib/quality-review-contract";
import { sampleConcepts } from "@/lib/quality-checks";
import { requireUser } from "@/lib/requireUser";
import { listReviewItems, mergeDraft } from "@/lib/reviews";
import { listTasks } from "@/lib/tasks";

export default async function QualityPage() {
  const user = await requireUser();
  const [initialSamples, pending, latestTasks] = await Promise.all([
    sampleConcepts(user, SPOT_CHECK_DEFAULT_SIZE).then((samples) =>
      samples.map((sample) => ({ ...sample, body: sample.body.slice(0, SPOT_CHECK_PREVIEW_CHARS) }))
    ),
    listReviewItems(user, { status: "pending", limit: 200 }),
    listTasks<AutoReviewTaskResult>(user, { kind: "auto-review", limit: 1 }),
  ]);

  const autoReviewItems: ReviewCardItem[] = pending
    .filter((item) => item.source === "auto-review")
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      source: item.source,
      title: item.title,
      targetId: item.targetConceptId,
      targetTitle: item.targetTitle,
      targetBody: item.targetBody ?? "",
      newBody: item.payload.body,
      stale: item.stale,
      mergedDraft: mergeDraft(item.targetBody ?? "", item.payload.body),
      similarity: item.similarity,
      score: item.score,
      reason: item.reason,
      createdAt: item.createdAt,
    }));

  return (
    <QualityReviewPanel
      initialSamples={initialSamples}
      latestTask={latestTasks[0] ?? null}
      autoReviewItems={autoReviewItems}
    />
  );
}
