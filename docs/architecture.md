# Architecture

Polar Marketing is one Node process (`server/index.mjs`, plain ES modules, no framework) plus a React dashboard built into a single HTML file. State is one JSON file (`data/studio.json`) and a folder of media; generated client websites are static folders under `sites/`. See [data-model.md](data-model.md) for the data side. Verified against the code on the `main` branch; file names are relative to the repo root.

## 1. Components

| Component | What it is | Where |
|---|---|---|
| API + page server | One `http.createServer` in `server/index.mjs`. Serves JSON APIs, server-rendered pages, static media, client sites and the built dashboard. Listens on loopback in production (`HOST` defaults to `127.0.0.1` when `NODE_ENV=production`), behind nginx. | `server/index.mjs` |
| Owner dashboard | React 18 + TypeScript + Vite SPA, hash-routed, built to one HTML file. Served only at `/admin/` behind the owner session. | `src/`, `vite.config.ts` |
| Public pages | Landing `/` (`home.html`), sign-in `/login` (`landing.html`), sign-up `/signup` (`signup.html`), client portal `/portal/<token>` (`portal.html`), legal pages. Vanilla HTML with inline scripts. | `server/*.html`, `legal.mjs` |
| Feature pages | Server-rendered HTML strings: loyalty join/card/staff scanner, booking form/manage page, public menu, declined screen, share page. | `server/*-pages.mjs`, `declined.mjs`, `share.mjs` |
| Store | In-memory object `db` persisted to `data/studio.json` with atomic writes. | `server/store.mjs` |
| AI layer | Text providers with fallback (Groq, Google, Mistral, SiliconFlow, DeepSeek, Alibaba, Puter, TokenHarbor, OpenAI, OpenRouter), image engines (Pollinations free, OpenRouter, Google, Puter), stock photos. | `server/openrouter.mjs`, `images.mjs`, `puter.mjs`, `stock.mjs` |
| Media pipeline | Canvas text overlays and ffmpeg video rendering. | `video.mjs`, `overlay.mjs`, `draw.mjs` (`@napi-rs/canvas`, `ffmpeg`) |
| Site generator | Prompt, sanitize, assemble, swap into `sites/<slug>/`. | `aisite.mjs`, `sitebuilder.mjs`, `webpage.mjs`, `siteimages.mjs`, `siteedit.mjs`, `sitezip.mjs` |
| Integrations | Facebook/Instagram/X/YouTube publishing, Apple Wallet (PassKit + APNs), Google Wallet, Resend booking email. | `social.mjs`, `pass.mjs`, `wallet.mjs`, `gwallet.mjs`, `booking-mail.mjs` |

Runtime dependencies (`package.json`): `@napi-rs/canvas`, `fflate`, `passkit-generator`, `qrcode`, `@heyputer/puter.js`, `react`, `react-dom`. Node >= 20. ffmpeg is an OS dependency (only for video).

## 2. Request flow

`http.createServer` handler (end of `server/index.mjs`):

1. `securityHeaders()` sets `nosniff`, `Referrer-Policy`, and per-path framing/CSP: `/sites/*` gets a CSP with `sandbox allow-scripts allow-forms allow-popups` (opaque origin, so site scripts cannot reach the owner's cookie), `/media/*` gets `default-src 'none'; sandbox`, everything else `X-Frame-Options: DENY`.
2. If the caller is the owner, an `x-ai-provider` header can pick one AI provider; the request runs inside `runWithProvider(...)` (`openrouter.mjs`).
3. `route(req, res, url)` runs. Anything thrown becomes JSON: 4xx messages are returned as is, 5xx get a generic message and a path-scrubbed log line (`scrub()`).
4. Process-level `uncaughtException`/`unhandledRejection` handlers log and keep the server up.

Client IP comes from `clientIp()`: `X-Real-IP` is trusted only when the socket peer is loopback (nginx must overwrite it, see `deploy/nginx.conf.example`).

## 3. How `index.mjs` dispatches

`route()` is a long ordered chain of `if` checks on `url.pathname` and `seg = pathname.split("/")`. Order matters; first match wins:

| # | Match | Handler |
|---|---|---|
| 1 | `/privacy`, `/legal` | `legalPage()` (`legal.mjs`) |
| 2 | `/declined`, then **any path of a declined business** (`declinedClientFor(seg)`) | `declinedPage()`/`declinedBody()` -> 403. Covers portal, book, booking, menu, join, staff, card, loyalty logo, `/sites/<slug>`, `/p/<key>`. |
| 3 | `/wallet/v1/*` | `handleWallet` (`wallet.mjs`), 404 unless Apple Wallet is configured |
| 4 | loyalty: `/join/<code>`, `/card/<token>`, `/staff/<token>`, `/api/loyalty/*`, `/api/studio/loyalty/*`, `/api/portal/<token>/loyalty/*`, `/assets/jsqr.js` | `handleLoyalty` (`loyalty-routes.mjs`) |
| 5 | bookings: `/book/<code>`, `/booking/<manageToken>`, `/api/book/*`, `/api/booking/*`, `/api/studio/bookings/*`, `/api/portal/<token>/bookings/*` | `handleBookings` (`bookings-routes.mjs`). After a PUT/PATCH, `index.mjs` re-syncs the booking button into built sites (`bookings-links.mjs: syncAllSites`). |
| 6 | expenses: `/api/studio/expenses/*`, `/api/portal/<token>/expenses/*` | `handleExpenses` (`expenses-routes.mjs`) |
| 7 | menu: `/menu/<code>`, `/api/menu/*`, `/api/studio/menu/*`, `/api/portal/<token>/menu/*` | `handleMenu` (`menu-routes.mjs`); same site re-sync on PUT/PATCH |
| 8 | `/api/ai/status`, `POST /api/ai` | AI proxy for the dashboard (owner only; status is minimal for visitors) |
| 9 | `/`, `/robots.txt`, `/login`, `/admin/`, `/api/auth*`, `/api/client-login`, `/api/client-logout`, `/assets/profile-form.js`, `/puter-callback`, `/signup`, `POST /api/signup` | inline in `index.mjs` |
| 10 | `/portal/<token>` (page) and `/api/portal/<token>/...` | inline: view, briefs, profile, qr, upload, messages, videos, "again" |
| 11 | `/api/studio/...` (owner API) | inline: `GET` full state, clients, approve/decline, site build/chat/undo/zip/upload, posts, videos, briefs, settings (offer, limits, ai, images), `DELETE clients/<id>` -> `eraseClient` |
| 12 | `/p/<shareKey>` | `sharePage()` (Open Graph page for a post/video) |
| 13 | `/brand/home/*` (with byte ranges), `/brand/*`, root icon paths | static from `brand/` |
| 14 | `/media/<file>` | static from `data/media/` (byte ranges, immutable cache, `?download=1`) |
| 15 | `/sites/<slug>/...` | static from `sites/` (hidden dot-folders refused; a missing trailing slash is redirected) |
| 16 | anything else | static file from `dist/` (never `.html`), else 404 |

Conventions of the `*-routes.mjs` handlers (`handleLoyalty`, `handleBookings`, `handleExpenses`, `handleMenu`, `handleWallet`):

- Signature `handleX(req, res, url, seg, ctx)`; return `true` when the request was handled, `false` to let `route()` continue.
- `ctx` is built once in `index.mjs` (`loyaltyCtx`): `send`, `readBody`, `saveUpload`, `isAdmin`, `clientByToken`, `baseUrl`, `clientIp`, plus wallet and design hooks. Route modules therefore never import `index.mjs`.
- Each feature has the same three surfaces: **public** (by unguessable code/token), **owner** (`/api/studio/<feature>`, requires `auth.isAdmin`), **portal** (`/api/portal/<token>/<feature>`, scoped to the business owning the token). Owner and portal share one `manage(...)` function that receives a scope (`{clientId: null}` or the business id).
- Per-IP limiters (`limiter()` in `auth.mjs`) are defined per module as `limits`.

Authentication (`auth.mjs`, plus session code in `index.mjs`):

- Owner: scrypt password hash (or `ADMIN_PASSWORD` env), 30-day HttpOnly cookie, or `x-admin-token` header matching `ADMIN_TOKEN`. In production it fails closed until a password exists; first-run creation is allowed only from the machine itself.
- Business: a 6-character access code (`/api/client-login`, throttled per IP, globally and per 3-char prefix) sets a 90-day sliding cookie (`c.sessions`), or the secret portal token in the URL.
- Approval gate (`limits.mjs`): new sign-ups are `pending`; `blockReason()` stops briefs/videos/messages for pending or declined businesses and enforces the weekly cap.

## 4. File map

### `server/` (Node modules)

Core and infra

| File | Role |
|---|---|
| `index.mjs` | Entry: env loading, wiring, `route()`, auth/session cookies, security headers, `listen`, schedulers. |
| `store.mjs` | `db`, `save()`, `id()/token()/now()`, `DATA_DIR`, `MEDIA_DIR`. |
| `auth.mjs` | Owner password/session, access codes, `limiter()`. |
| `limits.mjs` | Approval status, weekly post/video cap, `blockReason()`. |
| `declined.mjs` | Declined-business screen and the path-to-business matcher. |
| `legal.mjs` | `/privacy` and `/legal` pages from `LEGAL_*` env. |
| `retention.mjs` | `eraseClient()` and the opt-in `purgeExpired()`. |
| `offer.mjs` | Plans and prices shown on the landing page (`db.settings.offer`). |
| `test-harness.mjs` | Helpers for tests that spawn a real server. |

AI and media

| File | Role |
|---|---|
| `openrouter.mjs` | Text completion with provider fallback, free-model ranking, per-client provider (`withClientAi`). |
| `images.mjs`, `puter.mjs` | Image engines (Pollinations, OpenRouter, Google, Puter) and voice/image via Puter. |
| `stock.mjs` | Stock photos (Pexels with key, else Openverse CC0). |
| `reference.mjs` | "A website I like": SSRF-guarded fetch of example sites into a design brief. |
| `draw.mjs`, `overlay.mjs`, `video.mjs` | Text drawing, offer-on-photo/video overlays, ffmpeg video ads. |
| `studio.mjs` | Content studio: posts, captions, image drawing, publish, autopilot `tick()`. |
| `assistant.mjs` | Portal chat assistant, uploads (`up-<id>.<ext>`), clip rendering. |
| `social.mjs`, `share.mjs` | Direct publishing and the public share page. |
| `profile.mjs` | Business profile form -> `client.profile`, logo and photos. |

Websites

| File | Role |
|---|---|
| `sitebuilder.mjs` | Build orchestration, atomic swap, retries, zip install/download. |
| `aisite.mjs` | The big prompt, model call, QA pass, `writePages`, saves page sources to `data/site-src/`. |
| `directions.mjs` | Art directions (SiteInspire-style) picked per business. |
| `siteimages.mjs` | Image "art director": logo cleanup, crops, slot assignment. |
| `webpage.mjs` | HTML extraction, sanitizer, CSP, SEO head, JSON-LD, language switcher, lint. |
| `siteedit.mjs` | Website chat: find/replace edits and undo (versions in `data/site-src/<slug>/versions`). |
| `sitezip.mjs` | Zip export and checked zip import. |
| `ownsite.mjs` | "Use my own website" mode (nothing is built). |
| `bookings-links.mjs`, `menu-links.mjs` | Inject Book/Menu floating buttons into built sites. |
| `qr.mjs` | QR SVG/PNG. |

Feature modules (each: data module, routes, pages, tests)

| Feature | Data | Routes | Pages / other |
|---|---|---|---|
| Loyalty | `loyalty.mjs` | `loyalty-routes.mjs` | `loyalty-pages.mjs`, `loyalty-design.mjs` (AI card design), `pass.mjs`, `wallet.mjs`, `gwallet.mjs`, `vendor/jsqr.cjs` |
| Bookings | `bookings.mjs` | `bookings-routes.mjs` | `bookings-pages.mjs`, `booking-mail.mjs`, `bookings-links.mjs` |
| Expenses | `expenses.mjs` | `expenses-routes.mjs` | `expenses-export.mjs` (CSV and ODS) |
| Menu | `menu.mjs` | `menu-routes.mjs` | `menu-pages.mjs`, `menu-links.mjs` |

Static pages: `home.html`, `landing.html`, `signup.html`, `portal.html`, `profile-form.js` (served at `/assets/profile-form.js`). `index.mjs` reads them per request and replaces `{{BRAND}}`/`{{ICONS}}`; `home.html` also gets `{{BASE}}` and `{{OFFER_JSON}}`.

### `src/` (dashboard)

| Path | Role |
|---|---|
| `main.tsx`, `App.tsx`, `styles.css` | Entry, shell/nav (checks `GET /api/auth`; redirects to `/login#admin`; falls back to local mode if no server), global styles. |
| `src/core/` | Shared kit: `store.ts` (browser-side collections), `studio-sync.ts` (pull server clients into the CRM, push prices), `ai.ts` (calls `/api/ai`), `claude.ts` (claude.ai artifact runtime), `ui.tsx` (components), `nav.ts` (hash routing), `plans.ts`/`offer.ts`/`biz.ts` (plan catalogue, prices, IGIC 7% maths), `seed.ts` (example data), `types.ts`, `brand.ts`. |
| `src/screens/` | Business screens: `dashboard` (Today), `clients`, `business`, `loyalty`, `studio` (+ `studio-videos`, `studio-share`), `plans`, `billing`, `visits`, `reports`, `settings`, `bookings`, `menu`, `expenses`. `*-api.ts` are typed fetch helpers for `/api/studio/...` (`studio-api.ts` `call()` adds `x-admin-token` from `localStorage`). |
| `src/modules/` | The ten older one-service tools (reviews, visibility, receptionist, listings, retention, video, pages, clips, social, makers), each exporting `Screen` and `seed()`; `index.ts` holds `ROUTES`. Hidden unless enabled in Settings (`isExtraTool`). `polar-icons.tsx`, `polar-modules.css` are shared. |

### `scripts/`

| File | Role |
|---|---|
| `dev.mjs` | `npm run dev`: spawns `server/index.mjs` and Vite together. |
| `to-artifact.mjs` | Post-build: turns `dist/index.html` into `dist/artifact.html` (artifact page body). |
| `deploy.sh` | Release deploy over SSH: build, rsync to `releases/<ts>`, `npm ci --omit=dev --ignore-scripts`, health check, swap `current` symlink, restart, auto-rollback on failure. Never touches `data/`, `sites/`, `.env`. |
| `rollback.sh` | Point `current` at the previous (or named) release and restart. |
| `push-env.sh` | Merge AI/mail keys from local `.env` into the server `.env` (aborts if any existing key would be lost), restart. |
| `backup.sh` | rsync snapshot of `data/`, `sites/`, `.env`; optional `age`/`gpg` encryption and off-site copy; keeps N snapshots. |
| `restore.sh` | Restore or `--verify` a snapshot locally (never writes to the remote). |
| `brand-tokens.mjs`, `brand-assets.mjs`, `home-assets.mjs` | Generate `brand/tokens.*`, the icon set from the supplied logo, and the landing-page example images/Reel (needs ffmpeg). |
| `deploy.config` | Local, gitignored deploy settings. Not documented here by design. |

### `brand/`

Design system served at `/brand/*`: `tokens.css/json` (generated by `scripts/brand-tokens.mjs` from `DESIGN.md`), `components.css`, `theme.js` (sets `data-theme`), `brand.json` (product name read by both server and dashboard), `logo/` (icon set), `home/` (landing examples and credits), `site.webmanifest`, `ADOPTION.md`, `DESIGN.md`.

### `deploy/`

Reference config, not applied automatically: `README.md` (server setup, commands, restore), `isla-autopilot.service` (systemd unit, `NODE_ENV=production`, runs `server/index.mjs` from `current/`), `nginx.conf.example` (TLS, rate limits, body-size limits, `X-Real-IP` overwrite), `ufw.md` (firewall).

Server layout implied by the scripts: `<dir>/releases/<ts>/` (code), `<dir>/current` (symlink), and shared `.env`, `data/`, `sites/` outside releases.

## 5. Dashboard: build and serve

- `npm run build` = `tsc --noEmit` + `vite build` + `node scripts/to-artifact.mjs`. `vite-plugin-singlefile` inlines everything into `dist/index.html`; `dist/artifact.html` is the same content shaped for claude.ai artifacts.
- Production: `GET /admin/` (owner session required, else 302 to `/login`) returns `dist/index.html` with the icon links injected before `</head>`. Other files in `dist/` are served as static assets by the last `route()` fallback, never `.html`. If `dist/index.html` is missing, `/admin/` redirects to the Vite dev server.
- Dev: `npm run dev` runs the API on `:8787` and Vite on `:5173` with `base: "/admin/"`; Vite proxies `/api`, `/brand`, `/media`, `/sites`, `/portal`, `/login`, public feature paths etc. to the API (list in `vite.config.ts`).
- `npm start` builds, then serves everything from the one Node process.
- Data in the dashboard comes from two places: server APIs (studio, loyalty, bookings, menu, expenses) and a browser-side store for the CRM-style collections (see data-model.md section 8).

## 6. Generated client websites

Pipeline (`sitebuilder.buildSite(client, {newDesign})`):

1. Skipped when the business uses its own website (`ownsite.ownWebsite`). Only one build per client at a time (`building` set).
2. `client.site.status = "building"`; work happens in `sites/.<slug>.building` next to the live folder.
3. `siteimages`/`aisite.prepareAssets` choose and crop images; `directions.pickDirection` picks an art direction (kept on rebuild unless `newDesign`); `reference.mjs` optionally adds a design brief from example sites.
4. `aisite.buildAiSite`: one large prompt -> model writes full HTML+CSS; a quality review can trigger one repair pass; other languages are translations of the same design.
5. `webpage.mjs`: `sanitize()` tokenises the HTML and keeps only allow-listed tags and attributes: scripts are dropped (except Bootstrap's bundle, rewritten to one pinned jsDelivr URL), iframes are kept only for a Google Maps embed URL, `<link>` only for Google Fonts/Bootstrap stylesheets, and `<img src>` only for the site's own images (or `data:` images); `cleanCss()` strips imports/expressions/foreign `url()`; `assemble()` adds the head (CSP meta first, canonical, hreflang, Open Graph, LocalBusiness/FAQ JSON-LD) and the language switcher; `lintPage()` reports problems.
6. `aisite.writePages` writes `index.html` (first language) and `<lang>/index.html`, then `siteCta()` adds the Book/Menu buttons. `sitebuilder` writes `sitemap.xml`, `robots.txt`, `site.json`.
7. `swapDir(work, dir)` swaps with renames only (old folder moved aside and restored if the final rename fails), so the live site stays up during a rebuild.
8. Sources (`<lang>.html`, `assets.json`) are kept in `data/site-src/<slug>/` for the website chat (`siteedit.mjs`: find/replace edits, same sanitizer, undo via versions).
9. Failure: AI trouble -> `status: "waiting"` with backoff (`nextTryAt`, retried every 60 s by `startSiteRetries`, capped at hourly) and the previous site kept; other errors -> `failed`. There is no template fallback.

Other ways a site gets into `sites/<slug>/`: owner zip upload (`POST /api/studio/clients/<id>/site-upload` -> `installUploadedSite`, validated by `sitezip.readSiteZip`: safe paths, allowed extensions, size/file-count caps, previous site kept in `sites/.<slug>.previous`); download via `.../site.zip`.

Serving: `/sites/<slug>/` is plain static files by `route()` (section 3, row 15), with the `/sites/` CSP/sandbox header. Public URLs of the business domain are handled outside the app (nginx/DNS); the QR and links use `siteBase()` (custom domain when set, else the studio URL).

`bookings-links.syncAllSites` and the menu equivalent edit already-built pages in place (markers make it idempotent) when a business opens or closes bookings or its menu.

## 7. Background jobs

All timers are started in the `server.listen` callback of `index.mjs` and use `setInterval(...).unref()`. There is no external job runner or cron; everything is in-process and resumes from `db` after a restart.

| Job | Started by | Interval | What it does |
|---|---|---|---|
| Autopilot posts | `studio.startScheduler()` (`tick`) | 60 s, and once at boot | For each business with `autopilot` that passes `blockReason()`: if the time since its last post exceeds `7 days / max(7, postsPerWeek)` and nothing is generating, `startPost()` from its briefs in rotation (or an AI-picked topic). Also `retryDue()` for waiting/failed posts. At boot, posts left `generating` are re-run. |
| Autopilot videos | `startVideoScheduler()` + `setInterval(videoTick)` | 60 s | Same pacing with `videosPerWeek`, only for businesses that have briefs. Boot: re-run `generating` videos. |
| Assistant replies | `startAssistant()` | boot only | Re-run assistant messages left `thinking`. |
| Site retries | `startSiteRetries()` | 60 s | Rebuild `waiting` sites whose `nextTryAt` has passed; resume `building` sites older than 15 minutes; boot resumes any `building`. |
| Limiter pruning | `limiter()` in `auth.mjs` | >= 60 s | Drop expired hit records. |
| Boot fix-ups | `index.mjs` | boot | Reset `siteEdit` stuck on `working`; give every business an access code if missing. |

Retention (`retention.mjs`): `eraseClient()` is wired to `DELETE /api/studio/clients/<id>`. `purgeExpired()` (declined clients, old bookings, inactive loyalty customers; limits from `RETENTION_*_DAYS` via `retentionFromEnv()`, default off, supports `dryRun`) **is not called from anywhere except tests**, so no automatic purge runs today. See data-model.md section 9.

Autopilot output also fans out to platforms: `studio.publish()` posts to the business's connected accounts and webhook when `autoPublish` is on (`social.mjs`).

## 8. Tests

`npm test` = `node --test --test-concurrency=1 server/*.test.mjs` (39 files; serial because several start real servers or share ports). There are no frontend tests; `npm run typecheck` covers `src/`. Tests use temp `DATA_DIR`/`SITES_DIR` and blank AI keys so the real `.env` is never used.

| Kind | Files |
|---|---|
| Unit (module in-process) | `*.test.mjs` next to each module: `bookings`, `expenses`, `menu`, `loyalty`, `directions`, `images`, `openrouter`, `puter`, `qr`, `pass`, `wallet`, `gwallet`, `studio`, `social`, `webpage`, `sitezip`, `siteimages`, `ownsite`, `loyalty-design`, `loyalty-pages`, `bookings-pages`, `bookings-links`, `legal`. |
| End-to-end (spawn a real server, fake upstreams) | `e2e.test.mjs` (sign-up -> site + post -> share -> video, against fake OpenRouter/Pollinations/Meta/X/YouTube), `loyalty.e2e.test.mjs`, `bookings.e2e.test.mjs`, `menu.e2e.test.mjs`, `expenses.e2e.test.mjs`, `declined.test.mjs`, `security-core.test.mjs` (the last two use `test-harness.mjs`). |
| Security / hardening | `security-core.test.mjs` (headers, media streaming, code throttling, fail-closed admin, generic 5xx), `tenancy.security.test.mjs`, `webpage.security.test.mjs`, `sitezip.security.test.mjs`, `reference.security.test.mjs`, `booking-mail.security.test.mjs`, `html-syntax.test.mjs` (every inline `<script>` in `server/*.html` parses). |
| Data durability / lifecycle | `store.durability.test.mjs`, `erasure.test.mjs` (erase everything for a client, traversal safety, purge off by default). |

## 9. Known gaps (as seen in the code)

- Automatic retention purge is not scheduled (section 7). `docs/privacy/retention.md` and the README open items still say loyalty is missing from erasure; `eraseClient()` now covers loyalty, bookings, menu and expenses, so those docs are out of date on that point.
- Single process only: the store serialises writes inside one process; there is no cross-process lock, so never run two server instances on the same `data/`.
