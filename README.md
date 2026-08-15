# Personal Knowledge Web

个人知识库 Web 应用 —— 基于 OKF v0.2（Open Knowledge Format）交换格式的最小可用版本（MVP）。

对应《设计方案.txt》的「三层架构」中，本仓库实现的是 **Web 层**（Next.js）与 **运行时知识层**（自建 PostgreSQL + 全文检索）的最小集合。原始资料层、向量检索（pgvector）、冲突审核、LLM 原子化、Vercel Workflows 等留待后续阶段。

## 技术栈

| 模块 | 方案 |
| --- | --- |
| Web 框架 | Next.js 15 (App Router) + TypeScript |
| UI | Tailwind CSS |
| 身份认证 | 自定义用户名 + 密码（bcrypt 哈希，JWT httpOnly Cookie 会话） |
| 数据库 | 自建 PostgreSQL 16（部署在 ECS 实例） |
| 全文检索 | PostgreSQL `tsvector` + `pg_trgm` 三角模糊匹配 |
| OKF 导出 | 自研 OKF v0.2 Exporter，输出 Markdown + YAML frontmatter，打包 ZIP |

## 已实现功能（MVP）

- 登录 / 登出 / 修改密码（默认账号 `admin`）
- 知识条目 CRUD：新建、查看、编辑（**每次保存生成不可变新版本**）
- 版本历史与内容哈希（SHA-256）追溯
- 全文搜索（标题 / 正文 / 描述，中文与英文、代码关键词均可命中）
- 原始来源保留（每次录入的原始输入留存，用于可追溯与去重）
- OKF v0.2 Bundle 导出（`.okf/index.md`、`log.md`、按 type 分目录的概念 Markdown，ZIP 下载）
- 路由级 + 接口级双重鉴权（Middleware + Server Component / Route Handler）

## 目录结构

```
app/                  # 页面（登录、概览、知识、来源、设置）与 API 路由
components/           # 客户端表单与登录组件
lib/                  # 认证、数据库访问、概念 CRUD、搜索、OKF 导出
db/schema.sql         # 数据库 schema（含 pg_trgm、tsvector 触发器、索引）
scripts/migrate.ts    # 应用 schema
scripts/seed.ts       # 创建默认管理员（幂等，不覆盖已修改的密码）
middleware.ts         # 登录保护与重定向
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
DATABASE_URL=postgresql://kbapp:CHANGE_ME@127.0.0.1:5432/knowledge
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

> 本地访问实例上的数据库需先将 `DATABASE_URL` 指向可连通的地址（端口转发/隧道）。

## 部署到 Vercel

1. 将本仓库推送到 GitHub。
2. 在 Vercel 导入该仓库（框架自动识别 Next.js）。
3. 在 Vercel 项目 **Environment Variables** 中配置：
   - `DATABASE_URL` —— 指向**公网可达**的 PostgreSQL 连接串
   - `SESSION_SECRET` —— 随机 64 位 hex
   - `ADMIN_USERNAME`（可选）
4. 部署。首次需要 `npm run db:migrate` + `db:seed`（在能访问数据库的环境执行一次）。

### ⚠️ 关键：数据库网络连通性

数据库部署在**无公网 IP** 的 ECS 实例上，Vercel 的云函数无法直连私有 IP。要让生产环境可访问，需任选其一：

- **绑定公网 IP（EIP）**：给实例分配 EIP，并在阿里云安全组放行 `5432` 端口，同时实例上 `firewalld` 放行该端口；`DATABASE_URL` 指向 EIP。
- **内网穿透/隧道**：Cloudflare Tunnel、frp 等，将实例 `5432` 暴露为公网 endpoint。
- **改用云数据库**：将 `DATABASE_URL` 换成 Supabase / Neon 等托管 PostgreSQL（最省事，但需迁移数据）。

启用公网访问时，数据库侧还需：`listen_addresses = '*'`（已配置）、`pg_hba.conf` 增加对应来源的 `scram-sha-256` 条目（已为内网网段配置）、以及安全组/firewalld 放行。

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

- pgvector 向量检索 + 混合检索（RRF）
- 注入流程（Markdown/PDF/DOCX/URL）、LLM 知识原子化
- 近似去重、冲突审核、Claim 抽取
- OKF 同步到 Private Git 仓库
- 中文 PGroonga 全文检索（需在 ECS 的 PostgreSQL 16 安装 `postgresql-16-pgroonga` 扩展并 `CREATE EXTENSION pgroonga`，替换 `simple` tsvector 管线）

## 安全说明

- 数据库密码、会话密钥仅存在于本地 `.env`（已 gitignore），**不会**入库。
- 浏览器只经过 Next.js 服务端访问数据库，`DATABASE_URL` 不进入前端。
- 登录密码 bcrypt（cost 12）哈希存储，绝不存明文。
- 会话为 JWT（httpOnly cookie，7 天）；改密会提升 `token_version` 使旧会话立即失效。
- 登录有内存限流（同一用户名 15 分钟内连续失败 5 次即锁定 15 分钟）。
- 生产环境启用安全响应头（CSP、`X-Frame-Options: DENY`、`nosniff` 等），所有 `/api/*` 响应 `Cache-Control: no-store`。