# personal-knowledge-web 优化实现计划（四方向全覆盖）

## Context

用户要求分析 `E:\ECS\personal-knowledge-web`（Next.js 15 + 自建 PostgreSQL 的个人知识库，OKF v0.2 MVP）并选定优化方向。经通读全部代码 + 双代理审查 + 亲自验证，已确认四大问题域，用户批准全部落地：**A 安全加固 / B 中文搜索 / C 数据模型完整性 / D OKF 导出 + UX**。本计划分 4 个阶段，每阶段独立可构建可运行，覆盖全部四方向。

执行前提：数据库是无公网 IP 的 ECS 自建 PostgreSQL 16（经隧道访问）；schema 当前由幂等 `db/schema.sql` + `scripts/migrate.ts` 维护。

---

## 执行顺序（4 阶段，逐阶段可提交）

| 阶段 | 内容 | 涉及 |
|---|---|---|
| **1. Schema + 数据模型 + 会话吊销** | 迁移体系、schema 变更、concepts.ts 写入端、auth token_version | C1–C5, A3, B1-索引 |
| **2. 中文搜索** | searchConcepts 重写（trigram 排序、LIKE 转义、ASCII-only FTS） | B1 |
| **3. 安全加固** | seed 强校验、登录限流、middleware 密钥、安全头/CSP、db 加固 | A1, A2, A4–A7 |
| **4. OKF 导出 + UX** | 确定性 log/frontmatter、runtime=nodejs、分页、dashboard 单查、表单/路由修复、error/loading、README | D1–D8 |

**阶段 1 是唯一动数据库的阶段**；阶段 1 结束后跑 `npm run db:migrate`，其余阶段纯代码。

---

## Phase 1 — Schema + 数据模型 + 会话吊销

### 1.1 `db/schema.sql`（改写为最终形态，保持幂等，全新安装即正确）
- 新增 `schema_migrations` 表（迁移记录）。
- `users` 加 `token_version integer NOT NULL DEFAULT 1`。
- `concepts` 删 `okf_path` 死列。
- `concept_versions` 加快照列 `title, description, category, tags text[] DEFAULT '{}', status, type`（均为可空，tags 除外）——历史版本可重建。
- `sources` 加 `concept_id uuid REFERENCES concepts(id) ON DELETE SET NULL`（删概念保留审计行）。
- 索引：删 `idx_versions_concept`；新增 `idx_concepts_desc_trgm`(GIN description)、`idx_sources_concept_id`。tsvector 触发器不变。

### 1.2 新建 `db/migrations/`（5 个文件，全部 `IF NOT EXISTS` 守卫，可重跑）
- `0001_versions_snapshot.sql`：给 concept_versions 加 6 快照列 + `UPDATE ... FROM concepts` 回填旧行（`WHERE v.title IS NULL` 守卫，重跑不覆盖真快照）。
- `0002_sources_concept_id.sql`：sources 加 `concept_id` FK + 索引。
- `0003_users_token_version.sql`：users 加 `token_version`。
- `0004_remove_okf_path_and_dup_index.sql`：`ALTER TABLE concepts DROP COLUMN IF EXISTS okf_path;` + `DROP INDEX IF EXISTS idx_versions_concept;`。
- `0005_description_trgm_index.sql`：`CREATE INDEX IF NOT EXISTS idx_concepts_desc_trgm ... GIN (description gin_trgm_ops)`。

### 1.3 `scripts/migrate.ts` 重写为迁移 runner
1. 跑 `db/schema.sql`（幂等基表）；
2. 建 `schema_migrations` 记录表；
3. 按文件名升序逐个跑 `db/migrations/NNNN_*.sql`，每个在事务内执行 + 写入版本记录；已应用则跳过。保留 `npm run db:migrate` 入口与幂等契约。

### 1.4 `lib/concepts.ts`
- 顶部加 `export class NotFoundError extends Error {}`。
- `Concept` 删 `okf_path`；`ConceptVersion` 加 6 快照列；`ExportConcept` 加 `version_created_at`；`listConcepts` 加 `offset?`。
- `createConcept`：事务内 source 插入带 `concept_id` + 内容哈希去重守卫（同概念同哈希不重复插 source）；版本插入带 6 快照列。
- `addConceptVersion`：`throw new Error("Concept not found")` 改为 `throw new NotFoundError(...)`；**元数据-only 路径同步更新当前版本行快照列**（标题/标签/状态改动立即反映到最新版本，也修 D2）；新版本路径同样加 concept_id 去重 + 快照列。
- `listConceptsForExport` SELECT 加 `v.created_at AS version_created_at`。

### 1.5 `lib/auth.ts` — JWT token_version
- `SessionPayload` 加 `tokenVersion`；`createSession` 在 JWT 里写 `tv` 声明；`getSession` 解析时缺失/非数字 `tv` → `-1`（旧 token 一律作废，需重新登录一次，属设计预期）。

### 1.6 `lib/requireUser.ts` — 权威吊销检查（关键：Edge 约束）
middleware 跑在 Edge、**无法连 pg**，故 `token_version` 比对放在 `requireUser`/`requireApiUser`（每个受保护页面/接口都调用）：查询 `users.token_version` 与 JWT 的 `tv` 不一致即 `redirect("/login")` / 返回 null。middleware 只做签名校验 + 粗粒度门禁。被吊销的 token 最坏过 middleware 门、过不了数据访问。

### 1.7 auth 路由
- `login/route.ts`：SELECT 加 `token_version`，`createSession` 传入。
- `change-password/route.ts`：`UPDATE users SET password_hash=$1, token_version=token_version+1`，再重新签发会话（当前用户不被迫下线）。

### 1.9 `concepts/[id]/route.ts`：字符串匹配改 `instanceof NotFoundError`。

---

## Phase 2 — 中文搜索（B1）

`searchConcepts` 重写（lib/concepts.ts）：
- LIKE 元字符转义：`needle.replace(/[\\%_]/g, (m) => "\\" + m)` 作为独立参数 `$2`（修 `q=%` 通配符注入）。
- FTS 分支只对含 ASCII token 的查询开启（`/[a-z0-9]/i` 取代旧的含 CJK 正则——中文走 FTS 是恒假分支）。
- 打分增强：标题 ILIKE +30、正文 ILIKE 10→15、描述 ILIKE +8、`similarity(title)*50`、**新增 `similarity(body)*20` + `similarity(description)*12`**。
- WHERE 加 `similarity(v.body_markdown, $1) > 0.05` 模糊命中（主要惠及 ASCII）。
- SELECT 去掉 `c.okf_path`。

**B2（PGroonga，仅文档不执行）**：真正的分词需在 ECS 的 PostgreSQL 16 安装 `postgresql-16-pgroonga` 扩展 + `CREATE EXTENSION pgroonga`，替换 `simple` tsvector 管线为 `USING pgroonga` 索引 + `&@~` 匹配。属服务器变更，本计划不执行，写入 README 后续阶段 + 计划作为 follow-up。用户如需可另行开启。

---

## Phase 3 — 安全加固

- **A1** `seed.ts`：去掉 `?? "990327"` 回退，`ADMIN_PASSWORD` 缺失直接 throw。
- **A2** 新建 `lib/throttle.ts`（内存 Map 登录限流）：单用户 `npm start` 单进程，无需 DB 表。失败 5 次 / 15 分钟窗口锁 15 分钟；`login/route.ts` 顶部 `isThrottled` → 429 + `Retry-After: 900`；未知用户与密码错误都 `recordFailure`（防用户名枚举）；成功 `clearFailures`。
- **A4** `middleware.ts`：`jwtVerify(token, getSessionSecret())`，缺失即 fail-fast，不再 `?? ""`。
- **A5/A6** `next.config.ts` headers()：`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`X-Frame-Options: DENY`、`Permissions-Policy`；生产环境加 CSP（`script-src 'self' 'unsafe-inline'`，因主题内联脚本 + Next 内联 hydration 引导；markdown 以 `<pre>` 纯文本渲染、非 HTML，XSS 面小）；`/api/:path*` 统一 `Cache-Control: no-store`。
- **A7** `lib/db.ts`：`pool.on("error", ...)` 兜底空闲连接异常 + `statement_timeout: 10_000`。

---

## Phase 4 — OKF 导出 + UX

- **D1/D2/D3** `lib/okf.ts`：
  - `generated.at` / `verified.at` 改用 `version_created_at`（当前版本行 created_at，元数据-only 编辑不再导致时间超前）；
  - 删除自动 `verified` 块（无审核流程，自证语义弱）；
  - `buildLog` 改为确定性：按 `version_created_at` 倒序列出每条 `- <时间> v<N> <title> (<type>)`；
  - `buildIndex` 的 `exported_at` 改用 max `version_created_at`（确定性，同一状态两次导出 zip 内容字节一致）。
- **D5** `export/okf/route.ts`：`export const runtime = "nodejs"` + 去掉 `as unknown as BodyInit` 强转。
- **D6 分页**：`listConcepts` 加 offset；`knowledge/page.tsx` 支持 `page`（每页 20，`limit: PAGE_SIZE+1` 探测 hasMore，prev/next 保留 q/category）；`api/concepts` GET 读 limit/offset 并 clamp（1–200，默认 100）。
- **D7** dashboard 单查：`listConcepts()` 一次 + `slice(0,10)` 得 recent。
- **D8 UX**：`concept-form.tsx` 元数据-only 分支加 `router.refresh()`；`login-form.tsx` 支持 `next` prop（校验相对路径防开放重定向）；`logout-button.tsx` fetch 失败 try/finally 优雅降级；新建 `app/error.tsx` + `app/loading.tsx`。
- **文档**：README 导出目录说明改 `notes|definitions|...`；`.env.example` 密码占位 `CHANGE_ME`；README 去重/安全/后续阶段同步。

---

## 验证方式（每阶段）

- **P1**：隧道上 `npm run db:migrate`（应依次 applied 0001–0005，重跑幂等）；`npx tsc --noEmit` + `npm run build`；冒烟：登录（旧 token 作废需重登）、建/改正文/仅改标题/删除（sources.concept_id 置 NULL）。
- **P2**：入库含"部署"与 "docker" 的概念；`/api/search?q=部署` 中文命中、`?q=docker%` 不报错、`?q=do` 模糊命中。
- **P3**：`db:seed` 无密码即报错；错误密码 5 次后第 6 次 429；改密后旧 token 401、新会话可用；`curl -I` 看安全头 + `no-store`；缺 SESSION_SECRET 生产环境响亮报错。
- **P4**：两次导出 unzip 后 log.md/index.md 字节一致；仅改标题后导出 `generated.at` = 版本 created_at 且无 verified 块；>20 条分页 + 分类筛选跨页保留；深链登录回跳原 URL。

## 风险与约束
- **既有数据迁移**：0001 用当前元数据回填旧版本（历史真实元数据不可恢复，个人 KB 可接受）；0002 旧孤儿 sources 的 concept_id 留 NULL；0004 删 okf_path 前先 `SELECT count(*) WHERE okf_path IS NOT NULL`（预期 0）。
- **部署即失效**：阶段 1 后所有旧会话失效（JWT 无 tv），需重新登录一次（设计预期）。
- **CSP `unsafe-inline`**：单用户可接受的取舍；可选的强硬化（主题脚本外链 + sha256 + nonce）已记录但默认不做。
- **内存限流**：进程级、重启清零，适配单机 `npm start`；未来上多实例/Serverless 再改 DB 方案。
- **≤2 字中文查询**：pg_trgm similarity 对 2 字输入近似 0，排序主要靠 ILIKE 命中；真正中文分词是 PGroonga（B2）的价值。
- **迁移事务性**：纯 DDL 在 PG 可事务化，无 CONCURRENTLY，失败干净回滚。

## 关键文件
`lib/concepts.ts`、`db/schema.sql`、`scripts/migrate.ts`、`lib/auth.ts`、`lib/requireUser.ts`、`lib/okf.ts`、`middleware.ts`、`next.config.ts`、`lib/db.ts`、`scripts/seed.ts`、`lib/throttle.ts`(新)、`db/migrations/*`(新 5 个)、`app/api/auth/*`、`app/api/concepts/*`、`app/api/export/okf/route.ts`、`app/(app)/*`、`components/*`、`README.md`、`.env.example`
