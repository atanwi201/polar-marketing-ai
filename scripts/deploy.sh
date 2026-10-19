#!/usr/bin/env bash
# Ship code to the server as a new release: build, rsync into releases/<timestamp>, install prod deps,
# health-check the new release, swap the `current` symlink, restart; roll back automatically on failure.
# Never touches data/, sites/ or .env (they live in shared/ on the server, or beside releases/).
#
# Config (env or gitignored scripts/deploy.config, see below):
#   DEPLOY_HOST (required)  server name or IP          DEPLOY_USER (required) non-root deploy user
#   DEPLOY_DIR  (default /opt/isla-autopilot)          DEPLOY_PORT (default 22)
#   DEPLOY_NODE_BIN (default /opt/node22/bin)          DEPLOY_SERVICE (default isla-autopilot)
#   HEALTH_URL (default http://127.0.0.1:${PORT:-8787}/api/signup; any HTTP response < 500 counts as healthy)
#   KEEP_RELEASES (default 5)
# Usage: npm run deploy [-- --dry-run]
#
# Server layout: $DIR/releases/<ts>/ (code), $DIR/current -> releases/<ts>, $DIR/.env, $DIR/data, $DIR/sites
# (each release symlinks .env, data and sites to the shared copies in $DIR). The deploy user needs sudo for
# exactly: systemctl restart/is-active <service>  (see deploy/README.md).
# Dependencies: `npm ci --omit=dev --ignore-scripts`. @napi-rs/canvas ships prebuilt binaries as optional
# platform packages and has no install script, so --ignore-scripts is safe. If a future dependency needs a
# postinstall step, set NPM_ALLOW_SCRIPTS=1 for that deploy.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f scripts/deploy.config ] && . scripts/deploy.config

DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; *) echo "Unknown option: $a"; exit 2 ;; esac; done

: "${DEPLOY_HOST:?Set DEPLOY_HOST (env or scripts/deploy.config)}"
: "${DEPLOY_USER:?Set DEPLOY_USER (a non-root deploy user)}"
[ "$DEPLOY_USER" != root ] || { echo "Refusing to deploy as root; use a deploy user."; exit 2; }
DIR="${DEPLOY_DIR:-/opt/isla-autopilot}"
SERVICE="${DEPLOY_SERVICE:-isla-autopilot}"
NODE_BIN="${DEPLOY_NODE_BIN:-/opt/node22/bin}"
KEEP="${KEEP_RELEASES:-5}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8787/api/signup}"
TS=$(date +%Y%m%d%H%M%S)
REL="$DIR/releases/$TS"
SSH_OPTS=(-o StrictHostKeyChecking=yes -o BatchMode=yes -p "${DEPLOY_PORT:-22}")
SSH=(ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST")
INSTALL_FLAGS="--omit=dev --no-audit --no-fund --loglevel=error"
[ "${NPM_ALLOW_SCRIPTS:-0}" = 1 ] || INSTALL_FLAGS="$INSTALL_FLAGS --ignore-scripts"

npm run build
RSYNC=(rsync -az --delete -e "ssh ${SSH_OPTS[*]}"
  --exclude node_modules --exclude data --exclude sites --exclude .env --exclude '.env.*' --exclude '*.bak' --exclude '*.test.mjs')
[ "$DRY" = 1 ] && RSYNC+=(--dry-run --itemize-changes)

if [ "$DRY" = 1 ]; then
  echo "[dry-run] would create $DEPLOY_USER@$DEPLOY_HOST:$REL and rsync:"
  "${RSYNC[@]}" server dist brand package.json package-lock.json "$DEPLOY_USER@$DEPLOY_HOST:$REL/"
  echo "[dry-run] no remote changes made."
  exit 0
fi

"${SSH[@]}" "mkdir -p '$REL'"
"${RSYNC[@]}" server dist brand package.json package-lock.json "$DEPLOY_USER@$DEPLOY_HOST:$REL/"

# Remote step: install, link shared state, remember previous release, swap, restart, health check, rollback on failure.
"${SSH[@]}" bash -s -- "$DIR" "$REL" "$SERVICE" "$NODE_BIN" "$KEEP" "$HEALTH_URL" "$INSTALL_FLAGS" <<'REMOTE'
set -euo pipefail
DIR=$1; REL=$2; SERVICE=$3; NODE_BIN=$4; KEEP=$5; URL=$6; FLAGS=$7
cd "$REL"
ln -sfn "$DIR/data" data; ln -sfn "$DIR/sites" sites; ln -sfn "$DIR/.env" .env
PATH="$NODE_BIN:/usr/bin:/bin" HOME="$DIR" npm ci $FLAGS
PREV=$(readlink "$DIR/current" || true)
ln -sfn "$REL" "$DIR/current.new" && mv -T "$DIR/current.new" "$DIR/current"
rollback() {
  echo "Health check failed; rolling back to ${PREV:-<none>}" >&2
  if [ -n "$PREV" ]; then ln -sfn "$PREV" "$DIR/current.new" && mv -T "$DIR/current.new" "$DIR/current"; sudo systemctl restart "$SERVICE" || true; fi
  exit 1
}
sudo systemctl restart "$SERVICE" || rollback
ok=0
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$URL" || echo 000)
  if [ "$code" != 000 ] && [ "$code" -lt 500 ] && sudo systemctl is-active --quiet "$SERVICE"; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || rollback
# Keep the newest $KEEP releases (never the live one).
LIVE=$(readlink "$DIR/current")
ls -1d "$DIR"/releases/* | sort -r | tail -n +"$((KEEP+1))" | while read -r old; do [ "$old" = "$LIVE" ] || rm -rf -- "$old"; done
echo "Release $(basename "$REL") live."
REMOTE
echo "Deployed release $TS to $DEPLOY_HOST. Site: ${PUBLIC_URL:-see your PUBLIC_URL}"
