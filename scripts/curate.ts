import { loadEnv } from "./load-env";
import { closePool, query } from "../lib/db";
import { MIN_MENTION_TITLE_CHARS, findUnlinkedMentionOffset, parseWikiLinks } from "../lib/links";

loadEnv();

/**
 * Read-only KB hygiene report — the book's §3.3.3.2 定期整理 (and §9.3.3
 * "睡眠学习" pruning) in a first, deterministic form: surface the problems a
 * human (or a later LLM-assisted pass) should merge/fix. Writes nothing.
 *
 *   npm run curate [--days 180]
 *
 * Sections:
 *   1. 疑似重复  — concepts sharing an identical current-version body hash
 *   2. 失效链接  — [[标题]] references that resolve to no concept
 *   3. 缺描述    — stable concepts without a description (auto-summary miss)
 *   4. 长期未更新 — no update within the staleness window
 *   5. 未链接提及 — a body mentions another entry's title as plain text
 *      without [[linking]] it (Obsidian "unlinked mentions", deterministic)
 */
interface Row {
  id: string;
  title: string;
  status: string;
  description: string | null;
  body_markdown: string;
  content_hash: string;
  updated_at: string;
}

const STALENESS_DEFAULT_DAYS = 180;

function fmt(id: string, title: string): string {
  return `${title} (${id.slice(0, 8)})`;
}

async function main() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf("--days");
  const days =
    daysIdx !== -1 ? Math.max(1, Math.trunc(Number(args[daysIdx + 1])) || STALENESS_DEFAULT_DAYS) : STALENESS_DEFAULT_DAYS;

  const { rows } = await query<Row>(
    `SELECT c.id, c.title, c.status, c.description, c.updated_at,
            v.body_markdown, v.content_hash
     FROM concepts c
     JOIN concept_versions v ON v.concept_id = c.id AND v.version_number = c.current_version
     WHERE c.deleted_at IS NULL
     ORDER BY c.title`
  );
  console.log(`== curate 报告（只读，共 ${rows.length} 条）==\n`);

  // 1. Exact-body duplicates (the write-path 409 only stops future ones;
  // these are what already slipped in, e.g. same body under different titles).
  const byHash = new Map<string, Row[]>();
  for (const r of rows) {
    const group = byHash.get(r.content_hash);
    if (group) group.push(r);
    else byHash.set(r.content_hash, [r]);
  }
  const dupGroups = [...byHash.values()].filter((g) => g.length > 1);
  console.log(`1. 疑似重复（正文完全相同）：${dupGroups.length} 组`);
  for (const g of dupGroups) {
    console.log("   - " + g.map((r) => fmt(r.id, r.title)).join("  ≡  "));
  }

  // 2. Dangling wiki links: referenced title exists nowhere.
  const titles = new Set(rows.map((r) => r.title.toLowerCase()));
  const dangling: { from: Row; target: string }[] = [];
  for (const r of rows) {
    for (const ref of parseWikiLinks(r.body_markdown)) {
      if (!titles.has(ref.title.toLowerCase())) {
        dangling.push({ from: r, target: ref.title });
      }
    }
  }
  console.log(`\n2. 失效链接（[[…]] 无对应条目）：${dangling.length} 处`);
  for (const d of dangling) {
    console.log(`   - ${fmt(d.from.id, d.from.title)} → [[${d.target}]]`);
  }

  // 3. Missing description on stable entries (auto-summary didn't run/fill).
  const noDesc = rows.filter((r) => r.status === "stable" && !r.description);
  console.log(`\n3. 缺描述（stable 且无 description）：${noDesc.length} 条`);
  for (const r of noDesc.slice(0, 50)) console.log(`   - ${fmt(r.id, r.title)}`);
  if (noDesc.length > 50) console.log(`   …及其余 ${noDesc.length - 50} 条`);

  // 4. Stale entries.
  const cutoff = Date.now() - days * 86_400_000;
  const stale = rows.filter((r) => new Date(r.updated_at).getTime() < cutoff);
  console.log(`\n4. 长期未更新（>${days} 天）：${stale.length} 条`);
  for (const r of stale.slice(0, 50)) {
    console.log(`   - ${fmt(r.id, r.title)}（最后更新 ${new Date(r.updated_at).toLocaleDateString("zh-CN")}，${r.status}）`);
  }

  // 5. Unlinked mentions (Obsidian pattern): a body mentions another entry's
  // title as plain text without [[linking]] it. The linked/unlinked decision
  // and the ASCII word-boundary rule live in lib/links.ts so this report and
  // the concept detail page's 未链接提及 panel cannot drift apart (the local
  // copy here used to skip a note wholesale when the title appeared anywhere
  // inside `[[`, hiding every other stray mention in it).
  const unlinked: { from: Row; target: Row }[] = [];
  for (const src of rows) {
    for (const target of rows) {
      if (target.id === src.id) continue;
      if (target.title.trim().length < MIN_MENTION_TITLE_CHARS) continue;
      if (findUnlinkedMentionOffset(src.body_markdown, target.title) === -1) continue;
      unlinked.push({ from: src, target });
    }
  }
  console.log(`\n5. 未链接提及（正文提到标题但未加 [[链接]]）：${unlinked.length} 处`);
  for (const u of unlinked.slice(0, 50)) {
    console.log(`   - ${fmt(u.from.id, u.from.title)} 提到「${u.target.title}」`);
  }
  if (unlinked.length > 50) console.log(`   …及其余 ${unlinked.length - 50} 处`);

  await closePool();
}

main()
  .catch((err) => {
    console.error("[curate] fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
