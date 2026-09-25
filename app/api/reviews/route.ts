import { NextResponse } from "next/server";
import { z } from "zod";
import {
  countReviewItems,
  enqueueReview,
  listReviewItems,
  REVIEW_KINDS,
  REVIEW_SOURCES,
  REVIEW_STATUSES,
  type ReviewKind,
  type ReviewSource,
  type ReviewStatus,
} from "@/lib/reviews";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

/** 审核队列的服务面：GET 列出待裁决/已裁决记录，POST 入队。
 *
 * 入队端点是给「不在服务端进程里」的写路径用的——目前是 MCP：它在 agent 侧
 * 判别出 conflict / merge_suggestion 后，把那份被拦下的内容交回服务端队列，
 * 否则 agent 一放弃，内容就没了。服务端自己的两条写路径（ingest CLI、OKF
 * 导入）在进程内直接调 enqueueReview，不走 HTTP。 */

const enqueueSchema = z.object({
  kind: z.enum(REVIEW_KINDS),
  source: z.enum(REVIEW_SOURCES).default("api"),
  type: z.string().min(1).max(64).default("Note"),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(64)).max(30).optional(),
  status: z.enum(["draft", "stable", "deprecated"]).optional(),
  body: z.string().min(1),
  targetConceptId: z.string().uuid().nullish(),
  targetTitle: z.string().max(200).nullish(),
  similarity: z.number().nullish(),
  score: z.number().nullish(),
  reason: z.string().max(2000).nullish(),
});

export const GET = withRoute("GET /api/reviews", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const statusRaw = url.searchParams.get("status") ?? "pending";
  const status: ReviewStatus = (REVIEW_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as ReviewStatus)
    : "pending";
  const kindRaw = url.searchParams.get("kind");
  const kind = (REVIEW_KINDS as readonly string[]).includes(kindRaw ?? "")
    ? (kindRaw as ReviewKind)
    : undefined;
  const sourceRaw = url.searchParams.get("source");
  const source = (REVIEW_SOURCES as readonly string[]).includes(sourceRaw ?? "")
    ? (sourceRaw as ReviewSource)
    : undefined;
  // Number(null) === 0 in JS: a missing ?limit must not become limit=1.
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null ? 50 : Math.min(200, Math.max(1, Math.trunc(Number(limitRaw)) || 50));
  const offsetRaw = Number(url.searchParams.get("offset"));
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0;

  const [items, total] = await Promise.all([
    listReviewItems(user, { status, kind, source, limit, offset }),
    countReviewItems(user, { status, kind, source }),
  ]);
  return NextResponse.json({ items, total });
});

export const POST = withRoute("POST /api/reviews", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof enqueueSchema>;
  try {
    body = enqueueSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const id = await enqueueReview(user, {
    kind: body.kind as ReviewKind,
    source: body.source as ReviewSource,
    payload: {
      type: body.type,
      title: body.title,
      description: body.description,
      category: body.category,
      tags: body.tags,
      status: body.status,
      body: body.body,
    },
    targetConceptId: body.targetConceptId ?? null,
    targetTitle: body.targetTitle ?? null,
    similarity: body.similarity ?? null,
    score: body.score ?? null,
    reason: body.reason ?? null,
  });
  // id 为 null = 同一份内容撞同一条目的待裁决记录已存在（幂等），不是错误。
  return NextResponse.json({ id, deduped: id === null });
});
