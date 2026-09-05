import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/requireUser";
import { isUuid, withRoute } from "@/lib/withRoute";
import {
  checkAdminGuard,
  countAdmins,
  generatePassword,
  getUserById,
  resetPassword,
  setDisabled,
  setRole,
  validatePassword,
} from "@/lib/users";

const patchSchema = z.object({
  action: z.enum(["reset_password", "set_role", "disable", "enable"]),
  // reset_password: admin-supplied password, or a generated one when omitted.
  password: z.string().max(128).optional(),
  // set_role: the new role.
  role: z.enum(["user", "admin"]).optional(),
});

export const PATCH = withRoute(
  "PATCH /api/users/[id]",
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let body: z.infer<typeof patchSchema>;
    try {
      body = patchSchema.parse(await req.json());
    } catch {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }

    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    switch (body.action) {
      case "reset_password": {
        const password = body.password && body.password.length > 0 ? body.password : generatePassword();
        const passwordError = validatePassword(password);
        if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
        await resetPassword(id, password);
        // Shown once — every previous session dies with the token_version bump.
        return NextResponse.json({ ok: true, action: "reset_password", oneTimePassword: password });
      }
      case "set_role": {
        if (!body.role) return NextResponse.json({ error: "invalid request" }, { status: 400 });
        // Demoting an admin removes their power — self + last-admin guards apply.
        if (target.role === "admin" && body.role === "user") {
          const guard = checkAdminGuard({
            actingUserId: user.id,
            targetUserId: id,
            adminCount: await countAdmins(),
          });
          if (guard) return NextResponse.json({ error: guard }, { status: 409 });
        }
        await setRole(id, body.role);
        return NextResponse.json({ ok: true, action: "set_role", role: body.role });
      }
      case "disable": {
        const guard = checkAdminGuard({
          actingUserId: user.id,
          targetUserId: id,
          adminCount: target.role === "admin" ? await countAdmins() : null,
        });
        if (guard) return NextResponse.json({ error: guard }, { status: 409 });
        await setDisabled(id, true);
        return NextResponse.json({ ok: true, action: "disable" });
      }
      case "enable": {
        await setDisabled(id, false);
        return NextResponse.json({ ok: true, action: "enable" });
      }
    }
  }
);
