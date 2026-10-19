#!/usr/bin/env bash
# Pull a snapshot of everything that lives only on the server: data/, sites/ and .env. Usage: npm run backup
# Config (env or scripts/deploy.config): DEPLOY_HOST, DEPLOY_USER (a read-only backup user is best), DEPLOY_DIR, DEPLOY_PORT
#   BACKUP_DIR        default ~/polar-backups
#   BACKUP_KEEP       snapshots to keep (default 14)
#   BACKUP_RECIPIENT  age recipient (age1...) or gpg recipient; when set, each snapshot is also packed into an encrypted
#                     archive <stamp>.tar.<age|gpg> and the plaintext snapshot is removed (BACKUP_KEEP_PLAIN=1 keeps it)
#   BACKUP_OFFSITE_DEST  rsync destination (user@host:path) or rclone remote (remote:path, needs BACKUP_OFFSITE_TOOL=rclone)
#                     receiving the encrypted archive (plaintext is never sent off-site: requires BACKUP_RECIPIENT)
#   BACKUP_ON_FAILURE command run with the error message as $1 when the backup fails (e.g. a mail/ntfy script)
# studio.json is fetched on its own first via a temp name and renamed, so a half-written copy is never kept; the app must
# write it atomically (write temp + rename) for this to be fully consistent.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f scripts/deploy.config ] && . scripts/deploy.config
: "${DEPLOY_HOST:?Set DEPLOY_HOST}"; : "${DEPLOY_USER:?Set DEPLOY_USER}"
DIR="${DEPLOY_DIR:-/opt/isla-autopilot}"
OUT="${BACKUP_DIR:-$HOME/polar-backups}"
KEEP="${BACKUP_KEEP:-14}"
STAMP=$(date +%Y-%m-%d_%H%M%S)
SSHCMD="ssh -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=20 -p ${DEPLOY_PORT:-22}"
REMOTE="$DEPLOY_USER@$DEPLOY_HOST"

fail() {
  echo "BACKUP FAILED: $1" >&2
  rm -rf "$OUT/$STAMP.partial" 2>/dev/null || true
  [ -n "${BACKUP_ON_FAILURE:-}" ] && "$BACKUP_ON_FAILURE" "$1" || true
  exit 1
}
trap 'fail "line $LINENO exited with status $?"' ERR

umask 077
mkdir -p "$OUT"
# Latest COMPLETE snapshot only: directories named like a date stamp, never *.partial
PREV=$(ls -1d "$OUT"/20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9] 2>/dev/null | tail -1 || true)
LINK=(); [ -n "$PREV" ] && LINK=(--link-dest="$PREV")
P="$OUT/$STAMP.partial"; mkdir -p "$P"
rsync -a --timeout=300 -e "$SSHCMD" ${LINK[@]+"${LINK[@]}"} "$REMOTE:$DIR/data" "$REMOTE:$DIR/sites" "$REMOTE:$DIR/.env" "$P/"
# Re-fetch studio.json last into a temp name then rename, to narrow the torn-write window.
if [ -f "$P/data/studio.json" ] || true; then
  rsync -a --timeout=60 -e "$SSHCMD" "$REMOTE:$DIR/data/studio.json" "$P/data/.studio.json.tmp" 2>/dev/null && mv -f "$P/data/.studio.json.tmp" "$P/data/studio.json" || true
fi
[ -s "$P/data/studio.json" ] || fail "studio.json missing or empty in snapshot"
if command -v node >/dev/null; then node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$P/data/studio.json" || fail "studio.json does not parse"; fi
mv "$P" "$OUT/$STAMP"

FINAL="$OUT/$STAMP"
if [ -n "${BACKUP_RECIPIENT:-}" ]; then
  ARCH=""
  if command -v age >/dev/null; then ARCH="$OUT/$STAMP.tar.age"; tar -C "$OUT" -cf - "$STAMP" | age -r "$BACKUP_RECIPIENT" -o "$ARCH"
  elif command -v gpg >/dev/null; then ARCH="$OUT/$STAMP.tar.gpg"; tar -C "$OUT" -cf - "$STAMP" | gpg --batch --yes -e -r "$BACKUP_RECIPIENT" -o "$ARCH"
  else fail "BACKUP_RECIPIENT set but neither age nor gpg is installed"; fi
  [ -s "$ARCH" ] || fail "encrypted archive is empty"
  FINAL="$ARCH"
  if [ -n "${BACKUP_OFFSITE_DEST:-}" ]; then
    if [ "${BACKUP_OFFSITE_TOOL:-rsync}" = rclone ]; then rclone copy "$ARCH" "$BACKUP_OFFSITE_DEST" || fail "rclone off-site copy failed"
    else rsync -a --timeout=300 "$ARCH" "$BACKUP_OFFSITE_DEST/" || fail "rsync off-site copy failed"; fi
  fi
  [ "${BACKUP_KEEP_PLAIN:-0}" = 1 ] || rm -rf "$OUT/$STAMP"
elif [ -n "${BACKUP_OFFSITE_DEST:-}" ]; then
  fail "BACKUP_OFFSITE_DEST needs BACKUP_RECIPIENT (refusing to send plaintext off-site)"
fi

# Retention: keep the newest $KEEP complete snapshots and encrypted archives (never touches *.partial of a running job)
for pat in '20*_[0-9][0-9][0-9][0-9][0-9][0-9]' '20*_[0-9][0-9][0-9][0-9][0-9][0-9].tar.*'; do
  ls -1d "$OUT"/$pat 2>/dev/null | sort -r | tail -n +"$((KEEP+1))" | while read -r old; do rm -rf -- "$old"; done
done
echo "Backup saved: $FINAL ($(du -sh "$FINAL" | cut -f1))"
