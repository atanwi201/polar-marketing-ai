# Plan: Google Business Profile + phone-based loyalty + marketing consent

Status: PLAN ONLY. Nothing here is implemented. Written 2026-10-21 for cheaper agents to execute task by task.
Owner of decisions: ATD. Items marked **[ATD]** need ATD's hands (accounts, keys, approvals, legal choices).

## Rules every task inherits (from CLAUDE.md and docs/)
- No deploy, no ssh, no `push-env` without ATD's go-ahead in conversation. Agents only commit to a branch / `main` as ATD directs; `npm test` and `npm run typecheck` green before any commit touching `server/` or `src/`.
- **No downtime, no data loss:** every data change is additive and lazy (new fields, new arrays via accessors like `ldb()`), old code must keep working with new data, so `scripts/rollback.sh` stays safe. No hand edits of `data/studio.json`. Take a backup (`scripts/backup.sh`) before any migration runs in production.
- New routes need an access class, a rate limit and a test (`docs/routes-and-auth.md`; update that table in the same task). Keep tenant isolation, CSP, sanitizer. No new dependencies or CDN scripts without asking ATD (so: no `libphonenumber` unless ATD approves, see L1).
- UI: `docs/design-system.md` (tokens, Figtree/Bricolage, Lucide, light/dark). Strings in ES and EN, ES default. EUR, IGIC 7%.
- Never print secrets or customer data in logs, tests or docs. Tests use `node:test` with fake providers, no network.
- Never add `SystemCallFilter=` to the systemd unit.

Size: S = under 2 h, M = half a day, L = a day+. Tags: `[PAR]` can run in parallel with others that share its dependencies; `[SEQ]` must wait for listed dependencies; `[ATD]` needs ATD.

---

# Part A. Loyalty: one card per phone number

## A.0 Current state (read from the code)
- `loyalty.customers[]` is **one record per (programme, join)**: `joinCustomer()` in `server/loyalty.mjs` requires name + email, phone optional (regex only), and does **no dedupe at all** (same email twice = two cards). The card URL secret is `cardToken`, Apple Wallet pass serial is the customer `id`.
- Join: `GET /join/<joinCode>` (`joinPage` in `loyalty-pages.mjs`) then `POST /api/loyalty/join/<joinCode>` (limiter `join` 10/h per IP, which is too tight for a shop sharing wifi at a busy time).
- Staff: `/staff/<staffToken>` scanner reads the customer's QR (`LC1-<customerId>`) with jsQR, or a typed code (`lookupByCode`), then `record()` (10 min stamp gap).
- Consent today: an unticked checkbox, stored as a bare boolean `customers[].marketingConsent`. No timestamp, no text version, no proof.

## A.1 Target behaviour
1. A **member** is a person identified by a phone number in E.164 (`+34612345678`). One member, many **cards** (one per shop programme), all reused across visits and shops.
2. Customer scans the shop's QR (the existing `/join/<code>` link). Outcomes:
   - **Known device** (the browser already holds a member token): the card for this shop is created and shown immediately, zero typing.
   - **New device, new number:** one field (phone) plus optional first name, one button. Card appears at once, then "Add to Apple/Google Wallet" and "Save to home screen". No app, no website to install, no account, no email.
   - **New device, number already registered:** see A.4 (recovery). The shop's card for that number is created/shown only after a cheap proof of ownership (or, in the no-OTP fallback, shown without balances of other shops).
3. Each shop sees only its own card, balances and customers (tenant isolation unchanged). Shops never see which other shops a member uses.
4. Email becomes optional and is no longer asked on the join page.

## A.2 Data model (additive, no rewrite)
New section `loyalty.members[]` (lazy via `ldb()`):

```
member: { id, phone: "+34...", phoneVerifiedAt: "" | iso, name, memberToken (device secret, base64url 18B),
          createdAt, updatedAt, lastSeenAt, locale: "es"|"en" }
```
Changes to `customers[]` (the per-programme card): add `memberId` (optional). Everything else stays, so Apple/Google Wallet, staff scanner, txns and tests keep working unchanged. `cardToken` per card remains the card URL secret; `memberToken` is a second secret that lets the same device get any of its cards.
New `loyalty.consents[]` (append-only, see Part C): `{ id, memberId, clientId, programId, channel, textId, textShown, granted, at, ipHash, uaHash, source }`.
Indexes: build in-memory maps at boot / on first use (`byPhone`, `byMemberToken`); the dataset is small and JSON-backed.
Retention/erasure: extend `removeClientData` and `retention.mjs` so deleting a client removes its cards and consents; a member with no cards left is deleted; erasure by phone (subject access / delete request) is a function `eraseMember(phone)` (task A9).

## A.3 Phone normalisation
- Parse to E.164 with default country `+34`. Accept `612 345 678`, `0034 612345678`, `+34-612-345-678`, `(+34) 612345678`, `+44 7700 900123` (foreign tourists matter in Tenerife: keep other countries), reject letters, too short (<8 digits) or too long (>15 digits per E.164), and numbers starting `+340`/`+3400`.
- Spain specific sanity: after `+34`, national number is 9 digits starting 6/7 (mobile) or 8/9 (landline). Mobiles (6/7) are accepted for all flows; landlines are accepted for card only but flagged `landline` (cannot receive SMS/WhatsApp).
- Implementation: small pure module `server/phone.mjs` (`normalisePhone(raw, {defaultCountry:"ES"}) -> {e164, country, kind} | null`), table-driven for common calling codes (ES, PT, FR, DE, GB, IE, IT, NL, BE, CH, AT, SE, NO, DK, FI, PL, US/CA), generic E.164 length check for the rest. **No new dependency** unless ATD approves `libphonenumber-js` (≈ 145 kB min; would be the most correct choice, ask [ATD]).
- Store the normalised value only; display formatted. Case: a customer typing the same number two ways must map to one member.

## A.4 Verifying the number cheaply (recommendation: tiered, ship tier 0 first)
The risk is not fraud for money; it is (a) typos creating cards that belong to nobody, (b) someone typing another person's number and reading their name / stamping, (c) marketing messages sent to numbers that never consented.

| Tier | What | Cost | Use |
|---|---|---|---|
| 0 (ship first) | No OTP at join. Card is bound to the device by `memberToken` (localStorage + `Secure; HttpOnly; SameSite=Lax` cookie, 2 years) and by the secret `cardToken` URL. A number already registered from another device gets **no information back** except "welcome back, check your messages" and a recovery step (tier 1). | €0 | New numbers |
| 1 (recovery and any marketing) | OTP only when it matters: (i) re-opening an existing number on a new device, (ii) before the first **marketing** message to a number. Provider behind an interface `otp.send(phone)/verify(phone, code)`; first adapter: a pay-per-use SMS provider (ATD chooses; Spain SMS is roughly €0.04-0.09 each). Alternative free path to evaluate: WhatsApp "send this code to our number" inbound verification, but it needs a WhatsApp Business API sender. | ≈ €0.05 per recovery only | Returning on new device |
| 2 (optional) | Staff-confirmed: at the till staff see the last 3 digits and first name and tap "Yes, this is them". Zero cost, no phone needed, good for tourists with foreign SIMs. | €0 | Fallback when SMS fails |

Rules: OTP is 6 digits, 10 min expiry, max 3 tries, max 3 sends per number per hour and 10 per IP per hour, hash the code at rest, global daily send cap (env `OTP_DAILY_CAP`) so a bot cannot burn money. Until ATD supplies an SMS key (**[ATD]**), tier 1 falls back to tier 2 (staff confirmation) so nothing blocks.

## A.5 Staff scanner changes
- Keep QR/typed `LC1-` code lookup unchanged.
- Add lookup **by phone**: staff types the last digits or the full number on a keypad; server returns up to 5 matches for this programme only (masked: `+34 6•• ••• 123`, first name). Rate limited with the existing `badStaff` limiter.
- Add "new customer at the till": staff types phone + optional name, the card is created for this programme (no marketing consent is recorded, see Part C), and the customer is sent the card link when the phone is mobile (A.7 channel decision) or shown a QR to scan.
- The customer's card QR payload stays `LC1-<cardId>` (no phone number inside the QR, so a photographed card leaks nothing).

## A.6 Migration from email-based cards (no downtime, reversible)
1. Deploy code that **reads** both shapes. Old cards keep working: they have no `memberId`, are shown and scanned exactly as today.
2. New joins create members. Existing cards are **not** touched at deploy time.
3. Optional claim flow: an old card owner opening `/card/<token>` sees a one-line prompt "Add your phone number so your card works in other shops" (phone + OTP tier 1). On success: create/link a member, set `card.memberId`, keep `email`. This is a customer action, never bulk.
4. Backfill script `scripts/loyalty-members-report.mjs` (dry-run only by default): reads the DB copy, normalises existing optional `phone` values, and prints counts: cards with a valid phone, duplicates within the same programme (same normalised phone or same email). **Reports only; never auto-merges.** Merging duplicates is a separate owner-initiated admin action (sum stamps/points, move txns, keep the oldest `cardToken` valid via an alias list), written and tested in A8.
5. Rollback: previous release ignores `members`, `consents`, `memberId`; data stays valid. Take a backup before the first production join with the new code.
6. Gap to fold in while here (documented in `docs/routes-and-auth.md`): loyalty join does not check business approval, only `declined`. Do not widen this; decide with ATD whether to close it in task A3 (**[ATD]** yes/no).

## A.7 Delivering the card "right away" with no install
- After join the page is the web card (`/card/<token>`) already in the product; add "Add to Google Wallet / Apple Wallet" prominently (existing endpoints) and a PWA hint (existing).
- Do **not** require SMS to deliver the card; the card is already on screen. SMS/WhatsApp link is only a convenience for tier 1/2 and for till-enrolment.

## A.8 Abuse limits
Join limiter by IP rises to 60/h but adds **per-phone** (5/h) and **per-programme** (300/h) limits; `badCard` unchanged. Enumeration response must be identical for "number exists" and "number is new" up to the recovery step.

## A.9 Tasks (loyalty)

| ID | Task | Files | Acceptance tests | Depends | Size | Tag |
|---|---|---|---|---|---|---|
| L1 | Phone normaliser `normalisePhone` (A.3) | new `server/phone.mjs`, `server/phone.test.mjs` | table test: ES formats (spaces, 0034, +34, parentheses, dashes), foreign (+44, +49, +351), invalid (short, long, letters, `+340`), landline flag, same number two spellings -> same E.164 | none | S | PAR |
| L2 | Members data layer: `members[]`, `byPhone`, `byMemberToken`, `findOrCreateMember`, `cardForMember(member, program)` (creates the card via existing join logic, idempotent: second call returns the same card), schema docs | `server/loyalty.mjs` (or new `server/loyalty-members.mjs`), `docs/data-model.md`, `server/loyalty.members.test.mjs` | idempotent card per (member, programme); two shops, one member -> two cards, separate balances; old cards without `memberId` untouched; welcome bonus once per card; existing loyalty tests still pass | L1 | M | SEQ |
| L3 | Public join API v2: `POST /api/loyalty/join/<code>` accepts `{phone, name?, memberToken?}`; known device path; sets cookie; returns `{cardUrl}`; keeps accepting old `{name,email,...}` bodies for cached pages | `server/loyalty-routes.mjs`, `docs/routes-and-auth.md` | new number -> 201 + card; same device second shop -> card with no phone sent; unknown/old body shape still works; invalid phone -> 400 JSON error; identical response for existing vs new number; limits per IP/phone/programme; declined business still 403 | L2 | M | SEQ |
| L4 | Join page v2 (phone-first, one field, big button, ES/EN, design tokens, a11y labels; consent checkbox is task C3) | `server/loyalty-pages.mjs`, `server/loyalty-pages.test.mjs` | `npm test` incl. `html-syntax.test.mjs` (inline script parses); renders without email field; Spanish default; works with JS errors surfaced inline; manual check in browser pane at 375 px, light and dark | L3 | M | SEQ |
| L5 | Recovery (tier 1/2): OTP interface with a fake adapter for tests, real adapter disabled until key; staff-confirm fallback; caps and hashes | new `server/otp.mjs`, routes in `loyalty-routes.mjs`, tests | wrong code x3 locks; expiry; send caps; no OTP key -> falls back to staff confirm; code never logged | L3 | M | SEQ **[ATD]** supplies SMS provider/key later; code ships without it |
| L6 | Staff scanner: phone lookup + enrol-at-till (A.5) | `server/loyalty-routes.mjs`, `server/loyalty-pages.mjs` (staff page), tests | lookup returns only this programme's cards, masked phones; max 5; wrong token -> 404 and `badStaff` counts; enrol creates card without consent record | L2 | M | PAR with L3/L4 once L2 is merged |
| L7 | Owner/portal views: show phone (formatted), hide email when empty, search by phone; CSV export uses E.164 | `src/` and `server/portal.html` loyalty views, `loyalty.mjs customerRow` | typecheck; portal opens and lists customers; no cross-tenant leak test | L2 | S | PAR |
| L8 | Claim-your-card flow for old email cards + duplicate report script + owner-initiated merge | `scripts/loyalty-members-report.mjs`, `loyalty.mjs`, tests | dry run changes nothing (hash of DB before/after); merge sums balances and keeps both card tokens working | L2, L5 | M | SEQ |
| L9 | Erasure and retention: `eraseMember`, `removeClientData`, `retention.mjs` cover members and consents; update `docs/privacy/retention.md` and `ropa.md` | `server/loyalty.mjs`, `server/retention.mjs`, `docs/privacy/*` | erasing a client removes its cards and consents; erasing a phone removes the member and all its cards in all shops and writes an audit line without personal data | L2 | S | PAR |
| L10 | End-to-end test of the whole flow (scan QR -> join -> second shop -> staff phone lookup -> stamp) and update the existing e2e tests | `server/loyalty.e2e.test.mjs` | all green; no network | L3,L4,L6 | S | SEQ |

Parallel plan: L1 first. Then L2. After L2, run **L3, L6, L7, L9 in parallel**. L4 after L3. L5 and L8 after L3. L10 last.

---

# Part B. Google Business Profile (GBP)

## B.0 Plain statement of the real constraints
(Verified against Google's pages where noted; the rest comes from secondary sources and **must be re-checked by the executing agent against the official docs before building**, because this API changes often.)
1. **Access is gated.** The Business Profile APIs are not open to any Cloud project. You need a Google Cloud project, an organisation-style contact, then submit the "Application for Basic API Access" form ([Prerequisites](https://developers.google.com/my-business/content/prereqs)). Until approved, the project's quota shows **0 QPM**. Google's FAQ says requests are reviewed within about 14 days; third-party write-ups say longer and add expectations (a verified profile active 60+ days, a business website whose domain matches the requester's email). Approval is per Cloud project. [FAQ](https://developers.google.com/my-business/content/faq), [limits](https://developers.google.com/my-business/content/limits). After approval the default is 300 QPM, plus a reported hard cap of ~10 edits/min on a single location.
2. **OAuth consent screen and verification.** The scope is `https://www.googleapis.com/auth/business.manage`. In "Testing" status only listed test users can connect and refresh tokens expire after 7 days. Production needs brand/app verification (privacy policy URL, homepage, authorised domain, demo video, scope justification; sensitive-scope review can take weeks). **[ATD]**
3. **Endpoints are split and partly legacy.** Business Information API (`mybusinessbusinessinformation`) handles locations (info, hours, categories, attributes). Verifications API handles verification. Reviews, local posts and media have remained on the older v4 surface and reports say that may be allow-listed or return 403 for some projects; Q&A was shut down (Nov 2025); performance moved to its own API; some account-management methods were deprecated in April 2026 ([change log](https://developers.google.com/my-business/content/change-log)). **Task G0 must confirm the live status of every method we plan to use.**
4. **Creating a profile is not instant.** An API-created location starts unverified and is not publicly visible until the owner verifies by postcard (a few days, sent to the real address), phone/SMS, email, or video; method depends on the business and Google decides which options are offered. Google may refuse or suspend profiles it considers fake, service-area-only, or created in bulk by an agency, and may ask for a video. Duplicates of an existing listing are common: the client may already have an unclaimed listing (Maps shows the business) and must **claim** it, not create a new one.
5. **Ownership.** The profile must belong to the client's own Google account (they hold Primary Owner), with the studio added as a manager through the API/OAuth consent, never the other way round. If the client leaves they keep their listing. Policy: do not create profiles under the studio's own account on behalf of clients.
6. **Quotas and content rules.** 300 QPM project-wide is plenty (one-person studio). Posts and replies must follow Google's content policies (no phone numbers in post text, no fake or incentivised review content; do not gate reviews). AI-written review replies need a human approve step by default.
7. **Tokens.** We store a refresh token per client. `accounts` secrets are plain text today (see `docs/data-model.md` 2.1): store GBP tokens **encrypted at rest** (AES-256-GCM with a key from env `TOKEN_ENC_KEY`) and mask them like `maskAccounts` does. Do not weaken that; ask before changing existing accounts' storage.

## B.1 Features and flows
**Connect** (existing business): portal button "Conectar Google Business" -> Google OAuth (authorisation-code, offline access, PKCE, state bound to the client session) -> we list the client's accounts/locations -> client picks one -> stored. Reuse the pattern from the YouTube connect flow in `server/social.mjs` / `server/index.mjs` (`apps.youtube` flag), but a separate OAuth client and scope.
**Create** (no profile): wizard prefilled from the client's profile (name, category, address, phone, hours, website, description): `validateOnly` call first, then create under the client's own account, then show verification options and tell the client exactly what happens next ("Google will send a postcard to <address>; enter the code here when it arrives").
**Manage**: edit info and hours (diff preview before pushing), upload photos from `data/media`/client photos, publish posts (reuse the existing posts pipeline: a post can include "Google Business" as a platform), list reviews, draft AI reply in the client's tone, client approves, reply is posted; unreplied-review badge in the portal; monthly performance numbers if the API is available.
**Autopilot hook:** optional weekly GBP post from existing approved posts; replies to 4-5★ reviews can be auto-posted only if the client enables it; 1-3★ always need human approval.

## B.2 Fallback while Google approval is pending (works today, no API)
1. **Checklist generator:** the app builds a ready-to-paste GBP kit per client: name, categories, description (750 chars), hours, services, 10 post drafts, photo set with alt texts, and Q&A seeds. Shown in the portal with copy buttons.
2. **Guided manual setup:** step-by-step ES/EN screens linking to `business.google.com/create` and the claim flow; client (or ATD on a call) pastes the kit. Status tracker: not started / created / verification pending / verified.
3. **Review-reply assistant without the API:** client pastes the review text, the assistant drafts the reply, client posts it themselves (deep link to their reviews page).
4. **Add the studio as a manager by invite** (client invites ATD's Google account in GBP settings) so ATD can fix things by hand in the web UI.
5. When the API is approved, "Connect" lights up for the same clients; the manual states carry over (the tracker reads the connected location).
Feature flag `GBP_API_ENABLED` (env) switches between fallback and API UI; default off.

## B.3 Tasks (GBP)

| ID | Task | Files | Acceptance | Depends | Size | Tag |
|---|---|---|---|---|---|---|
| G0 | **Research spike, no code:** confirm against official docs which methods exist today (locations create/patch, verifications fetch/verify/complete, reviews list/reply, localPosts create, media upload, performance), their endpoints, scopes, required allow-listing; write `docs/gbp-api-notes.md` with links and dates | `docs/gbp-api-notes.md` | every planned call has an official doc link and a "works / needs allow-list / deprecated" mark | none | S | PAR |
| G1 | **Google Cloud + access request** (project, org contact, consent screen in Testing with ATD as test user, Basic API Access form, privacy policy URL, domain verification). Prepare the exact form answers and demo-video script as `docs/gbp-access-request.md` | doc only | form submitted; quota page shows >0 QPM when approved | G0 | M | **[ATD]** (agent drafts, ATD submits) |
| G2 | **OAuth app verification** for production (video, scope justification) | doc, privacy page copy in `server/legal.mjs` if needed | consent screen "In production", verified | G1 | M | **[ATD]** |
| G3 | **Fallback kit** (B.2 1-4): generator (AI + client profile), portal screen with copy buttons and status tracker, ES/EN, no Google calls | new `server/gbp-kit.mjs`, `server/gbp-routes.mjs`, portal view, tests with fake AI | kit built from a fixture client; description <= 750 chars; no cross-tenant access; status persists in `client.gbp = {mode:"manual", status, notes}` | none | M | PAR |
| G4 | **Token store + OAuth connect** (encrypted tokens, state/PKCE, refresh, revoke/disconnect, fake Google server in tests) | new `server/gbp-auth.mjs`, routes, `.env.example` (key names only), `docs/routes-and-auth.md` | connect, refresh, disconnect against the fake; tokens never returned by any API; state mismatch rejected; secrets not in logs | G0 | M | PAR with G3 (code can be built and tested with a fake before approval) |
| G5 | **Client wrapper** `server/gbp.mjs`: typed calls with retry/backoff on 429/5xx, 10-edits/min per location guard, `validateOnly` support, error mapping to human messages | `server/gbp.mjs`, tests with fake fetch | all calls covered by fake responses incl. 403 allow-list error -> friendly "access pending" state | G0, G4 | M | SEQ |
| G6 | **Create/claim wizard + verification screens** (postcard/phone/video, code entry) | `server/gbp-routes.mjs`, portal view | `validateOnly` happy path and duplicate-found path against fakes; refuses to create when a matching listing exists until client chooses "claim" | G5 | L | SEQ |
| G7 | **Info/hours/photos manager** with diff preview | routes + portal view | edit pushes only changed fields; photo upload from client media with size/type checks | G5 | M | PAR with G8, G9 |
| G8 | **Posts**: add GBP as a publishing platform in `social.mjs`/`studio.mjs` autopilot, with content-policy sanitiser | `server/social.mjs`, `studio.mjs`, tests | post with phone number is sanitised/blocked; failure recorded in `publishNote` like other platforms | G5 | M | PAR |
| G9 | **Reviews and replies**: list, AI draft in client tone, approve-to-send, auto-reply rules (4-5★ only, opt-in), unreplied badge | new `server/gbp-reviews.mjs`, assistant hook, portal view | 1-3★ never auto-sent; reply text capped; duplicate reply refused | G5 | M | PAR |
| G10 | Admin view: per-client GBP status, API health, access-pending banner | `src/screens/` | typecheck; no secrets in payload | G3,G5 | S | SEQ |
| G11 | Docs: `docs/architecture.md`, `routes-and-auth.md`, `data-model.md`, `privacy/subprocessors.md` (Google as processor), `ropa.md` | docs | docs match code | all | S | SEQ |

Parallel plan: **G0 and G3 start now in parallel**; G1 (ATD) can start as soon as G0 confirms the form; G4 in parallel with G3. G5 after G0+G4. G6-G9 parallel after G5. Nothing needs Google approval to be built and tested (fakes); only real use needs G1/G2.

---

# Part C. Marketing consent (decision for ATD)

## C.1 The legal issue, plainly
ATD wants marketing consent **required** to get a card. That is not allowed as a legal basis for sending marketing:
- **RGPD art. 4(11) and 7(4):** consent must be freely given. When a service (the loyalty card) is made conditional on consenting to processing that is not necessary for that service (marketing messages), consent is presumed not free (recital 43). A consent obtained that way is invalid, so every message sent on it would be sent without consent.
- **LSSI art. 21:** commercial email/SMS/WhatsApp-type messages need prior express consent, unless art. 21.2 applies (existing customer relationship, similar products, with opt-out at collection and in every message). Fines for LSSI are up to €30,000 (minor) / €150,000 (serious); AEPD also sanctions under RGPD. Voice calls are under the Telecommunications Law and the Lista Robinson. (Secondary sources; a Spanish data-protection lawyer should confirm before launch. **[ATD]**)
- Consequence: forcing the box ticked **destroys the value of the list** (the shop could not lawfully use it) and exposes both the shop (the controller) and Polar Marketing (the processor, and the one who built the form).
- What *is* allowed to require: the phone number itself (needed to identify the card), and service messages tied to the card (stamp added, reward ready, card recovery code) under contract performance, with no marketing in them.

## C.2 Compliant design that maximises opt-in
1. **Separate, unticked checkbox**, not bundled with terms. Copy (ES default): "Quiero recibir ofertas y novedades de {Negocio} por WhatsApp/SMS. Puedo darme de baja cuando quiera." (never pre-ticked, never hidden, one per channel only if we really offer several channels).
2. **Clear benefit** next to it: "Te avisamos de recompensas, ofertas y de cuando casi tienes tu premio." An **extra incentive** for opting in is allowed if the card works without it (e.g. +1 bonus stamp or priority offers); keep it modest and make the non-opt-in path visibly complete ("No gracias, solo la tarjeta").
3. **Place it after value is shown:** on the confirmation screen right after the card appears ("Tu tarjeta está lista. ¿Quieres que te avisemos de ofertas?" with a prominent button) instead of on the form. People who already hold a card opt in far more than at a blocking form, and the card is never conditional. Show the question a second time at the third visit (one gentle reminder, then stop).
4. **Per shop, not global:** the consent belongs to the shop that asked (the controller). A member at a second shop is asked again for that shop.
5. **Proof (accountability):** append-only `loyalty.consents[]`: who (member id), which shop/programme, channel, exact text shown + text version id, granted/withdrawn, timestamp, hashed IP and user agent, source (join page / card page / staff till). Staff-collected consent is allowed only if the customer sees and taps it on their own phone; staff must not tick on their behalf.
6. **Withdrawal as easy as giving:** every marketing message carries a one-tap unsubscribe link `/u/<signed token>` and "reply STOP"; a card-page toggle "Ofertas: sí/no"; withdrawal is logged and honoured immediately. Marketing sends must check the latest consent row.
7. **Verify before first marketing message** (A.4 tier 1): confirms the number belongs to the person who consented (double opt-in), strongly recommended.
8. **Minors:** consent age in Spain is 14; do not collect consent from under-14s (age line in terms; no age field needed).
9. Privacy notice (layer 1 on the join page: shop identity, purpose, legal basis, retention, rights; layer 2 in `legal.mjs`). Update `docs/privacy/ropa.md`, `retention.md` (consent evidence life of consent + 3 years), and the DPA text (shop = controller, Polar = processor).
10. No marketing sends are built in this plan. Existing `marketingConsent` boolean keeps working; new code writes both the boolean and a consent row.

## C.3 Options for ATD **[ATD decision]**
- **A (recommended):** optional separate checkbox on the post-join screen + modest bonus incentive + proof + one-tap unsubscribe. Compliant, highest compliant opt-in.
- **B:** required checkbox. Not recommended: invalid consent, no usable list, fine risk.
- **C:** no marketing consent at all; only service messages and wallet-pass updates. Safest, but no promotions.
- Also confirm: which channels (WhatsApp / SMS / email only?), who is the sender, and whether the shop or Polar owns the list (the shop is the controller).

## C.4 Tasks (consent)

| ID | Task | Files | Acceptance | Depends | Size | Tag |
|---|---|---|---|---|---|---|
| C1 | Consent log: `consents[]`, `recordConsent` / `withdrawConsent` / `hasConsent(member, client, channel)`; dual-write boolean | `server/loyalty.mjs` or `server/consent.mjs`, `server/consent.test.mjs`, `docs/data-model.md` | withdrawn consent flips `hasConsent`; rows append-only; text version stored; works for old boolean customers | L2 | S | SEQ |
| C2 | Unsubscribe: signed token, `GET/POST /u/<token>` page (ES/EN), `{POST} /api/loyalty/consent` toggle from card page | `server/loyalty-routes.mjs`, `loyalty-pages.mjs`, `docs/routes-and-auth.md` | invalid/expired token -> neutral page; idempotent; rate limited; no personal data in URL | C1 | M | SEQ |
| C3 | Join/confirmation UI: unticked checkbox on the post-join screen with benefit copy and "No gracias"; stores text version | `server/loyalty-pages.mjs`, tests incl. html-syntax | box never pre-ticked (assert in test); card shown regardless of choice; both ES and EN | C1, L4 | S | SEQ |
| C4 | Optional bonus for opting in (setting per programme, default off) | `loyalty.mjs applyFields`, portal settings view | bonus granted once per member per shop, not on withdrawal+re-consent loops | C1 | S | PAR |
| C5 | Privacy/legal copy + ROPA/retention/DPA updates, reviewed by a lawyer | `server/legal.mjs`, `docs/privacy/*` | pages render ES/EN; docs updated | ATD choice | M | **[ATD]** approves wording |
| C6 | Owner export of "consented contacts" (CSV: E.164, shop, channel, date, text version) | portal/admin route | only consented-and-not-withdrawn rows; tenant isolated | C1 | S | PAR |

---

# Suggested execution order and ATD checklist

Wave 1 (parallel now, no dependencies): **L1, G0, G3**, plus **[ATD]** decisions below.
Wave 2: L2, G4 (parallel), ATD starts G1.
Wave 3 (parallel): L3, L6, L7, L9, C1, G5.
Wave 4 (parallel): L4, L5, L8, C2, C4, C6, G6-G9.
Wave 5: C3, L10, G10, G11, docs.
Then ATD reviews, we run `npm test && npm run typecheck`, take a backup, and only on ATD's explicit go-ahead use the runbook to deploy and verify the live site (rollback first if anything is off).

## Needs ATD
1. **Consent policy:** choose A / B / C (C.3) and have a Spanish privacy lawyer confirm; pick channels.
2. **Google accounts:** Cloud project + the Basic API Access form (G1), OAuth consent screen and production verification (G2). Needs a business email whose domain matches the studio website; expect weeks. Decide the studio Google account that becomes manager.
3. **SMS/OTP provider and budget** (A.4) and an `OTP_DAILY_CAP`; until then staff-confirm fallback is used.
4. **Dependency decision:** hand-rolled phone module vs `libphonenumber-js`.
5. **Close the pending-business loyalty gap?** (A.6 point 6).
6. **Token encryption key** `TOKEN_ENC_KEY` in `.env` (key name only here) for GBP tokens.
7. Approval for every deploy; backups before migration.
