#!/usr/bin/env bash
# Pull an offsite copy of everything that lives only on the server: data/, sites/ and .env.
# Usage: npm run backup   (add to cron/launchd on your Mac for nightly runs)
# Keeps the last 14 dated snapshots in $BACKUP_DIR (default ~/polar-backups); unchanged files are hard-linked, so it is cheap.
set -euo pipefail
HOST="${DEPLOY_HOST:-root@217.160.204.176}"
DIR=/opt/isla-autopilot
OUT="${BACKUP_DIR:-$HOME/polar-backups}"
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$OUT"
PREV=$(ls -1d "$OUT"/20* 2>/dev/null | tail -1 || true)
LINK=(); [ -n "$PREV" ] && LINK=(--link-dest="$PREV")
umask 077
rsync -az "${LINK[@]}" "$HOST:$DIR/data" "$HOST:$DIR/sites" "$HOST:$DIR/.env" "$OUT/$STAMP.partial/"
mv "$OUT/$STAMP.partial" "$OUT/$STAMP"
ls -1d "$OUT"/20* | head -n -14 | xargs -r rm -rf
echo "Backup saved: $OUT/$STAMP ($(du -sh "$OUT/$STAMP" | cut -f1))"
