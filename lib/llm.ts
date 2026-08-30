import { getLlmChatConfig, getLlmEmbeddingConfig, type LlmConfig } from "./config";

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

/**
 * One chat completion expecting JSON back. Single attempt with a hard
 * timeout; callers own retry/degradation policy.
 */
export async function llmChatJson<T>(
  messages: { role: "system" | "user"; content: string }[],
  opts?: { temperature?: number }
): Promise<T> {
  const cfg = getLlmChatConfig();
  if (!cfg) throw new Error("LLM 未配置(LLM_BASE_URL/LLM_API_KEY/LLM_MODEL)");
  return llmChatJsonWith(cfg, messages, opts);
}

export async function llmChatJsonWith<T>(
  cfg: LlmConfig,
  messages: { role: "system" | "user"; content: string }[],
  opts?: { temperature?: number }
): Promise<T> {
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
  if (!ok) {
    const detail =
      typeof (data as { error?: { message?: unknown } })?.error?.message === "string"
        ? (data as { error: { message: string } }).error.message
        : "";
    throw new Error(`LLM chat 返回 HTTP ${status}${detail ? `:${detail.slice(0, 200)}` : ""}`);
  }
  const content = (data as {
    choices?: { message?: { content?: unknown } }[];
  })?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LLM chat 返回为空");
  }
  return extractJson<T>(content);
}

/** Embed a batch of texts. Returns vectors in input order. */
export async function llmEmbed(texts: string[]): Promise<number[][]> {
  const cfg = getLlmEmbeddingConfig();
  if (!cfg) throw new Error("Embedding 未配置(LLM_EMBEDDING_*)");
  const { ok, status, data } = await postJson(
    `${cfg.baseUrl}/embeddings`,
    cfg.apiKey,
    { model: cfg.model, input: texts },
    EMBED_TIMEOUT_MS
  );
  if (!ok) {
    throw new Error(`LLM embeddings 返回 HTTP ${status}`);
  }
  const rows = (data as { data?: { embedding?: unknown; index?: number }[] })?.data;
  if (!Array.isArray(rows) || rows.length !== texts.length) {
    throw new Error("LLM embeddings 返回结构与输入不一致");
  }
  const vectors = rows
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((r) => (Array.isArray(r.embedding) ? r.embedding.map(Number) : null));
  if (vectors.some((v) => !v || v.length === 0)) {
    throw new Error("LLM embeddings 返回缺少向量");
  }
  return vectors as number[][];
}
