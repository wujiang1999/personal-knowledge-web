import { requireUser } from "@/lib/requireUser";
import { ChangePasswordForm } from "@/components/change-password-form";

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">设置</h1>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="mb-3 font-medium">账号</h2>
        <p className="mb-4 text-sm text-zinc-500">
          当前登录：<span className="font-mono text-zinc-800">{user.username}</span>
        </p>
        <ChangePasswordForm />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="mb-2 font-medium">OKF 导出</h2>
        <p className="mb-3 text-sm text-zinc-500">
          将全部知识导出为 OKF v0.2 Bundle（Markdown + YAML frontmatter），打包为 ZIP 下载。
        </p>
        <a
          href="/api/export/okf"
          className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          下载 OKF ZIP
        </a>
      </section>
    </div>
  );
}