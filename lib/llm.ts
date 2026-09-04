import { getLlmChatConfig, getLlmEmbeddingConfig, type LlmConfig } from "./config";
import { logLlmCall, usageInt, type LlmCallLogInput } from "./logs";

/** Chat + embedding clients for any OpenAI-compatible endpoint. No SDK —
 * the surface used is two POSTs. Secrets are read from lib/config only and
 * are never logged or included in errors. */

const CHAT_TIMEOUT_MS = 60_000;
const EMBED_TIMEOUT_MS = 30_000;

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; data: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM 请求失败(${url.replace(/\?.*$/, "")}):${detail}`);
  }
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Extract the first JSON value from an LLM reply. Tolerates ```json fences,
 * leading prose, and trailing commentary — the usual failure modes of
 * "respond with JSON only" prompts.
 */
export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* fall through to slice heuristics */
  }
  const unfenced = trimmed.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(unfenced) as T;
  } catch {
    /* fall through */
  }
  const firstObj = unfenced.indexOf("{");
  const firstArr = unfenced.indexOf("[");
  const start =
    firstArr !== -1 && (firstObj === -1 || firstArr < firstObj) ? firstArr : firstObj;
  if (start === -1) throw new Error("LLM 回复中未找到 JSON");
  const endObj = unfenced.lastIndexOf("}");
  const endArr = unfenced.lastIndexOf("]");
  const end = Math.max(endObj, endArr);
  if (end <= start) throw new Error("LLM 回复中未找到完整 JSON");
  return JSON.parse(unfenced.slice(start, end + 1)) as T;
}

/** Narrow an OpenAI-style usage block out of parsed JSON (unknown → typed). */
function readUsage(data: unknown): { promptTokens: number | null; completionTokens: number | null } {
  if (typeof data !== "object" || data === null || !("usage" in data)) {
    return { promptTokens: null, completionTokens: null };
  }
  const usage = data.usage;
  if (typeof usage !== "object" || usage === null) {
    return { promptTokens: null, completionTokens: null };
  }
  return {
    promptTokens: usageInt("prompt_tokens" in usage ? usage.prompt_tokens : undefined),
    completionTokens: usageInt("completion_tokens" in usage ? usage.completion_tokens : undefined),
  };
}

/** First choice's message content, narrowed from parsed JSON. */
function readChatContent(data: unknown): unknown {
  if (typeof data !== "object" || data === null || !("choices" in data)) return undefined;
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (typeof first !== "object" || first === null || !("message" in first)) return undefined;
  const message = first.message;
  if (typeof message !== "object" || message === null || !("content" in message)) return undefined;
  return message.content;
}

/** Provider error message, narrowed from parsed JSON. */
function readErrorDetail(data: unknown): string {
  if (typeof data !== "object" || data === null || !("error" in data)) return "";
  const err = data.error;
  if (typeof err !== "object" || err === null || !("message" in err)) return "";
  return typeof err.message === "string" ? err.message : "";
}

/** Embedding rows as { index, embedding } pairs, narrowed from parsed JSON;
 * null when the response shape is not an array. */
function readEmbeddingRows(data: unknown): { index: number; embedding: unknown }[] | null {
  if (typeof data !== "object" || data === null || !("data" in data)) return null;
  const rows = data.data;
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => {
    if (typeof r !== "object" || r === null) return { index: 0, embedding: null };
    const index = typeof r.index === "number" ? r.index : 0;
    return { index, embedding: "embedding" in r ? r.embedding : null };
  });
}

/** Context attached to a call log row: which feature triggered the call and
 * whose user it was (null = system/script). */
export interface LlmCallMeta {
  purpose: string;
  userId?: string | null;
}

export async function llmChatJson<T>(
  messages: { role: "system" | "user"; content: string }[],
  opts?: { temperature?: number; meta?: LlmCallMeta }
): Promise<T> {
  const cfg = getLlmChatConfig();
  if (!cfg) throw new Error("LLM 未配置(LLM_BASE_URL/LLM_API_KEY/LLM_MODEL)");
  return llmChatJsonWith(cfg, messages, opts);
}

/**
 * One chat completion expecting JSON back. Single attempt with a hard
 * timeout; callers own retry/degradation policy. Every call — success or
 * failure — lands in llm_calls for /logs.
 */
export async function llmChatJsonWith<T>(
  cfg: LlmConfig,
  messages: { role: "system" | "user"; content: string }[],
  opts?: { temperature?: number; meta?: LlmCallMeta }
): Promise<T> {
  const meta = opts?.meta ?? { purpose: "chat" };
  const startedAt = Date.now();
  const inputChars = messages.reduce((s, m) => s + m.content.length, 0);
  const usage = { promptTokens: null as number | null, completionTokens: null as number | null };
  const log = (ok: boolean, error: string | null): LlmCallLogInput => ({
    kind: "llm",
    purpose: meta.purpose,
    userId: meta.userId ?? null,
    model: cfg.model,
    inputChars,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    tookMs: Date.now() - startedAt,
    ok,
    error,
  });
  try {
    const { ok, status, data } = await postJson(
      `${cfg.baseUrl}/chat/completions`,
      cfg.apiKey,
      {
        model: cfg.model,
        messages,
        temperature: opts?.temperature ?? 0.2,
        // Not all providers support response_format; a JSON-parsing prompt plus
        // tolerant extraction is more portable than a hard JSON mode.
      },
      CHAT_TIMEOUT_MS
    );
    const u = readUsage(data);
    usage.promptTokens = u.promptTokens;
    usage.completionTokens = u.completionTokens;
    if (!ok) {
      const detail = readErrorDetail(data);
      throw new Error(`LLM chat 返回 HTTP ${status}${detail ? `:${detail.slice(0, 200)}` : ""}`);
    }
    const content = readChatContent(data);
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("LLM chat 返回为空");
    }
    const parsed = extractJson<T>(content);
    logLlmCall(log(true, null));
    return parsed;
  } catch (err) {
    // Logged exactly once here — success paths return above.
    logLlmCall(log(false, err instanceof Error ? err.message : String(err)));
    throw err;
  }
}

/** Embed a batch of texts. `meta` tags the call row on /logs (purpose +
 * owning user; omit for system/script calls). */
export async function llmEmbed(
  texts: string[],
  meta?: LlmCallMeta
): Promise<number[][]> {
  const purpose = meta?.purpose ?? "embed";
  const userId = meta?.userId ?? null;
  const startedAt = Date.now();
  const inputChars = texts.reduce((s, t) => s + t.length, 0);
  let model = "unknown";
  const log = (ok: boolean, error: string | null): LlmCallLogInput => ({
    kind: "embedding",
    purpose,
    userId,
    model,
    inputChars,
    promptTokens: null,
    completionTokens: null,
    tookMs: Date.now() - startedAt,
    ok,
    error,
  });
  try {
    const cfg = getLlmEmbeddingConfig();
    if (!cfg) throw new Error("Embedding 未配置(LLM_EMBEDDING_*)");
    model = cfg.model;
    const { ok, status, data } = await postJson(
      `${cfg.baseUrl}/embeddings`,
      cfg.apiKey,
      { model: cfg.model, input: texts },
      EMBED_TIMEOUT_MS
    );
    if (!ok) {
      throw new Error(`LLM embeddings 返回 HTTP ${status}`);
    }
    const rows = readEmbeddingRows(data);
    if (!rows || rows.length !== texts.length) {
      throw new Error("LLM embeddings 返回结构与输入不一致");
    }
    const vectors = rows
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((r) => (Array.isArray(r.embedding) ? r.embedding.map(Number) : null));
    if (vectors.some((v) => v === null || v.length === 0)) {
      throw new Error("LLM embeddings 返回缺少向量");
    }
    logLlmCall(log(true, null));
    return vectors.filter((v): v is number[] => v !== null);
  } catch (err) {
    logLlmCall(log(false, err instanceof Error ? err.message : String(err)));
    throw err;
  }
}
