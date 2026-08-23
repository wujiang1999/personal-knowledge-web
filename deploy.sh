#!/bin/bash
# Deploy the code already checked out on this server.
#
# This script deliberately does not fetch from GitHub or rewrite Git history.
# Update the checkout first through the approved deployment path (for example,
# a reviewed Git bundle), then run: sudo ./deploy.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE="personal-knowledge-web"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://sjtuai.art}"
cd "$APP_DIR"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root so service restart and file ownership remain controlled." >&2
  exit 2
fi

git_as_app() {
  runuser -u knowledge-web -- env HOME=/var/lib/knowledge-web git -C "$APP_DIR" "$@"
}

if [[ -n "$(git_as_app status --porcelain --untracked-files=no)" ]]; then
  echo "Refusing to deploy with tracked, uncommitted changes." >&2
  exit 2
fi

rollback_dir=""
rollback() {
  status=$?
  if [[ -n "$rollback_dir" && -d "$rollback_dir" ]]; then
    echo "==> deploy failed — restoring the previous Next.js build"
    rm -rf -- "$APP_DIR/.next"
    mv "$rollback_dir" "$APP_DIR/.next"
    systemctl restart "$SERVICE" || true
  fi
  exit "$status"
}
trap rollback ERR

echo "==> release commit: $(git_as_app rev-parse --short HEAD)"
echo "==> npm ci"
runuser -u knowledge-web -- env HOME=/var/lib/knowledge-web npm ci --no-audit --no-fund

echo "==> validation"
runuser -u knowledge-web -- env HOME=/var/lib/knowledge-web npm run check

echo "==> db migrate (idempotent; safe no-op when already applied)"
runuser -u knowledge-web -- env HOME=/var/lib/knowledge-web npm run db:migrate

echo "==> build"
if [[ -d "$APP_DIR/.next" ]]; then
  rollback_dir="$(mktemp -d "$APP_DIR/.next.rollback.XXXXXX")"
  rmdir "$rollback_dir"
  mv "$APP_DIR/.next" "$rollback_dir"
fi
runuser -u knowledge-web -- env HOME=/var/lib/knowledge-web npm run build

echo "==> restart service"
systemctl restart "$SERVICE"

echo "==> health check ($HEALTH_URL)"
for i in 1 2 3 4 5; do
  if sleep 2; systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "OK"
    runuser -u knowledge-web -- env HOME=/var/lib/knowledge-web PUBLIC_BASE_URL="$PUBLIC_BASE_URL" npm run smoke:prod
    rm -rf -- "$rollback_dir"
    rollback_dir=""
    echo "==> deployed: $(git_as_app rev-parse --short HEAD) active: $(systemctl is-active "$SERVICE")"
    exit 0
  fi
  echo "    (attempt $i/5 not ready)"
done

echo "==> ERROR: service not healthy after restart" >&2
exit 1
