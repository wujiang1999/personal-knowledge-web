#!/usr/bin/env bash
# Restore drill for personal-knowledge-web backups.
# Rebuilds the latest snapshot into a throwaway database (knowledge_drill),
# verifies checksums, restore success and expected tables, then drops it.
# Read-only towards production data; safe to run while the app is live.
# Server path: /usr/local/sbin/personal-knowledge-web-restore-drill
set -euo pipefail

BACKUP_ROOT=/var/backups/personal-knowledge-web
DRILL_DB=knowledge_drill
EXPECTED_TABLES="users concepts concept_versions sources attachments schema_migrations"

LATEST=$(find -P "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20[0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z' | sort | tail -1)
if [ -z "$LATEST" ]; then
  echo "FAIL: no backup snapshot found in $BACKUP_ROOT"
  exit 1
fi
echo "drill source: $LATEST"

# 1. snapshot integrity (fails the drill via set -e on any mismatch)
( cd "$LATEST" && sha256sum -c SHA256SUMS )
echo "checksums: OK"

# 2. restore into a throwaway database
sudo -u postgres dropdb --if-exists "$DRILL_DB"
sudo -u postgres createdb "$DRILL_DB"
cleanup() { sudo -u postgres dropdb --if-exists "$DRILL_DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# dump is root-only readable: feed it via stdin (root shell opens the fd, sudo inherits it)
sudo -u postgres pg_restore -d "$DRILL_DB" --no-owner --exit-on-error < "$LATEST/knowledge.dump"
echo "pg_restore: OK"

# 3. expected tables present (row counts informational; drift vs live is expected)
missing=0
for t in $EXPECTED_TABLES; do
  rows=$(sudo -u postgres psql -d "$DRILL_DB" -Atc "select count(*) from \"$t\"" 2>/dev/null) || { echo "FAIL: table missing in restore: $t"; missing=1; continue; }
  echo "table $t rows=$rows"
done
if [ "$missing" -ne 0 ]; then
  echo "DRILL FAIL: $(basename "$LATEST")"
  exit 1
fi

echo "DRILL PASS: $(basename "$LATEST")"
