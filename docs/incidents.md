# Incident log

Blameless: we record what happened and how the system let it happen, not who did it. Newest first. No hosts, IPs or secrets in entries.

## 2026-10-20 (near miss: backups stopped working)

- **Impact:** No new snapshot since 2026-10-19 03:00. The 2026-10-20 03:00 run failed, so there was no fresh restore point for about a day and a half. No data was lost and nothing was overwritten; the last good snapshot is still on the operator's machine.
- **Detection:** `npm run backup` failed with `rsync: [sender] opendir "/opt/isla-autopilot/data" failed: Permission denied (13)`, and the same error was appended to `backup.log`. It was only noticed when a deploy was about to run.
- **Cause:** The deploy user can no longer read `data/`. The app tightens `DATA_DIR` to mode 0700 at boot when it owns the folder (`store.mjs`), and the deploy user is only in group `isla`, so 0700 gives it no access. The backup script runs `rsync` as the deploy user.
- **Fix (2026-10-20):** read-only ACL, no new user, no sudoers rule, no restart. `acl` package installed; `setfacl -R -m g:isla:rX` and `-d` (default, so new files inherit) on `data/` and `sites/`, `g:isla:r` on `.env`. Owners and the 0700 modes are unchanged and nothing is writable. A new snapshot (`2026-10-20_180530`) was taken and `studio.json` parses; the live site still answered 200 on `/` and `/login`.
- **Prevention:** A failed backup has to be noticed, not just logged. Put an age check on the newest snapshot in the weekly routine and alert when it is older than a day.
- **Related, same cause (fixed 2026-10-20):** the deploy user could not read the journal. It is now in group `systemd-journal` (read-only), so `journalctl -u isla-autopilot` works from the deploy account.
- **The ACL did not survive a restart (fixed 2026-10-20):** the deploy of release `20261020182038` restarted the service, and the boot-time `chmod 0700` in `store.mjs` reset the ACL mask (`mask::---`), which silently turned `group:isla:r-x` into an entry that grants nothing. Every restart undid the ACL, so the backup worked only until the next deploy. `store.mjs` now tightens the mode as before and then puts the mask back, and it also revives a dead access mask from the folder's own default ACL, so the app heals the damage instead of needing the operator to run `setfacl` again. Covered by `server/store.durability.test.mjs` (skipped where the `acl` tools are missing).
- **The folder healed, the files did not (fixed 2026-10-28):** after release `20261028095006`, `data/` was readable again but `rsync` still failed: the backup user could enter the folder and read none of the files in it. A file created with mode 0600 inherits the folder's default ACL with its mask off (`group:isla:r-x #effective:---`), so every `studio.json` the app wrote after the ACL was set was unreadable, and `rsync` exits at the first file it cannot read. `store.mjs` now creates `studio.json`/`studio.json.bak` as 0640 when the folder's default ACL grants a named group read, and at boot it gives the same treatment to the files already there (mode and mask, owners and the 0700 folder unchanged). Verified against a real Linux ACL before shipping.
- **Resolution (2026-10-28):** shipped in release `20261028114512`; right after the restart `find data/ ! -readable` as the deploy user counted 0 files, and `npm run backup` produced `2026-10-28_114536` (139 files, `studio.json` parses, `.env` and `sites/` present). The real client portal page and `/api/portal/<token>` were then checked on the server for the first time (200, loyalty section present; a bogus token is 404). No errors in the journal since the restart.
- **Detection gap, again:** both halves were found only because a deploy was being prepared, not by the nightly job. The age check in the weekly routine is still the only guard.
- **Doubts / TO CONFIRM:** when the 0700 tightening started, and whether an older snapshot exists anywhere else.

## 2026-10-19 (two incidents)

### A. Crash loop after restart caused by systemd SystemCallFilter
- **Impact:** After the 2026-10-19 20:10 UTC deploy (release `20261019211132`, the first with the deploy user and releases layout), node was killed on some requests and systemd restarted it about every 3 seconds, causing intermittent 502s. The site was stable from 20:15:41 UTC.
- **Detection:** intermittent 502s; `journalctl -u isla-autopilot` showed `status=31/SYS`.
- **Cause:** the audit-added `deploy/isla-autopilot.service` contained two `SystemCallFilter=` lines. They blocked a syscall Node needs, so the kernel killed it with SIGSYS (`status=31/SYS`) on some requests. The file was untracked, so git has no history of the lines.
- **Fix:** removed both lines in `/etc/systemd/system/isla-autopilot.service` on the server and in the repo file, then `systemctl daemon-reload` and restart.
- **Rule:** **never add `SystemCallFilter=` to the unit.** Rely on the other hardening: `NoNewPrivileges`, `ProtectSystem=strict` with explicit `ReadWritePaths`, `PrivateTmp`, `RestrictAddressFamilies`, `RestrictNamespaces`, empty `CapabilityBoundingSet`, `MemoryMax`, `TasksMax`. Keep `MemoryDenyWriteExecute=no` (Node's JIT needs W+X pages). Any unit change goes to a copy first and is checked with `systemd-analyze security`, then watched in the journal after restart.
- **Prevention:**
  - Change the unit only in the repo (`deploy/isla-autopilot.service`), commit it, and install the same file; never hand-edit the server unit without copying it back.
  - Before restarting with a new unit: keep a copy of the previous unit, `systemd-analyze verify`, apply, restart, and watch `systemctl status` and the journal for a minute.
  - Roll back first (restore the previous unit file, `daemon-reload`, restart) and debug second. Note: `scripts/rollback.sh` only swaps code, not the unit.
  - Follow the post-deploy checklist in `docs/deploy-runbook.md`.

### B. Missing backtick in portal inline script froze the client portal
- **Impact:** The client portal (`server/portal.html`) stopped working for users: the page's inline script failed to parse, so the portal froze/blanked. The server and API stayed up, so the basic health check (any non-5xx) did not catch it. Duration and affected users: TO CONFIRM.
- **Detection:** Noticed on the live portal after deploy (manual check / user-visible freeze). Exact detector: TO CONFIRM.
- **Cause:** A missing closing backtick in a template literal inside an inline `<script>` in `server/portal.html`. One syntax error invalidates the whole script block, so nothing in it runs. No automated check parsed inline scripts, and the deploy health check only tests the server responds.
- **Fix:** Restored the missing backtick and redeployed (or rolled back to the previous release meanwhile). Release names: TO CONFIRM.
- **Prevention:**
  - `server/html-syntax.test.mjs` now extracts every inline `<script>` (excluding `src=` and JSON/JSON-LD blocks) from every `server/*.html` and runs `node --check` on it; one test per HTML file.
  - `npm test` includes it. Run `npm test` before every deploy; do not deploy on red.
  - Post-deploy: open a real portal page and confirm it is interactive, not just that the server answers.
  - Rolling back is the first response to a broken page.

---

## Template for future entries

```
## YYYY-MM-DD <short title>

- **Impact:** who/what was affected, for how long, data loss yes/no.
- **Detection:** how and when it was noticed (alert, user report, checklist), and time to detect.
- **Timeline:** key times (detected, rolled back, resolved), without names.
- **Cause:** the technical root cause and why existing checks missed it.
- **Fix:** what restored service, and the permanent fix (commit/release name).
- **Prevention:** tests, checks, process or docs changed; owner and status of each follow-up.
- **Doubts / TO CONFIRM:** anything not verified.
```
