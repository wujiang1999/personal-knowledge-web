import { requireUser } from "@/lib/requireUser";
import { listApiKeys } from "@/lib/apiKey";
import { ChangePasswordForm } from "@/components/change-password-form";
import { ApiKeysPanel } from "@/components/api-keys";
import { OkfImportForm } from "@/components/okf-import-form";
import { ResummarizeButton } from "@/components/resummarize-button";
import { countMissingDescriptions } from "@/lib/summary";

export default async function SettingsPage() {
  const user = await requireUser();
  const [apiKeys, missingDescriptions] = await Promise.all([
    listApiKeys(user.id),
    countMissingDescriptions(user),
  ]);

  return (
    <div className="space-y-8">

      <section className="ui-panel p-6">
        <h2 className="mb-3 font-medium">账号</h2>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          当前登录：<span className="font-mono text-zinc-800 dark:text-zinc-100">{user.username}</span>
        </p>
        <ChangePasswordForm />
      </section>

      <section className="ui-panel p-6">
        <h2 className="mb-2 font-medium">API 密钥</h2>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          供机器客户端（MCP、脚本、自动化）以 <span className="font-mono">Authorization: Bearer pkb_...</span> 访问知识库。
          明文只在生成时显示一次，服务器只存哈希；吊销立即生效。被禁用账号的密钥全部自动失效。
        </p>
        <ApiKeysPanel initial={apiKeys} />
      </section>

      <section className="ui-panel p-6">
        <h2 className="mb-2 font-medium">维护</h2>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          批量补齐<b>没有描述</b>的条目（每条一次 LLM 调用，单次最多 50 条）。人工写过的描述永远不会被覆盖；
          任务在服务端后台执行，进度可在本页看到，刷新不丢。
        </p>
        <ResummarizeButton missing={missingDescriptions} />
      </section>

      <section className="ui-panel p-6">
        <h2 className="mb-2 font-medium">OKF 导出</h2>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          将全部知识导出为 OKF v0.2 Bundle（Markdown + YAML frontmatter），打包为 ZIP 下载。
        </p>
        <a
          href="/api/export/okf"
          className="inline-block rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          下载 OKF ZIP
        </a>
      </section>

      <section className="ui-panel p-6">
        <h2 className="mb-2 font-medium">OKF 导入</h2>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          上传本知识库导出的 OKF ZIP（或同格式的 Markdown 打包）。内容完全相同的条目自动复用；同名但内容不同的条目不会覆盖已有知识，会列在冲突报告里等人工裁决。
        </p>
        <OkfImportForm />
      </section>
    </div>
  );
}