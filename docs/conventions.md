# Conventions for agents and contributors

Rules to follow when changing this repo. They are derived from what the code does today and then fixed as decisions. Design decisions live in `docs/design-system.md`; this file wins for everything that is not visual. Where reality differs, it is listed at the end under "Known deviations".

## 1. Stack and layout

- Node 20+, plain ES modules (`"type": "module"`), no build step for the server. Studio (owner dashboard) is React 18 + TypeScript + Vite, built to `dist/` and also to a single file.
- `server/` backend and the HTML pages (`portal.html`, `signup.html`, `landing.html`, `home.html`); `src/` studio; `brand/` tokens, theme, logo; `scripts/` ops (deploy, backup, restore, rollback); `docs/` documentation; `deploy/` server config.
- Commands: `npm test`, `npm run typecheck`, `npm run build`, `npm run api`, `npm run dev`.

## 2. Files, modules, style

- Server files: lowercase `kebab-case.mjs`. Group by feature with a shared prefix: `menu.mjs` (logic, pure and testable), `menu-routes.mjs` (HTTP handler), `menu-pages.mjs` (HTML rendered on the server), `menu-links.mjs`. `index.mjs` only wires and dispatches.
- A route module exports `handleX(req, res, url, seg, ctx)` that returns `true` when it answered the request; `index.mjs` calls them in order.
- Studio: `src/screens/*.tsx` for owner screens (with a matching `*-api.ts` client), `src/modules/*` for product modules, `src/core/*` for shared types, store, UI kit. Components are PascalCase, files lowercase.
- ES modules only: `import`/`export`, `node:` prefix for built-ins (`node:fs`, `node:path`), no CommonJS, no default-exporting a bag of functions. Use `import.meta.dirname` for paths.
- Two-space indent, double quotes, semicolons, `const` by default, early returns, `async/await`. Comments say why, not what; keep a short header comment on every module saying what it is and what it must not do.
- Inline `<script>` code in HTML pages is plain ES that must run without a build (no TypeScript, no imports). Keep it free of stray backticks inside template literals (see testing).
- Always escape HTML with the local `esc()` helper when interpolating user data into HTML; never concatenate raw user input into markup, headers or file paths.

## 3. Dependencies

- Minimal on purpose. Current runtime deps: `@heyputer/puter.js`, `@napi-rs/canvas`, `fflate`, `passkit-generator`, `qrcode`, `react`, `react-dom`. Prefer Node built-ins and a few lines of code over a new package.
- Adding a dependency needs a written reason in the commit message (what it replaces, size, maintenance, licence). Pin exact versions for build tools and React; no `latest`.
- **No CDN, remote script, remote stylesheet, remote font or remote icon on Polar's own pages.** Fonts and icons are self-hosted or inline (`docs/design-system.md` sections 3 and 7). Only exception: the generated client websites (`server/webpage.mjs`), which may reference the allow-listed jsDelivr assets; that list is enforced by the sanitizer and its tests.
- Outbound calls to AI, image, mail, wallet and social providers go through the existing provider modules, never directly from route handlers, so tests can fake them.

## 4. Errors and HTTP shapes

- JSON APIs answer with `send(res, status, body)`. Success returns the resource or `{ ok: true, ... }`. **Every error is `{ "error": "<message>" }`** with the right status: 400 invalid input, 401 not signed in / wrong credentials, 403 forbidden (including declined businesses and non-owner), 404 unknown id/code/link, 413 too large, 429 rate limited, 503 feature not configured. Never mix in other shapes (`message`, `errors`, plain text) on JSON routes.
- Error messages are user-readable sentences saying what to fix ("Use at least 8 characters."), in English at the server boundary unless the route is a public/portal route that already localizes (bookings return Spanish for owner/portal). Never leak stack traces, file paths, provider names, keys, tokens or other tenants' data.
- Unexpected exceptions: handlers throw or reject; the top-level handler in `index.mjs` logs once and answers a generic 500. Domain code may throw an `Error` with a numeric `.status` (route code replies `e.status ?? 400`); do not rely on the message for 5xx.
- Validate at the edge: type, length, allowed values, and ownership (the record belongs to the caller's client) before touching data. Reject, do not silently coerce. Upload limits are explicit (images jpeg/png/webp, 6 MB).
- Rate-limit anything public, expensive or guessable with `limiter(...)` from `auth.mjs`; per-IP limits use the `clientIp(req)` helper (reverse proxy overwrites `X-Real-IP`). Tokens, codes and links are compared in constant time and never logged.
- HTML pages that must not be cached or framed set `Cache-Control: no-store` and the security headers already applied centrally; do not add per-route ad-hoc headers that weaken them.
- Declined or pending businesses are blocked from portal, client login and every public route. Any new route that resolves a business must go through the same check.

## 5. Logging

- Use `console.log` for startup banners only, `console.warn("[area] ...")` for recoverable problems (failed push, provider fallback), `console.error("[area] ...")` for server errors. Prefix with a bracketed area tag, as in `[error]`, `[uncaught]`, `[wallet push]`.
- Always pass messages through `scrub()` (removes absolute paths) and truncate (about 200 chars). Replace long ids in logged paths (`/:id`).
- **Never log**: secrets, API keys, tokens, access codes, passwords, full emails/phones of end customers, request bodies, uploaded content, or anything from `.env` / `scripts/deploy.config`. Log counts and ids, not personal data.
- No third-party log or analytics service without an explicit decision and a privacy-doc update (`docs/privacy/subprocessors.md`).

## 6. Internationalisation (ES / EN)

- Supported UI languages: **Spanish (`es`) and English (`en`)**. Spanish is the default for the client-facing side; the browser language is used only where nothing is stored.
- **Every user-facing string must exist in both languages in the same change.** This includes button labels, errors, empty states, toasts, emails, PDFs/passes, legal pages, `aria-label`s, `title`s and `alt` text. A string in one language only is a bug. Never concatenate translated fragments; use whole sentences with placeholders.
- Storage key: **`polar:lang`** (`"es"` or `"en"`) in `localStorage`, always wrapped in `try/catch`. Legacy `crier:lang` and `isla:lang` are read as fallback only, never written. A `?lang=` query parameter may override for that visit.
- Where strings live:
  - Portal (`server/portal.html`): the `T = { es: {...}, en: {...} }` dictionaries, read with `t(key)` (core UI) and `tl(key)` (feature views; returns the key itself if missing). Keys are `snake_case` with a feature prefix (`nav_`, `l_` loyalty, `bk_` bookings, `m_` menu, `x_` expenses).
  - Other HTML pages (`landing`, `home`, `signup`): inline dictionaries applied through `data-i18n` attributes / `applyLang()`.
  - Server-rendered pages and emails (`*-pages.mjs`, `booking-mail.mjs`, `legal.mjs`): a per-language object chosen from the record's language (a booking is managed in the language it was made in).
  - Studio (`src/`): the owner dashboard is currently English; any new studio text still goes through one dictionary per file, not scattered literals, so it can be translated.
- Set `<html lang>` when the language changes. Dates, numbers and currency use `Intl` with the active locale (`es-ES` / `en-IE`), never hand-built strings.
- Copy follows the tone rules in `docs/design-system.md` section 10.

## 7. Dates, money, tax

- Currency is **EUR** only. Store money as numbers in euros with at most 2 decimals (round with `Math.round(n * 100) / 100`); never floats from user strings without parsing and validating. Display with `Intl.NumberFormat` (`style: "currency", currency: "EUR"`).
- **IGIC 7 %** (Canary Islands indirect tax, not IVA). The single constant is `IGIC = 0.07` in `src/core/plans.ts`; helper `withIgic` in `src/core/biz.ts`. Prices shown to customers state whether IGIC is included; the public price list says "excluding IGIC (7%)". Do not hard-code 0.07 or 1.07 elsewhere; import the constant. Never label IGIC as IVA/VAT in copy.
- Timezone is `Atlantic/Canary` for anything customer-facing (bookings, opening hours, expiry). Store timestamps as ISO 8601 UTC (`new Date().toISOString()`), and calendar dates (birthday, booking day, receipt date) as `YYYY-MM-DD`. Convert only at display time.
- Week starts Monday; 24-hour time in `es`; show times with the business's timezone, not the viewer's.

## 8. Data, secrets and privacy

- Persistence is the JSON store in `server/store.mjs` (atomic write with fsync, `.bak`, corrupt-file fallback). Use `db` and `save()`; never write the data file directly. Tenant isolation: every query is scoped by `clientId`; add a tenancy test for new collections.
- Personal data follows `docs/privacy/` (RoPA, retention, erasure). New personal data fields must be added to retention (`server/retention.mjs`) and to the erasure path, and documented.
- Secrets live only in `.env` (and on the server). Never print, copy, log, commit or paste values from `.env` or `scripts/deploy.config`, in code, docs, tests, commit messages or chat. Document new variables in `.env.example` with empty or fake values.
- Tests must never read the real `.env`: blank every provider key (see `test-harness.mjs`).

## 9. Testing

- Runner: `node --test --test-concurrency=1 server/*.test.mjs` (`npm test`). No Jest/Vitest. `npm run typecheck` must pass for `src/`.
- Naming: `x.test.mjs` unit, `x.e2e.test.mjs` spawns the real server, `x.security.test.mjs` security regressions. Tests sit next to the module in `server/`.
- Use `server/test-harness.mjs` for anything that starts a server: `blankedEnv()` (provider keys blanked, because `index.mjs` auto-loads `.env`; an empty string counts as set), `freePort()`, `waitReady()`. Use a temp `DATA_DIR`/`SITES_DIR` per test run (`mkdtempSync(join(tmpdir(), ...))`) so no test touches `data/` or `sites/`.
- **No network and no real providers in tests.** Use fake providers: inject `fetchImpl`, point `*_BASE_URL` env vars at a local `http.createServer` stub, or leave keys blank so the code takes its offline path. A test that needs a real key is not allowed.
- **Every new route needs a security test** covering at least: unauthenticated access rejected (401/403), another tenant's id rejected (no cross-tenant read/write), declined/pending business blocked where it applies, input validation (type, size, bad id), rate limit if one is declared, and that error bodies contain no paths, tokens or stack traces. Put it in `x.security.test.mjs` or `tenancy.security.test.mjs`.
- **Inline-script syntax test:** every inline `<script>` in `server/*.html` is parse-checked by `server/html-syntax.test.mjs`. Any edit to an HTML page must keep it green; new HTML pages are picked up automatically. Run it before committing page changes. Prefer string concatenation or careful escaping over nested template literals in inline scripts.
- Bug fixes ship with a regression test. Tests are deterministic: no sleeps longer than needed, no reliance on wall-clock date without injecting it, fixed ports only through `freePort()`.
- Before reporting UI work done, run the page in a browser at phone width in light and dark, and check focus, contrast and both languages.

## 10. Git and commits

- Branch `main`; commit small, working states. Run `npm test` and `npm run typecheck` first.
- Message style (as in history): one imperative or descriptive sentence, sentence case, no trailing period, optionally `Area: detail` with a colon (`Reservations: owner dashboard Bookings tab`, `backup.sh: bash 3.2 compatible`). Names the user-visible change, not the files. Body only for non-obvious reasons. Agent commits end with the attribution line required by the session.
- One concern per commit; do not mix refactors, design changes and features. Never commit with `--no-verify`, never force-push `main`, never rewrite published history.
- Never commit generated or private state.

### Must stay untracked (already in `.gitignore`; do not weaken it)

`sites/` (generated customer websites), `data/` (live database and media), `.env` and `.env.*` (except `.env.example`), `.claude/` (local agent state), `scripts/deploy.config`, `deploy/*.local`, `backups/`, `polar-backups/`, `releases/`, `*.bak`, `node_modules/`, `dist/`. Before every commit run `git status` and check that none of these, nor anything containing a key or customer data, is staged.

## 11. Deploy and operations

- Use the scripts only: `npm run deploy` (`scripts/deploy.sh`), `scripts/rollback.sh`, `npm run backup` / `scripts/restore.sh`, `npm run push-env`. Production runs with `NODE_ENV=production`; the server fails closed without an admin password or token. Do not run these against production unless the owner asks. Scripts stay compatible with bash 3.2 (macOS).

## Known deviations

1. Studio (`src/`) strings are English-only literals spread across screens; there is no ES dictionary yet. Rule 6 applies to all new studio text.
2. `src/core/store.ts` uses the `isla:` localStorage prefix, and `server/share.mjs` loads Google Fonts (Inter); both contradict the naming and no-CDN rules.
3. IGIC appears as the constant in `plans.ts`, but some copy and `legal.mjs` text repeat "7 %" literally.
4. Error messages at the server boundary are mostly English even for Spanish-facing public routes; only bookings localize them.
5. Some older tests use fixed ports (for example 8841) instead of `freePort()`, and some inline their own env-blanking list instead of `blankedEnv()` from `test-harness.mjs`.
6. Not every existing route has a dedicated security test; the rule is mandatory for new and touched routes.
7. `docs/README.md` states Polar's pages load no Google Fonts, while `index.html` does.
