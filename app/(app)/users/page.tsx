import { redirect } from "next/navigation";
import { requireUser } from "@/lib/requireUser";
import { listUsers } from "@/lib/users";
import { UserAdmin } from "@/components/user-admin";

/** Admin-only account console. Non-admins are bounced to the dashboard —
 * the nav link is hidden for them anyway, this is just the direct-URL guard. */
export default async function UsersPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");

  const users = await listUsers();

  return (
    <div className="space-y-6">
      <div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          创建账号、重置密码、调整角色、禁用/启用。数据隔离与角色鉴权在所有接口生效；这里的管理动作同样即时生效。
        </p>
      </div>
      <UserAdmin users={users} actingUsername={user.username} />
    </div>
  );
}
