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
/** Per-field boosts (BM25F). A title hit is a deliberate statement of what the
 * entry is about; a description hit is a one-line summary the author wrote;
 * body occurrences are the cheapest signal to acquire and the most common, so
 * they anchor the scale at 1. Before this the three fields were concatenated
 * into one bag with a single tf, which scored '检索方案' in a title exactly
 * like the same word appearing once in a long body — and 0020 had already
 * removed the tsvector A/B weights that used to carry that distinction. */
export const FIELD_WEIGHTS = { title: 2, description: 1.25, body: 1 } as const;
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

/** One field's term frequency and its length, in the same units the SQL's
 * lateral computes (occurrences of the lower()ed term, char_length). */
export interface FieldTf {
  tf: number;
  len: number;
}

/** The three indexed fields. `avg` is the corpus-wide mean length of each,
 * already guarded against zero (an all-NULL description column averages to 0
 * and would divide by zero without the GREATEST in `stats`). */
export type FieldBag<T> = { title: T; description: T; body: T };

/** Length-normalized, weight-combined term frequency — BM25F's tf̃.
 * Each field is normalized against *its own* mean length (a 30-char title is
 * long for a title; a 30-char body is nothing), then the fields are combined
 * with their boosts. */
export function combinedTermFreq(
  fields: FieldBag<FieldTf>,
  avg: FieldBag<number>,
): number {
  const norm = (len: number, mean: number): number =>
    1 - BM25_B + BM25_B * (len / Math.max(mean, 1));
  return (
    (FIELD_WEIGHTS.title * fields.title.tf) / norm(fields.title.len, avg.title) +
    (FIELD_WEIGHTS.description * fields.description.tf) /
      norm(fields.description.len, avg.description) +
    (FIELD_WEIGHTS.body * fields.body.tf) / norm(fields.body.len, avg.body)
  );
}

/** One query term's BM25F contribution: idf × the saturated field-weighted tf.
 * Unit-tested against pinned literals; the SQL in searchConcepts computes
 * exactly this formula inline. */
export function bm25fTermContribution(
  fields: FieldBag<FieldTf>,
  avg: FieldBag<number>,
  df: number,
  n: number,
): number {
  const tf = combinedTermFreq(fields, avg);
  if (tf === 0) return 0;
  const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
  return (idf * tf * (BM25_K1 + 1)) / (BM25_K1 + tf);
}
