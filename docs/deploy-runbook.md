# Deploy runbook (Polar Marketing / isla-autopilot)

Production has real users. This runbook is the operating procedure; `deploy/README.md` covers one-time server setup and `docs/incidents.md` logs what has gone wrong. No hosts, IPs or secrets belong in this file: use `<host>` placeholders and never print values from `.env` or `scripts/deploy.config`.

## Ship a change to production (from a fresh clone)
Placeholders only below; never paste real hosts, IPs or secrets into chat, docs or commits.

1. **Clone and install**
   ```
   git clone <repo-url> ~/Desktop/polar-marketing-ai && cd ~/Desktop/polar-marketing-ai
   npm install
   ```
2. **Create `scripts/deploy.config`** (gitignored; copy values from a secure place, not from chat):
   ```
   DEPLOY_HOST=<host>
   DEPLOY_USER=<deploy-user>
   PUBLIC_URL=https://<public-domain>
   # optional: DEPLOY_PORT=22  DEPLOY_DIR=/opt/isla-autopilot  DEPLOY_SERVICE=isla-autopilot
   #           DEPLOY_NODE_BIN=/opt/node22/bin  HEALTH_URL=http://127.0.0.1:8787/api/signup  KEEP_RELEASES=5
   ```
   Pin the host key (verify the fingerprint out of band), then confirm SSH works as the deploy user (key only):
   ```
   ssh-keyscan -t ed25519 <host> >> ~/.ssh/known_hosts
   ssh -o BatchMode=yes <deploy-user>@<host> 'echo ok'
   ```
3. **Local `.env`**: make sure it exists (copy from `.env.example` and fill from your secret store). Use `npm run push-env` only when provider keys changed; it restarts the service, so it needs the go-ahead (step 5) and the verification in step 7.
4. **Test**: `npm test && npm run typecheck` must both pass (`npm test` includes the inline-script syntax test).
5. **Get ATD's explicit go-ahead** for this deploy. No go-ahead, no deploy.
6. **Deploy**: `npm run deploy -- --dry-run`, review, then `npm run deploy`.
7. **Verify the live site** at `<PUBLIC_URL>`: landing page, `/login`, a client portal page (interactive, not blank), the health endpoint (`/api/signup` returns non-5xx), and on the server `systemctl is-active isla-autopilot` plus `journalctl -u isla-autopilot -n 50` (no repeating errors, no secrets pasted).
8. **Rollback if anything is off**: `bash scripts/rollback.sh [release]`. Roll back first, debug second, then repeat step 7.
9. **Record anything notable** (rollback, near miss, surprise) in `docs/incidents.md` using its template.

## Golden rules
1. Deploy only with ATD's explicit go-ahead, every time. A past approval does not carry over.
2. Run `npm test` first and get it green.
3. After every restart, check the live site. If anything is wrong, **roll back first, debug second**.
4. Never print, paste, log or commit secrets (`.env`, API keys, `scripts/deploy.config` values).

## Server layout
| Item | Detail |
|---|---|
| Deploy user `deploy` | SSH key only, member of group `isla`, sudo limited to `systemctl restart` / `is-active` for the service |
| Service user `isla` | Runs the service, owns `data/`, `sites/`, `.env` |
| App root | `/opt/isla-autopilot` |
| `releases/<timestamp>/` | One directory per deploy (code, `dist`, `brand`, prod `node_modules`). Each release symlinks `data`, `sites`, `.env` to the shared copies |
| `current` | Symlink to the live release; swapped atomically |
| `data/` | Persistent app data (`studio.json` etc.). Never touched by deploys |
| `sites/` | Generated client sites. Never touched by deploys |
| `.env` | Secrets, mode 0600, owner `isla`. Never touched by deploys |
| Service | systemd unit `isla-autopilot` (source: `deploy/isla-autopilot.service`), Node 22 under `/opt/node22/bin`, listens on 127.0.0.1:8787 behind nginx (TLS, rate limits; `deploy/nginx.conf.example`). Firewall: `deploy/ufw.md` |

## scripts/deploy.config (key names only)
Gitignored, sourced by deploy, rollback, backup and push-env. Keys currently set: `DEPLOY_HOST`, `DEPLOY_USER`, `PUBLIC_URL`.
Optional keys the scripts understand: `DEPLOY_PORT` (22), `DEPLOY_DIR` (`/opt/isla-autopilot`), `DEPLOY_SERVICE` (`isla-autopilot`), `DEPLOY_NODE_BIN` (`/opt/node22/bin`), `HEALTH_URL` (`http://127.0.0.1:8787/api/signup`, evaluated on the server), `KEEP_RELEASES` (5), `NPM_ALLOW_SCRIPTS` (set to 1 only if a new dependency needs an install script).
Backup keys: `BACKUP_DIR`, `BACKUP_KEEP`, `BACKUP_RECIPIENT`, `BACKUP_OFFSITE_DEST`, `BACKUP_OFFSITE_TOOL`, `BACKUP_KEEP_PLAIN`, `BACKUP_ON_FAILURE`. Restore key: `AGE_IDENTITY`.
SSH uses `StrictHostKeyChecking=yes`: the host key must already be in `known_hosts`.

## Pre-deploy checklist
- [ ] ATD has explicitly said go for this deploy.
- [ ] `git status` reviewed: you know exactly what is going out (the working tree is what ships, committed or not).
- [ ] `npm test` is green. It runs `node --test server/*.test.mjs`, which includes `server/html-syntax.test.mjs`: it parses every inline `<script>` in `server/*.html` and fails on a stray backtick or similar syntax error that would blank a page.
- [ ] `npm run deploy -- --dry-run` (also runs the build; shows the rsync, changes nothing remote).
- [ ] Recent backup exists (`npm run backup`), especially before data-affecting changes.
- [ ] Note the current release name (ls of `releases/`) so you can name the rollback target.

## What `npm run deploy` does (scripts/deploy.sh)
1. Loads `scripts/deploy.config`; refuses to run as root or without `DEPLOY_HOST`/`DEPLOY_USER`.
2. `npm run build` locally (`tsc --noEmit`, `vite build`, artifact step). A failure stops the deploy.
3. Creates `releases/<YYYYMMDDHHMMSS>` on the server.
4. `rsync -az --delete` of `server`, `dist`, `brand`, `package.json`, `package-lock.json`, excluding `node_modules`, `data`, `sites`, `.env*`, `*.bak`, `*.test.mjs`.
5. On the server: symlinks `data`, `sites`, `.env` into the release, then `npm ci --omit=dev --ignore-scripts`.
6. Records the previous release (`current` target), then swaps `current` atomically.
7. `sudo systemctl restart isla-autopilot`.
8. Health check: up to 20 tries, 1 s apart, `curl` of `HEALTH_URL`; passes when the HTTP code is below 500 **and** the service is active. Note this is a shallow check (any non-5xx), not proof the pages work.
9. If the restart or health check fails: automatically points `current` back to the previous release, restarts, and exits non-zero.
10. On success prunes old releases, keeping the newest 5 (never the live one).

## Post-deploy checklist (mandatory, even if the script said OK)
Check the live site at `<PUBLIC_URL>` immediately after the restart:
- [ ] Landing page loads and renders.
- [ ] `/login` loads.
- [ ] A client portal page loads and is interactive (not blank; the 2026-10-19 portal freeze passed every server-side check).
- [ ] API health responds (e.g. `/api/signup` returns a non-5xx response).
- [ ] `systemctl is-active isla-autopilot` is `active` and stays so for a minute (a crash loop can pass the first check; the unit allows 5 starts per 60 s).
- [ ] Logs show no repeating errors (`journalctl -u isla-autopilot -n 50`, read without pasting secrets).

**If any check fails: roll back now (below), then investigate.** Do not debug on the live site while users are affected.

## Manual rollback (scripts/rollback.sh)
```
bash scripts/rollback.sh              # previous release (newest other than live)
bash scripts/rollback.sh <release>    # a named release, e.g. 20261019120000
```
It swaps `current`, restarts the service, waits 2 s and prints `is-active`. Then repeat the post-deploy checklist. Rollback only changes code: `data/`, `sites/` and `.env` are shared and unchanged. If the cause is the systemd unit or `.env` rather than code, rolling back the release will not help; revert that server-side change (keep a copy of the previous unit file before editing, and `systemctl daemon-reload` after).
Note: "previous release" is by name order; if a bad release is not the live one, name the target explicitly. Only the last 5 releases exist.

## Backups and restore
- `npm run backup` (scripts/backup.sh) pulls `data/`, `sites/`, `.env` into `BACKUP_DIR` (default `~/polar-backups`) via rsync with hard-links, validates that `studio.json` is non-empty and parses, optionally encrypts with age/gpg (`BACKUP_RECIPIENT`), optionally copies the encrypted archive off-site, and keeps the newest `BACKUP_KEEP` (14). Off-site without encryption is refused. `.env` is in the snapshot, so keep snapshots encrypted and private.
- `bash scripts/restore.sh --verify [snapshot]` restores the newest (or given) snapshot to a temp dir, checks `studio.json` parses, reports whether `.env` is present, and deletes the temp dir. Run monthly, and after any change to backup config. Encrypted archives need `AGE_IDENTITY` (age) or your gpg keyring.
- Real restore: `bash scripts/restore.sh <snapshot> <empty-dir>` (local only, never writes to the server). Then stop the service, copy `data/`, `sites/`, `.env` into `/opt/isla-autopilot`, fix owner `isla` and `.env` mode 0600, start the service, run the post-deploy checklist. Do this only with ATD's go-ahead: it overwrites live data.

## push-env (scripts/push-env.sh)
`npm run push-env` merges a fixed allow-list of provider/email key names (AI provider keys and model lists, Pexels, Pollinations, Resend, booking sender) from the local `.env` into the server `.env`.
- Prints only key **names** being sent; never echo values.
- Keeps a timestamped `.env.bak.*` on the server (newest 5), replaces only the matching keys, aborts if any previously present key would be lost, enforces mode 600 and unchanged owner, then restarts the service.
- It restarts the service, so it needs ATD's go-ahead and the full post-deploy checklist, like a deploy.
- Other keys (for example `HOST`, `PUBLIC_URL`, secrets outside the list) must be edited on the server by hand.

## Quick reference
| Task | Command |
|---|---|
| Tests | `npm test` |
| Dry run | `npm run deploy -- --dry-run` |
| Deploy | `npm run deploy` (after ATD go-ahead) |
| Rollback | `bash scripts/rollback.sh [release]` |
| Backup / verify | `npm run backup` / `bash scripts/restore.sh --verify` |
| Env keys | `npm run push-env` |
