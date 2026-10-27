# Routes and authentication

Source of truth: `server/index.mjs` (the `route()` function, in order), plus the `handle*` modules it delegates to.
Everything here was read from code; if code and this file disagree, the code wins. Update this file when you add a route.

## 1. How a request flows

`http.createServer` in `server/index.mjs`:

1. `securityHeaders()` sets headers on every response (section 5).
2. If the caller is admin and sent `x-ai-provider`, AI calls in this request are pinned to that provider (`runWithProvider`). Ignored for non-admins.
3. `route()` runs top to bottom. **Order matters**, first match answers:
   1. `/privacy`, `/legal`, `/declined`
   2. **Declined-business gate** (`declinedClientFor`, section 4). Runs before every client-facing handler.
   3. `handleWallet` (`wallet.mjs`), `handleLoyalty` (`loyalty-routes.mjs`), `handleBookings` (`bookings-routes.mjs`), `handleExpenses` (`expenses-routes.mjs`), `handleMenu` (`menu-routes.mjs`), `handleGbp` (`gbp-routes.mjs`). Each returns `true` when it answered, `false` to fall through.
   4. `/api/ai*`, landing/login/auth/signup pages and APIs
   5. `/portal/<token>` page and `/api/portal/<token>/...` (generic portal API)
   6. `/api/studio/...` (admin API; first line is the admin check)
   7. `/p/<shareKey>`, `/brand/*`, `/media/*`, `/sites/*`, built app assets from `dist/`, then 404 JSON.
4. Errors thrown with `.status` become that status. Anything >= 500 returns a generic message unless `e.expose` is set; paths are scrubbed from logs.

Request bodies go through `readBody(req, limit)` (default 1 MB, JSON only, 413 when exceeded, 400 on bad JSON). It does not check `Content-Type`.

## 2. Access classes

| Class | Who | Proof |
|---|---|---|
| **Public** | anyone | none, or an unguessable link token/code in the path (booking code, manage token, join code, card token, menu code, share key) |
| **Tenant** | one business | portal token in the path (`/portal/<token>`, `/api/portal/<token>/...`) or the 6-character client access code (login only). Staff scanner uses a per-programme staff token |
| **Admin** | the studio owner | `isla_admin` cookie (password login) or `X-Admin-Token` header equal to `ADMIN_TOKEN` |

"Rate limit" below is per client IP (see section 3 for how the IP is derived) unless stated. All limiters are in memory and reset on restart. Where a row says "none in app", nginx may still limit (see `deploy/nginx.conf.example`).

## 3. Route table

Legend for the Auth column: **none** = public, **token** = portal token in path, **code** = link code/token in path, **admin** = cookie or `ADMIN_TOKEN`.

### 3.1 Public

| Method | Path | Handler | Auth | Rate limit |
|---|---|---|---|---|
| GET | `/` | `index.mjs` (`home.html`) | none | none in app |
| GET | `/privacy`, `/legal` | `index.mjs` + `legal.mjs` | none | none in app |
| GET | `/declined` | `index.mjs` + `declined.mjs` | none (returns 403 page) | none in app |
| GET | `/robots.txt` | `index.mjs` | none | none |
| GET | `/login` | `index.mjs` (`landing.html`) | none; a valid client cookie redirects to the portal (or declined screen) | none in app |
| GET | `/signup` | `index.mjs` (`signup.html`) | none | none in app |
| POST | `/api/signup` | `index.mjs` | none; creates a business as `pending` | 5/h per IP (inline map) and `signupTries` 30/h; body up to 12 MB |
| GET | `/puter-callback` | `index.mjs` | none (static page; token is read in the browser and posted to an admin route) | none |
| GET | `/assets/profile-form.js` | `index.mjs` | none | none |
| GET | `/assets/jsqr.js` | `loyalty-routes.mjs` | none | none |
| GET | `/api/auth` | `index.mjs` | none; returns `{admin, setup, fromEnv}` only | none in app |
| GET | `/api/ai/status` | `index.mjs` | none; non-admins only learn `configured`, admins get providers/models | none |
| POST | `/api/auth/login` | `index.mjs` + `auth.mjs` | none; sets admin cookie | `authHits` 60 requests/15 min and `loginTries` 10 failures/15 min per IP |
| POST | `/api/auth/logout` | `index.mjs` | none (clears own cookie) | none |
| POST | `/api/client-login` | `index.mjs` + `auth.mjs` | 6-char code; sets `isla_client` cookie | `codeTries` 12 failures/15 min per IP, `codeTriesAll` 300/h global, `codePrefixTries` 40/h per 3-char prefix |
| POST | `/api/client-logout` | `index.mjs` | none (clears own cookie) | none |
| GET | `/p/<shareKey>` | `index.mjs` + `share.mjs` | code (share key) | none |
| GET | `/brand/*`, `/favicon.ico`, `/apple-touch-icon*.png`, `/site.webmanifest`, `/brand/home/<file>` | `index.mjs` | none (path-whitelisted, traversal checked) | none |
| GET/HEAD | `/media/<file>` | `index.mjs` | none; unguessable file names; served with `sandbox` CSP and `Access-Control-Allow-Origin: *` | none |
| GET | `/sites/<slug>/...` | `index.mjs` | none (client websites); declined businesses get 403 | none |
| GET | `/<built asset>` | `index.mjs` | none; only non-HTML files from `dist/` (the app HTML is served at `/admin` only) | none |
| GET | `/book/<code>` | `bookings-routes.mjs` | code | none in app |
| GET | `/booking/<manageToken>` | `bookings-routes.mjs` | code (manage token) | `badToken` 30 failures/15 min |
| GET | `/api/book/<code>/info` | `bookings-routes.mjs` | code | `read` 240/min |
| GET | `/api/book/<code>/availability` | `bookings-routes.mjs` | code | `read` 240/min |
| POST | `/api/book/<code>` | `bookings-routes.mjs` | code; creates a booking | `create` 12/h |
| POST | `/api/booking/<manageToken>/cancel` | `bookings-routes.mjs` | code (manage token) | `cancel` 20/h, `badToken` 30 failures/15 min |
| GET | `/join/<joinCode>` (`?l=es\|en`) | `loyalty-routes.mjs` | code; renders three states from the `lc_member` cookie (open the card / one-tap add / phone form), Spanish by default | none in app |
| POST | `/api/loyalty/join/<joinCode>` | `loyalty-routes.mjs` | code; `{phone, name?}` creates a member + card and sets the `lc_member` device cookie; `{name, email}` (old cached page) still creates one card per submit | `join` 60/h per IP, `joinPhone` 5/h per number, `joinProgram` 300/h per programme |
| POST | `/api/loyalty/join/<joinCode>/code` | `loyalty-routes.mjs` | code; `{phone}` starts a recovery. `202 {recovery:"sms"\|"staff", sent}` in every case, member or not, and sets the `lc_recovery` HttpOnly cookie (15 min) when there is a member. `sms` means a provider is configured, not that a card exists | `recoveryCode` 10/h per IP, `recoveryPhone` 5/h per number, plus the OTP service's own 3 sends/number/h and `OTP_DAILY_CAP` |
| POST | `/api/loyalty/join/<joinCode>/verify` | `loyalty-routes.mjs` | code; `{code}` against the request behind the `lc_recovery` cookie. `200 {state:"confirmed", cardUrl}` + `lc_member` cookie; `401 {error, triesLeft}`, `410` expired, `423` locked after 3 wrong digits | `recoveryVerify` 30/15 min per IP |
| GET | `/api/loyalty/join/<joinCode>/wait` | `loyalty-routes.mjs` | code; the requesting page polls while the staff look at the till. `{state:"pending"\|"confirmed"\|"expired"\|"missing"}` and, once confirmed, the card URL and the `lc_member` cookie | `recoveryWait` 900/min per IP |
| GET | `/card/<cardToken>` and `/card/<token>/(qr.svg\|manifest.webmanifest\|pass.pkpass\|google-wallet)` | `loyalty-routes.mjs` | code (card token) | `card` 240/min, `badCard` 30 failures/15 min |
| GET | `/api/loyalty/card/<cardToken>` | `loyalty-routes.mjs` | code | same as above |
| POST | `/api/loyalty/card/<cardToken>/claim` | `loyalty-routes.mjs` | code (card token); `{phone}` sends a six-digit code to that number so an old email card can gain a phone. `202 {sent:true}`; `503` while no SMS provider is configured (the card page hides the form then); `409` when the card already has a number | `claimCode` 10/h per IP, `claimPhone` 5/h per number, plus the OTP service's 3 sends/number/h and `OTP_DAILY_CAP` |
| POST | `/api/loyalty/card/<cardToken>/claim/verify` | `loyalty-routes.mjs` | code; `{phone, code}` links the card to the member for that number (creating one if needed), sets `card.memberId`, keeps email/name/balances and sets the `lc_member` cookie. `401/423/410` as recovery; `409` when that number already has another card at this programme (the owner merges, never this route) | `claimVerify` 30/15 min per IP |
| GET | `/loyalty/logo/<programId>.png` | `loyalty-routes.mjs` | none | none |
| GET | `/staff/<staffToken>` | `loyalty-routes.mjs` | code (staff token, can expire) | `badStaff` 20 failures/15 min |
| POST | `/api/loyalty/staff/<staffToken>/(lookup\|record\|find\|enrol\|waiting\|confirm)` | `loyalty-routes.mjs` | code (staff token); `find` searches this programme's cards by phone suffix (5 matches, masked, first name only), `enrol` creates the card, `record` adds stamps/points, `waiting` lists this programme's pending recoveries (first name + masked number), `confirm` `{id}` marks one proved | `staff` 180/5 min, `badStaff` 20 failures/15 min |
| GET/HEAD | `/menu/<code>` (+ `/qr.svg`, `/qr.png`, `/img/<file>`) and `/api/menu/<code>` | `menu-routes.mjs` | code; only when the menu is enabled | `read` 300/min |
| POST/DELETE/GET | `/wallet/v1/devices/<deviceId>/registrations/<passTypeId>[/<serial>]`, GET `/wallet/v1/passes/<passTypeId>/<serial>` | `wallet.mjs` | `Authorization: ApplePass <authToken>` per pass (timing-safe compare); 404 when Wallet is not configured | none in app |
| POST | `/wallet/v1/log` | `wallet.mjs` | none by design (Apple sends no token); 8 KB / 20 lines / 300 chars | 30/min per IP |

**Loyalty join responses** (`joinRoute` in `loyalty-routes.mjs`). A number that has never joined: `201` + `{cardUrl}`, and the `lc_member` cookie (HttpOnly, `SameSite=Lax`, 2 years) binds the card to that browser. A browser that already holds that cookie gets its card for another shop with no body at all (`201` when the card is new, `200` when it already existed). A number that belongs to another device: `202 {recovery:"verify"}`, no card, no name, no write. That last one is a **deliberate departure from plan A.8** ("identical response for existing and new"): a zero-friction join and a protected balance cannot both be silent about which case you are in, so the route leaks exactly one bit (this number has a card somewhere) and nothing else. Proving the number is L5: `.../code` starts a 15-minute recovery, tier 1 sends a six-digit code to that phone, and tier 2 asks the staff to confirm at the till (which is what happens while no SMS provider is configured). Both end with `{state:"confirmed", cardUrl}` and the `lc_member` cookie on the requesting device, and both are polled through `.../wait`. The `code` answer is the same shape for a number with no card — `{recovery, sent:false}` — so the endpoint itself is not an enumeration oracle; what it does expose is whether a provider is configured.

**Old cards (claim) and duplicates (merge).** A card created before the phone-first join has no `memberId`; `/card/<token>` shows it exactly as before. When an SMS provider is configured, the card page offers one line — "Add your number" — which posts to `.../claim` and then `.../claim/verify`. The card token is already the proof of the card; the code only proves the number. On success the card keeps its `email`, `name`, `cardToken` and balances and gains `memberId` + the canonical phone. A number that already holds a card *at the same programme* is a 409 and changes nothing: two balances for one person are merged by the owner, never by whoever typed the number. The owner/portal merge is `POST .../programs/<id>/merge {keepId, mergeId, confirm:true}` (ids or card tokens); it sums stamps/points/lifetime/visits, moves transactions, Wallet device tokens and consent rows, and records the absorbed card's `cardToken` in `aliases` and its `id` in `oldIds`, so the old URL and an already-printed QR keep resolving to the surviving card. `scripts/loyalty-members-report.mjs` is a read-only dry run that lists old cards and same-programme duplicates by normalised phone or email; it never merges.

### 3.2 Tenant (portal token)

The token is the credential. Unknown token: 404 JSON on API, the portal HTML shell on `/portal/<token>` (it shows "link not valid" itself).

| Method | Path | Handler | Auth | Rate limit |
|---|---|---|---|---|
| GET | `/portal/<token>` | `index.mjs` (`portal.html`) | token (page is served even for unknown tokens) | none in app |
| GET | `/portal/<token>/manifest.webmanifest` | `index.mjs` | token; 404 for an unknown token | none in app |
| GET | `/portal/sw.js` | `index.mjs` | none; the portal's service worker (makes the app installable, caches nothing) | none in app |
| GET | `/api/portal/<token>` | `index.mjs` `portalView` | token | `portalHits` 300/min |
| POST | `/api/portal/<token>/briefs` | `index.mjs` | token; blocked while pending/declined or over the weekly cap | `portalHits` + 10/day per business |
| POST | `/api/portal/<token>/profile` | `index.mjs` | token; not blocked while pending (site only rebuilds once approved) | `portalHits` + 15/day per business; body up to 40 MB |
| GET | `/api/portal/<token>/qr`, `/qr.png` | `index.mjs` | token | `portalHits` |
| POST | `/api/portal/<token>/upload` | `index.mjs` + `assistant.mjs` | token; blocked while pending/declined | `portalHits` + 40/day per business |
| POST | `/api/portal/<token>/messages` | `index.mjs` + `assistant.mjs` | token; blocked while pending/declined | `portalHits` + 40/day per business |
| POST | `/api/portal/<token>/videos` | `index.mjs` | token; blocked while pending/declined or over cap | `portalHits` + 3/day per business |
| POST | `/api/portal/<token>/posts/<id>/again` | `index.mjs` | token; post must belong to the business; blocked like briefs | `portalHits` |
| GET/POST/PATCH/DELETE | `/api/portal/<token>/loyalty/...` (programmes, upload, design, customers, adjust, qr, staff-token rotation, merge) | `loyalty-routes.mjs` `manage()` | token; every id is checked against the business | `manage` 600/min, `design` 6/10 min per IP+business |
| GET/PUT/PATCH/POST | `/api/portal/<token>/bookings/...` (config, bookings, qr) | `bookings-routes.mjs` `manage()` | token; booking must belong to the business | `manage` 600/min |
| GET/PUT/PATCH/POST | `/api/portal/<token>/menu/...` (config, photo, import, translate) | `menu-routes.mjs` `manage()` | token; 403 `disabled` until the owner enables it | `manage` 600/min, `photo` 120/h, `ai` 30/h |
| GET/PUT/PATCH/POST/DELETE | `/api/portal/<token>/expenses/...` (config, scan, export, items, photo, ask, dictate, parse) | `expenses-routes.mjs` `manage()` | token; 403 `disabled` until the owner enables it; expense must belong to the business | `manage` 600/min, `scan` 30/h, `ask` 20/h |
| GET/PATCH/POST | `/api/portal/<token>/gbp` and `/gbp/kit` (manual Google Business Profile kit and status) | `gbp-routes.mjs` `handleGbp()` | token; 403 for pending/declined businesses; only the caller's own `client.gbp` is ever read or written | `read` 180/min per IP, `write` 60/min, `ai` 6/h (kit generation) |

Client session (convenience only, not an API credential): after a correct code, `POST /api/client-login` sets `isla_client` (`<clientId>.<random>`, 90-day sliding, HttpOnly, SameSite=Lax) and `/login` uses it to redirect to `/portal/<token>`. API calls still need the token in the path.

### 3.3 Admin (cookie or `ADMIN_TOKEN`)

All `/api/studio/*` routes start with `if (!auth.isAdmin(req)) return 401` (in `index.mjs`, or at the top of the delegated handler).

| Method | Path | Handler | Auth | Rate limit |
|---|---|---|---|---|
| GET | `/admin`, `/admin/` | `index.mjs` | admin cookie; otherwise 302 to `/login`. Serves `dist/index.html` | none in app |
| POST | `/api/auth/password` | `index.mjs` | admin + current password; disabled when the password comes from `ADMIN_PASSWORD` | none in app |
| POST | `/api/ai` | `index.mjs` | admin (401 otherwise); 503 without any AI key | none in app |
| GET | `/api/studio` | `index.mjs` | admin; full data dump with secrets masked | none |
| POST | `/api/studio/clients` | `index.mjs` | admin; create/update a business (whitelisted fields) | none |
| DELETE | `/api/studio/clients/<id>` | `index.mjs` + `retention.mjs` | admin; erases the client and its data | none |
| GET | `/api/studio/clients/<id>/qr`, `/qr.png`, `/site.zip` | `index.mjs` | admin | none |
| POST | `/api/studio/clients/<id>/(site\|site-upload\|site-chat\|site-undo\|approve\|decline\|cap\|profile\|token\|messages\|messages/seen\|accounts)` | `index.mjs` | admin. `approve`/`decline` drive the approval gate; `token` rotates portal token + code and kills client sessions; `site-upload` accepts a zip up to 80 MB | none |
| POST | `/api/studio/briefs`, `/api/studio/briefs/<id>/archive` | `index.mjs` | admin | none |
| POST/DELETE | `/api/studio/posts/<id>/(again\|retry\|publish\|image\|edit\|share)`, DELETE `/api/studio/posts/<id>` | `index.mjs` | admin | none |
| POST/DELETE | `/api/studio/videos`, `/api/studio/videos/<id>/(again\|retry\|edit\|publish\|share)`, DELETE `/api/studio/videos/<id>` | `index.mjs` | admin | none |
| POST | `/api/studio/settings/offer`, `/api/studio/settings/limits` | `index.mjs` | admin | none |
| GET/POST | `/api/studio/settings/ai`, GET `/api/studio/settings/ai/models`, POST `/api/studio/settings/ai/puter-token` | `index.mjs` | admin; keys are masked in responses and `••••` values are ignored on save | none |
| POST | `/api/studio/settings/images`, `/api/studio/settings/images/check` | `index.mjs` | admin | none |
| any | `/api/studio/loyalty/...` | `loyalty-routes.mjs` `manage()` | admin; may pass `clientId` | `manage` 600/min, `design` 6/10 min |
| any | `/api/studio/bookings/...` | `bookings-routes.mjs` `manage()` | admin; `?clientId=` | `manage` 600/min |
| any | `/api/studio/menu/...` | `menu-routes.mjs` `manage()` | admin; `?clientId=`, `overview` | `manage` 600/min, `photo`, `ai` |
| any | `/api/studio/expenses/...` | `expenses-routes.mjs` `manage()` | admin; `?clientId=` | `manage` 600/min, `scan`, `ask` |

## 4. `server/auth.mjs`

**Admin password.** `hashPassword` uses `scrypt` (random 16-byte salt, 32-byte key), stored as `scrypt$<salt>$<hash>` in `db.settings.admin.hash`; `verifyPassword` compares with `timingSafeEqual`. If `ADMIN_PASSWORD` is set it wins over the stored hash (compared via SHA-256 digests with `timingSafeEqual`), and the password cannot be changed from the UI. Minimum length 8 (enforced in `index.mjs`).

**Admin session.** `startSession` creates 32 random bytes, stores only the SHA-256 in `db.settings.admin.sessions` (max 20, expired ones pruned) and sets cookie `isla_admin`: `HttpOnly; SameSite=Lax; Path=/; Max-Age=30 days`, plus `Secure` when `PUBLIC_URL` is https (if `PUBLIC_URL` is unset, falls back to trusting `X-Forwarded-Proto`). `setPassword` wipes all sessions. Logout removes the session and expires the cookie.

**`isAdmin(req)`** is true when any of:
- `X-Admin-Token` header matches `ADMIN_TOKEN` (timing-safe), or
- a valid, unexpired session cookie, or
- non-production only: no password and no token configured at all (open first run for dev and tests).

In production with nothing configured, nobody is admin until the first password is created.

**First-run password.** `firstRunAllowed`: anywhere in dev; in production only from a loopback socket **and** with no `X-Real-IP`/`X-Forwarded-For` header (a proxied request always has one). Otherwise 403 "set it from the server itself or with ADMIN_PASSWORD".

**Client access codes.** `newCode` makes 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), shown as `XXX-XXX`, unique across businesses, generated with `crypto.randomInt`. `findByCode` normalizes (uppercase, strips non-alphanumerics) and needs exactly 6. Rotating the portal token (`/clients/<id>/token`) also rotates the code and clears client sessions.

**Per-IP limiters.** `limiter(max, windowMs)` keeps timestamps per key, prunes on a timer and when the map grows, and caps at 20,000 keys. Methods: `blocked`, `fail` (record), `hit` (check + record), `clear`. Used both as failure counters (login, codes, bad tokens) and as plain request counters (`hit` helpers in the route modules). Code guessing is throttled three ways: per IP, across all IPs, and per 3-character prefix; a correct code does not reset the failure budget.

**Client IP and `X-Real-IP` trust** (`clientIp` in `index.mjs`). If the TCP peer is loopback (`127.*`, `::1`, `::ffff:127.*`), the IP is the first value of `X-Real-IP`, else `X-Forwarded-For`; otherwise it is the socket address and those headers are ignored. In production the server binds to `127.0.0.1` unless `HOST` is set, so only the reverse proxy can reach it. **The proxy must overwrite `X-Real-IP`, never append**, or a client can pick its own rate-limit bucket. Never expose the Node port directly while this trust rule is in place.

### Tenancy checks

- The tenant is resolved from the path token (`db.clients.find(x => x.token === seg[2])`), never from the request body. Portal handlers pass `scope.clientId` / `scopeClient`; owner mode takes `clientId` from the body/query.
- Sub-resources are re-checked against that tenant: loyalty `mine(programId)` (`p.clientId === scope.clientId`), bookings `mineBooking`, expenses `x.clientId === c.id`, posts `again` (`x.clientId === c.id`), message attachments only from `c.uploads`.
- `addBrief` validates a client-supplied `imageFile` with `safeMediaFile` (plain image name inside `MEDIA_DIR`, else 400).
- Tests: `tenancy.security.test.mjs`, `security-core.test.mjs`.

### Approval gate (pending and declined)

State is `client.approval.status`: `pending` (every new sign-up), `approved`, `declined`; missing means `approved` (legacy). Helpers in `limits.mjs` (`approval`, `isApproved`, `blockReason`).

- **Declined** (`declined.mjs`, `declinedClientFor(seg)`): runs early in `route()` and maps the path to a business for portal, booking (code and manage token), menu, loyalty join/staff/card/logo, `/sites/<slug>`, `/p/<shareKey>`, and the matching `/api/...` forms. Declined: APIs get 403 JSON `{code:"declined", declinedUrl}`, pages get the 403 declined screen (ES/EN, contact email from `LEGAL_EMAIL`). `POST /api/client-login` also returns the declined body, and `/login` redirects declined sessions. Because the check happens before the `handle*` modules, they never see declined businesses (their header comments say so).
- **Pending** (`blockReason`, 403 `pending`): portal `briefs`, `videos`, `posts/<id>/again`, `messages`, `upload` are refused; scheduler and assistant skip it (`studio.mjs`, `video.mjs`, `assistant.mjs`); website is not built until approval (`saveProfile` rebuilds only if approved); booking emails are not sent (`index.mjs` booking hook and `booking-mail.mjs`). The weekly cap (`cap`, 429) applies on top of approval. **Loyalty issuance is also refused** (`canIssue` in `loyalty-routes.mjs`): the join page and `POST /api/loyalty/join/<code>` answer exactly like an unknown link (404, no state leak, no card created), and the staff page/lookup/find/enrol/stamp answer 404/403. A customer who already holds a card keeps it — `/card/<token>` and `GET /api/loyalty/card/<token>` are deliberately not gated, because the card is the customer's, not the shop's.
- **Approve** (`POST /api/studio/clients/<id>/approve`): sets approved, starts the site build and a first post. Owner-created posts (`reason: "owner"`) never count toward the cap or get blocked.
- Gap still open: public booking creation is not blocked while pending (only the emails are).

## 5. CSRF, CSP and security headers

**CSRF.** There are no CSRF tokens or Origin checks. Protection rests on:
- the admin and client cookies are `SameSite=Lax` (not sent on cross-site POST/PUT/PATCH/DELETE);
- every state change uses POST/PUT/PATCH/DELETE (GET handlers do not mutate, except card/booking view pages that only touch counters or `save()`);
- `X-Admin-Token` is a custom header, so browsers force a CORS preflight and the server sends no CORS headers (only `/media/*` sends `Access-Control-Allow-Origin: *`, on read-only files);
- portal and link tokens are bearer secrets in the URL, not cookies.

Weak spot: `readBody` ignores `Content-Type`, so rely on SameSite, not on "it must be JSON". Do not add any cookie-authenticated GET that changes state, and do not weaken `SameSite`.

**Headers** (`securityHeaders` in `index.mjs`), all responses: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- `/sites/*` (AI-generated client websites): `X-Frame-Options: SAMEORIGIN` and a CSP with `sandbox allow-scripts allow-forms allow-popups` (opaque origin, so site scripts cannot read the owner cookie), `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`, `default-src 'self' https:`, `img-src 'self' https: data:`, `frame-src https:`.
- `/media/*`: `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy: default-src 'none'; sandbox` (uploads can never run as a page).
- everything else: `X-Frame-Options: DENY`. No CSP on app pages (they use inline scripts).
- Loyalty, booking and menu HTML pages add `Cache-Control: no-store` and `Referrer-Policy: no-referrer` (so link tokens do not leak). The Puter callback page also uses `no-referrer`.
- HSTS, `Permissions-Policy` and size limits are not set by Node; they come from `deploy/nginx.conf.example`, which also sets per-route request and size limits.

## 6. Checklist: adding a new route safely

1. **Pick the class** (public / tenant / admin) and put the route in the right place. Order in `route()` matters: new client-facing paths must come after the declined gate; a new module goes next to the other `handle*` calls.
2. **Admin**: first statement must be `if (!ctx.isAdmin(req)) return 401`. Put it under `/api/studio/` so it is covered by the existing guard and grouped with the others.
3. **Tenant**: resolve the business only from the path token. Never read `clientId` from body/query in portal mode. Re-check ownership of every id (`x.clientId === c.id`) and return 404, not 403, for other tenants' objects.
4. **Declined gate**: if the path carries a new kind of link token or code, add it to `declinedClientFor` in `declined.mjs` (both the `/api/...` form and the page form) and add a test in `declined.test.mjs`.
5. **Pending/cap**: if the route creates content, sends messages, or costs AI/credits, call `blockReason(c)` (see portal `briefs`) and let pending businesses see but not act.
6. **Rate limit**: use `limiter` from `auth.mjs`. Count failures for secret guessing (bad token/code), count every hit for expensive or write endpoints (AI, uploads, creation). Key by `clientIp(req)` (never read `X-Real-IP` yourself). Add per-business daily caps for anything a tenant can spam.
7. **Body**: call `readBody(req, limit)` with the smallest limit that works; validate types, slice strings, whitelist fields (see `CLIENT_FIELDS`). Uploads: check magic bytes and pixel caps (`assertSafeImage` in `images.mjs`), never trust `Content-Type`; file names from clients go through `safeMediaFile`.
8. **Methods**: only mutate on POST/PUT/PATCH/DELETE. Never make a cookie-authenticated GET change state.
9. **Responses**: mask secrets (see `aiSettingsView`), do not echo upstream error bodies or paths, let `.status` errors carry user-safe messages and let 5xx fall through to the generic message. Public HTML pages: escape output and send `Cache-Control: no-store` plus `Referrer-Policy: no-referrer` when the URL contains a token.
10. **Tokens**: generate with `crypto` (`token()`, `randomBytes`, `randomInt`), compare secrets with `timingSafeEqual`, store session secrets only as hashes.
11. **Robots/privacy**: tokenised pages are covered by `Disallow` for `/portal/` in `robots.txt`; add new private prefixes there, and update `docs/privacy/` if you store new personal data.
12. **Tests**: add the route to the relevant suite (`tenancy.security.test.mjs`, `security-core.test.mjs`, `declined.test.mjs`, or the module's own test); tests that spawn a server use `test-harness.mjs` (blanked provider keys).
13. **Docs and proxy**: add a row to the table above; if the path needs a stricter proxy limit or body size, update `deploy/nginx.conf.example`.

## 7. Open points worth checking

- `deploy/nginx.conf.example` rate-limits `= /api/login`, but the app's admin login is `/api/auth/login`; that path currently falls into the general `/api/` limit. Confirm the intended path.
- Loyalty/booking behaviour for **pending** businesses differs from the comment in `index.mjs` (see "Gap" in section 4).
- `POST /api/ai` and `/api/auth/password` have no app-level limiter (admin only).
