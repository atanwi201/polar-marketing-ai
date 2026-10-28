# Data model

Everything the server owns lives in one JSON document, `data/studio.json`, loaded into the in-memory object `db` (`server/store.mjs`) at boot, plus files under `data/` and `sites/`. This page describes what is stored, who reads and writes it, how tenants are isolated, and how data is removed. See [architecture.md](architecture.md) for the code layout. Field lists are derived from the code that creates the records, not from a schema file (there is none), so optional fields may be missing on old records.

## 1. On-disk layout

Paths are relative to the install directory. `DATA_DIR` defaults to `data/` (override with the `DATA_DIR` env var); `SITES_DIR` defaults to `sites/`.

| Path | Content | Written by |
|---|---|---|
| `data/studio.json` | The whole database (section 2). Mode 0600. | `store.mjs: save()` |
| `data/studio.json.bak` | The previous good copy (copied just before each overwrite). | `store.mjs` |
| `data/studio.json.corrupt-<ts>` | A main file that failed to parse at boot and was set aside. | `store.mjs` |
| `data/media/` | All uploaded and generated media, flat (section 7). Dir mode 0700. | `studio`, `video`, `assistant`, `profile`, `loyalty-design`, `index.mjs saveUpload` |
| `data/media/menu/` | Menu item photos, `<clientId>_<id>.jpg`. | `menu.mjs savePhoto` |
| `data/receipts/` | Receipt photos of the expenses, `exp-<expenseId>.jpg`. Not public: `data/media` is served to anyone who knows the name, and a receipt is the business's money, so these are only readable through the expenses API (the owner, or the business that owns the expense). | `expenses.mjs saveReceipt` |
| `data/site-src/<slug>/` | Page sources for the website chat: `<lang>.html`, `assets.json`, `versions/<ts>/<lang>.html`. | `aisite.mjs`, `siteedit.mjs` |
| `data/erasure-audit.log` | One JSON line per erased client, no personal data (mode 0600). | `retention.mjs` |
| `sites/<slug>/` | Published static site, `<lang>/index.html`, `images/`, `sitemap.xml`, `robots.txt`, `site.json`. | `sitebuilder.mjs` |
| `sites/.<slug>.building`, `.previous`, `.uploading`, `.old-<pid>` | Transient work folders and the one-level backup of an uploaded replacement. Never served (dot-folders are refused). | `sitebuilder.mjs` |

Not in the data folder: `.env` (secrets and config) and Apple/Google Wallet certificates (paths come from env). They are outside this document by design.

## 2. `studio.json` shape

Top level (`store.mjs: empty()` plus lazily created sections):

```
{
  clients:  [ Client ],                 // always present
  briefs:   [ Brief ],
  posts:    [ Post ],
  videos:   [ Video ],
  messages: [ Message ],                // portal chat
  settings: { admin, ai, images, offer, limits },     // created on first use
  loyalty:  { programs, customers, txns, devices, templates, uploads },
  bookings: { configs, items },
  expenses: { configs, items },
  menu:     { configs }
}
```

Section roots are created lazily by accessors (`ldb()`, `bdb()`, `edb()`, `mdb()`), so a database from before a feature existed simply lacks the key. `id()` is `Date.now().toString(36)` plus 6 random hex chars; `token()` is 12 random bytes in base64url (`store.mjs`). Dates are ISO strings except bookings (`YYYY-MM-DD`, `HH:MM`) and expense dates (`YYYY-MM-DD`).

### 2.1 `clients[]` (a business; the tenant)

Created by `POST /api/signup` (`index.mjs`, status `pending`) or by the owner (`POST /api/studio/clients`). The owner can edit only the whitelist `CLIENT_FIELDS` in `index.mjs`.

| Group | Fields |
|---|---|
| Identity and access | `id`, `token` (portal URL secret), `code` (`ABC-DEF` access code), `createdAt`, `source` (`signup`/`owner`), `sessions[]` (`{h: sha256 of cookie secret, exp}`, max 10) |
| Contact and offer | `name`, `kind`, `town`, `phone`, `email`, `domain`, `offer`, `hours`, `tone`, `languages[]`, `exampleUrls[]` |
| Approval and plan | `approval: {status: pending/approved/declined, at}` (missing = approved), `plan` (`basic`/`pro`/`""`), `customPrice`, `postCap` (weekly override) |
| Autopilot | `autopilot`, `postsPerWeek`, `videosPerWeek`, `videoSeconds`, `videoVoice`, `autoPublish`, `platforms[]`, `webhookUrl`, `imageSize`, `aiProvider` |
| Website | `websiteMode` (`ai`/`own`), `websiteUrl`, `siteSlug`, `site` (status `building/waiting/ready/failed`, `step`, `url`, `kind` `ai/upload`, `design`, `direction`, `builtAt`, `attempts`, `nextTryAt`, `error`), `siteChat[]` (last 60), `siteEdit`, `siteVersions`, `profileSaves[]` |
| Brand | `profile` (tagline, story, services, social links, colours, style, ...), `logoFile`, `photos[]` (`{file, ...}`, max 12) |
| Publishing | `accounts: {facebook, instagram, x, youtube}` with access tokens in plain text (masked by `maskAccounts` before leaving the server) |
| Portal state | `uploads[]` (files this business uploaded, last 200), `marketingConsent` (`false` or `{at, source}`), `gbp` (`{mode: "manual"|"api", status: not_started/created/verification_pending/verified, notes, kit, auth?, updatedAt}`, see `gbp-kit.mjs` and `gbp-auth.mjs`) |
| Google connection | `gbp.auth = {enc, connectedAt, updatedAt, expiresAt, scope, lastError}`: one AES-256-GCM blob (access + refresh token, key `TOKEN_ENC_KEY`, AAD = client id). Nothing decrypts it outside `gbp-auth.mjs`; no route returns it. `mode` flips to `"api"` while connected, back to `"manual"` on disconnect or a dead grant (`lastError: "reconnect"`). |
| Google profile (G6) | `gbp.google = {account, location, title, address, phone, website, status, verification, linkedAt, updatedAt}`. `status` is `not_linked` / `linked` / `verification_pending` / `verified`; `verification` is `{method, name, state, startedAt, completedAt}` from `verifications.verify`. Additive: old clients get an empty block on first use. `location` is a Google resource name (`locations/*`), never a place id. |

Business-wide feature configs (loyalty, bookings, expenses, menu) are stored in their own sections, keyed by `clientId`, not inside the client.

### 2.2 Content

| Collection | Key fields | Notes |
|---|---|---|
| `briefs[]` | `id`, `clientId`, `text`, `imageFile`, `imageDescription`, `archived`, `createdAt` | What a business wants marketed; autopilot cycles through non-archived briefs. |
| `posts[]` | `id`, `clientId`, `briefId`, `status` (`generating/waiting/ready/published/failed`), `reason` (`brief/autopilot/signup/owner/again/...`), `captions{lang}`, `short{lang}`, `hashtags`, `cta`, `concept`, `imagePrompt`, `altText`, `imageFile`, `imageEngine`, `kind`, `shareKey`, `attempts`, `nextTryAt`, `publishedAt`, `publishNote`, `model`, `error` | `shareKey` is the public `/p/<key>` token. Posts with `reason: "owner"` do not count toward the weekly cap. |
| `videos[]` | `id`, `clientId`, `briefId`, `text`, `seconds`, `langs`, `voice`, `status`, `step`, `progress`, `scenes[]` (`text{lang}`, `imageFile`), `renders{lang: {file, cover, duration, size}}`, `captions`, `title`, `description`, `hashtags`, `shareKey`, `reason`, `publishedAt` | Media file names are collected for deletion by `videoFiles()` in `index.mjs`. |
| `messages[]` | `id`, `clientId`, `role` (`client/assistant/owner`), `text`, `attachments[{file,kind,duration}]`, `status` (`thinking/...`), `replyTo`, `needsOwner`, `seenByOwner`, `postId`, `videoId`, `lang`, `createdAt` | The portal shows the last 80 per business (`portalMessages`). |

### 2.3 `settings`

| Key | Content | Sensitivity |
|---|---|---|
| `admin` | `{hash: "scrypt$salt$hash", sessions: [{h, exp}]}` (last 20 sessions; cookie secret is stored only as a hash) | secret |
| `ai` | Provider API keys saved from the dashboard (field names from `providerList()`), `puterKey`, `puter{imageModel,voiceProvider,voice}`, `models{}`, `order` | secret, plain text |
| `images` | `provider`, `googleKey`, `pexelsKey`, models, `fallback` | secret, plain text |
| `offer` | Public copy of Plans & prices (`cleanOffer`) used by the landing page | public |
| `limits` | `{postsPerWeek}` default weekly cap | - |

Keys are never returned in full by the API (`aiSettingsView`/`imageSettingsView` mask to the last 4 characters). Keys can also come from env; the env value is used when the DB has none.

### 2.4 `loyalty` (`loyalty.mjs`, routes in `loyalty-routes.mjs`)

| Array | Record |
|---|---|
| `programs[]` | `id`, `clientId`, `name`, `type` (`stamps/points/custom`), `status` (`draft/live/paused`), `joinCode`, `staffToken`, `staffTokenExpiresAt` (default 365 days, `LOYALTY_STAFF_TOKEN_DAYS`), `design` (palette, font, layout, `stripFile`, `backgroundFile`), `stamps{goal,perVisit,minSpendEur}`, `points{perEuro,perVisit}`, `tiers[]`, `rewards[]`, `pointsExpireDays`, `terms`, `welcomeBonus`, `consentBonus` (0-10 stamps or points granted once per person per shop when the customer opts in; 0 = off) |
| `customers[]` | `id`, `programId`, `clientId`, `cardToken` (web card URL secret), `authToken` (Apple Wallet auth), `name`, `email`, `phone`, `memberId` (optional: set on cards created from a phone or claimed with one; old cards never get one until claimed), `aliases[]` (card tokens absorbed by an owner merge; the old card URL keeps working), `oldIds[]` (ids of merged cards, so an already-printed `LC1-` QR still resolves to the survivor), `stamps`, `points`, `lifetimePoints`, `visits`, `tier`, `lastVisitAt`, `redemptions[]`, `marketingConsent` (boolean; mirrors **email** consent for old readers), `consentBonusAt` (set once, so withdrawing and re-consenting never pays twice). A merge sums the balances, moves `txns`/`devices`/`consents` to the survivor, keeps the earliest `createdAt`, and removes the absorbed row. |
| `consents[]` | Append-only marketing-consent proof (Part C): `id`, `memberId`, `customerId` (the card open when it was given), `clientId`, `programId`, `channel` (`whatsapp`/`email`), `textId` (channel + language + `2026-10-v1`), `textShown` (the exact sentence), `granted`, `at`, `ipHash`/`uaHash` (SHA-256, first 32 hex chars), `source` (`card`/`link`/`declined`), `unsubToken` (random 24 bytes; empty on withdrawals). Never rewritten: a withdrawal is a new row with `granted: false`, and the latest row per (member, shop, channel) wins. Removed only when the person is erased. |
| `members[]` | A person, not a card: `id`, `phone` (E.164 only, the identity key), `phoneVerifiedAt` (empty until an OTP confirms it), `name`, `memberToken` (long-lived device secret), `createdAt`, `updatedAt`, `lastSeenAt`, `locale` (`es/en`). One member holds one `customers[]` card per programme. `findOrCreateMember` never creates a second member for the same normalised number; `cardForMember` is idempotent per (member, programme). |
| `recoveries[]` | A short-lived proof request (plan A.4): `id`, `secretHash` (SHA-256 of the cookie value; the secret itself is never stored), `memberId`, `clientId`, `programId`, `phone`, `state` (`pending/confirmed/expired`), `method` (`sms/staff`, what it is waiting on), `createdAt`, `expiresAt` (15 min), `confirmedAt`, `confirmedBy`. Never holds a code; OTPs live hashed in memory in `otp.mjs` and die with the process. Pruned 24 h after expiry and removed with the member, their shop or the inactivity purge. |
| `txns[]` | `id`, `programId`, `customerId`, `clientId`, `at`, `type`, `stamps`, `points`, `amountEur`, `note`, `by` (`staff/owner/portal/system`) |
| `devices[]` | Apple Wallet registrations `{deviceId, pushToken, serial (= customer id), passTypeId, at}` |
| `templates[]` | Reusable card designs (`clientId` empty = owner-wide) |
| `uploads{}` | `file -> clientId` (owner = `""`): who uploaded each card picture, used for ownership checks |

Every card change calls `notify()`, which `index.mjs` wires to Apple and Google Wallet pushes. Stamps are rate-limited per customer (`STAMP_GAP_MS`, 10 minutes).

### 2.5 `bookings` (`bookings.mjs`)

- `configs[]`, one per business: `clientId`, `kind` (`table/room`), `enabled`, `code` (7 chars, public `/book/<code>`), `timezone`, `langs`, `autoConfirm`, `advanceDays`, `notice`, `closedDates`, `table{week,seats,slotMinutes,durationMinutes,minParty,maxParty,minNoticeMinutes}`, `room{roomTypes,minNights,maxNights,checkIn,checkOut}`.
- `items[]`: `id`, `clientId`, `kind`, `status` (`pending/confirmed/cancelled/no_show/completed`), customer `name`, `email`, `phone`, `lang`, `notes`, `source`, `manageToken` (customer's cancel link), `history[]`, either `date/time/party` or `checkIn/checkOut/guests/roomTypeId/roomName/nights`, and `mail[]` (an email log `{at, event, to, state}` that includes the recipient address; `booking-mail.mjs`).

### 2.6 `expenses` (`expenses.mjs`)

- `configs[]`: `clientId`, `enabled` (only the owner can switch it), `currency`, `locations[{id,name}]`.
- `items[]`: `id`, `clientId`, `date`, `locationId`, `store`, `category`, `totalCents`, `taxCents`, `taxRate` (0.07 IGIC / 0.21 IVA / 0), `taxIncluded`, `items[]`, `notes`, `source` (`manual/scan`), `photoFile` (the receipt photo, see `data/receipts/`), timestamps.
- **The total is never typed when there are items**: it is the items plus the tax (`totalCents = items + taxCents`), the same way a Spanish receipt adds the IGIC to the base prices. With no items (a whole rent) the amount is typed. The tax is the rate on the net sum, or the exact amount a receipt prints.
- The receipt photo of a scanned ticket is kept with the expense (in `data/receipts/`), so the business can show the original ticket again and the owner can check it. It is only reachable through the expenses API, never through the public media folder.

### 2.7 `menu` (`menu.mjs`)

- `configs[]`: `clientId`, `enabled`, `code` (8 chars, public `/menu/<code>`), `languages` (es/en/de/fr), `currency`, `categories[]` -> `items[]` (`name{lang}`, `description{lang}`, `priceCents`, `allergens[]` from the 14 EU allergens, `photo` `/menu/img/<file>`, `available`). Caps: 30 categories, 200 items per category.

## 3. How modules read and write it

All modules mutate `db` in place (it is a plain object shared by import) and then call `save()`. Typical pattern: validate input into a clean record, push/assign it, `await save()` (or `void save()` for background work). Rules of thumb from the code:

| Module | Reads | Writes |
|---|---|---|
| `index.mjs` | everything | `clients` (sign-up, owner edits, approve/decline, token rotation), `briefs`, `settings.*`, client sessions |
| `auth.mjs` | `settings.admin` | session list and password hash (via the `save` it is given) |
| `limits.mjs` | `clients`, `posts`, `videos`, `settings.limits` | nothing (pure) |
| `studio.mjs` | `clients`, `briefs`, `posts` | `posts` (generation, retries, publish status), media files |
| `video.mjs` | `clients`, `briefs`, `videos` | `videos`, media files |
| `assistant.mjs` | `messages`, `clients` | `messages`, `posts`, `videos`, `client.profile`, media files |
| `profile.mjs` | `client.profile` | `client.profile`, `logoFile`, `photos`, media files |
| `sitebuilder.mjs`, `siteedit.mjs`, `aisite.mjs` | `clients`, profile | `client.site*`, `sites/`, `data/site-src/` |
| `loyalty*.mjs`, `wallet.mjs`, `gwallet.mjs` | `db.loyalty`, `clients` | `db.loyalty.*` |
| `bookings*.mjs`, `booking-mail.mjs` | `db.bookings`, `clients` | `db.bookings.*` (including the `mail` log) |
| `expenses*.mjs` | `db.expenses`, `clients` | `db.expenses.*` |
| `menu*.mjs` | `db.menu`, `clients` | `db.menu.*`, `data/media/menu/` |
| `retention.mjs` | all sections | removes data (section 9) |
| `declined.mjs`, `bookings-links.mjs`, `menu-links.mjs`, `ownsite.mjs` | `db` | read-only (links/sites are edited on disk, not in `db`) |

## 4. Durability (`server/store.mjs`)

- **Atomic write** (`writeOnce`): serialise `db` to `studio.json.<pid>.<rand>.tmp` (mode 0600), `fsync` the file, copy the existing `studio.json` to `studio.json.bak`, `rename` the temp over `studio.json`, then `fsync` the directory. A failed rename leaves `*.failed` and rejects.
- **Serialised and coalescing** (`save()` / `pump()`): one write at a time; callers that arrive during a write share the next one, and a burst of synchronous `save()` calls shares a single write (`setImmediate`). `save()` resolves once a write that started after the call is on disk and rejects on failure. Fire-and-forget callers (`void save()`) get the error logged and counted in `saveStatus` (`ok`, `failed`, `lastError`, ...), never an unhandled rejection.
- **Locking scope**: this is in-process serialisation only. There is no file lock, so two server processes on the same `data/` would overwrite each other. Run one instance.
- **Boot recovery** (`loadDb`): missing main file -> use `.bak`; unparseable main file -> rename it to `.corrupt-<ts>`, use `.bak`; both bad -> refuse to start with an explicit error (never silently start empty). A valid main file is merged over `empty()` so new top-level arrays exist.
- **Permissions**: `DATA_DIR`, `media/` tightened to 0700 and `studio.json`/`.bak` to 0600 at boot if loose (only when owned by the current user).
- **Backups** (`scripts/backup.sh`, restore with `scripts/restore.sh`): rsync of `data/`, `sites/` and `.env` to the operator's machine, `studio.json` re-fetched last via a temp name, parse-checked before the snapshot is kept; optional `age`/`gpg` encryption (plaintext is never sent off-site); keeps the newest N snapshots. Releases (`scripts/deploy.sh`) never touch `data/` or `sites/`. Covered by `server/store.durability.test.mjs`.
- **Not durable by design**: the dashboard's CRM collections (section 8) and in-memory rate limiters (reset on restart).

## 5. Tenancy: how data is isolated per business

The tenant is a `clients[]` record; every tenant-owned record carries `clientId`. There is no database-level enforcement: isolation is by access path.

| Actor | Credential | What it can reach |
|---|---|---|
| Owner | Session cookie or `x-admin-token` (`auth.isAdmin`) | Everything, under `/api/studio/*`; owner endpoints take `clientId` in the body/query. |
| Business (portal) | Portal token in the URL (`/api/portal/<token>/...`), looked up with `db.clients.find(x => x.token === t)`; `/login` code -> 90-day cookie that redirects to the same portal | Only that business. Handlers derive the scope from the token and ignore any `clientId` the caller sends. |
| Customer (loyalty) | `cardToken` in `/card/<token>` | Their own card and transactions. |
| Staff (loyalty) | `staffToken` of one programme, with expiry; lookups verify `f.program.id === program.id` | That programme only. |
| Customer (booking) | `manageToken` in `/booking/<token>` | View/cancel that one booking. |
| Public visitor | Join code, booking code, menu code, `shareKey` | Public views of one programme / booking form / menu / post. |

Mechanisms in code:

- **Scoped `manage()` handlers** (`loyalty-routes.mjs`, `bookings-routes.mjs`, `expenses-routes.mjs`, `menu-routes.mjs`): the portal path passes the token's business id as scope; owner passes `null`. Records are fetched with an ownership check (for loyalty: `mine(pid)` requires `p.clientId === scope.clientId` unless owner). A foreign id answers 404.
- **Portal handlers in `index.mjs`**: posts/videos/briefs are always filtered by `clientId`; message attachments must be in the business's own `c.uploads` list; "make another version" looks up the post with `x.clientId === c.id`.
- **Feature switch**: expenses and menu answer "off" to the portal until the owner enables them for that business.
- **Approval and caps** (`limits.mjs`): pending/declined businesses cannot create posts, videos, messages or loyalty cards; a declined business is cut off from every route (`declinedClientFor`), with a 403 page or JSON.
- **Media ownership**: menu photos are named `<clientId>_<id>.jpg` and `photoOwnedBy()` lets a tenant reference or delete only its own files (shared legacy files are kept while another menu uses them). Loyalty designs may point only at pictures the business uploaded (`l.uploads`), its own `loy-<programId>-` files, its logo/photos, or files already in the design (`loyalty.mjs`, comment at line 82). Client-supplied media names pass `safeMediaFile()` (plain image file in `MEDIA_DIR`, no separators). Tested in `server/tenancy.security.test.mjs`.
- **Secrets never cross tenants**: the portal's `publicClient()`/`profileView()` return a reduced view (no accounts, tokens, sessions); the public loyalty join page strips `staffToken`; the owner view masks social tokens.
- **Rotation**: `POST /api/studio/clients/<id>/token` replaces `token` and `code` and clears `sessions`; staff tokens rotate with `rotateStaffToken`.
- **Brute-force limits**: per-IP and global limiters on access codes, card/staff tokens, booking manage tokens, sign-ups and portal hits.

Known limits of this model: `/media/<file>` is served without authentication to anyone who knows the file name (names embed a time-based id and are not secret; `Access-Control-Allow-Origin: *`, immutable cache). Treat uploaded photos and videos as publicly retrievable by URL. Portal and card tokens are bearer secrets in URLs.

## 6. Generated sites and `site-src`

- `client.siteSlug` is derived by `sitebuilder.siteSlug()` and is the only key linking a client to `sites/<slug>/` and `data/site-src/<slug>/`. `retention.eraseClient` accepts it only if it matches `^[a-z0-9][a-z0-9-]{0,80}$` and resolves strictly inside the target folder (`rmInside`), and only deletes it if no other client uses the same slug.
- `sites/<slug>/` is publicly served; it holds the sanitized pages and the optimised images the build copied in (`images/<id>-<frame>.jpg`), not references into `data/media/`.
- `data/site-src/<slug>/` is private (not served): the model's page bodies per language, the asset plan, and up to a few undo versions. It is the input for the website chat and is deleted on erasure.
- For `websiteMode: "own"` nothing is built; only `websiteUrl` is stored.

## 7. Media files (`data/media/`)

One flat folder, served at `/media/<name>`. Naming by producer:

| Pattern | Producer |
|---|---|
| `up-<id>.<ext>` | Uploads from the sign-up/portal/chat (`index.mjs saveUpload`, `assistant.receiveUpload`); `<name>.frame.jpg` for video frames |
| `<postId>-<time>.jpg` | Post images (`studio.mjs`) |
| `<videoId>-s<n>.jpg`, `<videoId>-<lang>-<time>.mp4` (+ cover) | Video scenes and renders (`video.mjs`, `assistant.runClip`) |
| `<prefix>-<id>.<ext>` | Business logo and photos (`profile.mjs`) |
| `loy-<programId>-strip-/bg-...png` | AI loyalty card pictures (`loyalty-design.mjs`) |
| `menu/<clientId>_<id>.jpg` | Menu photos (separate subfolder, served by the menu routes at `/menu/img/...`) |

References live in `db` as bare file names (`imageFile`, `logoFile`, `photos[].file`, `renders.*.file/cover`, `scenes[].imageFile`, `attachments[].file`, `design.stripFile/backgroundFile`). Deletion is by name, and a file is removed only if no other record still references it (see section 9). Limits: images 6 MB for data-URL uploads, 12 MB for chat photos, videos up to 250 MB.

## 8. Dashboard-side data (not in `studio.json`)

The owner dashboard keeps its CRM-style records in the browser, not on the server (`src/core/store.ts`): on claude.ai it uses the artifact's shared db, anywhere else `localStorage` under keys `isla:<collection>`. Collections used: `clients` (the CRM view of businesses, with `studioId` linking to the server record), `tasks`, `invoices`, `visits`, `reports`, `settings` (including the `offer` record for Plans & prices). Consequences:

- Billing, invoices, visits, tasks and reports are **not** covered by `scripts/backup.sh` or by erasure; they exist only in the owner's browser profile (or the artifact db). The Settings screen offers a backup/restore for them.
- The server sees only: the full studio state (`GET /api/studio`, pulled by `studio-sync.ts` to create CRM entries for new sign-ups) and the public part of Plans & prices, pushed to `POST /api/studio/settings/offer` (stored as `settings.offer`).
- The owner token (if used) is kept in `localStorage` key `isla:adminToken` and sent as `x-admin-token`.

## 9. Retention and erasure (`server/retention.mjs`)

**Erasure, `eraseClient(clientId)`** is the only wired path (`DELETE /api/studio/clients/<id>`, owner only). It removes, in order:

1. The client and its `briefs`, `posts`, `videos`, `messages`.
2. Bookings and expenses (`removeClientData`), the menu (config and photos, `menu.removeClientData`), and all loyalty data: programmes (with staff tokens), customers, transactions, Apple Wallet device registrations, templates, card pictures (`loyalty.removeClientData`).
3. Media files referenced by the client's records (keys ending in `file`/`cover`/`image`, video scene/render files, chat attachment frames), skipping any file name still present anywhere else in `db`.
4. `sites/<slug>` plus its `.building/.previous/.uploading` folders and `data/site-src/<slug>`.
5. One audit line in `data/erasure-audit.log` (`at`, `event`, `clientId`, counts; no personal data).

Not erased: the dashboard's browser-side CRM/billing records (section 8), copies in backups (`scripts/backup.sh` snapshots keep until rotated), and nginx/application logs.

**Retention purge, `purgeExpired(opts)`** exists but is **not scheduled or called by the server** (only `server/erasure.test.mjs` uses it). If wired up, it would use env-driven limits in days (`retentionFromEnv`; 0/unset = off):

| Env | Effect |
|---|---|
| `RETENTION_DECLINED_DAYS` | Erase clients declined longer ago than N days (full `eraseClient`) |
| `RETENTION_BOOKING_DAYS` | Delete bookings whose last day (`checkOut` or `date`) is older than N days |
| `RETENTION_LOYALTY_INACTIVE_DAYS` | Delete loyalty customers with no activity for N days, with their transactions and wallet registrations |

`dryRun` only counts. Other retention that does run today: loyalty points expiry per programme (`pointsExpireDays`), client sessions and owner sessions expire by timestamp and are pruned on the next login, and `eraseClient` on request. The retention schedule and legal basis are in `docs/privacy/retention.md` (proposals; some statements there predate the loyalty/bookings/menu/expense erasure that now exists in code).

**Personal data inventory in `studio.json`** (for requests and reviews): business contact data and social tokens (`clients`), end-customer name/email/phone in `loyalty.customers` and `bookings.items` (plus recipient addresses in `bookings.items[].mail`), chat content and uploads (`messages`, `media`), and the owner's secrets in `settings`. Secrets are stored in plain text in `studio.json` (not encrypted at rest); protect the file (0600 is enforced) and backups (use encryption).
