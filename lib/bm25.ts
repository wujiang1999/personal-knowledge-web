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
 * deduplicated in first-occurrence order. Punctuation-only runs are dropped.
 * The array ships to SQL as one parameter, so the statement text (and its
 * prepared-statement plan) is term-count independent. */
export function tokenizeQuery(needle: string): string[] {
  const terms: string[] = [];
  const push = (t: string) => {
    if (t && !terms.includes(t)) terms.push(t);
  };
  for (const run of needle.toLowerCase().match(/[a-z0-9_]+|[^\sa-z0-9_]+/g) ?? []) {
    if (/[a-z0-9_]/.test(run)) {
      push(run);
    } else if (/[\p{L}\p{N}]/u.test(run)) {
      // Non-ASCII run: strip embedded punctuation, then sliding 2-grams
      // (TokenBigram emits full grams only; a 1-char run is its own term).
      const letters = run.replace(/[^\p{L}\p{N}]/gu, "");
      if (letters.length === 1) push(letters);
      else for (let i = 0; i + 2 <= letters.length; i++) push(letters.slice(i, i + 2));
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
