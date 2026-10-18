#!/usr/bin/env bash
# Ship code changes to the server: build, copy the code (never data/, sites/ or .env, which live
# on the server now), install packages and restart. Usage: npm run deploy
set -euo pipefail
HOST="${DEPLOY_HOST:-root@217.160.204.176}"
DIR=/opt/isla-autopilot

npm run build
rsync -az --delete --exclude node_modules --exclude '*.test.mjs' server dist brand package.json package-lock.json "$HOST:$DIR/"
ssh "$HOST" "cd $DIR && chown -R isla:isla $DIR \
  && sudo -u isla env PATH=/opt/node22/bin:/usr/bin:/bin HOME=$DIR npm ci --omit=dev --no-audit --no-fund --loglevel=error \
  && systemctl restart isla-autopilot && sleep 2 && systemctl is-active isla-autopilot"
echo "Deployed: https://marketing.polar-coffee.com/"
