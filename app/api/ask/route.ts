import { NextResponse } from "next/server";
import { z } from "zod";
import { ASK_DEFAULT_K, ASK_MAX_K, executeAskTask } from "@/lib/ask";
import { requireApiUser } from "@/lib/requireUser";
import { enqueueTask, findLiveTask } from "@/lib/tasks";
import { withRoute } from "@/lib/withRoute";

/** 提问入口：入队一个问答任务并立刻返回任务 id（202），答案由任务行承载。
 * 执行是进程内 fire-and-forget（与自动摘要同一套约定，见 lib/tasks）；
 * 客户端拿 id 轮询 `GET /api/tasks/[id]`，中途刷新/离开页面都不会丢答案。
 *
 * 重复提交挡板：同一账号「同一问题」正在飞行中就直接复用那个任务——双击、
 * 客户端重试是最常见的两种重复来源，都带着完全相同的问题文本。 */

const askSchema = z.object({
  question: z.string().trim().min(1).max(500),
  k: z.number().int().min(1).max(ASK_MAX_K).optional().describe("检索条数"),
});

export const POST = withRoute("POST /api/ask", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof askSchema>;
  try {
    body = askSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const question = body.question.trim();
  const k = body.k ?? ASK_DEFAULT_K;

  const live = await findLiveTask(user, "ask", (payload) => payload.question === question);
  if (live) {
    return NextResponse.json({ id: live.id, status: live.status, deduped: true }, { status: 202 });
  }

  const id = await enqueueTask(user, { kind: "ask", payload: { question, k } });
  void executeAskTask(id, user, question, k);
  return NextResponse.json({ id, status: "queued", deduped: false }, { status: 202 });
});
