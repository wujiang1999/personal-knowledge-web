#!/bin/bash
# One-command deploy for this app on the ECS instance.
#   bash deploy.sh            (run on the ECS instance)
#   workbench exec -i i-j6c698asus1j5de5d66d -c 'bash /root/personal-knowledge-web/deploy.sh'
#
# Flow: pull → migrate → build → restart → health check.
# On failure: roll back to the previous commit (rebuild + restart) and exit 1.
set -euo pipefail
cd "$(dirname "$0")"

APP=personal-knowledge-web
PREV_COMMIT="$(git rev-parse HEAD)"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

rollback() {
  echo "==> deploy failed — rolling back to $PREV_COMMIT"
  git reset --hard "$PREV_COMMIT" >/dev/null 2>&1 || true
  if npm run build >/dev/null 2>&1; then
    systemctl restart "$APP" >/dev/null 2>&1 || true
    echo "==> rolled back: service restarted with the previous build"
  else
    echo "==> rollback build failed — previous .next may be stale; service NOT restarted"
  fi
}

trap rollback ERR

echo "==> current commit: $PREV_COMMIT"
echo "==> git pull"
git pull --ff-only

echo "==> db migrate (idempotent; safe no-op when already applied)"
npm run db:migrate

echo "==> build"
npm run build

echo "==> restart service"
systemctl restart "$APP"

echo "==> health check ($HEALTH_URL)"
for i in 1 2 3 4 5; do
  if sleep 2; systemctl is-active --quiet "$APP" && curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "OK"
    echo "==> deployed: $(git rev-parse --short HEAD)  active: $(systemctl is-active "$APP")"
    exit 0
  fi
  echo "    (attempt $i/5 not ready)"
done

echo "==> ERROR: service not healthy after restart"
rollback
exit 1