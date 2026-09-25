/**
 * 版本记录（changelog）—— 面向使用者的"这个知识库现在跑的是哪一版、改了什么"。
 *
 * 为什么放在源码里而不是数据库表：它是**随代码一起发布**的事实，和实现同生共死。
 * 一条记录描述的是某个提交批次的行为，改代码就该在同一次提交里改它；放进 DB 反而
 * 要迁移、要备份、还有"代码已回滚但记录还在"的不一致形态。版本号随 package.json
 * 一起走（tests/changelog.test.ts 会强制两者一致，防止这里忘记更新）。
 *
 * 约定：
 *  - CHANGELOG[0] 永远是最新一版（新的加在数组最前面，不追加到末尾）。
 *  - version 必须与 package.json 的 version 相同，否则测试失败。
 *  - date 用北京时间的自然日（server 与用户同处 CST，运维脚本也按本地日历算）。
 *  - 只写**可核验**的改动，不写计划中的事；每批较大的更新追加一条。
 *  - 早于本页启用（2026-09-15）的历史批次不在下方逐条列，见 DEPLOYMENT.md「变更历史」。
 */

/** 改动分类。渲染时分组并配徽标色，顺序即页面展示顺序。 */
export const CHANGE_KINDS = ["security", "fix", "feature", "perf", "ops", "docs"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** 分类的中文标签（页面徽标用）。 */
export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  security: "安全",
  fix: "修复",
  feature: "功能",
  perf: "性能",
  ops: "运维",
  docs: "文档",
};

export interface ChangelogChange {
  kind: ChangeKind;
  /** 一句话说明"改了什么、此前会怎样"。写现象与后果，不写实现细节。 */
  text: string;
}

export interface ChangelogEntry {
  /** 语义化版本，必须与 package.json 一致。 */
  version: string;
  /** 发布日（YYYY-MM-DD）。 */
  date: string;
  /** 这一版的主题，一行。 */
  title: string;
  changes: ChangelogChange[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.3.4",
    date: "2026-09-25",
    title: "核心列表与治理入口优化",
    changes: [
      {
        kind: "feature",
        text: "知识列表新增状态筛选，并确保分类条件在关键词搜索时继续生效；筛选、每页条数和分页链接统一保留条件，清除按钮可一次退出全部筛选。",
      },
      {
        kind: "feature",
        text: "审核队列新增风险类型与来源筛选，待裁决和已裁决记录使用同一条件；概览增加可点击的待审阅与质量风险统计。",
      },
      {
        kind: "fix",
        text: "Ctrl/Cmd+K 快速跳转改为分页加载全部知识而非仅最近 200 条，并在加载失败时显示错误与完整数量，避免静默给出不完整结果。",
      },
      {
        kind: "fix",
        text: "概览的原始来源统计改用数据库总数，不再把来源列表的 200 条展示上限误当成真实总量。",
      },
    ],
  },
  {
    version: "0.3.3",
    date: "2026-09-25",
    title: "MCP 质检与列表筛选契约",
    changes: [
      {
        kind: "feature",
        text: "概念列表 API 新增 category/status 过滤，total 同步按过滤条件计算；MCP 可直接分页浏览指定目录或状态，不再拉取全库后自行筛选。",
      },
      {
        kind: "feature",
        text: "审核列表 API 新增 kind/source 过滤，MCP 可分别查看人工抽查、模型自动审阅及其它来源；过滤后的 total 与分页保持一致。",
      },
      {
        kind: "security",
        text: "质量风险禁止使用 kept_both 新建重复条目；目标在审阅后变化时返回结构化 target-changed，供客户端阻止陈旧建议覆盖新修改。",
      },
    ],
  },
  {
    version: "0.3.2",
    date: "2026-09-25",
    title: "统一页面标题与导航标签",
    changes: [
      {
        kind: "feature",
        text: "所有子页面顶部新增统一页面标题，并直接复用侧边栏同一份标签数据；图谱、来源、审核、问答等页面不再维护容易漂移的独立标题文字。",
      },
      {
        kind: "feature",
        text: "知识列表、新建与详情子路由统一显示“知识”，详情中的具体知识名称保留为内容标题；桌面与窄屏遵循相同规则。",
      },
    ],
  },
  {
    version: "0.3.1",
    date: "2026-09-25",
    title: "导航分组与响应式菜单整理",
    changes: [
      {
        kind: "feature",
        text: "将 13 个平铺入口收敛为概览、知识管理、智能工作流、数据与审计、系统管理五个一级入口；当前页面所属分组自动展开，其他分组按需折叠。",
      },
      {
        kind: "feature",
        text: "桌面与窄屏共用同一套纵向分组导航；审核待办会汇总到智能工作流父级，现有路由、激活态和徽标语义保持不变。",
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-09-25",
    title: "知识质检、可调整侧栏与导航可见性修复",
    changes: [
      {
        kind: "feature",
        text: "新增「质检」页面：人工抽查可随机抽取 1、3 或 5 条知识样本，确认无问题或把具体问题送入审核队列。",
      },
      {
        kind: "feature",
        text: "新增自动审阅：模型逐条检查随机知识样本，只将有具体证据的风险和可选修订稿送入审核队列；用户批准或人工编辑后才生成可回滚的新版本。",
      },
      {
        kind: "feature",
        text: "桌面侧栏支持拖拽调整宽度，可在 200–360px 之间调整、用方向键微调、双击恢复默认，并记住当前浏览器的宽度偏好；窄屏继续使用横向滚动菜单。",
      },
      {
        kind: "fix",
        text: "修复侧栏导航文字在上一次样式调整后未渲染的问题，并改为高对比度卡片式 Tab；审核徽标保持右对齐，滚动能力保留但隐藏明显滚动条。",
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-15",
    title: "安全加固、数据一致性修复与检索质量修正",
    changes: [
      {
        kind: "security",
        text: "修复附件 MIME 参数绕过导致的存储型 XSS：`X-Mime: text/html; charset=utf-8` 能绕过按精确值比对的下载黑名单，存库后按 text/html 内联渲染并在本站源上执行脚本。上传与发送两侧改为统一按基础类型判定，已存在的脏数据一并失效。",
      },
      {
        kind: "security",
        text: "修复生产环境 CSP 被中间件覆盖的问题：中间件设置响应头是替换而非合并，导致所有经中间件的路由（整个已登录应用与 /login）只剩 frame-ancestors，script-src、object-src、base-uri、form-action 全部丢失。现在两层共用同一份完整策略。",
      },
      {
        kind: "security",
        text: "修复登录 `?next=` 开放重定向：`/\\evil.com` 能通过原先的字符串黑名单并解析到外站，登录成功后把用户带到站外。改为解析后校验同源。",
      },
      {
        kind: "security",
        text: "登录限流改为取 X-Forwarded-For 的最后一跳，不再依赖边缘代理恰好会覆盖该头。",
      },
      {
        kind: "security",
        text: "OKF 导入改为流式限长读取：原先在 chunked 传输（无 Content-Length）下会先把整个请求体读进内存再校验长度，超大请求可耗尽进程内存。",
      },
      {
        kind: "fix",
        text: "修复只改标题或描述导致条目从语义检索与问答取证中消失的问题：向量文本包含标题与描述，元数据变更后必须重新向量化；此前 BM25 仍能命中，表现为难以归因的「搜得到、问答答不出」。",
      },
      {
        kind: "fix",
        text: "异步任务补齐终态守卫与租约心跳：被租约判死的任务不再被迟到的执行者复活，需要长时间运行的批量任务也不会中途被判失败后丢弃结果。",
      },
      {
        kind: "fix",
        text: "文件夹改名/删除不再影响回收站中的条目，也不会被回收站条目误判为「目标文件夹已存在」。",
      },
      {
        kind: "fix",
        text: "新装环境用 `db:seed` 建出的管理员现在明确具有 admin 角色；此前会以普通用户身份建出，导致无法进入账户管理、无法彻底删除、也无法签发管理员密钥，且没有界面可补救。",
      },
      {
        kind: "fix",
        text: "同一批 OKF 导入中的同名不同内容条目不再重复创建，改为进入冲突队列等待裁决。",
      },
      {
        kind: "fix",
        text: "中文查询不再因标点产生跨词边界的幻影词项（`知识库，检索` 曾产出 `库检`），长查询也不再被幻影词项挤掉真实关键词。",
      },
      {
        kind: "fix",
        text: "`category:` 检索转义 LIKE 通配符，`tech_ai` 不再误匹配 `tech-ai` 等。",
      },
      {
        kind: "fix",
        text: "主张矛盾审计改用条目全文而非 500 字检索预览，减少送入审核队列的假矛盾。",
      },
      {
        kind: "fix",
        text: "「未链接提及」与反向链接共用同一套链接解析：带空格的 `[[ 标题 ]]` 不再被误报为未链接，同一篇里已链接一次的标题也不会掩盖其他未链接的出现处。",
      },
      {
        kind: "ops",
        text: "`ingest` 与 `claims` 失败时改为退出非零并以失败关闭：此前逐条错误只打印、退出码为 0，导致周度矛盾审计静默失败且告警不触发。",
      },
      {
        kind: "ops",
        text: "补齐缺失的 systemd 单元（主应用、每日备份、五分钟拨测），并把 restore-drill 单元改名以匹配其告警 drop-in，否则单元失败不会触发通知。",
      },
      {
        kind: "ops",
        text: "统一脚本行尾为 LF 并加入 .gitattributes；CI 增加行尾、shell 语法与单元/drop-in 命名一致性检查，避免部署脚本再次因 CRLF 无法执行。",
      },
      {
        kind: "feature",
        text: "`/api/concepts` 与 MCP 的 `kb_list_concepts`、`kb_search` 现在返回 `total`，搜索支持 `offset` 翻页，调用方无需靠「返回空」判断是否翻到底。",
      },
      {
        kind: "feature",
        text: "新增本页「版本」：记录每一版的改动，便于确认线上跑的是哪一版。",
      },
      {
        kind: "docs",
        text: "修正文档中过期的 Next.js 版本、MCP 版本与工具数量、以及在没有 .git 的交付目录里执行 `git pull` 的升级步骤；架构文档的 API 表补上 `/api/judge`。",
      },
    ],
  },
];

/** 当前版本 = 最新一条记录。与 package.json 的一致性由测试强制。 */
export const CURRENT_VERSION: string = CHANGELOG[0].version;

/** 按分类分组，顺序遵循 CHANGE_KINDS（页面据此渲染分组）。 */
export function groupChanges(entry: ChangelogEntry): { kind: ChangeKind; texts: string[] }[] {
  return CHANGE_KINDS.map((kind) => ({
    kind,
    texts: entry.changes.filter((c) => c.kind === kind).map((c) => c.text),
  })).filter((g) => g.texts.length > 0);
}
