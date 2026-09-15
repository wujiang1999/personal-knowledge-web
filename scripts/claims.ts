import { loadEnv } from "./load-env";
import { getAdminUsername } from "../lib/config";
import { auditConceptClaims, claimAuditTargets, CLAIM_MAX_PER_CONCEPT, type ClaimFinding } from "../lib/claims";
import { closePool, query } from "../lib/db";

loadEnv();

/**
 * Claim 审计（矛盾抽取）：把条目正文拆成原子主张，逐条回查库内相关条目，
 * 找出与既有内容**事实矛盾**的主张。
 *
 *   npm run claims                       # 只读：审计最近 5 条，打印报告（默认）
 *   npm run claims -- --max 20           # 只读：审计最近 20 条
 *   npm run claims -- --id <uuid>        # 只读：只审计一个条目
 *   npm run claims -- --write            # 把矛盾写进审核队列（/reviews 裁决）
 *
 * 与 `npm run ingest` / `npm run curate` 同一惯例：默认 dry-run，`--write` 才落库。
 * 成本：每个条目 1 次抽取调用 + 每条主张最多 1 次矛盾判定调用（主张数上限
 * CLAIM_MAX_PER_CONCEPT，找不到相关候选的主张直接跳过）。
 */
function usage(): never {
  console.error("usage: npm run claims -- [--id <uuid>] [--max <N>] [--write]");
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const idIdx = args.indexOf("--id");
  const id = idIdx !== -1 ? (args[idIdx + 1] ?? "") : undefined;
  if (idIdx !== -1 && !id) usage();
  const maxIdx = args.indexOf("--max");
  const max = maxIdx !== -1 ? Math.max(1, Math.trunc(Number(args[maxIdx + 1])) || 5) : 5;

  const ownerRow = await query<{ id: string; username: string; role: string }>(
    "SELECT id, username, role FROM users WHERE username = $1 LIMIT 1",
    [getAdminUsername()]
  );
  if (ownerRow.rows.length === 0) throw new Error(`找不到用户 ${getAdminUsername()}(ADMIN_USERNAME)`);
  const user = {
    id: ownerRow.rows[0].id,
    username: ownerRow.rows[0].username,
    role: ownerRow.rows[0].role === "admin" ? ("admin" as const) : ("user" as const),
  };

  const targets = await claimAuditTargets(user, { id, limit: max });
  if (targets.length === 0) {
    console.log("没有可审计的条目（--id 是否传对？）");
    await closePool();
    return;
  }
  console.error(
    `[claims] 审计 ${targets.length} 个条目;模式=${write ? "写入(矛盾入队)" : "dry-run(加 --write 才入队)"};每仓最多 ${CLAIM_MAX_PER_CONCEPT} 条主张`
  );

  let totalClaims = 0;
  let totalChecked = 0;
  let totalSkipped = 0;
  /** Targets whose audit threw. Kept separate from findings: a target that
   * errored was never examined, which is a different claim than "examined, no
   * contradictions found". */
  const erroredTargets: { title: string; reason: string }[] = [];
  const allFindings: { source: string; finding: ClaimFinding }[] = [];

  for (const target of targets) {
    process.stderr.write(`[claims] ${target.title.slice(0, 30)} …\n`);
    try {
      const outcome = await auditConceptClaims(user, target, {
        write,
        onProgress: (m) => process.stderr.write(m + "\n"),
      });
      totalClaims += outcome.claims;
      totalChecked += outcome.checked;
      totalSkipped += outcome.skippedWeak;
      for (const f of outcome.findings) allFindings.push({ source: outcome.title, finding: f });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      erroredTargets.push({ title: target.title, reason });
      console.error(`[claims] ${target.title} 审计失败:`, reason);
    }
  }

  console.log(`\n== claim 审计报告（${write ? "已入队" : "dry-run"}）==`);
  console.log(`条目 ${targets.length} 个 · 抽取主张 ${totalClaims} 条 · 做了矛盾判定 ${totalChecked} 条 · 跳过(无相关候选) ${totalSkipped} 条`);
  if (erroredTargets.length) {
    console.log(`审计失败 ${erroredTargets.length} 个条目（未检查）:`);
    for (const e of erroredTargets) console.log(`  ✗ 《${e.title}》: ${e.reason}`);
  }
  console.log(`发现矛盾 ${allFindings.length} 条:`);
  for (const { source, finding } of allFindings) {
    const queued = finding.reviewId ? ` → 待裁决 ${finding.reviewId.slice(0, 8)}` : "";
    console.log(`  ! 《${source}》「${finding.claim}」 vs 《${finding.targetTitle}》：${finding.reason}${queued}`);
  }
  if (allFindings.length === 0) {
    console.log("  （没有发现事实矛盾）");
  } else if (!write) {
    console.log("\n加 --write 可把这些矛盾写进审核队列，在网页 /reviews 裁决。");
  }
  if (erroredTargets.length) {
    // This runs under personal-knowledge-web-claims.timer, whose
    // OnFailure=kb-alert@%n.service is the only notification path. Exiting 0
    // with every target errored (expired LLM key, provider outage, DB down)
    // reported a clean weekly audit and never alerted — the contradiction
    // sweep could stop working for weeks unnoticed.
    console.error(`[claims] ${erroredTargets.length}/${targets.length} 个条目审计失败，退出码 1`);
    process.exitCode = 1;
  }
  await closePool();
}

main()
  .catch((err) => {
    console.error("[claims] fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
