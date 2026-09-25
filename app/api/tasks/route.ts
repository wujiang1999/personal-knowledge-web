import { NextResponse } from "next/server";
import { z } from "zod";
import { executeAutoReviewTask } from "@/lib/quality-checks";
import { AUTO_REVIEW_DEFAULT_SIZE, AUTO_REVIEW_MAX_SIZE } from "@/lib/quality-review-contract";
import { requireApiUser } from "@/lib/requireUser";
import { executeResummarizeTask, RESUMARIZE_MAX_BATCH } from "@/lib/summary";
import { enqueueTask, findLiveTask, listTasks, TASK_KINDS, type TaskKind } from "@/lib/tasks";
import { withRoute } from "@/lib/withRoute";

/** 任务面：GET 历史、POST 入队维护类任务。
 *
 * 问答有自己的入口（`POST /api/ask`，带“同一问题在飞行中复用”的挡板）；这里
 * 收批量维护与自动审阅。kind 用 discriminated union 登记，新增任务类型必须
 * 同时更新 lib/tasks 的 TASK_KINDS。 */

const createSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("resummarize"),
    limit: z.number().int().min(1).max(RESUMARIZE_MAX_BATCH).optional().describe("本次最多处理多少条"),
  }),
  z.object({
    kind: z.literal("auto-review"),
    limit: z.number().int().min(1).max(AUTO_REVIEW_MAX_SIZE).optional().describe("本次抽查多少条"),
  }),
]);

export const GET = withRoute("GET /api/tasks", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const kindRaw = url.searchParams.get("kind");
  const kind = kindRaw && (TASK_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as TaskKind) : undefined;
  // Number(null) === 0 in JS: a missing ?limit must not become limit=1.
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null ? 20 : Math.min(100, Math.max(1, Math.trunc(Number(limitRaw)) || 20));
  const offsetRaw = Number(url.searchParams.get("offset"));
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0;

  const tasks = await listTasks(user, { kind, limit, offset });
  return NextResponse.json({ tasks });
});

export const POST = withRoute("POST /api/tasks", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  if (body.kind === "auto-review") {
    const limit = body.limit ?? AUTO_REVIEW_DEFAULT_SIZE;
    const live = await findLiveTask(user, "auto-review", () => true);
    if (live) {
      return NextResponse.json({ id: live.id, status: live.status, deduped: true }, { status: 202 });
    }
    const id = await enqueueTask(user, { kind: "auto-review", payload: { kind: "auto-review", limit } });
    void executeAutoReviewTask(id, user, limit);
    return NextResponse.json({ id, status: "queued", deduped: false }, { status: 202 });
  }

  const limit = body.limit ?? RESUMARIZE_MAX_BATCH;
  const live = await findLiveTask(user, "resummarize", () => true);
  if (live) {
    return NextResponse.json({ id: live.id, status: live.status, deduped: true }, { status: 202 });
  }

  const id = await enqueueTask(user, { kind: "resummarize", payload: { kind: "resummarize", limit } });
  void executeResummarizeTask(id, user, limit);
  return NextResponse.json({ id, status: "queued", deduped: false }, { status: 202 });
});
