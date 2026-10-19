# Polar Marketing: agent guide

Read this first. It is the entry point for any coding agent (Claude Code, Codex, Cursor, ...). `AGENTS.md` points here. Deep dives live in `docs/`.

## What this is

Polar Marketing is a back office and client portal for a one-person AI marketing studio in Tenerife. Local businesses sign up, get an AI-built website, AI-written posts and vertical video ads, a loyalty card (Apple/Google Wallet), bookings, a digital menu and an expense tracker. The studio owner (ATD) runs everything from an admin dashboard; each business uses its own portal. **It is live in production with real users.**

## Architecture in 30 seconds

- **Server:** plain Node (>=20) ES modules, no framework, entry `server/index.mjs` (one `http` server, routes dispatched to `server/*-routes.mjs`). Few dependencies on purpose.
- **Owner dashboard:** React 18 + TypeScript + Vite in `src/`, built to one HTML file (`dist/`), served at `/admin/`.
- **Public and client pages:** vanilla HTML with inline scripts (`server/home.html`, `landing.html`, `signup.html`, `portal.html`) or rendered by `*-pages.mjs` (loyalty, menu, bookings, legal).
- **Data:** a single JSON file `data/studio.json` (`server/store.mjs`), media in `data/media/`. Generated client sites in `sites/<slug>/`. All three are git-ignored and live on the server, never in the repo.
- **AI:** a provider chain with free-first fallback (`server/openrouter.mjs`, `images.mjs`, `aisite.mjs`). Details: `docs/ai-providers.md`.
- **Access classes:** public, tenant (portal token or client code), admin (cookie or `ADMIN_TOKEN`). Details: `docs/routes-and-auth.md`.

## Run and test

```
cp .env.example .env     # fill keys; never commit it
npm install
npm run dev              # Vite on :5173 + API on :8787 (landing /, login /login, dashboard /admin/)
npm run typecheck        # tsc --noEmit
npm test                 # node --test, serial; fake AI providers; includes the inline-script syntax test
npm run build            # tsc + vite build
```

Video needs `ffmpeg`. Tests must pass before any deploy and before any commit that touches `server/` or `src/`.

## File map

| Path | What |
| --- | --- |
| `server/index.mjs` | HTTP entry, routing, security headers, static serving |
| `server/auth.mjs` | admin password (scrypt), sessions, client codes, per-IP limits |
| `server/store.mjs` | load/save `studio.json` (atomic writes), ids, tokens |
| `server/studio.mjs`, `assistant.mjs` | posts, autopilot scheduler, the portal AI assistant |
| `server/sitebuilder.mjs`, `aisite.mjs`, `webpage.mjs`, `siteedit.mjs`, `sitezip.mjs`, `ownsite.mjs` | client website build, sanitize, edit, zip, "own website" mode |
| `server/loyalty*.mjs`, `wallet.mjs`, `gwallet.mjs`, `pass.mjs` | loyalty cards and wallet passes |
| `server/bookings*.mjs`, `booking-mail.mjs` | bookings and confirmation email |
| `server/menu*.mjs`, `expenses*.mjs` | digital menu, expense tracker |
| `server/legal.mjs`, `retention.mjs`, `declined.mjs` | privacy/legal pages, retention, approval gate |
| `server/*.test.mjs`, `test-harness.mjs` | tests and shared harness |
| `src/core/` | dashboard kit: UI, store, AI client, plans, types |
| `src/screens/`, `src/modules/` | dashboard screens; older one-service modules (hidden by default) |
| `brand/` | tokens.css, components.css, theme.js, logos, DESIGN.md (reference) |
| `scripts/` | dev, deploy, rollback, backup, restore, push-env |
| `deploy/` | systemd unit, nginx example, firewall notes |
| `docs/` | everything below |

Full map: `docs/architecture.md`.

## Docs index

- `docs/architecture.md`, `docs/data-model.md`
- `docs/routes-and-auth.md`, `docs/ai-providers.md`
- `docs/design-system.md` (single source of truth for UI; wins over `brand/DESIGN.md`)
- `docs/conventions.md` (naming, errors, i18n ES/EN, testing; written as decisions)
- `docs/deploy-runbook.md`, `docs/incidents.md`
- `docs/privacy/` (RGPD/LSSI compliance material)

## Hard rules

1. **Production has live users. Never deploy** (`npm run deploy`, `scripts/deploy.sh`, ssh restarts, `push-env`) without ATD's explicit go-ahead in this conversation. Docs-only pushes need no deploy.
2. **Run `npm test` before any deploy** and before pushing code. It includes `server/html-syntax.test.mjs`, which parses every inline `<script>` (a missing backtick in `portal.html` once froze the portal for everyone).
3. **After every restart, check the live site** (landing, `/login`, a portal page, the health endpoint). If anything is off, **roll back first** (`bash scripts/rollback.sh`), debug second. See `docs/deploy-runbook.md`.
4. **Never print, log, commit or paste secrets**: `.env`, `scripts/deploy.config`, tokens, keys, client codes, cookies, server IPs. When inspecting env files, show key names only.
5. **`sites/`, `data/`, `.env`, `.claude/`, `backups/`, `releases/` stay untracked.** Never `git add -f` them. Customer content must not enter git.
6. Do not weaken security: keep tenant isolation, rate limits, CSP and the sanitizer in `webpage.mjs`. Every new route needs an access class and a test (`docs/routes-and-auth.md`).
7. Do not hand-edit `data/studio.json` on a running server. Use the app, or stop the service and take a backup first.
8. Never add `SystemCallFilter=` to `deploy/isla-autopilot.service` (it caused a SIGSYS crash loop on 2026-10-19).
9. Prefer small reversible changes. Match surrounding style. Don't add dependencies or CDN scripts to Polar's own pages without asking.
10. When unsure whether something is safe, stop and ask ATD. Replies to ATD: short, they are a JS veteran.

## Conventions (summary, full text in `docs/conventions.md`)

- UI strings exist in Spanish and English; Spanish is the default market. Currency EUR, IGIC 7%.
- Follow `docs/design-system.md` for any UI: tokens from `brand/tokens.css`, Figtree/Bricolage Grotesque, Lucide icons only, light/dark/system.
- Errors: return JSON `{ error }` with a proper status, never leak paths or stack traces (`scrub` in `index.mjs`).
- Tests use `node:test`; AI providers are faked, no network.
- Commits: imperative, one topic. Branch is `main`; remote `origin`.

## Working tree note

The working tree may contain uncommitted but already-live work. Look at `git status` before assuming a file is stale, and never `git checkout .` or `git reset --hard` over it.
