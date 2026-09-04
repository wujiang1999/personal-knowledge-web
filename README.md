# Personal Knowledge Web

个人知识库 Web 应用 —— 基于 OKF v0.2（Open Knowledge Format）交换格式的最小可用版本（MVP）。

对应《设计方案.txt》的「三层架构」中，本仓库实现的是 **Web 层**（Next.js）与 **运行时知识层**（自建 PostgreSQL + 全文检索）的最小集合。原始资料层、向量检索（pgvector）、冲突审核、LLM 原子化、Vercel Workflows 等留待后续阶段。

## 技术栈

| 模块 | 方案 |
| --- | --- |
| Web 框架 | Next.js 15 (App Router) + TypeScript |
| UI | Tailwind CSS |
| 身份认证 | 自定义用户名 + 密码（bcrypt 哈希，JWT httpOnly Cookie 会话） |
| 数据库 | 自建 PostgreSQL 16（部署在腾讯云服务器，与应用同机） |
| 检索 | BM25（ASCII 词 + CJK bigram 分词，PostgreSQL 原生计算）+ pgvector 语义召回 RRF 融合；pg_trgm 模糊兜底 |
| OKF 导出 | 自研 OKF v0.2 Exporter，输出 Markdown + YAML frontmatter，打包 ZIP |

## 已实现功能（MVP）

- 登录 / 登出 / 修改密码（默认账号 `admin`）
- 知识条目 CRUD：新建、查看、编辑（**每次保存生成不可变新版本**）
- 版本历史与内容哈希（SHA-256）追溯
- 混合检索（标题 / 正文 / 描述）：BM25 词法评分与 embedding 语义召回 RRF 融合，返回去重 top-k；中文与英文、代码关键词均可命中
- 用量记录页（`/logs`）：查询记录（来源/命中路径/耗时）与 LLM / Embedding 调用记录（用途/模型/tokens/成败），写入侧完全 fire-and-forget
- 原始来源保留（每次录入的原始输入留存，用于可追溯与去重）
- OKF v0.2 Bundle 导出（`.okf/index.md`、`log.md`、按 type 分目录的概念 Markdown，ZIP 下载）
- 双向引用：正文中 `[[条目标题]]` 渲染为可跳转链接，详情页附「被引用」反向链接面板
- 写入时精确查重：创建内容与已有条目正文完全相同时返回 409 并指向原条目
- 只读整理报告：`npm run curate` 列出疑似重复 / 失效链接 / 缺描述 / 长期未更新
- 路由级 + 接口级双重鉴权（Middleware + Server Component / Route Handler）

## 目录结构

```
app/                  # 页面（登录、概览、知识、来源、设置）与 API 路由
components/           # 客户端表单与登录组件
lib/                  # 认证、数据库访问、概念 CRUD、搜索、OKF 导出、附件、[[链接]]
db/schema.sql         # 数据库 schema（含 pg_trgm、tsvector 触发器、索引）
scripts/migrate.ts    # 应用 schema（幂等迁移 runner）
scripts/seed.ts       # 创建默认管理员（幂等，不覆盖已修改的密码）
scripts/curate.ts     # 只读知识库整理报告（重复/失效链接/缺描述/陈旧）
proxy.ts              # 登录保护与重定向
tests/                # Vitest 单元测试（限流 / 搜索转义 / OKF / 附件 MIME / [[链接]]）
.github/workflows/ci.yml  # CI：typecheck + lint + test + build
```

## 数据库 schema

`users`、`concepts`（当前状态）、`concept_versions`（不可变历史）、`sources`（原始输入）。

核心设计遵循方案原则：

- **版本不可变**：修改知识不更新旧版本正文，而是新增一行 `concept_versions`，再更新 `concepts.current_version`。
- **原始资料不覆盖**：每次录入/编辑都写入一条 `sources` 记录（同概念、同正文哈希的重复来源会被跳过，实现去重）。
- **OKF 是交换格式**：数据库是运行时事实源，OKF 是确定性导出结果。

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

```bash
DATABASE_URL=postgresql://CHANGE_ME:CHANGE_ME@127.0.0.1:5432/knowledge
SESSION_SECRET=CHANGE_ME          # openssl rand -hex 32
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_ME          # 必填；仅 seed 首次创建时使用，seed 缺省会报错
```

## 本地运行

```bash
npm install
npm run db:migrate   # 应用 schema
npm run db:seed      # 创建默认管理员 admin
npm run dev          # http://localhost:3000
npm run build        # 生产构建
npm start            # 运行生产构建
```

> 本地访问实例上的数据库需先将 `DATABASE_URL` 指向可连通的地址（端口转发/隧道/公网 IP）。

## 质量检查（提交前跑一遍）

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint（eslint-config-next）
npm test            # Vitest 单元测试（限流 / LIKE 转义 / OKF / 附件 MIME）
npm run build       # 生产构建（等价于部署时执行）
npm run format      # Prettier（可选，格式化全库）
```

CI（`.github/workflows/ci.yml`）在 push/PR 时自动执行以上四步（typecheck/lint/test/build）。

## 部署（自托管 · 腾讯云）

应用以 systemd 服务 `personal-knowledge-web` 运行在腾讯云服务器的 `/opt/personal-knowledge-web`，监听 `127.0.0.1:3000`（仅本机），由 Caddy 反向代理对外提供 `https://sjtuai.art` 并终止 TLS；运行账号为专用低权限账号 `knowledge-web`。

更新代码并部署：

1. 通过**审核后的 git bundle** 将目标 commit 更新到服务器检出 `/opt/personal-knowledge-web`（`deploy.sh` 刻意不访问 GitHub、不改写 Git 历史）。
2. SSH 登录服务器，在检出目录执行：

```bash
sudo ./deploy.sh
```

`deploy.sh` 流程：`npm ci` → `npm run check`（typecheck + lint + test）→ `npm run db:migrate`（幂等，已应用迁移为 no-op）→ `npm run build`（当前构建自动转存为 `.next.rollback`）→ `systemctl restart` → 轮询 `http://127.0.0.1:3000/api/health` 探活 → `npm run smoke:prod` 公网冒烟测试。任一步失败自动恢复旧构建并重启，退出码 1。

> ⚠️ **生产环境必须启用 HTTPS（TLS）**。若应用绕过反代以明文 HTTP 直出公网，只能把 `SESSION_COOKIE_SECURE` 设为 `false`，会话 Cookie 将在公网明文传输，网络路径上的中间人可直接接管会话。

### TLS / HTTPS

线上由 Caddy 反向代理终止 TLS（`sjtuai.art`，证书由 Caddy 自动申请与续期），应用只监听 `127.0.0.1:3000`，生产环境保持 `SESSION_COOKIE_SECURE=true`。不要绕过反代把应用端口直接暴露公网。

## 用户管理

账号不提供自助注册（单用户知识库，公网开放注册会暴露私有数据）。新增/重置用户由部署者通过命令行完成：

```powershell
# Windows PowerShell —— 新增用户
cd E:\TXY\deployment\sjtuai.art
$env:NEW_USERNAME = 'alice'
$env:NEW_PASSWORD = '请改成强密码'
npm run db:add-user

# 重置某用户密码（并使该用户所有旧会话立即失效）
$env:RESET = '1'
npm run db:add-user
```

```bash
# Linux/macOS
NEW_USERNAME=alice NEW_PASSWORD=xxx npm run db:add-user
NEW_USERNAME=alice NEW_PASSWORD=xxx RESET=1 npm run db:add-user
```

- 密码以 bcrypt（cost 12）哈希存储，绝不落明文。
- 不带 `RESET=1` 时与 `db:seed` 一致：已存在的用户名会被跳过、不覆盖密码。
- `NEW_PASSWORD` 仅在进程环境内使用；不要把它写进 `.env` 长期留存（`.env` 已 gitignore，但仍建议用完即清）。
- 脚本读 `.env` 的 `DATABASE_URL`：在实例本地跑用 `127.0.0.1:5432`；从其它机器跑需先把 host 换成可达地址（公网 IP 或隧道）。

## 部署到 Vercel（备选方案）

1. 将本仓库推送到 GitHub。
2. 在 Vercel 导入该仓库（框架自动识别 Next.js）。
3. 在 Vercel 项目 **Environment Variables** 中配置：
   - `DATABASE_URL` —— 指向**公网可达**的 PostgreSQL 连接串
   - `SESSION_SECRET` —— 随机 64 位 hex
   - `ADMIN_USERNAME`（可选）
4. 部署。首次需要 `npm run db:migrate` + `db:seed`（在能访问数据库的环境执行一次）。

### ⚠️ 关键：数据库网络连通性

数据库部署在云服务器本机（不对公网开放 5432）。要让外部环境（如 Vercel）可访问，任选其一：

- **内网穿透/隧道**：Cloudflare Tunnel、frp 等，将服务器 `5432` 暴露为公网 endpoint（必须强制 TLS）。
- **改用云数据库（推荐）**：将 `DATABASE_URL` 换成 Supabase / Neon 等托管 PostgreSQL（托管侧自带 TLS 与访问控制，但需迁移数据）。

## 附件

每个知识概念下可上传附件（单文件 ≤ 100 MB），并支持浏览器内预览：

- **存储**：文件字节保存在服务器本地磁盘（`ATTACHMENT_DIR`，默认 `./data/attachments`，已 gitignore）；数据库 `attachments` 表只存元数据（文件名 / MIME / 大小 / 哈希 / 磁盘 key）。
- **预览**：图片（`<img>`）、PDF（`<iframe>`）、文本/代码（`<pre>`）、音视频（`<audio>`/`<video>`）原生预览；音视频支持 Range 拖动进度。其它类型走下载。
- **鉴权**：上传 / 预览 / 下载 / 删除都走登录会话（JWT cookie），文件接口不公开。
- **注意**：本地磁盘存储要求**应用与数据库同机部署（云服务器）**。若未来迁到 Vercel，需改用对象存储（OSS 等）。

## 备份与恢复

个人知识库最重要的运维动作。服务器已配置 systemd 定时备份 `personal-knowledge-web-backup.timer`：每日备份 PostgreSQL 数据库、附件、代码 git bundle 与 SHA256 校验和到 `/var/backups/personal-knowledge-web/`，保留 14 天。

```bash
sudo systemctl status personal-knowledge-web-backup.service   # 查看最近一次备份
sudo systemctl list-timers | grep backup                      # 查看下次备份时间
```

恢复演练（新空库 + 校验 SHA256SUMS + `pg_restore --list` 预检）的完整步骤见 `docs/OPERATIONS.md`。数据库与附件按同一时间戳归档，恢复时必须成对还原才能保持一致。

## OKF 导出说明

导出的 ZIP 结构：

```text
.okf/
├── index.md              # bundle 索引（okf_version: "0.2"）
├── log.md                # 变更日志
├── notes/                # 按 type 分目录（definitions/procedures/decisions/entities/references/notes）
│   └── <slug>-<id8>.md   # 每个概念一个文件
└── deprecated/...        # status=deprecated 的概念
```
每个概念文件带 YAML frontmatter，`type` 必填，并含 `status`、`generated`（`at` 取自当前版本创建时间，不受元数据-only 编辑影响）、自定义 `kb` 字段（id/version/language/content_hash/sensitivity）。

## 后续阶段（方案文档 P1–P5）

- ~~pgvector 向量检索 + 混合检索（RRF）~~ 已上线：embedding 端点已配置（见 DEPLOYMENT.md），检索为 BM25 + 语义 RRF 融合（2026-09-04 起）
- ~~注入流程（Markdown/PDF/DOCX/URL）、LLM 知识原子化~~ Markdown 已产品化：`npm run ingest`（含 §3.3.5 上下文锚定分块）
- ~~近似去重、冲突审核~~ 部分落地：写入时精确查重（409）+ `npm run curate` 整理报告；冲突审核/Claim 抽取待做
- OKF 同步到 Private Git 仓库

## 安全说明

- 数据库密码、会话密钥仅存在于本地 `.env`（已 gitignore），**不会**入库。
- 浏览器只经过 Next.js 服务端访问数据库，`DATABASE_URL` 不进入前端。
- 登录密码 bcrypt（cost 12）哈希存储，绝不存明文。
- 会话为 JWT（httpOnly cookie，7 天）；改密会提升 `token_version` 使旧会话立即失效。
- 登录有内存限流（同一用户名 15 分钟内连续失败 5 次即锁定 15 分钟）。
- 生产环境启用安全响应头（CSP、`X-Frame-Options: DENY`、`nosniff` 等），所有 `/api/*` 响应 `Cache-Control: no-store`。
- **附件上传做 magic-bytes 内容校验**：声明为位图/PDF 但内容不符会上传失败；SVG / XML / HTML 等可执行格式一律降级为 `application/octet-stream` 强制下载、**永不内联渲染**，防止存储型 XSS。
- **公网部署必须启用 TLS**（反代终止 HTTPS，保持 `SESSION_COOKIE_SECURE=true`）；不要明文 HTTP 直出公网（会话 Cookie 会被中间人窃取）。
- `/api/health` 为无需登录的健康检查端点（仅返回 `{ok, db}`，不含任何数据），供 deploy.sh 与监控探活。