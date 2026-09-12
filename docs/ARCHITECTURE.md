# personal-knowledge-web 架构说明

- **基线**：commit `1b890ab`（2026-09-08），本地 / GitHub / 腾讯云三端一致
- **评审日期**：2026-09-08
- **定位**：本文档描述系统**当前实现**的架构（模块、数据模型、API、关键机制），
  所有结论均来自对源码、schema、配置的实际阅读。与之互补：
  - `README.md` —— 功能清单与本地开发指南
  - `DEPLOYMENT.md` —— 部署手册 + 逐批次变更历史
  - `docs/OPERATIONS.md` —— 备份/监控/附件运维
  - `docs/personal-wiki-mcp.md` —— MCP 客户端集成与分发
  - `E:/TXY/personal-knowledge-web-architecture-review.md`（2026-08-28）—— 主机/安全评审

---

## 一、系统总览

单机自托管的个人知识库：Next.js（App Router，全栈单体）+ PostgreSQL 16，
Caddy 反代终止 TLS。运行时拓扑：

```
浏览器 ──https──► Caddy (43.155.203.242:443, sjtuai.art)
                    └─► reverse_proxy 127.0.0.1:3000
                          └─ personal-knowledge-web.service（systemd，账号 knowledge-web）
                               Next.js 16.3.3 生产模式（实测 node_modules 版本）
                               ├─ Server Components（页面） + Route Handlers（/api/*）
                               ├─ proxy.ts（Edge 中间件：JWT 验签 + 安全响应头）
                               └─ lib/*（pg 池、检索、LLM 客户端、用量日志）
MCP 客户端（Claude/Codex，personal-wiki）──Bearer pkb_…──► https://sjtuai.art/api/*
本机 PostgreSQL 16 @ 127.0.0.1:5432（库 knowledge；扩展 pg_trgm / pgroonga / pgvector）
附件字节 → 本地磁盘 ATTACHMENT_DIR（默认 ./data/attachments；DB 只存元数据）
外部 LLM（OpenAI 兼容）：聊天 DeepSeek（摘要/ingest/周报）；embedding DashScope
                         qwen3.7-text-embedding-flash（1024 维，semantic search；2026-09-13 切换）
```

要点：

- 应用与数据库同机，5432/3000 均只绑 127.0.0.1，公网仅 80/443（+ 加固后的 SSH）。
- 无 Redis、无队列、无独立 worker：所有异步动作（用量日志、自动摘要、embedding）
  都是**进程内 fire-and-forget**，失败只进 journal，绝不影响主流程。
- 数据面事实源是 PostgreSQL；OKF v0.2 只是确定性导出/导入的交换格式。

## 二、分层与目录职责

| 层 | 位置 | 职责 |
|---|---|---|
| 页面 | `app/(app)/` | 13 个 Server Component 页面：dashboard / knowledge（列表+详情+新建）/ ask / sources / logs / trash / reviews / settings / users / stats / graph；另有 `/login` |
| 客户端组件 | `components/`（23 个） | 表单、CodeMirror 编辑器、目录树、图谱（ECharts 动态导入）、快速切换器、版本历史、附件面板、账户控制台等 |
| API | `app/api/`（31 个 route.ts） | 全部 JSON 接口；除 `/api/health` 外每个 handler 都过 `withRoute` + `requireApiUser` |
| 领域库 | `lib/`（26 个模块） | CRUD/检索/鉴权/LLM/日志/导出等全部业务逻辑，页面与 API 共同复用 |
| 数据 | `db/schema.sql` + `db/migrations/0001–0017` | 幂等基线 schema + 编号迁移 |
| 运维脚本 | `scripts/`（12 个） | migrate / seed / add-user / create-api-key / ingest / review / curate / claims / embed-backfill / audit-attachments / smoke-production / load-env |
| 服务器侧纳管 | `server/`、`offsite/`、`Caddyfile`、`deploy.sh` | systemd 单元 drop-in、备份/恢复演练/告警脚本、异地拉取、Caddy 权威快照 —— 详见 DEPLOYMENT.md 目录映射 |

`lib` 内部依赖方向单向：路由/页面 → `lib/concepts|users|stats|…` → `lib/db|config|logs|llm|semantic`，
无环；`proxy.ts` 与 `lib/config.ts` 是仅有的 Edge 安全模块（不 import `node:path` 等）。

## 三、数据模型

基线表（`db/schema.sql`）+ 迁移增量，共 10 张核心表：

| 表 | 作用 | 关键列 |
|---|---|---|
| `users` | 账户 | `password_hash`（bcrypt cost 12）、`token_version`（会话吊销计数器）、`role`（user/admin）、`disabled_at`、`last_login_at` |
| `concepts` | 条目当前态 | `owner_id`、`type/title/description/category/tags/status`、`current_version`、`deleted_at`（回收站）、`retrieval_count`、`last_retrieved_at` |
| `concept_versions` | 不可变版本史 | 每行含**元数据快照** + `body_markdown` + `content_hash`（`sha256:` 前缀）+ `generated_by`（`human:名` / `llm:ingest:模型`）+ `content_tsv`（触发器维护，title=A、description/body=B 权重） |
| `sources` | 原始输入留痕 | 每次录入/编辑写一行（同概念同哈希去重跳过）；`concept_id` ON DELETE SET NULL —— 彻底删除后仍存为审计行 |
| `attachments` | 附件元数据 | `storage_key`（服务端生成的磁盘文件名）、mime/size/hash；字节在磁盘 |
| `api_keys` | 机器凭证 | `key_hash`（SHA-256 of `pkb_`+48hex），明文仅创建时返回一次；`revoked_at` |
| `folders` | 空文件夹实体 | `(owner_id, path)` 唯一；可见树 = folders ∪ `concepts.category` 派生 |
| `tasks` | 异步任务（迁移 0019） | `owner_id`、`kind`（ask / resummarize）、`status`（queued/running/done/failed）、`payload`/`result` jsonb、`error`、`attempts`、`started_at`/`finished_at`；**执行租约**：超期未结束的任务在读取时被判 failed（无 worker 的单实例取舍） |
| `review_items` | 审核队列（迁移 0018） | `owner_id`、`kind`（conflict/near_duplicate）、`source`（ingest/okf-import/mcp/api/claims）、`status`、`payload` jsonb（候选全文）、`content_hash`、`target_concept_id`（ON DELETE SET NULL）+ `target_title` 快照、`similarity`/`score`/`reason`、`resolved_action`/`resolved_concept_id`/`resolved_at`；待裁决集合按 (owner, 目标, 哈希) 去重 |
| `search_logs` / `llm_calls` | 用量记录（/logs） | 均带 `api_key_id` 归因列；llm_calls 记录 kind/purpose/model/tokens/成败 |
| `request_log` | 流量日志（/stats） | 每个 API 响应一行（route/method/path/status/took_ms）；插入端 2% 概率清理 180 天前旧行 |
| `concept_embeddings` | 语义向量（迁移 0013） | `PRIMARY KEY(concept_id)`、`content_hash`+`model`（陈旧判定）、`vector` 维度在首次 backfill 时钉死并建 HNSW（cosine）索引；pgvector 缺失时迁移 NOTICE 跳过、不失败 |

设计不变量：

1. **版本不可变**：修改 = 插入新 `concept_versions` 行 + 更新 `concepts.current_version`；
   回滚 = 把历史版本内容生成为**新版本**（回滚本身可再回滚）。
2. **正文未变的保存不产生新版本**：`addConceptVersion` 对同哈希走"元数据 only"分支，
   同时把新元数据镜像进当前版本行，维持「最新版本行 = 最新元数据」不变量（`lib/concepts.ts`）。
3. **两段式销毁**：DELETE 只 `trashConcept`（软删除，全查询面过滤 `deleted_at IS NULL`）；
   `?purge=1` 才真删，且仅对已回收条目生效（否则 409）。CASCADE 清版本/附件/向量，sources 保留。
4. **owner 域**：所有读写按 `owner_id` 过滤，`admin` 角色全局绕过（`requireUser` 的
   `ScopeUser` 形状贯穿 lib 层）。文件夹是 category 的派生视图 + folders 实体，
   重命名/移动 = 前缀改写，删除 = 子树条目退回根目录（不删内容）。

## 四、检索管线（`lib/concepts.ts:searchConcepts`）

BM25 + embedding 混合，五级降级链，任何一级失败都退化而不是报错：

```
查询 q
 ├─ parseSearchQuery（lib/search-syntax）：剥离 tag:/category:"…"/status: 算子
 ├─ TTL 结果缓存（默认 60s / 200 条，任意写操作整体清空；命中不落日志）
 ├─ ① BM25（单条 SQL，词法）：tokenizeQuery = ASCII 整词 + CJK bigram
 │     （≤24 词项，单数组参数 → 语句文本与词数无关）；df/tf 共用 lower()
 │     子串定义；k1=1.2 b=0.75；deprecated ×0.25 原位降权
 │     ── 与 query embedding HTTP 调用【并行】发起（省 300–700ms 跨境往返）
 ├─ ② 算子-only 查询 → 作用域内列表（独立参数数组 + 独立语句名）
 ├─ ③ 空窗口且 needle ≥3 字 → pg_trgm 模糊兜底（错字/近miss）
 ├─ ④ 词法有结果 → rerankWithSemantic：pgvector 近邻 × 词法窗口 RRF 融合（k=60）
 ├─ ⑤ 词法为空且有向量 → semantic-only 纯语义召回（合成降序分，仅首页）
 └─ 按 id 去重 top-k 输出 + 每条带 match 锚定的 500 字预览窗口
```

- **作用域一致性**：tag/category/status 算子同时下推到词法与向量召回
  （`semanticCandidates`/`rerankWithSemantic` 都收 `ParsedQuery`），修复过向量召回绕过 category 过滤的泄漏。
- **归因与观测**：每次真实检索落 `search_logs`（source=ui|api|ingest、mode、耗时）；
  ui|api 命中批量 `+1` 条目 `retrieval_count`（ingest 查重探测与缓存命中都不计）。
- **计划缓存**：BM25/算子/过滤各形态用具名 prepared statement（scope × filterShape 编码进
  语句名），每连接 parse+plan 一次；实测多引擎 SQL 冷启动 plan ~65ms 被消掉。
- **相似度信号**：语义路径的结果行携带 `similarity`（1 − cosine 距离），供 MCP 写路径
  判别降级用（阈值 0.55，2026-09-08 决策冻结不动）。
- `hasSemanticSearch` 探测按进程缓存（pgvector 扩展 + `concept_embeddings` 表 + embedding 配置三条件），
  装扩展/配 key 后必须重启服务才生效。

## 五、鉴权与安全

三条独立凭证链，两道关卡：

1. **`proxy.ts`（Edge 中间件）**——只做 JWT 验签（Edge 无 DB）：无效会话的页面请求 307 →
   `/login?next=`，API 请求 401；有效会话访问 /login 与 / 弹回 /dashboard；
   按路径设置 XFO/CSP frame-ancestors（附件端点 SAMEORIGIN/'self' 以容纳自家 PDF iframe，其余 DENY/'none'）。
   Bearer 头直接放行给路由层裁决（中间件不能查库）。
2. **会话**（`lib/auth.ts` + `lib/requireUser.ts`）——HS256 JWT（httpOnly、SameSite=Lax、7 天）；
   `token_version` 是权威吊销位：改密/登出/被禁用/被重置都 bump tv，服务端查库不匹配即失效。
   改密时**当前会话一并下线**：路由 bump tv 后清 Cookie（与 logout 同理由：Edge 验签不查库，
   陈旧 cookie 会被当成有效会话），UI 跳回 `/login`，必须用新密码重新登录（OWASP 建议）。
   签名有效但 tv 过期的会话经 `/api/auth/expire` 清 Cookie 回登录页 —— 消解过两次
   /login↔/dashboard 重定向死循环（08-28、09-04 事故）的结构性修复。
3. **API key**（`lib/apiKey.ts`）——`Authorization: Bearer pkb_<48hex>`，服务端只存 SHA-256；
   呈现 key 的请求**永不回退 cookie**（无效 key 原样 401）；禁用账号名下 key 联表过滤即时失效。
4. **口令面**：bcrypt cost 12；登录限流 `username|ip` 复合键（15 分钟 5 次失败锁 15 分钟，
   内存 Map、封顶 10k 键），防"打已知用户名把受害者锁出自己账号"的 DoS 形态；
   用户名规则 `[\p{L}\p{N}_.-]{2,32}` 支持中文。
5. **角色**：admin 绕过 owner 过滤（含继承到 MCP admin key）；账户管理面
   （`/api/users*`）admin-only，守卫 `checkAdminGuard` 拒自锁 + 保最后一名管理员；
   key/密码明文只在响应里出现一次。
6. **纵深**：`next.config.ts` 生产 CSP/nosniff/Referrer-Policy/Permissions-Policy + 全部 `/api/*`
   `Cache-Control: no-store`；请求体上限链（Caddy 128MB → `proxyClientMaxBodySize` 110MB → 应用 100MB）；
   附件 magic-bytes 校验 + SVG/HTML/XML 一律降级 octet-stream 强制下载（防存储型 XSS，
   判定逻辑抽在 `lib/attachment-mime.ts` 服务端/客户端同源）；`[id]` 路由先做 UUID 校验，
   非法 id 干净 404 而非 pg 22P02→500；Markdown 渲染为纯文本语义（`<pre>`），永不注入 HTML。

## 六、API 面（`app/api/`）

| 资源 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 免鉴权存活探针（`{ok,db}` + DB roundtrip），deploy/监控专用 |
| `/api/auth/login|logout|change-password` | POST | 会话生命周期；改密强制全端下线重新登录；`/api/auth/expire` GET 清 Cookie |
| `/api/me` | GET | 识别调用者（cookie 或 key）——`kb_whoami` 的落点 |
| `/api/concepts` | GET, POST | 列表/创建（POST 正文全同 → 409 + `existingId/existingTitle`） |
| `/api/concepts/[id]` | GET, PATCH, DELETE | 详情（含版本）/ 存新版本（同哈希→元数据 only）/ 软删除，`?purge=1` 真删 |
| `/api/concepts/[id]/restore` | POST | 回收站恢复 |
| `/api/concepts/[id]/versions/[v]/restore` | POST | 版本回滚（生成新版本） |
| `/api/concepts/[id]/attachments` | GET, PUT | 附件列表 / 裸二进制流上传（`X-Filename`/`X-Mime` 头） |
| `/api/attachments/[id]` | GET, DELETE | 取字节（`?download=1` 强制下载；Range 支持音视频）/ 删 |
| `/api/search` | GET | `?q=&limit=&offset=`，混合检索 |
| `/api/trash` | GET, DELETE | 回收站列表 / 清空 |
| `/api/reviews` | GET, POST | 审核队列列表（`?status=pending|resolved`）/ 入队（MCP 等进程外写路径用） |
| `/api/reviews/[id]/resolve` | POST | 裁决：`action=kept_old|adopted_new|merged|kept_both`，写入走不可变版本路径 |
| `/api/ask` | POST | 知识问答入队（同一问题在飞行中则复用该任务），返回任务 id（202） |
| `/api/tasks` | POST | 批量维护任务入队（`kind=resummarize`，同类在飞行中则复用），返回任务 id（202） |
| `/api/tasks` | GET | 任务历史（`?kind=&limit=&offset=`，owner 作用域；含运行中任务的进度 result） |
| `/api/tasks/[id]` | GET | 单任务轮询：`queued|running|done|failed` + 结果 |
| `/api/categories` | GET, POST | 文件夹树 / `op=create|rename|move|delete`（冲突 409） |
| `/api/sources` | GET | 原始输入留痕 |
| `/api/capture` | POST | 快速捕获（首行成标题、默认目录 `捕获/`、status=draft；故意无 GET 防 key 进访问日志） |
| `/api/graph` | GET | 链接图（节点=可见条目，边=已解析 [[链接]]/嵌入，内存解析） |
| `/api/export/okf` `/api/import/okf` | GET / POST | OKF v0.2 ZIP 导出 / 导入（同名不同内容 → conflicts 报告 + 审核队列，不覆盖） |
| `/api/logs/llm` | POST | 远端客户端（MCP judge）用量上报契约，服务端归因 apiKeyId |
| `/api/stats` | GET | 流量/检索质量/key 用量/高频条目/库健康（`?days=`，admin 全库口径） |
| `/api/users` `/api/users/[id]` | GET, POST / PATCH | admin 账户控制台 |
| `/api/keys` `/api/keys/[id]` | GET, POST / DELETE | 自助 API key（活跃上限 10，409 拦截） |

约定：所有响应 `no-store`；域错误经 `withRoute` 统一映射（`NotFoundError`→404、
`DuplicateBodyError`→409、`UserExistsError`→409、`AttachmentTooLargeError`→413，
未知异常→带路由名日志的 JSON 500）；zod 400 留在各路由内联（需要请求特定消息）。
`withRoute` 的 name 同时是 request_log 的 route 标签（`METHOD /api/...` 形态）。

## 七、LLM 集成（`lib/llm.ts|semantic.ts|summary.ts|ingest.ts`）

无 SDK，就两个 OpenAI 兼容 POST（chat/completions、embeddings），配置缺省 = 功能关闭、
调用方静默降级（`lib/config.ts` 全部返回 `null` 而非抛错）：

| 用途 | 触发点 | 关键参数 |
|---|---|---|
| `auto-summary` | 创建/新版本且 description 为空 | fire-and-forget；`maxTokens:200`、thinking 默认关（0.18s vs 16.4s 实测）；绝不覆盖人工描述 |
| `search-embed` | 每次检索（与 BM25 并行） | 输入截 4000 字；失败 → 纯词法 |
| `ingest-atomize` | `npm run ingest -- file.md [--write]` | 标题面包屑分块（≤2800 字符）→ LLM 原子化 → 查重（score≥25 或标题全同跳过）→ `generated_by=llm:ingest:<model>`；块级并发池 `INGEST_CONCURRENCY` 默认 4 |
| `claims` | `npm run claims [--write]` | 主张抽取 + 矛盾判定（每条主张 1 次判定调用，无相关候选则跳过）；`--write` 时把矛盾作为 conflict 入审核队列，dry-run 只出报告 |
| `weekly-review` | `npm run review [--write]` | 近 N 天变更分组 + LLM 叙事 → 「每周回顾」条目（重跑出新版本） |
| `resummarize` | `/settings`「维护」按钮（`POST /api/tasks`） | 批量补齐缺描述的条目：复用 `auto-summary` 的提示与写入路径（`purpose=auto-summary`），每条落一次进度；人工描述不覆盖、上限 50 条/次 |
| `ask` | `POST /api/ask`（网页 /ask、MCP `kb_ask`） | 检索 top-k → 只依据资料作答 → `[n]` 引用解析成条目 id；`maxTokens:1200`、thinking 默认关；检索为空直接回「没检索到」不烧配额 |
| `backfill` | `npm run db:embed-backfill` | 全量向量化 + 钉维度 + HNSW，幂等可重跑 |
| `chat` | 供 MCP judge 等远端使用（经 `/api/logs/llm` 上报） | — |

每次调用（成败均）落 `llm_calls`：kind/purpose/model/tokens/耗时/user/api_key 归因。
`response_format` 被 provider 4xx 拒绝时回退纯 body 重试；`extractJson` 容忍 ```json 围栏与前后杂文。

## 八、可观测性与后台任务

- 写侧三张日志表（`search_logs`/`llm_calls`/`request_log`）+ `/logs`（查询记录页）+ `/stats`
  （`lib/stats.ts`：流量总览含 P50/P95、检索路径分布——「模糊兜底/纯语义」占比高 = BM25 未接住的信号、
  key 用量与知识贡献、高频/零检索条目、向量覆盖率/陈旧向量、DB 体积、部署 commit——
  `getBuildCommit` 每进程缓存一次，deploy 重启自然失效）。
- 所有日志插入吞错（表缺失只降级日志面）；`/api/health` 不打流量日志（探针噪声）。
- 无应用内定时器；OS 层承担：备份 timer（每日，30 天保留）、smoke timer（5 分钟拨测，
  带 OnFailure 告警）、恢复演练 timer（月度）、Windows 侧异地拉取 —— 见 `server/` 与 DEPLOYMENT.md。

## 九、配置面（`.env.example` 为权威清单）

| 变量 | 消费者 / 缺省行为 |
|---|---|
| `DATABASE_URL` | `lib/db.ts` 池（`max=PG_POOL_MAX??5`，`statement_timeout=10s`，idle-error 监听防崩）；未设 → 启动即抛 |
| `SESSION_SECRET` | JWT 签名；<32 字节抛错（防伪造 HS256） |
| `SESSION_COOKIE_SECURE` | 缺省跟 `NODE_ENV=production`；仅明文直出时才允许 false |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 仅 `db:seed` 首建使用 |
| `ATTACHMENT_DIR` / `MAX_TOTAL_ATTACHMENT_BYTES` | 磁盘目录（默认 `./data/attachments`）/ 每人配额（默认 2 GiB，不得低于 100 MiB 单文件上限） |
| `LLM_BASE_URL/API_KEY/MODEL` | 聊天三件套，任一缺失 → 依赖 LLM 的功能整体关闭 |
| `LLM_AUTO_SUMMARY` | `1/on/true` 才开自动摘要 |
| `LLM_EMBEDDING_BASE_URL/API_KEY/MODEL/DIMENSIONS` | 语义检索；前三个缺省回退 `LLM_*`，`DIMENSIONS` 必填（列/索引按它钉死） |
| `SEARCH_CACHE_TTL_MS` / `SEARCH_CACHE_MAX` | 检索缓存 60s / 200 条 |
| `CAPTURE_CATEGORY` | `/api/capture` 默认目录（缺省 `捕获`） |
| `ASK_MIN_SIMILARITY` / `ASK_MIN_SCORE` | 问答弱候选门槛（0.25 / 5）：top-1 相似度低于前者、或纯词法命中低于后者时不调 LLM，直接回「关联太弱」；按 41 条库标定，语料量级变化后需重标 |
| `INGEST_CONCURRENCY` | ingest 块级并发（默认 4） |

## 十、演进与已知约束

- 迁移 0001→0017 是功能演进主线：版本快照 → pgroonga → 角色 → 文件夹 → 热路径索引 →
  语义搜索 → 用量日志 → 回收站 → 归因/stats → 多账户管理。**引用迁移新增列的索引只存在于
  迁移文件、不进基线 schema**（基线先于迁移执行，`CREATE TABLE IF NOT EXISTS` 对老库 no-op）——
  加列时沿用此惯例。
- 基座为「Web 层 + 运行时知识层」最小集；原方案中的 **冲突审核**已落地（`review_items` + `/reviews`，2026-09-10），Claim 抽取仍未实现。
- 单实例约束（个人规模权衡）：搜索缓存、登录限流、语义探测、**异步任务的执行者**均为**进程内状态**，多实例部署需先外置（`lib/throttle`、`lib/tasks` 注释已声明）。
- pgvector/pgroonga 由超级用户带外安装（迁移 NOTICE 跳过 + 脚本后补 schema），部署脚本不装扩展。
- 附件在本地磁盘 → 迁 Vercel/对象存储是 README 已声明的前提变更。
- 旧版 `middleware.ts` 约定在 Next 16 下更名为 `proxy.ts`（`next.config.ts` 里一处指向旧文件名的
  注释已随本批文档修正）。
