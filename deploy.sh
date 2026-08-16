#!/bin/bash
# One-command deploy for this app on the ECS instance.
#   bash deploy.sh            (run on the ECS instance)
#   workbench exec -i i-j6c698asus1j5de5d66d -c 'bash /root/personal-knowledge-web/deploy.sh'
set -euo pipefail
cd "$(dirname "$0")"

echo "==> git pull"
git pull --ff-only

echo "==> build"
npm run build

echo "==> restart service"
systemctl restart personal-knowledge-web
sleep 3
systemctl --no-pager status personal-knowledge-web | head -6

echo "==> active: $(systemctl is-active personal-knowledge-web)"
