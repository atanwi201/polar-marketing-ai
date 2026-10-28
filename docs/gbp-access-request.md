# GBP access request (G1): the exact clicks, and the video for G2

Status: draft for ATD to execute. The agent cannot do any of it: every step needs the Google account that owns or
manages the business profile, and the application is reviewed against that account. Facts about the gate come from
`docs/gbp-api-notes.md` (checked 2026-10-27) and Google's
[prerequisites](https://developers.google.com/my-business/content/prereqs); the form's own labels change without
notice, so read the live form and map it onto the answers below.

Two independent clocks, start both as early as possible:

1. **60+ days of a verified GBP.** Hard requirement for Basic API Access. If the profile is verified today, the
   application cannot succeed before day 60. Nothing in code can shorten this.
2. **OAuth verification (G2).** Needs a working app (G4/G5) and a finished privacy policy, so it starts later, but
   it runs for weeks. Until it passes, the app stays in **Testing**, which means refresh tokens die after 7 days.

Do not confuse the two: Basic API Access is per Cloud project and gates the quota (0 QPM → 300 QPM). OAuth
verification is per OAuth client and gates the "unverified app" warning. Google can reject either independently.

## 0. What has to be true before the form

- [ ] A Google account that is **owner or manager** of a GBP that has been verified and active for **60+ days**.
      The studio's own profile works; so does a long-standing client's, with their permission.
- [ ] That GBP has a **website** that represents the business, is live, and matches the name, address and phone on
      the profile. Not a placeholder page.
- [ ] The profile is complete: category, hours, photos, services, phone, website. Reviewers look at it.
- [ ] The email used on the application is that owner/manager account, not a personal one that happens to have
      access to Cloud.
- [ ] Decide the Cloud project owner: it should be a studio account, not a client's, because the project number is
      what gets approved.

Record here (no secrets, no IPs): which GBP, which Google account, verification date. Per-client details go in the
CRM, not in this file.

| Item | Value / date |
| --- | --- |
| GBP used as the qualification | |
| Verified (date) | |
| Day 60 | |
| Google account (owner/manager) | |
| Cloud project name / number | |

## 1. Cloud project

1. Console → **Create project**. Name it after the studio, e.g. `polar-marketing-gbp`. Note the **project number**
   from the Project info card (not the project id; the form asks for the number).
2. No billing account is needed: the Business Profile APIs are free of charge. Leave billing off unless a later
   API needs it.
3. **Do not enable the seven APIs yet.** Enabling is harmless, but Basic setup tells you to do it after approval,
   and an enabled API with 0 QPM only produces confusing 403s.
4. **Organization**: if the account has one, put the project in it and confirm no org policy blocks
   `iam.disableServiceAccountKeyCreation`-style items we might need later. We only use OAuth user tokens, so this
   is usually a non-issue.

## 2. OAuth consent screen (Google Auth Platform)

This is the screen a client sees when they connect their profile, and the same screen the reviewers inspect.

- **User type:** External.
- **App name:** `Polar Marketing`. It must match the homepage and the logo; a mismatch is a common rejection.
- **User support email / developer contact:** a studio address that a reviewer can write to and that gets read.
- **App logo:** the existing mark, square, 120×120 or larger.
- **Application homepage:** the public studio site, `https://<public-domain>/` (no login, no redirect).
- **Privacy policy:** `https://<public-domain>/privacy` — see section 5, it is not ready today.
- **Terms of service:** `https://<public-domain>/legal`.
- **Authorized domains:** the public domain only. Verify ownership first (section 3), otherwise the console refuses
  to save the domain.
- **Scopes:** add `https://www.googleapis.com/auth/business.manage` only. Add `openid`, `email`, `profile` if the
  sign-in needs the account's address; they are not sensitive and do not need justification. Do **not** request
  `business.manage` plus the deprecated v4 admin scopes "just in case": every extra scope is another thing to
  justify in the video.
- **Test users:** ATD's Google account, plus the Google account of whoever tests with a client profile. Maximum
  100; each one can authorise while the app is in Testing.
- **Publishing status:** leave it on **Testing** until G2. Understand the cost: in Testing, refresh tokens expire
  after **7 days**, so a connected client silently disconnects every week. Reconnect is one tap, but the pilot must
  not promise "connect once and forget" before verification.

Freeze these now, because they end up in the code (G4):

| Thing | Value |
| --- | --- |
| Client type | Web application |
| Authorised redirect URI | `https://<public-domain>/api/gbp/callback` (agree the path before G4 writes it) |
| Authorised JavaScript origin | not needed (server-side flow with `state`) |
| Client secret storage | server `.env` only, never in the repo, never in chat |

## 3. Verify the domain

Google will not accept a homepage or privacy URL on a domain the project has not verified.

1. Search Console → add the **domain** property (DNS TXT record), not the URL-prefix property, so every subdomain
   is covered. The DNS edit is at the registrar.
2. Wait for propagation, then confirm Search Console says *Verified*.
3. In the Cloud console, the domain now appears under authorized domains. If the site sits behind a host that
   serves a challenge page to Googlebot, fix that first: reviewers open the URL like any visitor.

## 4. The Basic API Access form

Form: <https://support.google.com/business/contact/api_default>, dropdown **"Application for Basic API Access"**.
It requires a signed-in Google account; the answers below are the substance, not the literal field labels.

| Asked | Answer |
| --- | --- |
| Email | the GBP owner/manager address from section 0 |
| Project number | the number from section 1, digits only |
| Business / organisation | the legal name used on the GBP and the invoices |
| Website | the same URL that is on the GBP |
| GBP used to qualify | name and address of the profile; if it is a client's, say so and that you manage it |
| Are you a third-party developer? | **Yes.** We build and run marketing tools for local businesses on their behalf. |
| How many locations / clients? | the real current number, and say it grows one business at a time |
| What will you do with the API? | see the paragraph below; keep it concrete and short |
| Which APIs? | Business Information, Account Management, Verifications, v4 reviews/posts/media, Performance, Notifications |
| Anything else | mention that access is read/write on the client's own profile, with the client's consent, and that they can revoke it at any time from their Google account |

Use-case text to adapt (do not paste marketing language; reviewers want specifics):

> Polar Marketing is a small studio that runs the online presence of local businesses in the Canary Islands. With
> the client's explicit consent, we connect their Business Profile through OAuth and then: keep name, address,
> hours, phone, website, attributes and photos correct; publish offers and weekly posts; read and answer reviews;
> and read performance metrics to report back to the client. Every action is taken on the client's own profile,
> never on profiles they do not manage, and the client can revoke access from their Google account at any time.
> We do not resell data, and we do not use it for advertising or profiling.

Then: submit, and keep the confirmation email. The follow-up arrives at the owner/manager address, sometimes as a
request for more detail; answer within the thread rather than re-applying.

**Check approval without waiting for an email:** Cloud console → APIs & Services → Business Profile APIs → Quotas.
`0 QPM` = not approved; `300 QPM` = approved. Only then enable the APIs and only then set `GBP_API_ENABLED` in
production (G5).

## 5. What the privacy policy must say before G2

`server/legal.mjs` serves `/privacy` and already covers the RGPD side, but it carries `[PENDING]` markers and says
nothing about Google user data. OAuth verification checks the page itself, so complete it before submitting G2:

- [ ] Which Google data is read and written: business profile fields, media, posts, reviews and replies,
      performance metrics.
- [ ] Why, and on whose instruction: the client's, as their processor.
- [ ] Where it is stored: our server in the EU; OAuth refresh tokens encrypted at rest (`TOKEN_ENC_KEY`), access
      tokens in memory.
- [ ] That it is never sold, never used for advertising, never used to train models, and not read by humans except
      to fix a reported problem.
- [ ] The Google API Services User Data Policy **Limited Use** statement, verbatim or close to it.
- [ ] How to disconnect: one button in the portal, plus the Google account permissions page; what is deleted and
      when (tokens immediately, cached profile data at disconnect or on request).
- [ ] A working contact for privacy requests, and the effective date.
- [ ] Remove every `[PENDING]` marker: a placeholder on a page under review reads as an unfinished product.

C5 (Spanish data-protection lawyer) and this section are the same work. Do them together.

## 6. Demo video script for G2

Requirements in practice: an **unlisted YouTube** link, English narration or English subtitles, the browser URL bar
visible, no cuts inside the OAuth flow, and a walk through what the app does with the data. Record on a clean
browser profile with no extensions and no other tabs; close chat, email and anything with a client's personal data
that is not part of the demo.

| Time | Shot | Say |
| --- | --- | --- |
| 0:00–0:15 | Homepage `https://<public-domain>/` in the address bar, then the sign-in screen | "Polar Marketing is a studio that manages local businesses' online presence. This is the production app at our verified domain." |
| 0:15–0:35 | Sign in as the business, open **Connect Google Business Profile** | "A business owner signs in and chooses to connect their own Google Business Profile." |
| 0:35–1:00 | The Google consent screen: app name, the `business.manage` scope, the account chooser | "Google asks for permission to manage this business's profile. This is the only scope we request, and it is what lets us edit their information, posts, photos and review replies." No cuts here. |
| 1:00–1:20 | Back in the app: connected state, profile name and address shown | "The connection is stored server-side. The refresh token is encrypted at rest; the browser never sees it." |
| 1:20–2:00 | Read: reviews list with one reply written | "We read reviews so the owner can answer from one place. Here is a reply being published to their profile." |
| 2:00–2:30 | Write: one harmless profile edit (e.g. a business description tweak) saved and visible in Google | "Edits go to the client's own profile only. We never touch profiles the client has not connected." |
| 2:30–2:50 | Portal → **Disconnect**, then Google account → Data & privacy → Third-party apps showing the app gone | "The client can disconnect here, or from their Google account, at any time. Disconnecting deletes the stored tokens." |
| 2:50–3:10 | `/privacy`, scrolled to the Google data section | "Our privacy policy explains what we read, why, how long we keep it, and how to have it deleted." |
| 3:10–3:20 | End card: studio name, support email | "Questions to the support address on screen." |

Rules that save a re-record: use the production domain (not localhost, not a staging host), keep the app name
identical to the consent screen and the homepage title, and show at least one real read and one real write. If the
demo needs a client's profile, get their written OK first and blur anything not needed.

## 7. Failure modes seen in the wild

- **Applying from a GBP younger than 60 days** → rejected, and the clock restarts when it is verified. Check the
  date before filling the form.
- **Homepage/privacy behind a login or a bot wall** → reviewer cannot open it → rejected.
- **Consent screen name ≠ homepage brand** → verification asks for a brand review, adding weeks.
- **Requesting extra scopes** → every scope needs a justification and a demo; trim to `business.manage`.
- **Application email not on the GBP** → the request is discarded without a useful error.
- **Assuming approval is instant because the quota page loads** → 0 QPM means not approved; `GBP_API_ENABLED` stays
  off.

## 8. Split of work

**ATD:** sections 0–5 (accounts, domain, form, privacy text with the lawyer) and, later, recording the video.
**Agent:** G4 token store and API client against a fake, G5 wiring behind `GBP_API_ENABLED`, G6 data-driven
verification, G10 status view, G11 docs. Nothing in G4–G9 waits for approval; only real traffic does.
