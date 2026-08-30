import { NextResponse } from "next/server";
import { z } from "zod";
import { createFolder, deleteCategoryFolder, listFolders, renameCategoryFolder } from "@/lib/concepts";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";

const pathSchema = z.string().min(1).max(200);
const nameSchema = z
  .string()
  .trim()
  .min(1, "名称不能为空")
  .max(100)
  .refine((s) => !s.includes("/"), "名称不能包含 /");

const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("rename"), path: pathSchema, name: nameSchema }),
  // parent: "" moves the folder to the root level.
  z.object({ op: z.literal("move"), path: pathSchema, parent: z.string().max(200) }),
  z.object({ op: z.literal("delete"), path: pathSchema }),
  z.object({ op: z.literal("create"), path: pathSchema }),
]);

function composeNewPath(path: string, name: string): string {
  const segs = path.split("/").filter(Boolean);
  const parent = segs.slice(0, -1).join("/");
  return parent ? `${parent}/${name}` : name;
}

function composeMovePath(path: string, parent: string): string {
  const name = path.split("/").filter(Boolean).pop();
  if (!name) return path;
  const normalizedParent = parent.split("/").filter(Boolean).join("/");
  return normalizedParent ? `${normalizedParent}/${name}` : name;
}

/** List empty-folder entity paths. Concept-derived folders are not included —
 * clients can derive those from concept categories. */
export const GET = withRoute("GET /api/categories", async () => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const folders = await listFolders(user);
  return NextResponse.json({ folders });
});

export const POST = withRoute("POST /api/categories", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message : undefined;
    return NextResponse.json({ error: message || "invalid request" }, { status: 400 });
  }

  if (body.op === "create") {
    const result = await createFolder(user, body.path);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.code === "conflict" ? 409 : 400 });
    }
    return NextResponse.json({ path: body.path }, { status: 201 });
  }

  const result =
    body.op === "rename"
      ? await renameCategoryFolder(user, body.path, composeNewPath(body.path, body.name))
      : body.op === "move"
        ? await renameCategoryFolder(user, body.path, composeMovePath(body.path, body.parent))
        : await deleteCategoryFolder(user, body.path);

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.code === "conflict" ? 409 : 400 });
  }
  return NextResponse.json({ affected: result.affected });
});
