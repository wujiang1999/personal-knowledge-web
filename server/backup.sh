#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/personal-knowledge-web
BACKUP_ROOT=/var/backups/personal-knowledge-web
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

umask 077
install -d -m 0700 "$BACKUP_ROOT"
STAGING="$(mktemp -d "$BACKUP_ROOT/.staging.XXXXXX")"
cleanup() {
  if [[ -d "$STAGING" ]]; then
    rm -r -- "$STAGING"
  fi
}
trap cleanup EXIT

runuser -u postgres -- pg_dump -Fc --no-owner --no-privileges knowledge > "$STAGING/knowledge.dump"
tar -C "$APP_DIR/data" -czf "$STAGING/attachments.tar.gz" attachments
pg_restore --list "$STAGING/knowledge.dump" >/dev/null
tar -tzf "$STAGING/attachments.tar.gz" >/dev/null
runuser -u knowledge-web -- git -C "$APP_DIR" rev-parse HEAD > "$STAGING/app-commit.txt"
(cd "$STAGING" && sha256sum knowledge.dump attachments.tar.gz app-commit.txt > SHA256SUMS)

FINAL="$BACKUP_ROOT/$STAMP"
mv "$STAGING" "$FINAL"
trap - EXIT

# Retain only completed timestamped backups inside this dedicated directory.
find -P "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20[0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z' -mtime "+$RETENTION_DAYS" -exec rm -r -- {} +
echo "backup complete: $FINAL"
