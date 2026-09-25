import { NextResponse } from "next/server";
import { z } from "zod";
import { REVIEW_ACTIONS, resolveReview, type ReviewAction } from "@/lib/reviews";
import { requireApiUser } from "@/lib/requireUser";
import { maybeQueueAutoSummary } from "@/lib/summary";
import { isUuid, withRoute } from "@/lib/withRoute";

/** 裁决一条待办：四选一（保留旧 / 采用新 / 合并 / 分别保留），全部落到既有的
 * 不可变版本与条目写入路径上。写入先于状态，任何失败都让记录留在待裁决区。 */

const resolveSchema = z.object({
  action: z.enum(REVIEW_ACTIONS),
  /** merged 用：人工编辑后的正文；缺省回落候选正文。 */
  body: z.string().min(1).optional(),
  /** kept_both 用：新条目标题；缺省沿用候选标题。 */
  title: z.string().min(1).max(200).optional(),
});

const NOT_FOUND = { "not-found": "Not found", "already-resolved": "Not found" } as const;

export const POST = withRoute(
  "POST /api/reviews/[id]/resolve",
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let body: z.infer<typeof resolveSchema>;
    try {
      body = resolveSchema.parse(await req.json());
    } catch {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }

    const result = await resolveReview(id, body.action as ReviewAction, user, {
      body: body.body,
      title: body.title,
    });
    if (result.ok) {
      // 裁决可能刚写入新版本或新条目——没有描述的走同一套自动摘要补白。
      if (result.conceptId && (result.versionCreated ?? true)) maybeQueueAutoSummary(result.conceptId);
      return NextResponse.json(result);
    }
    if (result.reason in NOT_FOUND) {
      return NextResponse.json({ error: NOT_FOUND[result.reason as keyof typeof NOT_FOUND] }, { status: 404 });
    }
    if (result.reason === "empty-body") {
      return NextResponse.json({ error: "正文不能为空" }, { status: 400 });
    }
    if (result.reason === "target-missing") {
      return NextResponse.json(
        { error: "目标条目已被彻底删除：改用「分别保留」新建条目，或「保留旧内容」结案" },
        { status: 409 }
      );
    }
    if (result.reason === "target-changed") {
      return NextResponse.json(
        { error: "目标条目在审阅后已发生变化，请重新运行审阅后再批准，避免覆盖新修改" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "目标条目不在当前账号范围内" }, { status: 403 });
  }
);
