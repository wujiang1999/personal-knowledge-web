import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/requireUser";
import { TASK_KINDS, listTasks, type TaskKind } from "@/lib/tasks";
import { withRoute } from "@/lib/withRoute";

/** 任务历史（目前只有问答）：倒序分页，owner 作用域（admin 看全库，与
 * /logs、/stats 同一套约定）。结果随行返回——问答记录本身就是内容。 */

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
