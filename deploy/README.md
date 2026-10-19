# Deploy and operations

Nothing here is applied automatically. Review, then install on the server by hand.

## One-time server setup
1. Users: `isla` (runs the service, owns `data/`, `sites/`, `.env`), `deploy` (member of `isla`, SSH key only), optional read-only `backup` user.
2. Layout under `/opt/isla-autopilot`: `releases/`, `current` (symlink), `.env` (0600, owner isla), `data/`, `sites/` (owner isla). Move the existing app files into `releases/<ts>` and point `current` at it.
3. sudoers for `deploy` (`visudo -f /etc/sudoers.d/deploy`):
   `deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart isla-autopilot, /usr/bin/systemctl is-active isla-autopilot, /usr/bin/systemctl is-active --quiet isla-autopilot`
   `.env` is replaced by push-env as the deploy user, so make `deploy` able to write it (group isla, dir mode 2770) while keeping the file 0600.
4. `deploy/isla-autopilot.service` -> `/etc/systemd/system/`, then `systemctl daemon-reload && systemctl enable --now isla-autopilot`.
5. `deploy/nginx.conf.example` -> nginx (TLS via certbot, HSTS, nosniff, X-Frame-Options, `X-Real-IP` overwritten, size limits, rate limits). `deploy/ufw.md` for the firewall.
6. Add `HOST=127.0.0.1` and `PUBLIC_URL=https://...` to the server `.env`.
7. Pin the host key locally: `ssh-keyscan -t ed25519 <host> >> ~/.ssh/known_hosts` (verify the fingerprint out of band). Scripts use `StrictHostKeyChecking=yes`.

## Local config
Create `scripts/deploy.config` (gitignored):
```
DEPLOY_HOST=marketing.example.com
DEPLOY_USER=deploy
# DEPLOY_PORT=22  DEPLOY_DIR=/opt/isla-autopilot  HEALTH_URL=http://127.0.0.1:8787/api/signup
```

## Commands
- `npm run deploy -- --dry-run` shows what rsync would send, changes nothing.
- `npm run deploy` builds, uploads to `releases/<ts>`, runs `npm ci --omit=dev --ignore-scripts` (@napi-rs/canvas ships prebuilt binaries with no install script; set `NPM_ALLOW_SCRIPTS=1` only if a new dependency needs one), swaps `current`, restarts, health-checks with retries and rolls back automatically. Keeps the last 5 releases.
- `bash scripts/rollback.sh [release]` switches to the previous (or named) release.
- `npm run push-env` merges provider keys into the server `.env` (backup copy kept, aborts if any key would be lost).
- `npm run backup` (see header of `scripts/backup.sh` for `BACKUP_RECIPIENT`, `BACKUP_OFFSITE_DEST`, `BACKUP_KEEP`, `BACKUP_ON_FAILURE`). Install `age` and use encryption; `.env` is inside the snapshot.
- `bash scripts/restore.sh --verify` restores the newest snapshot to a temp dir and checks `studio.json` parses. Do this monthly.

## Restore procedure
`bash scripts/restore.sh <snapshot> /path/to/empty-dir`, stop the service, copy `data/`, `sites/`, `.env` into `/opt/isla-autopilot` (fix owner `isla`, `.env` 0600), start the service.
