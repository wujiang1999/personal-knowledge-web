# Personal Knowledge Web

个人知识库 Web 应用 —— 基于 OKF v0.2（Open Knowledge Format）交换格式的最小可用版本（MVP）。

架构说明（模块/数据模型/API/关键机制的现状描述，随代码演进维护）见 `docs/ARCHITECTURE.md`；部署与变更历史见 `DEPLOYMENT.md`。

本仓库实现 Web 层（Next.js）与运行时知识层（自建 PostgreSQL）。当前功能及数据流以 `docs/ARCHITECTURE.md` 为准。

## 技术栈

| 模块 | 方案 |
| --- | --- |
| Web 框架 | Next.js 16 (App Router) + TypeScript |
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
- 运营统计页（`/stats` + `GET /api/stats`）：流量概览（请求总数/成功率/P50/P95，request_log）、检索质量（零结果率/检索路径分布）、API key 用量归因（调用量/成功率/知识贡献）、高频被检索条目（concepts.retrieval_count，整理信号）、库健康（向量覆盖/陈旧向量/回收站/DB 体积/部署版本，仅管理员）
- 账户管理（`/users` + `/api/users`，管理员）：创建账号（初始密码只显示一次）、重置密码、调整角色、禁用/启用——禁用立即生效（登录拒绝 + 会话作废 + 名下 API key 全部 401，数据保留可恢复），内置防自锁与「最后一名管理员」守卫；设置页自助 API 密钥管理（生成/吊销，明文仅显示一次）
- 原始来源保留（每次录入的原始输入留存，用于可追溯与去重）
- 知识问答（`/ask` + `POST /api/ask` + `GET /api/tasks[/id]`）：混合检索 → **只依据检索结果**作答 → 每条结论标 `[n]` 来源编号并可点回原文；检索不到直说「资料里没有」而不编造；**弱候选短路**：top-1 相似度（或纯词法分）低于标定门槛时直接回「关联太弱」，不再烧一次 LLM；问答历史持久化（任务行）
- 批量维护任务（`POST /api/tasks` + `/settings`「维护」）：一键补齐**没有描述**的条目（含进度与逐条结果，可中断可刷新），与问答共用异步任务表——同一类任务在飞行中不会被重复启动
- 异步任务表（`tasks`，迁移 0019）：比一次请求更久的活走「入队 → 进程内执行 → 轮询取结果」，带状态机与**执行租约**（进程中途消失的任务在下次读取时判失败，不会永远显示进行中）；当前承载知识问答、批量补描述和自动审阅
- 审核队列（`/reviews` + `GET/POST /api/reviews` + `POST /api/reviews/[id]/resolve`）：写路径拦下的内容有持久去处——ingest 命中的近似重复、OKF 导入的同名异内容、MCP 判别出的 conflict / merge_suggestion 都会入队；四种裁决（保留旧 / 采用新 / 合并 / 分别保留）全部落在不可变版本上，导航栏带待办计数
- 知识质检（`/quality`）：父页面下设「人工抽查」与「自动审阅」两个子组件。人工抽查每次随机返回 1/3/5 条当前样本，可确认无问题或报告具体问题；自动审阅由用户触发、随机抽样后逐条调用 LLM，只把有具体证据的风险和可选完整修订稿写入审核队列，批准或人工编辑后才生成新版本。质检候选带目标内容指纹，审阅后目标若已变化会拒绝批准，避免覆盖新修改
- 核心浏览优化：知识列表支持状态筛选且搜索时保留目录条件；审核队列支持类型/来源筛选；概览直接展示待审阅与质量风险；Ctrl/Cmd+K 加载全部知识供快速跳转
- MCP 集成（`personal-knowledge-web-mcp` 0.12.0，27 个工具）：补齐人工/自动质检、审核筛选、附件列表与受控删除；自动审阅必须显式确认，批量补描述、账户/密钥变更等高影响能力仍不暴露
- OKF v0.2 Bundle 导出（`.okf/index.md`、`log.md`、按 type 分目录的概念 Markdown，ZIP 下载）
- 双向引用：正文中 `[[条目标题]]` 渲染为可跳转链接，详情页附「被引用」反向链接面板
- 写入时精确查重：创建内容与已有条目正文完全相同时返回 409 并指向原条目
- 只读整理报告：`npm run curate` 列出疑似重复 / 失效链接 / 缺描述 / 长期未更新
- Claim 矛盾审计（`npm run claims [--id <uuid>] [--max N] [--write]`）：把条目正文拆成**可判断真伪的原子主张**，逐条回查库内相关条目并判定事实矛盾；默认 dry-run 只出报告，`--write` 把矛盾作为 `conflict` 写进审核队列等人工裁决（补齐「存量条目矛盾无人发现」的纠错半环）
- 路由级 + 接口级双重鉴权（Middleware + Server Component / Route Handler）

## 目录结构

```
app/                  # 页面（登录、概览、知识、来源、设置）与 API 路由
components/           # 客户端表单与登录组件
lib/                  # 认证、数据库访问、概念 CRUD、搜索、OKF 导出、附件、[[链接]]
db/schema.sql         # 基础 schema；后续演进由 db/migrations/ 维护
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
npm ci
npm run db:migrate   # 应用 schema
npm run db:seed      # 创建默认管理员 admin
npm run dev          # http://localhost:3000
npm run build        # 生产构建
npm start            # 运行生产构建
```

> 开发与测试使用独立数据库和凭据。不要把上述迁移或 seed 命令误用于生产数据库；生产更新走部署流程。

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

`deploy.sh` 流程：`npm ci` → `npm run check`（typecheck + lint + test）→ `npm run db:migrate`（幂等，已应用迁移为 no-op）→ `npm run build`（当前构建自动转存为 `.next.rollback.*`）→ `systemctl restart` → 轮询 `http://127.0.0.1:3000/api/health` 探活 → `npm run smoke:prod` 公网冒烟测试。保留旧构建后的发布步骤失败时，恢复该 `.next` 构建并重启。代码、依赖与数据库迁移不在构建回滚范围内，需分别备份和恢复。

> ⚠️ **生产环境必须启用 HTTPS（TLS）**。若应用绕过反代以明文 HTTP 直出公网，只能把 `SESSION_COOKIE_SECURE` 设为 `false`，会话 Cookie 将在公网明文传输，网络路径上的中间人可直接接管会话。

### TLS / HTTPS

线上由 Caddy 反向代理终止 TLS（`sjtuai.art`，证书由 Caddy 自动申请与续期），应用只监听 `127.0.0.1:3000`，生产环境保持 `SESSION_COOKIE_SECURE=true`。不要绕过反代把应用端口直接暴露公网。

## 用户管理

账号不提供公网自助注册。管理员可通过 `/users` 页面管理账户，也可在受控环境使用以下命令行工具：

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

## 附件

每个知识概念下可上传附件（单文件 ≤ 100 MB），并支持浏览器内预览：

- **存储**：文件字节保存在服务器本地磁盘（`ATTACHMENT_DIR`，默认 `./data/attachments`，已 gitignore）；数据库 `attachments` 表只存元数据（文件名 / MIME / 大小 / 哈希 / 磁盘 key）。
- **预览**：图片（`<img>`）、PDF（`<iframe>`）、文本/代码（`<pre>`）、音视频（`<audio>`/`<video>`）原生预览；音视频支持 Range 拖动进度。其它类型走下载。
- **鉴权**：上传 / 预览 / 下载 / 删除都走登录会话（JWT cookie），文件接口不公开。
- **注意**：当前部署依赖持久附件目录。迁往无持久本地磁盘的平台前，需调整附件存储并验证数据库连接。

## 备份与恢复

个人知识库最重要的运维动作。服务器已配置 systemd 定时备份 `personal-knowledge-web-backup.timer`：每日备份 PostgreSQL 数据库、附件、代码提交号（`app-commit.txt`）与 SHA256 校验和到 `/var/backups/personal-knowledge-web/`，保留 30 天（以 `server/backup.sh` 的 `RETENTION_DAYS` 为准）。

```bash
sudo systemctl status personal-knowledge-web-backup.service   # 查看最近一次备份
sudo systemctl list-timers | grep backup                      # 查看下次备份时间
```

源码 Git bundle 需要单独备份；提交号本身不能重建源码。当前恢复演练脚本校验备份并恢复测试数据库、检查基础表，不验证附件解包和应用启动。完整恢复还需成对恢复数据库与附件并运行应用探针，见 `docs/OPERATIONS.md`。

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
每个概念文件带 YAML frontmatter，`type` 必填，并含 `status`、`generated`（`at` 取自当前版本创建时间，不受元数据-only 编辑影响）、自定义 `kb` 字段（id/version/language/content_hash/sensitivity/title_heading）。

- `type` 是自由字符串（默认 `Note`，上限 64 字），目录归属按**词元**判定并带别名（`Reference`/`References`/`参考` → `references`，`操作步骤` → `procedures`），无法识别时落 `notes`；不会因为大小写或语言差异散落到不同目录。
- 文件里只有一个一级标题：正文自身若已以 `# {title}` 开头，导出器不再追加包装，并在 `kb.title_heading` 记为 `body`；否则追加并记为 `injected`。导入端只读这一个 `kb.*` 键——它决定要不要剥掉包装，从而保证「导出→导入」逐字节还原正文。

## 后续能力

混合检索、Markdown ingest、审核队列、Claim 审计、异步任务与 RAG 问答均已实现，见前面的功能清单。尚未纳入当前交付的能力包括：

- PDF／DOCX／URL 的自动解析录入。
- 包含历史版本和附件的全量 OKF 导出。
- OKF 同步到 Private Git 仓库。

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