#!/usr/bin/env bash
# KB alert notifier: invoked by systemd OnFailure= via kb-alert@<failed-unit>.service.
# Sends only fixed unit metadata through the hermes WeChat channel, falling back to
# the user's existing Feishu push script (same dual-channel pattern as hermes-cron).
# Never forward journal text: failed services may log credentials or private data.
# Runs as ubuntu (User=ubuntu in kb-alert@.service); paths are absolute on purpose.
# Server path: /usr/local/sbin/kb-notify
set -uo pipefail

UNIT="${1:-}"
case "$UNIT" in
  caddy.service|personal-knowledge-web-backup.service|personal-knowledge-web-smoke.service|\
  personal-knowledge-web-restore-drill.service|personal-knowledge-web-claims.service|\
  personal-knowledge-web-curate.service) ;;
  *) echo 'kb-notify: unexpected unit' >&2; exit 2 ;;
esac
HERMES_PY="/home/ubuntu/.hermes/hermes-agent/venv/bin/python"
FEISHU_PY="/home/ubuntu/.hermes/hermes-agent/venv/bin/python"
FEISHU_PUSH="/home/ubuntu/hermes-cron/feishu_push.py"

STATUS="$(timeout --kill-after=1s 3s systemctl show "$UNIT" -p ActiveState --value 2>/dev/null || true)"
case "$STATUS" in
  active|inactive|failed|activating|deactivating|reloading) ;;
  *) STATUS=unknown ;;
esac
MSG="[KB ALERT] unit=$UNIT status=$STATUS at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
Inspect on server: sudo systemctl status $UNIT; sudo journalctl -u $UNIT -n 50 --no-pager"

# primary: hermes WeChat — single attempt only (retry bursts re-arm the channel cooldown)
if printf '%s' "$MSG" | timeout --kill-after=5s 20s "$HERMES_PY" -m hermes_cli.main send --to weixin --quiet >/dev/null 2>&1; then
  echo "kb-notify: sent via weixin for $UNIT"
  exit 0
fi

# fallback: Feishu group push
if printf '%s' "$MSG" | timeout --kill-after=5s 20s "$FEISHU_PY" "$FEISHU_PUSH" "kb-alert" >/dev/null 2>&1; then
  echo "kb-notify: sent via feishu for $UNIT"
  exit 0
fi

# last resort: leave a loud trace in the system journal
echo "kb-notify: ALL channels failed for $UNIT" | systemd-cat -p err -t kb-notify
exit 1
