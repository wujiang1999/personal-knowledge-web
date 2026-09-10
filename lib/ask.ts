import { getLlmChatConfig } from "./config";
import { searchConcepts } from "./concepts";
import { query } from "./db";
import { llmChatJsonWith } from "./llm";
import type { ScopeUser } from "./requireUser";
import { claimTask, failTask, finishTask } from "./tasks";

/** 知识问答（RAG）：检索 → 只依据检索结果的合成 → 逐句引用标注。
 *
 * 三条硬规则，都是为了「答案可核查」：
 *  ① 只用资料回答，资料里没有就直说 —— 个人知识库里没有出处的答案等于幻觉；
 *  ② 每条结论带 [n] 来源编号，落库时把编号解析成条目 id，前端可点回原文；
 *  ③ 检索复用既有混合检索（BM25 + 语义 RRF），所以网页问、agent 问、搜到的是同一套库。
 *
 * 检索为空时直接给出「没检索到」而不烧一次 LLM —— 这是检索层的结论，不是编的。
 */

export const ASK_DEFAULT_K = 5;
export const ASK_MAX_K = 10;
/** 每份资料进 prompt 的字符上限（5 份 ≈ 12k 字符输入，成本与延迟都可控）。 */
export const ASK_SOURCE_CHARS = 2400;

/** 一份资料：检索命中的条目 + 进 prompt 的正文。 */
export interface AskSource {
  id: string;
  title: string;
  category: string | null;
  score: number;
  similarity: number | null;
  /** 进 prompt 的正文（超长截断，`truncated` 标明）。 */
  text: string;
  truncated: boolean;
}

export interface AskCitation {
  /** [n] 里的 n，前端按它把答案里的编号对上条目。 */
  marker: number;
  id: string;
  title: string;
}

export interface AskResult {
  answer: string;
  citations: AskCitation[];
  sources: Omit<AskSource, "text">[];
  model: string;
  tookMs: number;
}

/** 任务行 payload 的形态（lib/tasks 的 JSONB 载荷）。 */
export interface AskPayload {
  question: string;
  k: number;
}

const EMPTY_ANSWER =
  "知识库里没有检索到与这个问题相关的内容。可以换个说法再问，或先把资料录进来（网页「快速捕获」、`npm run ingest` 或 MCP 写入）。";

/** 弱候选短路的两条门槛（可用环境变量覆盖；默认值按 2026-09-10 的线上标定）。
 *
 * 动机：无关提问也会走完整条链路烧一次 LLM——这个 41 条的库里混合检索几乎
 * 从不空手而归（trgm 兜底 + 语义召回总能凑出几条），"检索为空"这条短路形同虚设。
 *
 * 标定样本（10 个问题，线上检索 top-1）：
 *   相关题：相似度 0.34 / 0.50 / 0.63，纯词法命中 8.26 / 29.48（无相似度）
 *   无关题：相似度 0.12 / 0.15 / 0.16，纯词法 3.68
 * 因此：有相似度就按它判（< 0.25 视为太弱），没有相似度（纯词法路径）就按词法分
 * 判（< 5 视为太弱）。**已知漏网**：语义兜底给无关短串也会打出 0.31 相似度 +
 * 合成分 100（合成分不能用，检索为空的语义路径统一从 100 递减），这类会被放行，
 * 由模型自己回「资料里没有」——宁可多烧一次，也不要把相关提问判成无关。
 * 库里只有 41 条、以 AI/ML 为主，换语料或库量级变化后这两个数应当重新标定。 */
export const ASK_MIN_SIMILARITY = Number(process.env.ASK_MIN_SIMILARITY ?? 0.25);
export const ASK_MIN_SCORE = Number(process.env.ASK_MIN_SCORE ?? 5);

const WEAK_ANSWER = (top: AskSource): string =>
  `检索到的内容与这个问题关联太弱（最高${top.similarity !== null ? `相似度 ${top.similarity.toFixed(2)}` : `词法分 ${Math.round(top.score)}`}），` +
  "没有据此作答。可以换个更具体的说法再问，或先把相关资料录进知识库。";

/** 检索结果是否弱到不值得交给模型。取 top-1 的相似度（语义路径）或词法分判断。 */
export function isRetrievalTooWeak(top: AskSource): boolean {
  return top.similarity !== null ? top.similarity < ASK_MIN_SIMILARITY : top.score < ASK_MIN_SCORE;
}

/** 检索候选并把正文取全：搜索返回的 500 字窗口只够判相关性，不够回答。
 * 一条 SQL 取回全部正文（`ANY(ids)`），保持检索顺序。 */
export async function collectSources(user: ScopeUser, question: string, k: number): Promise<AskSource[]> {
  const { results } = await searchConcepts(user, question, k, 0, "api");
  if (results.length === 0) return [];
  const ids = results.map((r) => r.id);
  const { rows } = await query<{ id: string; body_markdown: string }>(
    `SELECT c.id, v.body_markdown
       FROM concepts c
       JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
      WHERE c.id = ANY($1::uuid[]) AND c.deleted_at IS NULL`,
    [ids]
  );
  const bodies = new Map(rows.map((r) => [r.id, r.body_markdown]));
  return results.map((r) => {
    const full = bodies.get(r.id) ?? r.body_markdown ?? "";
    const truncated = full.length > ASK_SOURCE_CHARS;
    return {
      id: r.id,
      title: r.title,
      category: r.category,
      score: r.score,
      similarity: r.similarity ?? null,
      text: truncated ? full.slice(0, ASK_SOURCE_CHARS) : full,
      truncated,
    };
  });
}

/** 资料按 [n] 编号写进 prompt —— 编号是引用标注的唯一契约，模型必须照着用。 */
export function buildAskMessages(
  question: string,
  sources: AskSource[]
): { role: "system" | "user"; content: string }[] {
  const system =
    "你是个人知识库的问答助手。严格按下面的规则回答：\n" +
    "1. 只使用「资料」里的内容，不要引入资料之外的知识，也不要推测；\n" +
    "2. 每个结论句末尾标注来源编号，如 [1]、[2][3]；编号必须是资料里真实存在的；\n" +
    "3. 资料不足以回答时，直接说明资料里没有相关信息，并指出还缺什么；\n" +
    "4. 中文回答，可用 Markdown，先给结论再给要点，全文不超过 400 字。\n" +
    '只输出 JSON：{"answer":"..."}';
  const material = sources
    .map((s, i) => `[${i + 1}] 《${s.title}》${s.category ? `（分类：${s.category}）` : ""}\n${s.text}`)
    .join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `资料：\n${material}\n\n问题：${question}` },
  ];
}

/**
 * 解析模型输出：取出答案正文，把 [n] 解析成引用（去重、保序），并**删掉越界编号**
 * —— 模型偶尔会引用不存在的 [7]，留着就是一条点不开的假引用。
 */
export function parseAskAnswer(
  raw: unknown,
  sources: AskSource[]
): { answer: string; citations: AskCitation[] } {
  const content = (raw ?? {}) as Record<string, unknown>;
  const answer = typeof content.answer === "string" ? content.answer.trim() : "";
  if (!answer) throw new Error("LLM 未返回答案（answer 字段为空）");

  const seen = new Set<number>();
  const citations: AskCitation[] = [];
  // 连同标记前的一个空格一起吃掉：`结论 [7] 后` 删掉标记后不该留下双空格
  // （只吃空格与制表符，绝不吞换行，避免破坏答案的行结构）。
  const cleaned = answer.replace(/[ \t]?\[(\d{1,2})\]/g, (whole, digits: string) => {
    const n = Number(digits);
    const source = n >= 1 && n <= sources.length ? sources[n - 1] : undefined;
    if (!source) return "";
    if (!seen.has(n)) {
      seen.add(n);
      citations.push({ marker: n, id: source.id, title: source.title });
    }
    return whole;
  });
  citations.sort((a, b) => a.marker - b.marker);
  return { answer: cleaned.replace(/[ \t]+\n/g, "\n").trim(), citations };
}

/** 检索 + 合成。失败一律抛错，由任务层落成 failed + error。 */
export async function answerQuestion(
  user: ScopeUser,
  question: string,
  k: number,
  meta: { userId: string; apiKeyId?: string }
): Promise<AskResult> {
  const startedAt = Date.now();
  const sources = await collectSources(user, question, k);
  const cfg = getLlmChatConfig();
  const sourcesWithoutText = sources.map(({ text, ...rest }) => {
    void text;
    return rest;
  });
  if (sources.length === 0) {
    return {
      answer: EMPTY_ANSWER,
      citations: [],
      sources: [],
      model: cfg?.model ?? "",
      tookMs: Date.now() - startedAt,
    };
  }
  // 弱候选短路：不够相关就不烧 LLM（判据与标定见文件顶部常量）。返回命中项
  // 而不是空数组——用户能看到"最接近的几条是什么"，据此换个说法再问。
  if (isRetrievalTooWeak(sources[0])) {
    return {
      answer: WEAK_ANSWER(sources[0]),
      citations: [],
      sources: sourcesWithoutText,
      model: cfg?.model ?? "",
      tookMs: Date.now() - startedAt,
    };
  }
  if (!cfg) throw new Error("LLM 未配置（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL），无法合成答案");

  const raw = await llmChatJsonWith<unknown>(cfg, buildAskMessages(question, sources), {
    meta: { purpose: "ask", userId: meta.userId, apiKeyId: meta.apiKeyId },
    maxTokens: 1200,
  });
  const { answer, citations } = parseAskAnswer(raw, sources);
  return {
    answer,
    citations,
    sources: sourcesWithoutText,
    model: cfg.model,
    tookMs: Date.now() - startedAt,
  };
}

/**
 * 任务执行者：领用 → 跑 → 落库。整个函数不抛（fire-and-forget 的调用方
 * 不会 await，异常必须自己吞掉并写进任务行）。
 */
export async function executeAskTask(
  taskId: string,
  user: ScopeUser & { id: string },
  question: string,
  k: number
): Promise<void> {
  try {
    if (!(await claimTask(taskId))) return; // 已被领走/已结束：不重复执行
    const result = await answerQuestion(user, question, k, { userId: user.id, apiKeyId: user.apiKeyId });
    await finishTask(taskId, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ask] 任务失败:", taskId, message);
    await failTask(taskId, message).catch(() => {});
  }
}
