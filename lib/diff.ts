/** Minimal LCS line diff for the version-history compare view. Dependency-free
 * and pure: at this KB's scale a version is at most a few hundred lines, so an
 * O(n·m) DP is fine — a cell-count guard falls back to whole-block replace
 * before anything pathological can happen (pasted 10k-line bodies). */

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

const MAX_LINES = 4000;
const MAX_CELLS = 4_000_000;

export function diffLines(a: string, b: string): DiffLine[] {
  const split = (s: string) => (s.length === 0 ? [] : s.split("\n"));
  let x = split(a);
  let y = split(b);
  if (x.length > MAX_LINES) x = [...x.slice(0, MAX_LINES), `…（已截断，共 ${a.split("\n").length} 行）`];
  if (y.length > MAX_LINES) y = [...y.slice(0, MAX_LINES), `…（已截断，共 ${b.split("\n").length} 行）`];

  // Trim the common prefix/suffix first — version edits usually touch the
  // middle or end, and this keeps the DP table (and output) small.
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const midX = x.slice(start, endX);
  const midY = y.slice(start, endY);

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: "same", text: x[i] });

  if (midX.length === 0 && midY.length === 0) {
    // identical
  } else if (midX.length * midY.length > MAX_CELLS) {
    for (const t of midX) out.push({ kind: "del", text: t });
    for (const t of midY) out.push({ kind: "add", text: t });
  } else {
    // LCS table over the middle section.
    const rows = midX.length;
    const cols = midY.length;
    const dp: Uint32Array[] = [];
    for (let i = 0; i <= rows; i++) dp.push(new Uint32Array(cols + 1));
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = cols - 1; j >= 0; j--) {
        dp[i][j] = midX[i] === midY[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (midX[i] === midY[j]) {
        out.push({ kind: "same", text: midX[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push({ kind: "del", text: midX[i] });
        i++;
      } else {
        out.push({ kind: "add", text: midY[j] });
        j++;
      }
    }
    while (i < rows) out.push({ kind: "del", text: midX[i++] });
    while (j < cols) out.push({ kind: "add", text: midY[j++] });
  }

  for (let k = endX; k < x.length; k++) out.push({ kind: "same", text: x[k] });
  return out;
}
