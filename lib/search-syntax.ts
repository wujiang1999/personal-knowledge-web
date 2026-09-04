/** Obsidian-style search operators parsed out of the free-text query:
 * `tag:llm`, `category:"技术/部署"`, `status:draft`. Operators are stripped
 * from the free-text remainder (BM25 / trgm / embedding see only real
 * words); repeated `tag:` accumulate, one `category:` / `status:` each
 * (last wins). Unknown status values are ignored rather than silently
 * returning zero rows. */
export interface ParsedQuery {
  /** Free-text remainder with operators removed (untrimmed caller case). */
  text: string;
  tags: string[];
  category: string | null;
  status: string | null;
}

const OPERATOR_RE = /(tag|category|status):(?:"([^"]*)"|(\S*))?/g;
const STATUSES = new Set(["draft", "stable", "deprecated"]);

export function parseSearchQuery(q: string): ParsedQuery {
  const parsed: ParsedQuery = { text: q, tags: [], category: null, status: null };
  if (!q) return parsed;
  parsed.text = q.replace(OPERATOR_RE, (_m, key: string, quoted: string | undefined, bare: string | undefined) => {
    const value = (quoted ?? bare ?? "").trim();
    if (!value) return "";
    if (key === "tag") parsed.tags.push(value);
    else if (key === "category") parsed.category = value;
    else if (key === "status" && STATUSES.has(value.toLowerCase())) parsed.status = value.toLowerCase();
    return "";
  });
  return parsed;
}
