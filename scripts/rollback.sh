#!/usr/bin/env bash
# Point `current` at the previous release (or one named by arg) and restart. Usage: bash scripts/rollback.sh [release-name]
# Same config as deploy.sh (DEPLOY_HOST, DEPLOY_USER, DEPLOY_DIR, DEPLOY_SERVICE, DEPLOY_PORT, scripts/deploy.config).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f scripts/deploy.config ] && . scripts/deploy.config
: "${DEPLOY_HOST:?Set DEPLOY_HOST}"; : "${DEPLOY_USER:?Set DEPLOY_USER}"
DIR="${DEPLOY_DIR:-/opt/isla-autopilot}"; SERVICE="${DEPLOY_SERVICE:-isla-autopilot}"
ssh -o StrictHostKeyChecking=yes -o BatchMode=yes -p "${DEPLOY_PORT:-22}" "$DEPLOY_USER@$DEPLOY_HOST" bash -s -- "$DIR" "$SERVICE" "${1:-}" <<'REMOTE'
set -euo pipefail
DIR=$1; SERVICE=$2; WANT=$3
LIVE=$(readlink "$DIR/current")
if [ -n "$WANT" ]; then TARGET="$DIR/releases/$WANT"
else TARGET=$(ls -1d "$DIR"/releases/* | sort -r | grep -v -x -F "$LIVE" | head -1 || true); fi
[ -n "$TARGET" ] && [ -d "$TARGET" ] || { echo "No release to roll back to"; exit 1; }
ln -sfn "$TARGET" "$DIR/current.new" && mv -T "$DIR/current.new" "$DIR/current"
sudo systemctl restart "$SERVICE"
sleep 2; sudo systemctl is-active "$SERVICE"
echo "Rolled back: $(basename "$LIVE") -> $(basename "$TARGET")"
REMOTE
