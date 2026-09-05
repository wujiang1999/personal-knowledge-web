import { NextResponse } from "next/server";
import { importOkfZip, OKF_IMPORT_MAX_BYTES } from "@/lib/okf-import";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

/** OKF Bundle 导入（导出的逆操作，迁移/恢复闭环的另一半）：接收导出 ZIP 的
 * 原始字节，逐文件解析并按 重复/冲突/新建 分类入库，返回逐项报告。
 * 同名不同内容的条目不会被静默覆盖——它们留在 conflicts 里等人工裁决。 */
export const POST = withRoute("POST /api/import/okf", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > OKF_IMPORT_MAX_BYTES) {
    return NextResponse.json({ error: "ZIP 过大（上限 20MB）" }, { status: 413 });
  }
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: "缺少请求体" }, { status: 400 });
  if (bytes.length > OKF_IMPORT_MAX_BYTES) {
    return NextResponse.json({ error: "ZIP 过大（上限 20MB）" }, { status: 413 });
  }

  try {
    const report = await importOkfZip(user, bytes);
    return NextResponse.json(report);
  } catch (err) {
    // JSZip throws on non-zip payloads — a user-facing 400, not a 500.
    console.error("[api] POST /api/import/okf failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "无法解析 ZIP 文件" }, { status: 400 });
  }
});
