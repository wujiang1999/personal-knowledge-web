import { requireUser } from "@/lib/requireUser";
import { listApiKeys } from "@/lib/apiKey";
import { ChangePasswordForm } from "@/components/change-password-form";
import { ApiKeysPanel } from "@/components/api-keys";
import { OkfImportForm } from "@/components/okf-import-form";

export default async function SettingsPage() {
  const user = await requireUser();
  const apiKeys = await listApiKeys(user.id);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">设置</h1>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">账号</h2>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          当前登录：<span className="font-mono text-zinc-800 dark:text-zinc-100">{user.username}</span>
        </p>
        <ChangePasswordForm />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-2 font-medium">API 密钥</h2>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          供机器客户端（MCP、脚本、自动化）以 <span className="font-mono">Authorization: Bearer pkb_...</span> 访问知识库。
          明文只在生成时显示一次，服务器只存哈希；吊销立即生效。被禁用账号的密钥全部自动失效。
        </p>
        <ApiKeysPanel initial={apiKeys} />
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-2 font-medium">OKF 导出</h2>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          将全部知识导出为 OKF v0.2 Bundle（Markdown + YAML frontmatter），打包为 ZIP 下载。
        </p>
        <a
          href="/api/export/okf"
          className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          下载 OKF ZIP
        </a>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-2 font-medium">OKF 导入</h2>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          上传本知识库导出的 OKF ZIP（或同格式的 Markdown 打包）。内容完全相同的条目自动复用；同名但内容不同的条目不会覆盖已有知识，会列在冲突报告里等人工裁决。
        </p>
        <OkfImportForm />
      </section>
    </div>
  );
}