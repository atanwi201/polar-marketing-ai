# Google Business Profile API: what actually exists (G0)

Status: research spike, no code. Checked against the official docs on **2026-10-27**. Every claim
below links to a Google page and quotes what it says. Where this file disagrees with
`docs/plans/2026-10-gbp-and-phone-loyalty.md`, **this file wins** and the plan section is listed under
"Corrections" so G4-G9 are built against reality.

Re-check this file before G4 ships and again before G6: the API is actively developed (four changes
between April and July 2026 alone), and the plan's own warning about secondary sources proved right.

## 1. The access gate

| Fact | Source |
| --- | --- |
| Approval is per Cloud project. Without it the quota is 0 QPM and calls fail. | [Prerequisites](https://developers.google.com/my-business/content/prereqs), [Quota limits](https://developers.google.com/my-business/content/limits) |
| Applicants must **manage a GBP that has been verified and active for 60+ days**, and have **a website representing the business on that GBP**. | Prerequisites, "Request access to the APIs" |
| The form is the [GBP API contact form](https://support.google.com/business/contact/api_default), option **"Application for Basic API Access"**. It needs the **project number**. | Prerequisites, steps 1-4 |
| The email on the application must be **an owner/manager of that GBP**. | Prerequisites, step 4 |
| Approval signal: quota 0 QPM = not approved; **300 QPM = approved**. | Prerequisites, "Note on Checking Approval Status" |
| Approved projects get 300 QPM (5 req/s), and the docs tell you to pace requests evenly. | Quota limits |
| There is **no sandbox**. `validateOnly` is the only way to test a write without applying it. | [Basic setup](https://developers.google.com/my-business/content/basic-setup) |

The 60-day + website requirement is **official**, not third-party rumour as the plan assumed. That
matters for G1: if the studio's own GBP is not verified and 60 days old today, the application will be
rejected regardless of the form quality, and the clock starts when the profile is verified. This is
the single longest dependency in Part B and it cannot be compressed by code.

## 2. Which APIs to enable after approval

The docs list seven, and the v4 surface arrives through the first one:

1. Google My Business API (hosts v4.9: reviews, localPosts, media, and the legacy accounts methods)
2. My Business Account Management API (v1.1: accounts, admins, invitations, location transfer)
3. My Business Verifications API (v1)
4. My Business Business Information API (v1: locations, attributes, categories, googleLocations)
5. My Business Notifications API (v1.2)
6. My Business Lodging API (v1.2)
7. My Business Place Actions API (v1)

Source: [Basic setup](https://developers.google.com/my-business/content/basic-setup). Performance API
(v1) is not in that list but is documented and has its own host; enable it when G7/G9 needs it.

Hosts, so the fake in G4/G5 mimics the right paths:

| Host | What lives there |
| --- | --- |
| `mybusinessbusinessinformation.googleapis.com/v1` | locations (create/get/patch/delete), attributes, categories, googleLocations.search |
| `mybusiness.googleapis.com/v4` | reviews, localPosts, media, legacy accounts |
| `mybusinessaccountmanagement.googleapis.com/v1` | accounts, admins, invitations, locations.transfer |
| `mybusinessverifications.googleapis.com/v1` | fetchVerificationOptions, verify, getVoiceOfMerchantState, verifications.complete/list |
| `mybusinessperformance.googleapis.com/v1` | fetchMultiDailyMetricsTimeSeries, getDailyMetricsTimeSeries |
| `mybusiness.googleapis.com/upload/v1` | raw media bytes (`?upload_type=media`) |

## 3. Every call the plan needs

Status legend: **works** = documented and current; **gated** = documented but only after Basic access
approval (all of them are); **deprecated** = do not build against it, use the replacement.

| Need | Call | Status | Notes |
| --- | --- | --- | --- |
| Connect: list the client's accounts | `GET mybusinessaccountmanagement/v1/accounts` | works, gated | v1.1. Replaces v4 `accounts.list`. |
| Connect: list locations | `GET mybusinessbusinessinformation/v1/{parent=accounts/*}/locations?readMask=...` | works, gated | `readMask` is mandatory; ask only for fields you use. |
| Connect: permission for the studio | `accounts.admins.create` (v1.1) or `accounts.invitations.create` | works, gated | See correction 3. |
| Create: check for a duplicate | `POST googleLocations.search` (v1) | works, gated | 300 QPD. Returns claimed/unclaimed matches by name/address/phone. |
| Create: validation pass | `POST mybusinessbusinessinformation/v1/{parent=accounts/*}/locations?validateOnly=true` | works, gated | No sandbox; this is the only dry run. |
| Create: create | same call with `validateOnly=false` and a **unique `requestId`** | works, gated | 300 QPD. `requestId` dedupes retries: same id returns the existing location. |
| Create: claim an existing listing | `googleLocations.search` → request access (invitation) → owner accepts (`accounts.invitations.accept`) | works, gated | `locations.associate` is **deprecated** (2023-05-30). See correction 4. |
| Verification: options | `POST mybusinessverifications/v1/{locationId}:fetchVerificationOptions` | works, gated | `{ "languageCode": "es" }`. Options vary by region/business. |
| Verification: start | `POST mybusinessverifications/v1/locations/{locationId}:verify` | works, gated | Moves to verified or returns an error state. |
| Verification: finish with a PIN | `POST .../v1/{name=locations/*/verifications/*}:complete` | works, gated | Postcard PIN etc. |
| Verification: status | `GET .../v1/{locationId}:getVoiceOfMerchantState` | works, gated | `hasVoiceOfMerchant`; `gain_voice_of_merchant.action` tells you whether to verify. |
| Info/hours edit | `PATCH mybusinessbusinessinformation/v1/{location.name}?updateMask=...` | works, gated | **10 edits/min per location, hard cap, cannot be increased.** Update budget is 10,000/day. |
| Photos (from URL) | `POST mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/media` with `sourceUrl` | works, gated | One call. Media for **local posts must** use a URL, not bytes. |
| Photos (from bytes) | `media:startUpload` → `POST mybusiness.googleapis.com/upload/v1/media/{ref}?upload_type=media` → `media.create` | works, gated | Three steps. Bytes supported for locations only. |
| Posts | `POST mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/localPosts` | works, gated | Event / Call to action / Offer. **Product posts cannot be created by the API.** |
| Posts: scheduling | `RecurrenceInfo` on `LocalPost` | works, gated | Added 2026-04-07. Could replace our own cron for weekly posts. |
| Reviews list | `GET mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/reviews` | works, gated | Actively developed: `reviewReplyState` (2026-04-01), `reviewReplyUrl` (2026-07-24), `PolicyViolation` (2026-07-01). |
| Reply to review | `PUT .../reviews/{reviewId}/reply` (`updateReply`) | works, gated | `reviewReplyState` tells you if moderation rejected it, which is what the portal badge should show. |
| Delete reply | `DELETE .../reviews/{reviewId}/reply` | works, gated | |
| Performance | `GET mybusinessperformance.googleapis.com/v1/{name=locations/*}:fetchMultiDailyMetricsTimeSeries` | works, gated | v4 `locations:reportInsights` is **deprecated**. |
| Q&A | — | **dead** | Discontinued 2025-11-03. |

Sources: [Reviews](https://developers.google.com/my-business/content/review-data),
[Posts](https://developers.google.com/my-business/content/posts-data),
[Photos](https://developers.google.com/my-business/content/upload-photos),
[Verification](https://developers.google.com/my-business/content/manage-verification),
[VerificationMethod](https://developers.google.com/my-business/reference/verifications/rest/v1/VerificationMethod),
[Performance](https://developers.google.com/my-business/content/insight-data),
[Change log](https://developers.google.com/my-business/content/change-log),
[Deprecations](https://developers.google.com/my-business/content/sunset-dates).

## 4. Corrections to the plan

These change task text, not just trivia. Each one would have cost a day if discovered mid-build.

1. **Video is not an API verification method.** `VerificationMethod` has exactly
   `ADDRESS` (postcard), `EMAIL`, `PHONE_CALL`, `SMS`, `AUTO`. Video verification exists in the
   Business Profile **UI** for some categories and for "particularly personal places", but G6 cannot
   offer it as an option from the API. G6 must render **whatever `fetchVerificationOptions` returns**
   and never assume a fixed set of three.
2. **Q&A no longer exists** (discontinued 2025-11-03) even though the v4 reference navigation still
   lists `accounts.locations.questions`. That stale link is a trap for the next agent. **B.2.1's
   "Q&A seeds" in the fallback kit must be dropped** — it would generate content nobody can paste.
3. **v4 account management is deprecated**(`accounts`, `accounts.admins`, `accounts.invitations`,
   `accounts.locations.admins`). "Add the studio as a manager" must use **Account Management API
   v1.1**, not the v4 calls a 2023-era tutorial shows.
4. **`locations.associate` / `clearAssociation` were deprecated 2023-05-30**, so the plan's
   "associate" step for claiming is a dead end. Claiming is `googleLocations.search` → request access
   → the owner accepts an invitation. **Transfer requires tokens for both accounts and an existing
   owner relationship**, so it is not a claim mechanism either. G6's "refuses to create when a
   matching listing exists until the client chooses claim" is right; the claim implementation behind
   that button is different.
5. **Quotas are tighter than the plan implies in two places.** `create` and `search` are **300 per
   day**, not just 300 QPM, and the **10 edits/min per location** cap is explicitly "cannot be
   increased". G5's per-location guard is required, not defensive nicety. One client's hourly-sync
   loop can exhaust 300 creates/day.
6. **`readMask` is mandatory** on location reads. A wrapper that forgets it gets a 400 that looks like
   a permissions problem.
7. **v4 reviews/posts/media are not dying.** The plan hedged that they "may be allow-listed or return
   403 for some projects"; nothing in the current docs supports that, and all three got feature
   updates in 2026. They sit behind the same Basic access gate as everything else. Build against them;
   don't budget for a rewrite.
8. **`requestId` on create is a dedupe key, not just an id.** A retry after a timeout with the same
   `requestId` returns the location that was created, which is exactly the 429/timeout retry case G5
   needs.

## 5. What this means for the build

- **G4/G5 stay fake-first and this is now cheaper, not riskier**: the hosts and paths above are stable
  enough to write the fake against today. Every call in section 3 is reachable from a stub server.
- **`GBP_API_ENABLED` stays off until the quota page reads 300 QPM.** Not "until the form is sent".
- **G6 must be data-driven off `fetchVerificationOptions`.** Hard-coding postcard/phone/video breaks
  on the first client whose category offers only email.
- **The 60-day clock is the critical path.** G1 should be started before any GBP code is written, even
  though the code does not depend on it, because nothing else in Part B can go live without it.
- **The fallback kit (G3) is not a stopgap for a fortnight; it is the product for at least two
  months**, and for any client whose verification stalls. Treat its quality as launch quality.
