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

/** Escape LIKE metacharacters so user input can never act as a wildcard.
 * Lives in this leaf module (not lib/concepts.ts, which imports it) because
 * operatorFilterClauses builds LIKE fragments itself. PostgreSQL's default
 * LIKE escape character is `\`, so no extra ESCAPE clause is needed. */
export function escapeLike(needle: string): string {
  return needle.replace(/[\\%_]/g, (m) => "\\" + m);
}

/** Operator filters as SQL fragment strings against the `concepts c` alias.
 * Values are pushed onto `params` (append order = clause order); callers
 * encode clause PRESENCE in their prepared-statement name, never the values.
 * Category matches the exact path or any subfolder (slash-boundary). */
export function operatorFilterClauses(parsed: ParsedQuery, params: unknown[]): string[] {
  const clauses: string[] = [];
  if (parsed.tags.length > 0) {
    const idx = (params.push(parsed.tags), params.length);
    clauses.push(`c.tags @> $${idx}::text[]`);
  }
  if (parsed.category) {
    // Two parameters, mirroring the folder ops in lib/concepts.ts: the
    // equality branch compares the literal path, while the LIKE branch needs
    // the metacharacters escaped. Sharing one escaped value would break
    // exact matches (`tech_ai` would be searched as `tech\_ai`); sharing one
    // unescaped value would let `_` act as a single-character wildcard
    // (`category:tech_ai` also matching `tech-ai`) and `%` match everything.
    const eqIdx = (params.push(parsed.category), params.length);
    const likeIdx = (params.push(escapeLike(parsed.category)), params.length);
    clauses.push(`(c.category = $${eqIdx} OR c.category LIKE $${likeIdx} || '/%')`);
  }
  if (parsed.status) {
    const idx = (params.push(parsed.status), params.length);
    clauses.push(`c.status = $${idx}`);
  }
  return clauses;
}
