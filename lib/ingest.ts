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

/** Split Markdown into LLM-sized chunks, each annotated with the heading
 * breadcrumb ("location path") of the section it came from — index-aligned
 * `chunks[i]` / `paths[i]`. The book (§3.3.5 Contextual Retrieval) shows a
 * chunk severed from its heading hierarchy becomes ambiguous ("该公司" =
 * which company?); the path is injected into the extraction prompt so
 * atomized entries stay anchored to their document context.
 *
 * Chunking semantics (unchanged contract): sections break at any `#`–`####`
 * heading; oversized sections split into paragraph windows; tiny fragments
 * merge forward. A merged chunk that spans sections carries all of their
 * paths joined by ` | `. Content before the first heading has path "". */
export function splitMarkdownWithPaths(md: string): { chunks: string[]; paths: string[] } {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const sections: { text: string; path: string }[] = [];
  let current: string[] = [];
  const stack: { level: number; text: string }[] = [];
  const breadcrumb = () => stack.map((h) => h.text).join(" > ");
  const applyHeading = (line: string) => {
    const m = /^(#{1,4})\s+(\S.*)$/.exec(line)!;
    const level = m[1].length;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, text: m[2].trim() });
  };
  for (const line of lines) {
    const isHeading = /^#{1,4}\s+\S/.test(line);
    if (isHeading && current.length) {
      // Flush what precedes the heading under the breadcrumb in force while
      // that content was written; the heading then opens a new section.
      sections.push({ text: current.join("\n").trim(), path: breadcrumb() });
      applyHeading(line);
      current = [line];
    } else {
      if (isHeading) applyHeading(line);
      current.push(line);
    }
  }
  if (current.length) sections.push({ text: current.join("\n").trim(), path: breadcrumb() });
  const pieces = sections.filter((s) => s.text.length > 0);

  const raw: { text: string; path: string }[] = [];
  for (const piece of pieces) {
    if (piece.text.length <= MAX_CHUNK_CHARS) {
      raw.push(piece);
      continue;
    }
    // Paragraph-window split for oversized sections.
    let window = "";
    for (const para of piece.text.split(/\n{2,}/)) {
      const candidate = window ? `${window}\n\n${para}` : para;
      if (candidate.length > MAX_CHUNK_CHARS && window) {
        raw.push({ text: window, path: piece.path });
        window = para.slice(0, MAX_CHUNK_CHARS);
      } else if (candidate.length > MAX_CHUNK_CHARS) {
        raw.push({ text: candidate, path: piece.path });
        window = "";
      } else {
        window = candidate;
      }
    }
    if (window.trim()) raw.push({ text: window, path: piece.path });
  }

  // Merge tiny fragments forward so the LLM sees enough context; paths of the
  // merged pieces accumulate (deduped, in order).
  const merged: { text: string; paths: string[] }[] = [];
  for (const item of raw) {
    const prev = merged[merged.length - 1];
    if (
      prev !== undefined &&
      prev.text.length + item.text.length <= MAX_CHUNK_CHARS &&
      (item.text.length < MIN_CHUNK_CHARS || prev.text.length < MIN_CHUNK_CHARS)
    ) {
      prev.text = `${prev.text}\n\n${item.text}`;
      if (!prev.paths.includes(item.path)) prev.paths.push(item.path);
    } else {
      merged.push({ text: item.text, paths: [item.path] });
    }
  }
  const out = merged.filter((c) => c.text.trim().length > 0);
  return {
    chunks: out.map((c) => c.text),
    paths: out.map((c) => c.paths.filter(Boolean).join(" | ")),
  };
}

/** Backward-compatible chunk-only view of splitMarkdownWithPaths. */
export function splitMarkdown(md: string): string[] {
  return splitMarkdownWithPaths(md).chunks;
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
- 若材料带有「位置」上下文，用它消歧：条目标题须自含主体（哪家公司/哪份文件/哪个系统），
  正文开头一句点明来源章节，代词（"该公司""上文"）一律还原为具体对象。
- description 用一句话(≤120 字)概括该条目的核心结论；category 用 1-2 级中文目录；tags 3-6 个短标签。
- type 从 Note/Definition/Procedure/Decision/Entity/Reference/Technical Note 中选择。
只输出 JSON 数组，格式：
[{"title":"...","description":"...","type":"Note","category":"...","tags":["..."],"body":"..."}]
没有可提取的内容时输出 []。`;

/** Chat prompt for one chunk. `contextPath` (heading breadcrumb) anchors the
 * chunk in its original location — see splitMarkdownWithPaths. */
export function ingestUserPrompt(chunk: string, max: number, contextPath?: string): string {
  const ctx = contextPath?.trim() ? `位置：${contextPath.trim()}\n\n` : "";
  return `${ctx}材料如下（最多拆出 ${max} 条）：\n\n${chunk}`;
}
