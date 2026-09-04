# sjtuai.art · 个人知识库（personal-knowledge-web）部署手册

与 `wujiangai.art`（纯静态门户）不同，本站是**动态应用**：Next.js 15 + PostgreSQL，
由 Caddy 反向代理到本机 Node 服务。本地目录按域名存放完整项目源码（独立 git 仓库）。

## 架构总览

| 环节 | 值 |
|---|---|
| 域名 | `sjtuai.art`（www 301 → 裸域），DNS → 43.155.203.242（腾讯云，与门户同一台） |
| 入口 | Caddy `reverse_proxy 127.0.0.1:3000`（配置：`/etc/caddy/Caddyfile`，快照见本目录 `Caddyfile`） |
| 应用 | Next.js 15 生产模式，systemd 服务 `personal-knowledge-web.service` |
| 代码（服务器） | `/opt/personal-knowledge-web`（git 检出，运行账号 `knowledge-web` 属主） |
| 运行账号 | `knowledge-web`（专用低权限账号，`HOME=/var/lib/knowledge-web`） |
| 数据库 | 本机 PostgreSQL 16（systemd 依赖 `postgresql.service`） |
| 本地源码 | 本目录（git 仓库，origin = github.com/wujiang1999/personal-knowledge-web） |

## 目录映射

| 本地（E:\TXY\deployment\sjtuai.art\） | 服务器 | 说明 |
|---|---|---|
| 项目全部源码（`app/`、`lib/`、`db/` 等） | `/opt/personal-knowledge-web` | 经审核的 git bundle 更新服务器检出 |
| `deploy.sh`（项目根自带） | 同名文件 | **服务器端**部署脚本，以 root 运行 |
| `Caddyfile` | `/etc/caddy/Caddyfile` | 线上 Caddy 配置的**权威快照**，改动后须双向同步 |
| `server/` | 各自路径 | 服务器侧配置纳管：`backup.sh`(→/usr/local/sbin/personal-knowledge-web-backup)、`restore-drill.*`(→/usr/local/sbin + /etc/systemd/system)、`kb-notify.sh`+`kb-alert@.service`(告警通知器)、`fail2ban-jail.local`(→/etc/fail2ban/jail.local)、`systemd-drops/*.conf`(OnFailure 告警 drop-in) |
| `offsite/pull-kb-offsite.ps1` | —（Windows 侧） | 异地拉取脚本，计划任务 "KB offsite backup pull" 每日 12:30 运行，备份落 `E:\Backups\personal-knowledge-web` |
| `DEPLOYMENT.md` | 不上传 | 本文档 |

## 部署流程

1. 本地开发、提交（`npm run check` = typecheck + lint + test）。
2. 代码以**审核后的 git bundle** 方式传到服务器，更新 `/opt/personal-knowledge-web` 检出
   （服务器脚本刻意不直接从 GitHub 拉取）。
3. SSH 到服务器，在检出目录执行 `sudo ./deploy.sh`，脚本自动完成：
   `npm ci` → 校验 → `db:migrate`（幂等）→ 构建（旧构建存为 `.next.rollback`）→
   `systemctl restart` → 健康检查（`/api/health`）→ 冒烟测试（`npm run smoke:prod`）。
   任一步失败自动恢复旧构建并重启，退出码 1。
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

- **项目 README 的「部署到 ECS」章节已过时**（仍写阿里云旧路径 `/root/personal-knowledge-web`、
  旧 `git pull` 流程），以本文档和 `deploy.sh` 实际逻辑为准。
- 安全加固：systemd 单元启用 `NoNewPrivileges`、`ProtectSystem=full`，仅 `data/` 可写；
  ubuntu 账号读不了 `/opt/personal-knowledge-web` 属预期行为（需 sudo）。
- Caddy 层无静态文件：改 Caddy 配置后 `sudo systemctl reload caddy`，并同步更新本目录快照。

## 变更历史

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
