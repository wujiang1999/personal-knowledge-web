#!/usr/bin/env bash
# KB alert notifier: invoked by systemd OnFailure= via kb-alert@<failed-unit>.service.
# Sends a concise failure notice through the hermes WeChat channel, falling back to
# the user's existing Feishu push script (same dual-channel pattern as hermes-cron).
# Runs as ubuntu (User=ubuntu in kb-alert@.service); paths are absolute on purpose.
# Server path: /usr/local/sbin/kb-notify
set -uo pipefail

UNIT="${1:-unknown-unit}"
HERMES_PY="/home/ubuntu/.hermes/hermes-agent/venv/bin/python"
FEISHU_PY="/home/ubuntu/.hermes/hermes-agent/venv/bin/python"
FEISHU_PUSH="/home/ubuntu/hermes-cron/feishu_push.py"

RECENT="$(journalctl -u "$UNIT" -n 12 --no-pager -o cat 2>/dev/null | tail -12 || true)"
MSG="[KB ALERT] unit failed on $(hostname): $UNIT at $(date '+%F %T')
--- last journal lines ---
$RECENT"

# primary: hermes WeChat — single attempt only (retry bursts re-arm the channel cooldown)
if printf '%s' "$MSG" | "$HERMES_PY" -m hermes_cli.main send --to weixin --quiet >/dev/null 2>&1; then
  echo "kb-notify: sent via weixin for $UNIT"
  exit 0
fi

# fallback: Feishu group push
if printf '%s' "$MSG" | "$FEISHU_PY" "$FEISHU_PUSH" "kb-alert" >/dev/null 2>&1; then
  echo "kb-notify: sent via feishu for $UNIT"
  exit 0
fi

# last resort: leave a loud trace in the system journal
echo "kb-notify: ALL channels failed for $UNIT" | systemd-cat -p err -t kb-notify
exit 1
