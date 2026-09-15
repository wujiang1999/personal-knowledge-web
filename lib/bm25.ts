/** BM25 lexical scoring for searchConcepts.
 *
 * Query tokenization mirrors the TokenBigram shape the corpus was historically
 * indexed with: ASCII word runs stay whole words; non-ASCII (CJK) runs split
 * into 2-grams, a lone char stays alone. Matching in SQL is plain substring
 * position()/replace() over lower()ed field text — no external tokenizer, and
 * df and tf share one definition so the score is internally consistent.
 */

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
/** 失效内容降权（§3.3.3.2）：deprecated 条目仍可被搜到，但不与有效条目竞争
 * 前排。系数直接乘进 BM25，排序与返回的 score 始终一致。 */
export const DEPRECATED_FACTOR = 0.25;
/** Bound the per-doc scoring loop: a 200-char CJK needle would otherwise
 * expand to 199 bigrams. After dedup keep the first MAX_QUERY_TERMS terms;
 * relevance loss for needles that long is negligible. */
export const MAX_QUERY_TERMS = 24;

/** TokenBigram-shaped query terms: lowercase ASCII word runs + CJK bigrams,
 * deduplicated in first-occurrence order. Punctuation splits terms rather than
 * being stripped. The array ships to SQL as one parameter, so the statement
 * text (and its prepared-statement plan) is term-count independent.
 *
 * The run regex splits ASCII from everything else but does NOT split a CJK run
 * at punctuation, so `知识库，检索` arrives as one run. Stripping the
 * punctuation there would glue it into `知识库检索` and emit the cross-boundary
 * bigram `库检`, which then matches any document where 库 happens to sit next
 * to 检 (数据库检索优化) and inflates its BM25 score. Splitting first keeps the
 * two phrases independent — and stops phantom terms from crowding real ones
 * out of MAX_QUERY_TERMS. */
export function tokenizeQuery(needle: string): string[] {
  const terms: string[] = [];
  const push = (t: string) => {
    if (t && !terms.includes(t)) terms.push(t);
  };
  for (const run of needle.toLowerCase().match(/[a-z0-9_]+|[^\sa-z0-9_]+/g) ?? []) {
    if (/[a-z0-9_]/.test(run)) {
      push(run);
    } else if (/[\p{L}\p{N}]/u.test(run)) {
      // Non-ASCII run: split on any non-letter/non-digit so punctuation is a
      // term boundary, then sliding 2-grams per segment (TokenBigram emits
      // full grams only; a 1-char segment is its own term).
      for (const segment of run.split(/[^\p{L}\p{N}]+/u)) {
        if (!segment) continue;
        if (segment.length === 1) push(segment);
        else for (let i = 0; i + 2 <= segment.length; i++) push(segment.slice(i, i + 2));
      }
    }
  }
  return terms.slice(0, MAX_QUERY_TERMS);
}

/** Pure BM25 term contribution (idf × tf normalization). Unit-tested; the
 * SQL in searchConcepts computes exactly this formula inline. */
export function bm25TermContribution(
  tf: number,
  df: number,
  n: number,
  docLen: number,
  avgdl: number
): number {
  const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
  const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgdl));
  return (idf * tf * (BM25_K1 + 1)) / denom;
}
