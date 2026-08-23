# Personal Knowledge Web Operations

## Deployment

Run `sudo ./deploy.sh` only after the intended commit has been checked out by
the approved deployment path. The script never contacts GitHub and never
rewrites Git history. It runs validation, migrations, a build, a service
restart, and an external HTTPS smoke test; it restores the previous `.next`
build if a release step fails.

## Backups and Recovery

`personal-knowledge-web-backup.timer` creates a daily local backup of the
PostgreSQL database, attachments, checked-out Git bundle, and checksums in
`/var/backups/personal-knowledge-web/`; it retains 14 days. Check the most
recent job with `sudo systemctl status personal-knowledge-web-backup.service`.

Use a new, empty PostgreSQL database for restore rehearsal. Validate its dump
first with `pg_restore --list`, verify `SHA256SUMS`, restore the database, and
unpack attachments into the configured `ATTACHMENT_DIR`. Do not overwrite the
live database or attachments during a rehearsal.

## Monitoring

`personal-knowledge-web-smoke.timer` runs a real HTTPS check every five
minutes for the health endpoint, public login redirect, and the separate
answers site. Its failures are visible through
`sudo systemctl status personal-knowledge-web-smoke.service`; it does not send
external alerts. Caddy access events are available in `journalctl -u caddy`.

## Attachments

Files are capped at 100 MiB and each user has a 2 GiB total default quota.
Adjust `MAX_TOTAL_ATTACHMENT_BYTES` in the production environment only when
capacity and backup retention have been reviewed. Run `npm run
attachments:audit` to report database/file mismatches; it never deletes data.
