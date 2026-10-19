#!/usr/bin/env bash
# Restore or verify a backup snapshot made by backup.sh. Never writes to a remote host.
#   bash scripts/restore.sh --verify [SNAPSHOT]          restore to a temp dir, check studio.json parses, delete temp dir
#   bash scripts/restore.sh SNAPSHOT TARGET_DIR          restore into an EMPTY local TARGET_DIR (then copy to the server yourself, see deploy/README.md)
# SNAPSHOT: a snapshot directory, or an encrypted <stamp>.tar.age / .tar.gpg (decrypts with AGE_IDENTITY=<key file> or your gpg keyring).
# Default SNAPSHOT for --verify: newest in BACKUP_DIR (default ~/polar-backups).
set -euo pipefail
OUT="${BACKUP_DIR:-$HOME/polar-backups}"
MODE=restore
if [ "${1:-}" = --verify ]; then MODE=verify; shift; fi
SNAP="${1:-}"
if [ -z "$SNAP" ] && [ "$MODE" = verify ]; then
  SNAP=$(ls -1d "$OUT"/20*_[0-9][0-9][0-9][0-9][0-9][0-9] "$OUT"/20*_[0-9][0-9][0-9][0-9][0-9][0-9].tar.* 2>/dev/null | sort | tail -1 || true)
fi
[ -n "$SNAP" ] && [ -e "$SNAP" ] || { echo "Usage: restore.sh --verify [SNAPSHOT] | restore.sh SNAPSHOT TARGET_DIR"; exit 2; }
umask 077
if [ "$MODE" = verify ]; then DEST=$(mktemp -d); trap 'rm -rf "$DEST"' EXIT
else DEST="${2:?TARGET_DIR required}"; mkdir -p "$DEST"; [ -z "$(ls -A "$DEST")" ] || { echo "TARGET_DIR must be empty"; exit 2; }; fi

case "$SNAP" in
  *.tar.age) command -v age >/dev/null || { echo "age not installed"; exit 1; }; : "${AGE_IDENTITY:?Set AGE_IDENTITY to your age key file}"; age -d -i "$AGE_IDENTITY" "$SNAP" | tar -C "$DEST" -xf - ;;
  *.tar.gpg) command -v gpg >/dev/null || { echo "gpg not installed"; exit 1; }; gpg --batch -d "$SNAP" | tar -C "$DEST" -xf - ;;
  *) [ -d "$SNAP" ] || { echo "Not a directory: $SNAP"; exit 1; }; cp -a "$SNAP/." "$DEST/" ;;
esac
# Archives contain one top-level <stamp>/ directory.
ROOT="$DEST"; [ -d "$DEST/data" ] || ROOT=$(ls -1d "$DEST"/*/ | head -1)
[ -f "$ROOT/data/studio.json" ] || { echo "FAIL: data/studio.json missing"; exit 1; }
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log("studio.json OK, clients:", (d.clients||[]).length)' "$ROOT/data/studio.json" || { echo "FAIL: studio.json does not parse"; exit 1; }
[ -f "$ROOT/.env" ] && echo ".env present" || echo "WARN: .env not in snapshot"
if [ "$MODE" = verify ]; then echo "Verify OK: $SNAP"; else
  [ "$ROOT" = "$DEST" ] || { cp -a "$ROOT/." "$DEST/"; }
  echo "Restored to $DEST. Copy data/, sites/ and .env to the server by hand (stop the service first)."; fi
