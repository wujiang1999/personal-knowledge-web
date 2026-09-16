# sjtuai.art · 个人知识库（personal-knowledge-web）部署手册

与 `wujiangai.art`（纯静态门户）不同，本站是**动态应用**：Next.js 16 + PostgreSQL，
由 Caddy 反向代理到本机 Node 服务。本地目录按域名存放完整项目源码（独立 git 仓库）。

## 架构总览

| 环节 | 值 |
|---|---|
| 域名 | `sjtuai.art`（www 301 → 裸域），DNS → 43.155.203.242（腾讯云，与门户同一台） |
| 入口 | Caddy `reverse_proxy 127.0.0.1:3000`（配置：`/etc/caddy/Caddyfile`，快照见本目录 `Caddyfile`） |
| 应用 | Next.js 16 生产模式，systemd 服务 `personal-knowledge-web.service` |
| 代码（服务器） | `/opt/personal-knowledge-web`（git 检出，运行账号 `knowledge-web` 属主） |
| 运行账号 | `knowledge-web`（专用低权限账号，`HOME=/var/lib/knowledge-web`） |
| 数据库 | 本机 PostgreSQL 16（systemd 依赖 `postgresql.service`） |
| Embedding | `qwen3.7-text-embedding-flash`，DashScope OpenAI 兼容接口，1024 维（2026-09-13） |
| 本地源码 | 本目录（git 仓库，origin = github.com/wujiang1999/personal-knowledge-web） |

## 目录映射

| 本地（相对于 `deployment/sjtuai.art/`） | 服务器 | 说明 |
|---|---|---|
| 项目全部源码（`app/`、`lib/`、`db/` 等） | `/opt/personal-knowledge-web` | 经审核的 git bundle 更新服务器检出 |
| `deploy.sh`（项目根自带） | 同名文件 | **服务器端**部署脚本，以 root 运行 |
| `Caddyfile` | `/etc/caddy/Caddyfile` | Caddy 配置快照，可能落后于线上；变更前先比对实际配置 |
| `server/` | 各自路径 | 服务器侧配置纳管：`backup.sh`(→/usr/local/sbin/personal-knowledge-web-backup)、`restore-drill.sh`(→/usr/local/sbin/personal-knowledge-web-restore-drill)、`kb-notify.sh`(→/usr/local/sbin/kb-notify)、`fail2ban-jail.local`(→/etc/fail2ban/jail.local)、`*.service`/`*.timer`(→/etc/systemd/system，见下)、`systemd-drops/*.conf`(OnFailure 告警 drop-in) |
| ↳ `server/personal-knowledge-web.service` | `/etc/systemd/system/` | 主应用重建模板；安装前核对实际监听及沙箱参数，线上监听 127.0.0.1:3000 |
| ↳ `server/personal-knowledge-web-{backup,smoke,restore-drill,claims,curate}.{service,timer}` | `/etc/systemd/system/` | 定时/触发单元。名称必须与 `systemd-drops/<unit>.service.alert.conf` 一致，否则 `OnFailure` 告警不会挂上 |
| `offsite/pull-kb-offsite.ps1` | —（Windows 侧） | 历史 Windows 异地拉取脚本；Mac 接替与实际调度状态需独立验证 |
| `DEPLOYMENT.md` | 不上传 | 本文档 |

## 部署流程

MCP 客户端 `personal-wiki` 的注册迁移、独立三端同步路径及验证流程见
[personal-wiki MCP integration](docs/personal-wiki-mcp.md)。

1. 本地开发、提交（`npm run check` = typecheck + lint + test）。
2. 代码以**审核后的 git bundle** 方式传到服务器，更新 `/opt/personal-knowledge-web` 检出
   （服务器脚本刻意不直接从 GitHub 拉取）。
3. SSH 到服务器，在检出目录执行 `sudo ./deploy.sh`，脚本自动完成：
   `npm ci` → 校验 → `db:migrate`（幂等）→ 构建（旧构建存为 `.next.rollback.*`）→
   `systemctl restart` → 健康检查（`/api/health`）→ 冒烟测试（`npm run smoke:prod`）。
   保存旧构建后的步骤失败时恢复 `.next` 并重启；代码、依赖和数据库迁移需要独立恢复方案。
4. 浏览器验证 https://sjtuai.art

## 常用运维

```bash
systemctl status personal-knowledge-web        # 服务状态
journalctl -u personal-knowledge-web -f        # 应用日志
sudo systemctl restart personal-knowledge-web  # 重启
curl http://127.0.0.1:3000/api/health          # 服务器本机健康检查
```

备份、账号管理等见项目内 `docs/OPERATIONS.md`。

## 注意事项

- 当前部署目标为腾讯云，代码更新走 bundle。下方变更历史中的旧主机、版本及验证数字只描述当时状态。
- 安全加固：现有 systemd 单元启用 `NoNewPrivileges`、`ProtectSystem=full`；实际可写范围以 `systemctl cat` 和文件权限为准。
  ubuntu 账号读不了 `/opt/personal-knowledge-web` 属预期行为（需 sudo）。
- Caddy 层无静态文件：改 Caddy 配置后 `sudo systemctl reload caddy`，并同步更新本目录快照。

## 变更历史

- 2026-09-16（检索方案重构：BM25F + 章节定位 + 块级语义召回，e3202e6 → 修复 34ce25d）：
  按「P0→P1 逐步重构」清单落地，**全部为检索与导出层改动，无迁移、无数据变更**。
  **① BM25F**——`lib/bm25.ts` 给出参考实现（字段权重 title 2 / description 1.25 / body 1，
  逐字段按自身均长归一），SQL 用新的 `stats` CTE 取代原先「三字段拼一个 bag 共用一个 tf」的
  打分；测试钉死字面量数值。**注意：词法分尺度整体上移（标题命中最高约 2×），
  `ASK_MIN_SCORE` 与 ingest 查重的 `score ≥ 25` 仍是旧尺度标定值，尚未重标**（已写入
  `.env.example` 与 `ARCHITECTURE.md`）。**② `type:` 算子**——大小写不敏感；算子名加词边界
  （`hashtag:x`/`filetype:pdf` 不再被误剥）；并修复 trgm 兜底此前**完全忽略算子过滤**的泄漏。
  **③ `section`**——结果与 ask 资料都带命中处的章节路径（新 `lib/headings.ts`，围栏代码感知），
  内部锚点 `match_at` 不出响应。**④ 块级语义召回**——HNSW top-N chunk 池 + 抬高
  `hnsw.ef_search` + 按概念聚合，取代用不上向量索引、每次全扫作用域 chunk 的
  `DISTINCT ON (concept_id)`。**⑤ OKF**——type→目录别名；`kb.title_heading` 让导出文件只有一个
  H1 且导出/导入仍逐字节还原；`npm run curate` 新增「正文首行 H1 与标题重复」一节。
  **⑥ 事故与修复**——首发（e3202e6）上线后 `/api/search` 全部 500：`CROSS JOIN stats s` 写在
  LATERAL **之后**，而 LATERAL 只能看到其左侧的 FROM 项（改动前的写法把统计子查询放在外层
  选择列表，故不受此约束）。健康检查与冒烟测试都不覆盖检索，脚本按「构建成功」收尾。
  34ce25d 把 `stats` 前移。**验收**：本地 `npm run check` 通过（326 测试）+ 生产构建；
  修复后先用 `EXPLAIN`（仅计划、不执行）把四条语句（BM25F / 算子列表 / trgm / 语义 chunk
  + `hnsw.ef_search`）在生产库上验到 4/4 解析通过，再 FF + `deploy.sh`；
  上线后实测 `kb_search`：BM25F 分数生效（标题命中 26.47）、`type:Reference` 过滤生效
  （40→8 条且全为 Reference）、语义独有行带 `section`（score=2 的 RRF 尺度也如实存在）。
  MCP 侧同步 types/tools/README 契约描述并推送，三端 HEAD 一致（01082d9）。

- 2026-09-13（Embedding 模型切换）：从 `text-embedding-v4` 切换为
  `qwen3.7-text-embedding-flash`，保留原百炼端点、密钥及 1024 维。先离线准备
  48 条新向量（47 条有效知识 + 回收站 1 条），再短暂停服务，在事务内校验源数据
  未变化并全量替换，修改 `.env` 后启动服务；切换到健康检查成功耗时 1.9 秒。
  原配置及旧向量保存在服务器私有目录
  `/var/lib/knowledge-web/embedding-switch-20260913/`，用于回滚，不进入 Git。
  **接口兼容性**：四输入实测返回四个 `index=0`，因此该模型的回填改为逐条请求，
  不依赖不明确的批量响应顺序；在线搜索及写入原本就是单输入。
  **验收**：新向量 48/48、维度一致、正文哈希陈旧数 0；实际 MCP 搜索成功且
  服务端 `search-embed` 日志确认新模型；`npm run check` 通过（182 测试，
  0 lint 错误、3 条既有警告）。本批仅修改配置、回填脚本与文档，无应用构建代码变更。

- 2026-09-12（性能与卫生批次：死索引清理 + 向量自愈 + 查询缓存 + 周度节奏，bb05e32）：
  stats 实测驱动的一批。**① 死索引清理（迁移 0020）**——09-04 检索改造后 pgroonga/tsquery
  代码路径已全部移除，但 `idx_versions_body_pgroonga`/`idx_concepts_title_pgroonga`/
  `idx_versions_tsv` 与 `content_tsv` 列留在库中，每次写版本都在白维护两套 Groonga 倒排 +
  tsvector 触发器；且 pgroonga 落盘文件是稀疏文件，`pg_database_size`/`du -sb` 读 apparent
  体积虚报 294MB（实际 22MB）。0020 drop 三索引+触发器+函数+列，schema.sql 摘除 pgroonga
  依赖，0007/0008 改按扩展/列存在性守卫（照 0013 模式，无 pgroonga 包的全新装机也能干净
  迁移）；顺带 `DROP EXTENSION pgroonga` 并清除孤儿 `pgrn.*`（drop 不删文件，root shell
  glob 清理），库体积 294MB → **15MB**；pg_trgm 保留（错字兜底仍用）。**② stats db_size
  修正**——`pg_database_size()` 换成用户表+索引+toast 真实字节口径（/stats "DB 体积"
  294MB → 6480 kB）。**③ 向量覆盖率自愈**——手动 backfill 把 15/47 补到 **47/47（100%）**；
  新增 `queueConceptEmbedding`（lib/semantic.ts）：createConcept/addConceptVersion 提交后
  fire-and-forget upsert（与 embed-backfill 同文本构造/同 upsert，purpose=backfill 归因经
  route/reviews/review 调用方透传），失败仅记日志、由下一次写入或 backfill 自愈——覆盖率
  不再依赖手动脚本。线上验证：MCP 建临时条目 → `concept_embeddings` 立即出现该行（188ms）
  → purge 后 CASCADE 清除。**④ 查询向量 LRU**——`cachedQueryVector`（TTL 1h / 200 条，
  `QUERY_EMBED_CACHE_TTL_MS`/`QUERY_EMBED_CACHE_MAX` 可调）：重复查询免 300-700ms 跨境
  embedding 调用。线上验证：同 query 在 >60s 结果缓存过期后再查，无新 search-embed 调用，
  took_ms 293→101ms。**⑤ favicon**——`app/icon.png` 1254px/556KB → 64px/4.6KB（每页 head
  直接受益）。**⑥ 周度运维节奏**——新增 `personal-knowledge-web-claims.timer`（周日 05:00，
  `npm run claims -- --write`，矛盾自动进审核队列）与 `personal-knowledge-web-curate.timer`
  （周六 05:00，只读报告）；OnFailure 走既有 kb-alert@ 通知链。**⑦ 判别面核实（无改动）**
  ——judge 关 thinking 已于 09-10 默认生效（线上 judge completion tokens 21-30），三处 MCP
  客户端 env 均未设 `KB_LLM_THINKING`；DashScope 国际版端点实测现有 CN key 返回 401，
  仍待国际版 key（遗留，09-04 已记录）。**⑧ LLM key 轮换——用户裁决跳过**（2026-09-12）：
  omp key（DeepSeek，服务器 LLM_API_KEY 与 MCP judge 同用）与 DashScope embedding key 的
  历史终端泄漏面（09-05 对齐报告遗留项）经用户裁决接受、不轮换，遗留项就此结案。轮换尝试
  在控制台创建环节被用户中止，误建的 `personal-kb-r5` key 的本地临时副本已删，控制台内该行
  待用户手动删除。本地 182 测试 + 生产构建过，deploy.sh 门禁部署。
- 2026-09-10（Claim 矛盾审计：纠错闭环的另一半）：写入侧早有查重（409 + 判别），但**存量条目之间的矛盾从来没人发现**——两个条目各说各话、数值相反，只有人正好同时读到才会察觉。本批把「Claim 抽取」按最小可用口径落地：`npm run claims [--id <uuid>] [--max N] [--write]`。**① `lib/claims.ts`**——抽取提示要求"可判断真伪的原子陈述"，把提问句/目录句/过渡句挡在外面（`parseClaims`：去重、截断 200 字、单条上限 8 条）；每条主张用既有混合检索回查库内相关条目（排除自身），**先过相关度门槛**（复用问答那套「库里有没有相关内容」的标定：有相似度按 0.25、纯词法按 5），低于门槛直接跳过——找不到落脚点的主张做矛盾判定只是白烧一次调用；有候选才让模型判 `consistent|contradicts|unrelated`。**② 落点解析取保守口径**——`parseClaimVerdict` 接受截断 id 或标题匹配（模型会改写长 uuid），对不上就**降级成 unrelated**：宁可漏报一条，也不把找不到落点的判定送进队列。**③ 矛盾入队**——`--write` 时把矛盾作为 `conflict` 写进审核队列（新增来源 `source=claims`，标签「Claim 审计」），候选内容就是那条主张本身（正文带出处：《源条目》+ 原句片段 + 判定理由），于是四种裁决都有意义：采用新内容=修正目标条目、合并=人工改写、分别保留=把主张建为新条目、保留旧内容=驳回。**④ 默认只读**——与 `ingest`/`curate` 同一惯例：dry-run 打印条目数/主张数/判定数/跳过数/矛盾清单，`--write` 才落库。测试 `tests/claims.test.ts` 8 条（抽取清洗、越界 id 降级、判定枚举）。本地 `npm run check` 182 测试 + `npm run build` 通过。
- 2026-09-10（弱候选短路 + 批量维护任务）：上一批观察到的两处立即可做的改进。**① ask 弱候选短路**——无关提问此前也会走完整条链路烧一次 LLM：这个 41 条的库里混合检索几乎从不空手而归（trgm 兜底 + 语义召回总能凑出几条），原「检索为空」短路形同虚设。先标定再动手：10 个问题线上检索 top-1 —— 相关题相似度 0.34/0.50/0.63、纯词法 8.26/29.48；无关题相似度 0.12/0.15/0.16、纯词法 3.68。据此定两条门槛：**有相似度按相似度判（< 0.25 太弱），没有相似度（纯词法路径）按词法分判（< 5 太弱）**，命中即直接回「检索到的内容与这个问题关联太弱（最高相似度 x）」并把命中的条目列出来，不调 LLM。**已知漏网**：语义兜底对无关短串也会打出 0.31 相似度 + 合成分 100（合成分不能用），这类会放行、由模型自己回「资料里没有」——宁可多烧一次，也不把相关提问误判成无关（标定集上 9/10 正确分类、零假阴性）。两个门槛可用 `ASK_MIN_SIMILARITY` / `ASK_MIN_SCORE` 覆盖（`.env.example` 已写），换语料或库量级变化后应重标。**② 批量维护任务（任务表第二个生产者）**——`kind=resummarize`：一键补齐缺描述的条目（`POST /api/tasks`，≤50 条/次，同类任务在飞行中复用），每条落一次进度（新增 `progressTask`，只更新 result 不动状态），刷新页面也不丢；`/settings` 新增「维护」区带按钮与 x/y 进度。顺手把 `LLM_AUTO_SUMMARY` 开关从 `generateSummaryForConcept` 移到 `maybeQueueAutoSummary`：它管的是「每次保存后的自动花费」，不该拦住用户显式发起的批量补齐（自动路径行为不变）。任务轮询从 AskPanel 抽出 `lib/task-poll`（间隔/超时/「超时不等于失败」只有一处定义），问答面板与维护按钮共用。**③ 端点暴露口径**——`POST /api/tasks` 有意不暴露为 MCP 工具（与账号管理同类：全库 LLM 消耗 + 人为触发的维护动作），已在两份 README 的契约章节写明。本地 `npm run check` 174 测试（新增弱候选 2）+ `npm run build` 通过。
- 2026-09-10（异步任务表 + 知识问答批次）：规划里两个推迟项的合并落地——问答合成要 5-30 秒，塞进一个 HTTP 请求既撞超时也没法离开页面再回来取结果，于是**任务表**先有了真实生产者，不再是空转基础设施。**① 迁移 0019 `tasks`**——`queued → running → done|failed` 状态机 + `payload`/`result` jsonb + `attempts`；执行者是进程内 fire-and-forget（与自动摘要、用量日志同一套约定，本部署没有 worker），因此设**执行租约**：`coalesce(started_at, created_at)` 超过 5 分钟的任务在下一次读取时被判 failed，且区分「入队后未被启动」与「执行中进程消失」两种文案——单实例部署里"永远显示进行中"是最坏的失败形态，宁可明确判死。租约清理挂在读取路径（getTask/listTasks 先清后读），没有定时器。自动重试本批不做（问答不写库，重试的唯一收益是绕过偶发失败，让用户重问更简单）。**② RAG 带引用问答**（`lib/ask.ts` + `/ask` 页 + `POST /api/ask` + `GET /api/tasks[/id]`）——检索复用既有混合检索（BM25+语义 RRF，`source=api`，命中照常计 retrieval_count），随后把 top-k 的**全文**（搜索只给 500 字窗口，不够作答；一条 `ANY(ids)` 取回）按 `[n]` 编号喂给 LLM，提示词三条硬规则：只用资料、逐句标来源编号、资料不足就直说。`parseAskAnswer` 把 `[n]` 解析成条目 id 并**删掉越界编号**（模型会引用不存在的 `[7]`，留着就是点不开的假引用），答案里的 Markdown 由 `ConceptBody` 在服务端渲染（客户端不引 markdown 库）。检索为空时不烧 LLM，直接回「没检索到」。**③ 抗重复与可回看**——同一问题在飞行中直接复用该任务（双击/客户端重试的挡板）；问答历史留在任务行，`/ask` 页可回看答案与出处；`/logs` 的 purpose 增加「知识问答」。**④ MCP v0.10.0 同步**——新增 `kb_ask`（服务端同步等待，超时返回 `taskId` 而不是丢答案），工具数 21→22，README 工具参考/Agent 守则/典型工作流同步。**⑤ MCP judge 关 thinking（09-04 记录的待决权衡，本批实测后落地）**——判别是「给定材料做短判决」的机械任务，reasoning tokens 基本是延迟。实测（线上端点、同一输入）：短判决（ok/conflict）thinking 开 **1.1-2.0s / 80-264 completion tokens**、关 **0.6-1.0s / 24-54 tokens**；纯判决提示的直接 A/B 差距更大（6.2-6.8s / 1700-1842 tokens → 0.9-1.0s / 93-109 tokens）。**merge 判决两种模式都在 ~6.3-6.7s**——那颗成本在生成 mergedBody（1500+ tokens）而非推理，关思考省不掉。回归集三条（同题同文→merge、全新主题→ok、同题异内容→conflict）在开关两种模式下判定完全一致且均无规则降级。请求阶梯从两级（JSON 模式 → 纯 body）改为三级（JSON+关思考 → 关思考 → 纯 body），严格 provider 仍能落到可用调用。**残余风险与逃生开关**：A/B 用较薄的提示时，同一案例在关思考下从 merge 翻成 ok（判别质量确实吃推理），因此新增 `KB_LLM_THINKING=on` 恢复 provider 默认，README 配置表已写明；默认仍是关（快 2-7 倍）。本地 `npm run check` 172 测试（新增 ask 7）+ `npm run build` 通过；MCP 侧 typecheck + 87 测试通过。
- 2026-09-10（冲突审核队列批次：把「人工裁决」补成闭环）：规划里「重复/冲突治理」一直只有前半套——三处写路径都能*发现*相似与冲突，却没有一处能*安放*：ingest CLI 的近似重复跳过即遗忘、OKF 导入的冲突只活在一次性报告里、MCP 判出的 conflict 只回给 agent 一句话。内容被拦下就等于被丢弃，「留人工裁决」没有入口。本批补上后半套。**① 迁移 0018 `review_items`**——一行待裁决记录 = 候选全文（`payload` jsonb）+ 撞上的目标条目（`target_concept_id`，ON DELETE SET NULL + `target_title` 快照）+ 来源（ingest/okf-import/mcp/api）+ 判别信号（`similarity`/`score`/`reason`）；待裁决集合按 (owner, 目标, 正文哈希) 去重，重复 ingest 不会灌满队列（`.reviews` 里 WHERE NOT EXISTS 覆盖 NULL 目标，唯一部分索引兜住并发）。**② 三处入队**——ingest CLI 查重命中时入队（dry-run 仍零写入，只有 `--write` 才落记录）、OKF 导入的 conflict 分类入队并在报告里回带 `reviewId`、MCP 的 conflict/merge_suggestion 经新端点 `POST /api/reviews` 入队。**③ 四出口裁决**——`POST /api/reviews/[id]/resolve`：`kept_old` 只结案、`adopted_new`/`merged` 给目标条目生成新版本、`kept_both` 新建条目；全部走既有不可变写入路径（`addConceptVersion`/`createConcept`），先写库后落状态，裁决本身可再回滚。**④ `/reviews` 裁决台**——待裁决卡片带行级差异（抽出共用 `components/diff-view.tsx`，与版本对比同一套视觉）、合并草稿（旧正文 + `---` + 候选正文，人工删减后保存）、四种动作按钮；已裁决历史收在折叠面板；导航「审核」带待办计数徽标（`NavLinks` 增加可选 `badge`）。**⑤ MCP v0.9.0 同步**——新增 `kb_list_reviews`/`kb_resolve_review`，create/update 的 conflict/merge_suggestion 结果附带 `reviewId`（入队失败标 `reviewError`，绝不让裁决本身失败），工具数 19→21（v0.8.0 的 `kb_upload_attachment` 当时没更新 smoke 断言与 README 计数，本批一并修正为真实值），README 工具参考与 Agent 守则同步。本地 `npm run check` 165 测试（新增 reviews 9）+ `npm run build` 通过；MCP 侧 typecheck + 84 测试通过。**⑥ 修掉线上实测暴露的两个缺陷（都由本批新界面/新链路当场发现）**——**(a) OKF 往返不保真**——用真实导出包回灌验证导入入队时发现 42 条里 29 条被判成「同名异内容」冲突，逐条比对后定位：`parseOkfMarkdown` 把正文规范化成 `trim() + "\n"`，而导出器写的是 `body + "\n"`——凡是正文不以换行结尾的条目（本次 29 条）回灌后哈希必差一个字节，整包恢复会变成一屏假冲突（此前只污染一次性报告，本批起会灌满审核队列）。改法：`stripExportHeading` 改为导出器包装的**精确逆变换**（去掉一个前导空行、H1、一个空行、一个结尾换行，其余一字不动），`parseOkfMarkdown` 不再 trim/补换行；新增往返契约测试（任意正文形态逐字节还原）。修后同一导出包回灌：42 条全部判为重复、0 冲突。**(b) 导出/图谱/导入共用的读取面漏了回收站过滤**——`listConceptsForExport` 的 SQL 没有 `deleted_at IS NULL`，而 09-05 的变更记录里写明「导出」属于应当排除回收站的查询面；实测导出包里混着一条 09-06 就已删除的条目，更糟的是 OKF 导入拿同一份读取面做查重：撞上已删除条目的内容会被判成 `duplicate` 而**静默跳过**（用户以为「已复用」，实际哪里都没有）。三个调用方（导出、图谱、导入查重）的契约都是「可见条目」，补齐过滤。**(c) 裁决历史标签回落成英文 key**——`REVIEW_ACTION_LABEL` 原本定义在 `components/review-queue.tsx`（`"use client"` 模块），服务端页面读它的导出拿到的是「客户端引用」而不是值，`??` 兜底把 `kept_old` 原样渲染出来；标签常量改放纯模块 `lib/review-labels.ts`（服务端/客户端同源，与 `lib/attachment-mime.ts` 同一取舍）。

- 2026-09-10（DeepSeek 模型名更名同步，无代码改动）：`GET https://api.deepseek.com/models` 现仅列
  `deepseek-flash` 与 `deepseek-v4-pro`——旧名 `deepseek-v4-flash`（及 `deepseek-v4.1-flash-expires-on-0910`）
  已从模型列表移除，仅作兼容别名（实测仍返回 200，但响应体回填 `"model":"deepseek-flash"`），
  故全量切到现名。**四处配置同步改名**：① 服务器 `/opt/personal-knowledge-web/.env` 的 `LLM_MODEL`
  （改前备份 `/opt/personal-knowledge-web/.env.bak-20260910164700`，`diff` 确认仅该行变化、其余键不变，
  随后 `systemctl restart personal-knowledge-web`）；② MCP 客户端 env `KB_LLM_MODEL` 三处——
  `~/.omp/agent/mcp.json`、`~/.codex/config.toml`、`~/.claude.json`（MCP 无热加载，新会话生效）。
  `LLM_EMBEDDING_MODEL=text-embedding-v4`（DashScope）不受影响。**线上验收**：服务端 auto-summary
  触发一次真实调用（临时建条目 → 描述回填成功 → 条目彻底删除），`llm_calls` 记录
  `llm|auto-summary|deepseek-flash|ok|667ms|176→51 tokens`；MCP judge 全链路（`/api/search` →
  候选全文读取 → LLM 判别 → `POST /api/logs/llm` 落库）记录 `llm|judge|deepseek-flash|ok|3591ms|4492→1024`，
  返回值正常（verdict/reason/mergedBody 齐全，无规则降级 note）。本地 `deployment/sjtuai.art/.env`
  为 gitignore 的开发占位（仅 `DATABASE_URL`），不含 LLM 配置，无需同步。
- 2026-09-06（多账户管理批次）：把此前只能 SSH CLI 完成的账户运维搬进网页后台。**① 迁移 0017**——
  `users` 增 `disabled_at`（软禁用）与 `last_login_at`（登录路由记录）。**② 禁用三链路即时生效**——
  登录 403（「该账号已被管理员禁用」，且记一次失败供限流）；`requireUser`/`requireApiUser` 对禁用账号
  视同会话失效（页面跳 /api/auth/expire 清 Cookie）；`getUserByApiKey` 联表过滤 `disabled_at`，禁用
  账号名下全部 API key 立即 401。禁用动作同时 bump token_version 杀活会话；数据保留可随时启用。
  **③ `/users` 账户页（admin 导航「账户」，非 admin 隐藏 + 直接 URL 重定向兜底）**——列表（角色/状态/
  条目数/活跃 key 数/最近登录/创建时间）、创建账号（初始密码留空则服务端生成无歧义 12 位随机串，明文
  只随创建响应返回一次）、重置密码（token_version 自增踢全部会话）、角色切换、禁用/启用；守卫在
  `lib/users.ts` 纯函数 `checkAdminGuard`：禁止操作当前登录账号（防自锁）、禁止解除最后一名管理员
  （demote/disable 前 `countAdmins`），UI 上自己的行不渲染危险按钮。**④ 设置页「API 密钥」自助**——
  `GET/POST /api/keys` + `DELETE /api/keys/[id]`（owner 域内）：生成（`pkb_`+48hex，同 CLI 形态，
  活跃上限 10 个 409 拦截）、吊销（即时 401）；明文只在生成时显示一次，服务端仅存 SHA-256。CLI
  `db:add-user`/`db:create-api-key` 保留（引导/CI 场景）。**用户名规则**：`[\p{L}\p{N}_.-]{2,32}`，
  支持中文（ASCII `\w` 会误拒中文名，测试抓出）。MCP v0.7.0 同步：`kb_list_users`（只读，admin key
  专用）；账号/key 的变更类端点**有意不暴露**给 MCP——凭据明文经 agent 转录本有泄漏面，且误操作
  半径过大。E2E：临时号创建→key 生成→禁用→登录 403/key 401→启用恢复→清理，全部通过。
- 2026-09-05（运营统计批次：用量归因 + 流量观测 + 库健康）：对照参考产品的运维控制台补齐可观测面，
  数据面全部复用/轻扩现有表。**① 迁移 0016（usage_attribution）**——`search_logs`/`llm_calls` 增
  `api_key_id`（Bearer key 归因；cookie 会话为 NULL）；`concepts` 增 `retrieval_count`/
  `last_retrieved_at`（真实被检索计数：ui|api 来源才 +1，ingest 查重探测与缓存命中不计）+ 降序部分
  索引（引用 deleted_at，仍按惯例只存迁移文件）；新表 `request_log`（每 API 请求一行：route/method/
  path/status/耗时/key 归因），`lib/withRoute` 统一 fire-and-forget 写入，插入端 2% 概率顺手清理
  180 天前旧行。**② 归因链**——`AuthUser.apiKeyId` 自 `getUserByApiKey` 透传至 search_logs/
  llm_calls（含 search-embed 的 embedding 调用与 `POST /api/logs/llm` 的服务端归因，MCP 上报契约
  不变）。**③ /stats 页 + `GET /api/stats?days=N`**——流量概览（总数/成功率/P50/P95）、检索质量
  （零结果率/平均命中/路径分布：「模糊兜底/纯语义」占比高即 BM25 未接住的信号）、密钥用量表
  （调用量/成功率/知识贡献=该 key 的非 GET 写入数）、高频被检索条目、库健康（向量覆盖+陈旧向量/
  回收站/零检索条目/版本行/附件/DB 体积/部署 commit/启动时间）。admin 全库口径，普通用户仅本人，
  `keys`/`library` 对非 admin 为 null；`/api/health` 契约未动。**④ dashboard** 管理员新增「向量覆盖/
  回收站」瓷砖。测试 +4（`clampDays` 对缺省 `?days=` 的回落 bug 被新测试抓出后修复）。
- 2026-08-31（知识库管理优化批次，依据《深入理解 AI Agent》第 3 章/第 9 章）：**① 双向引用网络（§3.3.2）**——
  正文支持 `[[条目标题]]` 链接：`lib/links.ts` 解析，`components/concept-body.tsx` 渲染（保持 `<pre>`
  纯文本语义、未解析链接灰显），详情页新增「被引用」反向链接面板（`findBacklinks`，ILIKE + 转义）。
  **② 失效内容降权（§3.3.3.2）**——搜索打分对 `status='deprecated'` 条目 -150；列表/仪表盘/详情显示
  「已废弃」徽标。**③ 写入时精确查重（§3.3.3.2 去重）**——`createConcept` 在调用者视野内比对当前版本
  正文哈希，完全相同即抛 `DuplicateBodyError` → API 409 并返回 `existingId/existingTitle`，表单给出
  跳转链接；`lib/withRoute` 新增映射。**④ ingest 上下文锚定分块（§3.3.5 Contextual Retrieval）**——
  `splitMarkdownWithPaths` 为每块携带标题面包屑（`第一章 > 第二节`），经 `位置：` 前缀注入提取 prompt，
  系统提示要求条目标题自含主体、代词还原；`splitMarkdown` 契约不变（委托新函数）。**⑤ 只读整理报告
  （§3.3.3.2 定期整理 + §9.3.3 修剪）**——`npm run curate [--days N]`：疑似重复（正文哈希相同）/
  失效 `[[…]]` 链接 / 缺描述 / 超期未更新，只读不写。**未做**：语义搜索激活仍待 embedding 端点
  （本批不依赖 embedding）；冲突审核/Claim 抽取属后续阶段。测试 85 通过（新增 links 6 + 分块路径 5），
  `npm run check` + build 通过。
- 2026-08-31（深夜，语义搜索激活 + 空窗口召回修复，2f7427c）：**① 激活**——服务器 .env 配置
  百炼兼容端点（`dashscope.aliyuncs.com/compatible-mode/v1`，`text-embedding-v4`，1024 维）→
  `db:embed-backfill`（17 条全量向量化，建表 + 钉维度 + HNSW）→ 重启。**② 修复存量缺陷**——
  `searchConcepts` 的语义扩展原先要求词法窗口非空才运行（`results.length > 0` 门控），纯同义
  改写查询（零词面重叠）直接返回 0 条——恰是稠密检索存在的意义（书 §3.2.4）。现空词法窗口时
  直接按余弦近邻返回（合成降序分 100-5i，total=列表长，仅首页）；`rerankWithSemantic` 路径不变。
  同批 `conceptRowsForIds` 补漏 `category` 列并把 owner 字段收敛为 `SearchResult` 的 undefined 形态
  （旧 `as unknown as T` 强转掩盖了两处）。线上验证：「怎么把应用搬到云服务器上」→ 命中 ECS 部署
  全流程条目；词面查询的 RRF 融合不退化。凭证：embedding key 走 `LLM_EMBEDDING_*`（与聊天
  DeepSeek 分离），经文件追加写入不回显。
- 2026-09-01（凌晨，判别降级语义化微调，42c409b/5c91f41@MCP v0.3.3 联动）：搜索结果携带
  `similarity` 字段（余弦相似度，`1 - 距离`，仅语义搜索运行时存在）。动机：MCP 写路径判别
  （personal-knowledge-web-mcp）的规则降级原先只看词法融合分（阈值 60，按词法分标定）；语义搜索
  上线后纯语义候选行的显示分是 RRF 换算值（约 2–5 分），永远够不到 60——LLM 判别不可用时，
  换措辞的重复会漏过降级防线。服务端 `semanticCandidates` 返回 `{id, similarity}`，
  `rerankWithSemantic` 与空窗口路径都把相似度附到结果行；MCP 同步：降级规则改为「相似度 ≥0.55
  优先，其次词法分 ≥60」（阈值按线上实测校准：近似重复 0.60 / 纯改写 0.47 / 无关 ≤0.26），
  并修复全文读取读 `versions[0]`（此前误读恒为空的扁平字段，判别实际一直用 500 字摘要）；
  旧服务器（无 embeddings）字段缺省时自动退回纯词法判据，47 条测试通过。
- 2026-08-30（应用侧 LLM 三件套，731de55）：**① ingest 流水线产品化**——`npm run ingest -- <file.md>
  [--write] [--category 前缀] [--max N]`：Markdown 按标题/段落分块（`lib/ingest.ts`，≤2800 字符/块、
  小碎片前向合并）→ LLM 原子化提取（OpenAI 兼容，默认 dry-run，`--write` 才落库）→ 标题检索查重
  （score ≥60 或标题全同则跳过，与 MCP 规则降级同阈值）→ `createConcept` 带
  `generated_by=llm:ingest:<model>`。**② 自动摘要**——条目创建/新版本且 description 为空时，
  `lib/summary.ts` 异步（fire-and-forget）生成一句话描述回填 concepts + 当前版本行（无新版本）；
  绝不覆盖人工描述；失败仅记日志；开关 `LLM_AUTO_SUMMARY`（线上已开）。挂接点在两条写路由。
  **③ pgvector 语义搜索（代码就绪；地基已完成，待 embedding key 激活）**——迁移 0013 建
  `concept_embeddings`（vector 扩展缺失时 NOTICE 跳过，`ensureSemanticSchema` 可后补）；
  `lib/semantic.ts` 提供向量检索候选 + RRF 融合，`searchConcepts` 首页结果与向量近邻重排融合
  （无 embedding 配置时完全退化为词法检索）。**已完成（2026-08-30，用户批准装包）**：
  `apt install postgresql-16-pgvector` + knowledge 库 `CREATE EXTENSION vector`（0.6.0）；
  已探测确认现有 DeepSeek 端点无 `/embeddings` 能力（仅对话模型）。**剩余激活三步**（拿到
  embedding key 后）：① .env 追加 `LLM_EMBEDDING_MODEL=<模型>` 与 `LLM_EMBEDDING_DIMENSIONS=<维度>`
  （BASE_URL/API_KEY 缺省回退 LLM_*；DashScope text-embedding-v4 = 1024 维、SiliconFlow
  BAAI/bge-m3 = 1024 维）② `sudo bash -c 'cd /opt/personal-knowledge-web && npm run db:embed-backfill'`
  （自动建表 + 钉维度 + hnsw 索引 + 全量向量化，幂等可重跑）③
  `sudo systemctl restart personal-knowledge-web`（`hasSemanticSearch` 探测按进程缓存，必须重启生效）。
  LLM 配置注入：服务器 .env 增 `LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`（复用 MCP 的
  DeepSeek 配置，stdin 直写不回显）。线上验收：ingest dry-run/写入/查重、自动摘要 ~5s 回填、
  测试数据全部删除。`ConceptInput.generatedBy` 记录机器来源。
- 2026-08-30（Next 16 升级 + 健壮性优化，c5a7562/5cfd630）：Next 15.5.23 → **16.3.3**（清零
  npm audit 3 个 high：内置 postcss/sharp）；`middleware.ts` 迁移为 **`proxy.ts`** 约定、
  body-size 配置键改为 `experimental.proxyClientMaxBodySize`；eslint-config-next@16 原生
  flat config（弃用 FlatCompat）。健壮性批次：① `lib/withRoute` 统一包装全部 API 路由
  （域错误→404/413，未知异常→带路由名日志 + JSON 500，此前是哑 500 无服务端日志）；②
  `[id]` 路由先做 UUID 校验（非法 id 由 pg 22P02 → 500 改为干净 404）；③ 迁移 **0012**：
  `sources(content_hash, concept_id)`（每次存版本的去重探测此前全表扫）+ `concepts(owner_id,
  category)`；④ 客户端 5 个组件 fetch 补 try/catch（网络失败此前静默卡死 loading），
  logout 失败不再强制跳登录页；⑤ 搜索支持 `?offset=` + 返回 `total`（`COUNT(*) OVER()`，
  statement 升 `search_v2`），/knowledge 搜索结果与列表一致分页；⑥ 内联预览判定抽到
  `lib/attachment-mime.ts` 服务端/客户端同源（SVG 不再出现 UI 给预览、服务端强制下载的漂移）。
  运维注意：`deploy.sh` 以 root 运行会在检出内留下 root 属主文件（本次 `app/api/categories`
  即因此阻塞 knowledge-web 的 git 快进），已整体 `chown -R knowledge-web`；后续若再遇
  unlink 权限错误，先检查属主。同日 MCP 工具升级（963625d，独立仓库
  personal-knowledge-web-mcp）：`kb_get_concept` 默认仅当前版本（`versions="all"` 才返回
  历史版本，防上下文膨胀）、`kb_whoami` 缓存 60s、幂等 GET 对网络错误/5xx 重试一次。
- 2026-08-29（空文件夹，迁移 0011）：新增 `folders` 表（owner_id + path 唯一）作为文件夹的实体形态，
  支持仪表盘「+ 新建文件夹」创建空目录（`POST /api/categories` `op=create`）。树 = folders 行 ∪
  concepts.category 派生（`buildCategoryTree(concepts, extraFolderPaths)`）；重命名/移动同步改写
  folders 行，删除同时清空子树 rows；冲突校验覆盖两种存在形态。
- 2026-08-29（目录管理）：仪表盘「知识目录」升级为可折叠文件树（`components/directory-tree.tsx`），
  并补齐文件夹级操作——重命名（仅最后一级）、移动（可选新父目录，连同子树）、删除（子树条目
  移回根目录，**不删除内容**）。新增 `POST /api/categories`（`op=rename|move|delete`，lib 层
  `renameCategoryFolder`/`deleteCategoryFolder`）。文件夹是 `concepts.category` 的派生视图（无
  文件夹实体），操作按 owner 过滤、admin 可跨账号；目标路径冲突返回 409；版本快照保留分类历史，
  `updated_at` 不变以免刷屏「最近更新」。
- 2026-08-29（角色层，5db0c9a/c2930cd）：新增 `users.role`（'user'/'admin'，迁移 0010，admin 账号设为 admin）。
  admin 角色在所有列表/搜索/详情/导出/来源/更新/删除/附件接口绕过 owner 过滤，可跨账号读写；
  非 admin 账号隔离行为不变。列表/详情/搜索结果带 `owner_id` + `owner_username`，admin 界面
  对他人条目显示 👤 徽标。MCP 的 admin API key 自动继承该视野。同批修复存量 bug：`GET /api/concepts`
  不带 `?limit` 时因 `Number(null)===0` 静默按 limit=1 返回（c2930cd），现默认 100。
- 2026-08-28：本地项目从 `E:\TXY\personal-knowledge-web\` 迁入 `deployment/sjtuai.art\`，
  按「deployment/<域名>/」统一归位；服务器端无任何变更。
- 2026-08-28（晚间，登录故障修复，aef118c）：用户手动退出后陷入 /login↔/dashboard 重定向循环
  （黑屏）。根因：`app/api/auth/logout/route.ts` 只做了 token_version+1，从未调用
  `destroySession()` 清 Cookie（与注释声称不符）；Edge 中间件验签通过但无法校验
  token_version，于是把已"逻辑注销"的会话继续放行 → /login 307 弹回、/dashboard 页面 API
  全 401，前端死循环。修复：logout 补调 `destroySession()`；同批轮换 SESSION_SECRET 使
  故障期间浏览器里的旧 Cookie 立即失效。经 `deploy.sh` 全量门禁（npm ci/校验/构建/健康/
  冒烟）部署，端到端复现脚本验证退出链路恢复正常。该 bug 为应用存量问题，与当日基础设施
  加固无关——密钥轮换迫使用户重新登录/退出才将其暴露。
- 2026-08-28（加固，详见仓库根 `personal-knowledge-web-architecture-review.md`）：
  SSH 改为 key-only + 禁 root 并安装 fail2ban；unattended-upgrades 启用 security pocket；
  备份脚本修复保留清理 glob（原 18 字符模式永不匹配，旧快照无限累积）；新增月度恢复演练
  （`personal-knowledge-web-restore-drill.timer`，首次演练 PASS）；备份异地化（Windows 每日拉取
  + SHA256 校验）；`kb-alert@` 告警单元接入 smoke/备份/演练/caddy 四个服务（微信主、飞书备）；
  Caddyfile 增加 HSTS + 访问文件日志（供 fail2ban 限流 `/api/auth/login`）+ 请求体 128MB 上限
  （XFO/CSP/nosniff 由应用层负责，边缘不重复设置）；DB 密码与 SESSION_SECRET 轮换
  （`rotate-db-password.sh` 重写，服务器端生成不落明文）；服务器残留 Caddyfile 片段归档至
  `~/caddyfile-archive-20260828/`。备份保留以脚本为准（30 天，非旧文档所写 14 天）。

- 2026-09-04（检索方式改造，8d988ae）：查询改为 **BM25 + embedding 混合检索，返回去重 top-k**。
  `searchConcepts` 的启发式词法打分（ILIKE 覆盖 + trgm + tsquery + pgroonga_score 加权混合）替换为
  单条 SQL 的全库 BM25：查询按 TokenBigram 形态分词（ASCII 整词 + CJK bigram），词项以单个数组参数
  进 SQL（预处理语句文本与词数无关），df/tf 共用同一 lower() 子串定义；deprecated 条目 BM25×0.25
  原位降权；`hasPgroonga` 探测与 tsquery/ILIKE 分支移除（DB 内 pgroonga/trgm/tsv 索引保留未删，
  无 schema 变更）；pg_trgm 模糊查询保留为空窗口兜底（错字）。语义侧不变：pgvector 余弦召回与词法
  RRF 融合、零词面重叠时纯语义兜底、输出按 id 去重。实测 BM25 尺度（16 条语料）：自标题命中 43.1、
  同书相邻章 5.4-8.0、无关词 0 行。阈值重标定：`npm run ingest` 查重 60→25；MCP 仓库
  （c72a49f，v0.4.0）`kb_search` 默认 limit 20→**3**、judge 候选 5→3、规则合并分数 60→**6.5**。
  线上验证：词法/改写/无关/typo/单字五类查询行为符合预期，去重成立；MCP stdio 端到端确认默认 top3。
  同批轮换 MCP 的 `KB_API_KEY`（`personal-kb-mcp` → `personal-kb-mcp-r3`；旧 key 吊销）——
  排查过程曾把 key 明文回显到终端记录，故立即轮换；使用中的 MCP 客户端会话需重启才会拿到
  新 dist 与新 key。
- 2026-09-04（晚间，陈旧会话黑屏修复）：用户登录后陷入 /login↔/dashboard 重定向循环（黑屏）复发——
  与 08-28 事故同根因的另一条触发路径：**在其他设备登出/改密会使 `token_version`+1**，其余设备里的
  旧 Cookie 签名仍有效（SESSION_SECRET 未变），Edge 中间件（无法查库）把 /login 307 弹回 /dashboard，
  而 `requireUser` 查库发现 tv 不匹配又踢回 /login → 死循环，浏览器中止后呈黑屏。访问日志可见
  /login 307 与 /dashboard 200 每秒十余次交替。修复：`requireUser` 在行缺失/tv 不匹配时改重定向到
  新增的 **`GET /api/auth/expire`**（`destroySession()` 清 Cookie 后 307 回 /login，公网 Location 复用
  抽出的 `lib/publicUrl.ts` 助手），下一跳即拿到干净登录页，循环类问题终结；`proxy.ts` 同步改用
  lib 助手（行为不变）。部署后端到端验证：手工铸造 tv 过期 Cookie 访问 /dashboard，链路
  /dashboard → /api/auth/expire → /login 全部按预期，登录表单可达。
- 2026-09-04（晚间，LLM 调用耗时优化）：/logs 实测定位——`auto-summary` 一次 16.4s（输入仅 178 字符，
  completion 2263 tokens）：`deepseek-v4-flash`（2026-09-10 更名 `deepseek-flash`，见变更历史首条）
  **默认开启 thinking**，为"≤120 字摘要"白烧推理 tokens；
  全链路无 `max_tokens` 上限。服务器直压对照：同任务关 thinking + 限长 200 → **0.18s**（≈90×）。
  网络面：首尔 → api.deepseek.com TTFB 固定 0.2-0.5s；embedding 走 DashScope 中国区跨境 0.17-0.9s
  （国际版端点 TTFB 减半但需国际版 key，现有 CN key 401，暂不换）。优化：**① `llmChatJsonWith` 支持
  按调用 `thinking`（默认 disabled，utility JSON 任务无需推理）与 `maxTokens`**，provider 拒绝扩展字段
  4xx 时回退纯 body 重试（沿用 MCP judge 的 response_format 模式）；**② 摘要 `maxTokens: 200`、
  ingest 原子化 `maxTokens: 4000`**；**③ ingest 块级并发池（`INGEST_CONCURRENCY`，默认 4）**，
  告别逐块串行；**④ 搜索词法 BM25 与 query embedding 并行化**（`rerankWithSemantic` 接受预计算向量，
  失败仍降级纯词法）→ 每次语义搜索省 ~300-700ms。已落地未实施（权衡待定）：MCP judge 关 thinking
  （判别质量需回归）、候选全弱时规则短路、DashScope 国际版端点（需新 key）。本地 106 测试全过 +
  `deploy.sh` 全量门禁部署，线上验证：auto-summary / search-embed 的 llm_calls 行 took_ms 见新记录。
- 2026-09-04（深夜，Obsidian 范式第一批，a9c4983）：对照 Obsidian 知识工作流范式落地五项：**① 链接别名
  `[[标题|显示名]]`**——`parseWikiLinks` 在首个 `|` 拆 target/display，target 保持纯净（下游 title→id、
  反链 pattern、curate 全部受益），display 仅影响渲染，空别名回退 target；`findBacklinks` 同步支持别名
  形态（`[[title]]` OR `[[title|` 两个 ILIKE）。**② 未解析链接一键创建**——正文/outgoing 面板里的未解析
  链接渲染为虚线下划线，点击打开 `/knowledge/new?title=` 预填表单（Obsidian click-to-create）。**③ 详情页
  「链接到」面板**——出链列表（已创建/未创建状态，同 target 去重、首次出现排序）。**④ 编辑器 `[[` 补全**——
  标题列表取自 `/api/concepts?limit=200`（30s 客户端缓存、纯前端过滤，零 search-log 污染），裸 `[[` 列最近
  条目、输入过滤（前缀优先），↑↓/Enter/Esc 键盘流，`|` 别名后缀在补全时保留。**⑤ Ctrl/Cmd+K 快速切换器**
  （`components/quick-switcher.tsx`，header 挂触发按钮）——标题模糊过滤跳转。全库导出经核查**已存在**
  （`/api/export/okf` + settings 按钮），未重复建设。本地门禁 108 测试过；线上端到端验证（relay 浏览器）：
  别名渲染为显示名且指向正确 target、未解析链接 href 带预填 title、链接到面板两行状态正确、
  `?title=` 预填、`[[强` 前缀排序补全 + Enter 插入、Ctrl+K 打开→过滤→跳转全通过；测试条目与临时 key 已清理。
- 2026-09-04（深夜，Obsidian 范式第二批，c3dfc59+7298214+2f98180+c737b33）：**① 搜索算子**
  `tag:x` / `category:"路径"`（精确路径或子目录前缀）/ `status:draft`——`lib/search-syntax` 纯解析
  （引号值、重复 tag、未知 status 忽略、空算子剥离），BM25 语料 CTE 与算子-only 列表两条路径都带过滤
  （prepared statement 名编码子句形态），**语义召回同样带过滤**（`semanticCandidates`/`rerankWithSemantic`
  接收 parsed filters，修复 category 过滤被向量召回绕过的泄漏）；算子-only 查询走独立参数数组
  （pg 无法推断未引用参数类型，曾 500）。**② 建条目模板**（`lib/templates.ts`，create 模式选择器，
  追加不覆盖、联动类型字段）。**③ 草稿持久化**——全表单 800ms 防抖入 localStorage（per-context key），
  挂载时差异检测出「恢复/丢弃」横幅，保存成功即清；effect 内 setState 延迟一帧绕开
  react-hooks/set-state-in-effect。**④ 未链接提及**——详情页「未链接提及」面板 + curate 第 5 节，
  occurrence 级检测（body 内 `[[title…` 前缀的 occurrence 算已链接，混合体只报裸提及处），ASCII
  词边界防误报，snippet 供人确认。**⑤ 图谱视图**——`/graph` + `GET /api/graph`（节点=可见条目、
  边=已解析 `[[链接]]`，内存解析零额外查询），ECharts 力导向（动态导入 tree-shaken 包，目录着色、
  度数定节点大小、点击跳转），导航新增「图谱」。修复随批：BM25/算子 SELECT 补 `category` 列
  （此前搜索结果 category 恒 null）。115 测试过 + deploy.sh 门禁 + 线上验证（干净无头浏览器：
  图谱 canvas 渲染 18 节点、提及面板 occurrence 级命中、模板骨架、草稿恢复/丢弃、算子三类查询）。
  **教训**：CDP relay 后台标签页可能出现 JS 全冻结病理（零 console 错误、解析期脚本全不执行）——
  线上功能验证必须用独立无头浏览器实例 + CDP setCookie 注入会话，不能用 relay 后台标签下结论。

- 2026-09-04（深夜，Obsidian 范式第三批，a93d2ea+9828e06+07b81e3）：**① transclusion 嵌入**——
  `![[标题]]` 独占一行 = 块级嵌入（`splitBodyBlocks` fence 感知切分，行内 `![[…]]` 降级为 📄 链接），
  详情页 EmbedBox 渲染嵌入正文（深度 1，嵌套显占位符即防环），嵌入计入反链/图谱/外链面板
  （`WikiLinkRef.embed`）；`getBodiesByTitles`（admin/owner 视界、lower(title) 批量取正文）。
  **② 快速捕获**——`POST /api/capture`（Bearer API key，zod 校验 1-5000 字，标题=首行或「速记
  日期 时间 前缀」，默认目录 捕获/、status=draft；GET 故意不支持防 key 泄漏日志）。**③ 周期回顾**
  ——`npm run review [--days N] [--write]`：近 N 天变更按目录分组明细 + DeepSeek 叙事
  （overview/highlights/suggestions，purpose=weekly-review 入 llm_calls），落库「每周回顾 YYYY-MM-DD」
  （回顾/，重跑生成新版本），默认 dry-run。**④ CodeMirror 6 编辑器**（`components/markdown-editor.tsx`
  + `markdown-preview.tsx`）——显式扩展组合（**弃用 basicSetup**：其内嵌 autocompletion 与
  `autocompletion({override})` 双实例互斥、closeBrackets 会抢写 `]]`）；`[[`/`![[` 补全源
  （client 过滤 + `|别名` 后缀保留 + **`filter: false` 必须声明**——否则 CM FuzzyMatcher 以原始输入
  重筛 label，`|` 一输入全部选项被杀；validFor 反而让列表不随输入收窄，弃用）；apply 后光标落
  `]]` 之后；编辑/预览切换（视图保活，预览懒加载 react-markdown，wiki 语义与 ConceptBody 一致）；
  隐藏 `<textarea name=body>` 兜住 FormData/草稿。120 测试过 + 生产构建 + 线上验证（无头浏览器：
  补全四态、别名保序、嵌入渲染 📄+正文、预览切换、`/api/capture` 201→删除→404、`npm run review
  --write` 生成 LLM 叙事版周报）。**运维坑**：① `git merge | tail -1` 管道吞 merge 失败退出码，
  部署脚本必须 `set -o pipefail` 或免管道判断；② 服务器 `npm install` 会改脏 package-lock.json
  卡死后续 ff-merge，已对服务器副本 `git update-index --skip-worktree package-lock.json`；
  ③ `npm install --omit=dev` 会剪掉 tailwindcss 等 devDependency，服务器构建必须完整 install；
  ④ Next 16 dev 默认拦跨域静态资源（403），本地调试用 `localhost` 而非 `127.0.0.1`；
  ⑤ bash 后台任务 300s 截止，SSH 隧道/长驻进程须 `timeout: 0`。

- 2026-09-05（规划对齐迭代：回收站/版本回滚/OKF 导入）：对照《个人知识库项目规划》逐项盘点
  （原规划对齐报告已移除，可从 Git 历史查阅），修复四个结构性缺口。**① 回收站（软删除）**——
  迁移 **0015_concept_trash**（`concepts.deleted_at` + 双部分索引）；DELETE 改为入回收站，
  `?purge=1` 彻底删除且仅对已回收条目生效（两段式销毁，409 拦一步到位）；`/trash` 页 +
  `GET/DELETE /api/trash` + `POST /api/concepts/[id]/restore`；**全部查询面排除已删除**：
  列表/BM25/算子/trgm/pgvector 语义召回/图谱/导出/链接网络/反链/未链接提及/curate/查重/自动摘要/
  embed-backfill；详情页回收站横幅+恢复。**② 版本回滚+对比**——
  `POST /api/concepts/[id]/versions/[v]/restore`（历史不可变，回滚=把旧版本生成为新版本，可再回滚）；
  详情页版本历史「对比当前」（自研 LCS 行 diff `lib/diff.ts`，4M cell 上限兜底整块替换）+ 一键回滚。
  **③ OKF 导入**——`POST /api/import/okf`（≤20MB ZIP）+ 设置页上传 UI；逐文件解析，
  按规划 §三分类：内容全同→复用（duplicate）、同名不同内容→**冲突不覆盖**（conflicts 报告），
  解析失败逐文件进 errors 不阻塞；往返导出→导入自检过。**④ MCP v0.5.0（ebfea20，契约同步）**——
  kb_delete_concept 两段式语义 + 新增 kb_restore_concept / kb_restore_version / kb_list_trash /
  kb_empty_trash（confirm 门禁），工具 12→16。138 测试 + 生产构建过；线上 E2E：
  临时条目 回收站→搜索不可见→恢复→回滚→purge 全链路 + 导入冲突报告验证，临时数据已清理。
  **注意**：`npm run ingest` 查重阈值现行代码为 **score≥25 或标题全同**（历史记录曾写 ≥60，以代码为准）。
