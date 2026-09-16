# Personal Knowledge Web Operations

## Model and client hardening (2026-09-13)

Chat uses the configured `deepseek-flash` alias and embeddings use
`qwen3.7-text-embedding-flash` at 1024 dimensions. Call logs preserve the
configured model and provider-returned model separately. Embedding responses
must match dimensions and indices, contain finite nonzero vectors, and must
not identify a different model. Singleton embedding requests avoid the
provider's ambiguous batch indices. Credentials require HTTPS endpoints
(loopback development HTTP is allowed); redirects and URL credentials are
rejected. Authentication and throttling failures are not retried.

Migration 0021 adds complete-document chunks; 0022 adds API-key access/expiry;
0023 adds budget reservations and provider model logging. After migration run
`npm run db:embed-backfill`. Repeated runs skip complete current profiles.
Dimension changes fail closed and require an explicit index migration.

Default model limits are four global / two per-user concurrent calls, 120 global
/ 60 per-user calls per minute, and 2,000,000 global / 500,000 per-user daily
tokens (Asia/Shanghai). Admission reserves input UTF-8 bytes plus output bounds;
reported actual usage reconciles the reservation. Failed calls without known
usage retain their reservation. Leases expire after 150 seconds; old records
are pruned in bounded batches after 30 days, without a new scheduled job.
Tasks are limited to two live and ten submissions per minute per owner.
The `.env.example` documents overrides. These are token safeguards, not a
currency-denominated billing cap; provider-side spending limits remain useful.

Use a different `write` API key per client. On macOS/Linux, keep credential
files and server `.env` mode 600. On Windows, restrict their ACLs to the user,
SYSTEM, and Administrators.
Client MCP configuration needs only its knowledge API credential, not supplier
keys. Reopen client sessions after rotation to load the rebuilt MCP and key.
Production and development database passwords must differ.

## Deployment

Run `sudo ./deploy.sh` only after the intended commit has been checked out by
the approved deployment path. The script never contacts GitHub and never
rewrites Git history. It runs validation, migrations, a build, a service
restart, and an external HTTPS smoke test; it restores the previous `.next`
build if a release step fails after that build has been saved. This does not
restore the source checkout, dependencies, or database migrations.

## Backups and Recovery

`personal-knowledge-web-backup.timer` creates a daily local backup of the
PostgreSQL database, attachments, the checked-out commit ID (`app-commit.txt`),
and checksums in
`/var/backups/personal-knowledge-web/`; it retains 30 days (`RETENTION_DAYS` in the backup script). Check the most
recent job with `sudo systemctl status personal-knowledge-web-backup.service`.
The current script does not create a Git bundle: back up source history
separately. A commit ID is not a source backup.

Use a new, empty PostgreSQL database for restore rehearsal. Validate its dump
first with `pg_restore --list`, verify `SHA256SUMS`, restore the database, and
unpack attachments into the configured `ATTACHMENT_DIR`. Do not overwrite the
live database or attachments during a rehearsal. The existing
`server/restore-drill.sh` checks backup hashes and restores a temporary database
with basic-table checks; it does not unpack attachments or start the application.
Those additional steps are required before claiming a complete recovery.

## Monitoring

`personal-knowledge-web-smoke.timer` runs a real HTTPS check every five
minutes for the health endpoint, public login redirect, and the separate
answers site. Its failures are visible through
`sudo systemctl status personal-knowledge-web-smoke.service`. Alert scripts
and OnFailure drop-ins are maintained in `server/`; whether external alerts
are active depends on the installed units and configuration. Check
`systemctl cat` and the actual Caddy log configuration before diagnosing alerts
or locating access logs.

## Attachments

Files are capped at 100 MiB and each user has a 2 GiB total default quota.
Adjust `MAX_TOTAL_ATTACHMENT_BYTES` in the production environment only when
capacity and backup retention have been reviewed. Run `npm run
attachments:audit` to report database/file mismatches; it never deletes data.
