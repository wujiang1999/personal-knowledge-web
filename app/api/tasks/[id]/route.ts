import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/requireUser";
import { getTask } from "@/lib/tasks";
import { isUuid, withRoute } from "@/lib/withRoute";

/** 单任务轮询：客户端按 id 反复读它，直到 status 变成 done / failed。
 * 读取前会做一次租约清理（lib/tasks），所以进程中途重启留下的 running
 * 不会永远显示「进行中」。 */

export const GET = withRoute(
  "GET /api/tasks/[id]",
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const task = await getTask(id, user);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ task });
  }
);
