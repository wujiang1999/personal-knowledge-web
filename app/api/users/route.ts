import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/requireUser";
import { withRoute } from "@/lib/withRoute";
import {
  createUser,
  generatePassword,
  listUsers,
  validatePassword,
  validateUsername,
} from "@/lib/users";

/** Admin account list: every user with role, disabled state, activity
 * (last_login_at) and counters (live entries, live API keys). */
export const GET = withRoute("GET /api/users", async () => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({ users: await listUsers() });
});

const createSchema = z.object({
  username: z.string(),
  // Leave empty to have the server generate an unambiguous 12-char password.
  password: z.string().max(128).optional(),
  role: z.enum(["user", "admin"]).default("user"),
});

/** Create an account. The initial password (admin-supplied or generated) is
 * returned ONCE in `initialPassword`; only its bcrypt hash is stored. */
export const POST = withRoute("POST /api/users", async (req: Request) => {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const usernameError = validateUsername(body.username);
  if (usernameError) return NextResponse.json({ error: usernameError }, { status: 400 });

  const password = body.password && body.password.length > 0 ? body.password : generatePassword();
  const passwordError = validatePassword(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  const { id } = await createUser({ username: body.username, password, role: body.role });
  return NextResponse.json(
    {
      id,
      username: body.username,
      role: body.role,
      // Shown once by the admin console — it is not recoverable afterwards.
      initialPassword: password,
    },
    { status: 201 }
  );
});
