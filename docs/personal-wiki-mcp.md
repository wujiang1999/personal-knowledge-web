# personal-wiki MCP integration

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
