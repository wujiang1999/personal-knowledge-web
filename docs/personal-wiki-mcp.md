# personal-wiki MCP integration

## Current contract: v0.11.0 (2026-09-13), retrieval fields extended 2026-09-16

- Search results carry `section` (the heading path a hit sits under, e.g.
  `第4章 > 4.2 检索`) alongside `score` and `similarity`. `score` is a BM25F
  value: the three fields are weighted (title 2 / description 1.25 / body 1) and
  length-normalized per field, so a title hit scores about twice a single body
  occurrence and the old "typically 2-15" range no longer describes it. A row
  injected by semantic recall alone still carries the fused RRF score (~2),
  which is not comparable with the lexical scale — use `similarity` for
  cross-path comparison. Ask sources carry `section` too.
- Search operators are `tag:`, `category:`, `status:` and `type:` (the last is
  new, matched case-insensitively). Operator names need a word boundary, so
  `filetype:pdf` is searched as text rather than read as a `type:` filter, and
  operators now also constrain the fuzzy and semantic recall paths.
- The MCP judge calls authenticated `POST /api/judge`; only the server holds
  supplier credentials. `KB_LLM_*` client settings are no longer used.
- The judge classifies complete documents and returns an exact candidate ID.
  It never generates replacement content. Merge suggestions, failures, and
  oversized material enter the review queue with the submitted full body;
  an LLM verdict cannot automatically overwrite an existing concept.
- API keys have `read`, `write`, or explicitly provisioned `admin` access and
  optional expiry. Ordinary MCP keys use `write`: owner-scoped knowledge access,
  no key/account administration or irreversible purge. Browser admin access is
  unchanged. An expired/invalid Bearer key cannot fall back to a session cookie.
- RAG citations may include `chunkStart` and `chunkEnd` UTF-16 offsets into the
  current full body. Retrieval uses overlapping full-document chunks filtered
  by source hash, metadata, endpoint, model, and dimensions.
- Model admission and task submission have server-side concurrency, rate, and
  token limits. HTTP 429 is actionable throttling; clients must not retry writes
  automatically. See `OPERATIONS.md` for defaults.

The versioned sections below document historical behavior; this section
supersedes their client-side LLM and automatic-merge descriptions.

The MCP client registration and protocol server name are `personal-wiki` as of
2026-09-08 (MCP v0.7.1). Existing `kb_*` tool names, `KB_*` environment variables,
API routes, and historical API-key labels remain compatible.

## Distribution

| Location | Repository / path |
|---|---|
| Local client | `C:/Users/15890/.claude/mcp-servers/personal-knowledge-web-mcp` |
| GitHub | `https://github.com/wujiang1999/personal-knowledge-web-mcp` (`main`) |
| Tencent Cloud | `/opt/personal-wiki-mcp`, owned by `knowledge-web` |
| Knowledge API | This repository, deployed at `/opt/personal-knowledge-web` |

The MCP is a local stdio process launched by Claude or Codex. The Tencent copy
is an independently buildable checkout of the same MCP commit, not an HTTP
endpoint or a continuously running service. No new port is needed. Credentials
and client registrations are machine-local and must not be published or copied
into the server checkout.

## Rename and compatibility

- Claude: rename the `mcpServers` key from `personal-kb` to `personal-wiki` and
  update existing `mcp__personal-kb` permission references accordingly.
- Codex: rename `[mcp_servers.personal-kb]` and its child tables (including `.env`)
  to `personal-wiki`, preserving the command, arguments, credentials, and options.
- Preserve existing credentials and API-key names. Renaming the registration
  does not require a database migration or a key rotation.
- Open a fresh client session to load the new registration and rebuilt `dist`.

## v0.7.1 behavior and validation

- Handshake name is `personal-wiki`; its version comes from `package.json`.
- GET transport/5xx failures have at most one automatic retry; mutations are
  not replayed on transport/5xx failures. A discarded 5xx body is cancelled.
- `kb_whoami` checks `/api/me` and concept read access on every call. It no longer
  caches successful identities across probes or server instances.
- All 18 existing tools and their input contracts are retained.

## v0.10.0 — RAG ask + judge speedup (2026-09-10)

- New tool `kb_ask {question, k?}`: the server retrieves top-k with the same
  hybrid search as `kb_search`, answers **only from those documents**, and
  returns `citations` mapping each `[n]` marker back to a concept id. The tool
  waits server-side (5-30s typical, 75s cap); a timeout returns `taskId`
  instead of dropping the answer, which stays in the task history.
- Judge calls now send `thinking: {type: "disabled"}` by default, with a
  three-step retry ladder (JSON+no-thinking → no-thinking → plain). Measured
  against the live endpoint on identical input: short verdicts (ok/conflict)
  1.1-2.0s / 80-264 completion tokens with thinking on vs 0.6-1.0s / 24-54
  with it off — and 6.2-6.8s → 0.9-1.0s on a verdict-only A/B prompt. Merge
  verdicts stay ~6.3-6.7s either way: that cost is writing `mergedBody`.
  Verdicts on the regression set (duplicate → merge, unrelated → ok, same
  topic/different content → conflict) are identical in both modes.
  `KB_LLM_THINKING=on` restores the provider default (a thinner prompt once
  flipped merge → ok without reasoning, so the escape hatch is documented).
- Tool count 21 → 22; `scripts/smoke.mjs` asserts the new count.

## Web-only maintenance endpoint (2026-09-10, MCP unchanged)

`POST /api/tasks` enqueues batch maintenance jobs (`kind=resummarize`: fill in
missing descriptions, ≤50 per run, progress in the task row). It is **not
exposed as a tool on purpose** — same rationale as the account endpoints: it
burns LLM quota across the whole library and is a human-driven maintenance
action, not something an agent should trigger while answering a question. The
MCP contract for reading task state is unchanged (`kb_ask` polls its own task
server-side); the batch job is visible in the web UI only.

## v0.9.0 — review queue (2026-09-10)

The knowledge API gained two routes — `GET/POST /api/reviews` and
`POST /api/reviews/[id]/resolve` — backing the new review queue (`/reviews`).
Blocked writes are no longer dropped on the floor: `ingest` near-duplicates,
OKF import conflicts, and MCP `conflict` / `merge_suggestion` verdicts all
enqueue the *full* candidate body, so the decision has a durable home.

- `kb_create_concept` / `kb_update_concept` now attach `reviewId` to the
  `conflict` and `merge_suggestion` verdicts (the body is enqueued automatically).
  A failed enqueue returns `reviewId:null` + `reviewError` instead of failing the
  verdict — the agent must then hand the body back to the user.
- New tools: `kb_list_reviews` (read-only, `status=pending|resolved`) and
  `kb_resolve_review` (`kept_old` / `adopted_new` / `merged` / `kept_both`).
  Tool count 19 → 21 (`kb_upload_attachment`, added in v0.8.0, had left the
  smoke assertion at 18 — this release repairs that stale count too).
- Resolutions go through the existing immutable-version write paths
  (`addConceptVersion` / `createConcept`), so every decision is itself revertible
  from the version history.

Run `npm test`, `npm run typecheck`, and `npm run build` in the MCP repository.
With credentials injected into the process environment, `npm run smoke` verifies
the real stdio handshake, tool discovery, repeated identity checks, and a bounded
read from the live knowledge API. It does not write knowledge or print content.

After local validation and GitHub push, transfer a reviewed Git bundle to Tencent
Cloud, fast-forward the MCP checkout, install locked dependencies, and repeat the
checks. Compare local/GitHub/server HEADs and source tree hashes. This release
changes no web runtime or API contract, so syncing this integration document
requires no website rebuild or service restart.
