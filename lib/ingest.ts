/** Ingest pipeline pure logic: Markdown chunking, LLM candidate validation.
 * No DB / HTTP here so the pipeline behavior is unit-testable; the CLI wiring
 * lives in scripts/ingest.ts. */

export interface IngestCandidate {
  type: string;
  title: string;
  description: string | undefined;
  category: string | undefined;
  tags: string[];
  status: "stable";
  body: string;
}

/** Longest chunk handed to the LLM — keeps prompts (and cost) bounded. */
const MAX_CHUNK_CHARS = 2800;
/** Sections shorter than this carry too little signal to atomize alone. */
const MIN_CHUNK_CHARS = 120;

/** Split Markdown into LLM-sized chunks: first by headings (any level), then
 * long sections by paragraph windows. Tiny trailing fragments merge into the
 * previous chunk so context is not lost between them. */
export function splitMarkdown(md: string): string[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^#{1,4}\s+\S/.test(line) && current.length) {
      // A heading starts a new section; whatever came before (including the
      // content ahead of the first heading) is flushed as its own section.
      sections.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) sections.push(current.join("\n").trim());
  const pieces = sections.filter((s) => s.length > 0);

  const chunks: string[] = [];
  for (const piece of pieces) {
    if (piece.length <= MAX_CHUNK_CHARS) {
      chunks.push(piece);
      continue;
    }
    // Paragraph-window split for oversized sections.
    let window = "";
    for (const para of piece.split(/\n{2,}/)) {
      const candidate = window ? `${window}\n\n${para}` : para;
      if (candidate.length > MAX_CHUNK_CHARS && window) {
        chunks.push(window);
        window = para.slice(0, MAX_CHUNK_CHARS);
      } else if (candidate.length > MAX_CHUNK_CHARS) {
        chunks.push(candidate);
        window = "";
      } else {
        window = candidate;
      }
    }
    if (window.trim()) chunks.push(window);
  }

  // Merge tiny fragments forward so the LLM sees enough context.
  const merged: string[] = [];
  for (const chunk of chunks) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.length + chunk.length <= MAX_CHUNK_CHARS &&
        (chunk.length < MIN_CHUNK_CHARS || prev.length < MIN_CHUNK_CHARS)) {
      merged[merged.length - 1] = `${prev}\n\n${chunk}`;
    } else {
      merged.push(chunk);
    }
  }
  return merged.filter((c) => c.trim().length > 0);
}

function clampString(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Normalize raw LLM output into safe candidates. Invalid entries (missing
 * title/body, too-short body) are dropped rather than guessed at; lengths are
 * clamped to the server's zod limits so a write can never fail validation. */
export function validateCandidates(
  raw: unknown,
  opts: { baseCategory?: string; max?: number }
): { candidates: IngestCandidate[]; dropped: number } {
  const list = Array.isArray(raw) ? raw : [];
  const candidates: IngestCandidate[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const title = clampString(o.title, 200);
    const body = clampString(o.body, 60_000);
    if (title.length < 2 || body.length < 30) continue;

    const llmCategory = clampString(o.category, 200);
    const category = opts.baseCategory
      ? [opts.baseCategory, llmCategory].filter(Boolean).join("/")
      : llmCategory;
    const tags = Array.isArray(o.tags)
      ? o.tags
          .map((t) => clampString(t, 32))
          .filter(Boolean)
          .slice(0, 8)
      : [];
    candidates.push({
      type: clampString(o.type, 64) || "Note",
      title,
      description: clampString(o.description, 500) || undefined,
      category: category || undefined,
      tags,
      status: "stable",
      body,
    });
    if (opts.max && candidates.length >= opts.max) break;
  }
  return { candidates, dropped: list.length - candidates.length };
}

export const INGEST_SYSTEM_PROMPT = `你是个人知识库的编辑。把输入材料拆解为「原子知识条目」：
- 一条 = 一个独立、可单独检索的知识点（一个结论、一个机制、一个步骤、一个定义）。
- body 用 Markdown 保留原文的关键细节、数字、代码与因果关系，300-1500 字；不要改写事实、不要发挥。
- 宁大勿碎：同一机制的不同侧面可留在同一条；纯粹寒暄、目录、重复内容不要输出。
- description 用一句话(≤120 字)概括该条目的核心结论；category 用 1-2 级中文目录；tags 3-6 个短标签。
- type 从 Note/Definition/Procedure/Decision/Entity/Reference/Technical Note 中选择。
只输出 JSON 数组，格式：
[{"title":"...","description":"...","type":"Note","category":"...","tags":["..."],"body":"..."}]
没有可提取的内容时输出 []。`;

/** Chat prompt for one chunk. Returns the user-message text. */
export function ingestUserPrompt(chunk: string, max: number): string {
  return `材料如下（最多拆出 ${max} 条）：\n\n${chunk}`;
}
