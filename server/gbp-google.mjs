// The Google Business Profile create/claim wizard (plan G6). This is the part that decides *which*
// listing a shop ends up with, so the order is deliberate: look for an existing listing first, refuse
// to create a duplicate while one is claimed, and only then create. Google's own docs are blunt about
// it: a duplicate is common, and an agency-created duplicate is a support case for the shop.
//
// Two API facts shape the code (docs/gbp-api-notes.md, checked 2026-10-27):
// - Claiming is not an API call we can make. `googleLocations.search` returns `requestAdminRightsUri`
//   on a listing claimed by someone else; the owner opens that URL in Google's UI. So "claim" here
//   means "hand the owner the right link", never "associate" (deprecated in 2023).
// - An unclaimed match carries a `location` object Google explicitly says may be reused in
//   `locations.create`. We reuse it so the new profile keeps its place ID instead of racing a
//   duplicate.
//
// Everything is behind GBP_API_ENABLED *and* a connected token: the flag is off by default and the
// manual kit is the product until Basic API Access is approved.
import { ensureGbp, GbpError, clamp } from "./gbp-kit.mjs";
import { gbpApiEnabled, gbpClient } from "./gbp.mjs";
import { accessToken, gbpAuthView } from "./gbp-auth.mjs";
import { normalisePhone } from "./phone.mjs";
import { now } from "./store.mjs";

export const STATUSES = ["not_linked", "linked", "verification_pending", "verified"];
/** Google's `VerificationMethod` values. The UI renders whatever the API offers, never this list. */
export const METHODS = ["ADDRESS", "EMAIL", "PHONE_CALL", "SMS", "AUTO"];
export const REGION = "ES";
export const CATEGORY_PREFIX = "categories/";
const MAX_CANDIDATES = 10;
const CATEGORY_TTL = 3600e3;

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const isAccount = (v) => /^accounts\/[A-Za-z0-9_-]+$/.test(String(v ?? ""));
const isLocation = (v) => /^locations\/[A-Za-z0-9_-]+$/.test(String(v ?? ""));

/** The block on the client. Additive and lazy: old records get it the first time they need it. */
export function ensureGoogle(client) {
  const g = ensureGbp(client);
  if (!g.google || typeof g.google !== "object") {
    g.google = {
      account: "", location: "", title: "", address: "", phone: "", website: "",
      status: "not_linked", verification: null, linkedAt: "", updatedAt: now(),
    };
  }
  const x = g.google;
  if (!STATUSES.includes(x.status)) x.status = x.location ? "linked" : "not_linked";
  for (const k of ["account", "location", "title", "address", "phone", "website"]) if (typeof x[k] !== "string") x[k] = "";
  if (x.verification && typeof x.verification !== "object") x.verification = null;
  if (x.location && !x.linkedAt) x.linkedAt = now();
  return x;
}

/** What the portal gets. No tokens, no Google account ids beyond the resource names the owner chose. */
export function googleView(client) {
  const x = ensureGoogle(client);
  const auth = gbpAuthView(client);
  return {
    enabled: gbpApiEnabled(),
    configured: auth.configured,
    connected: auth.connected,
    lastError: auth.lastError,
    account: x.account,
    location: x.location,
    title: x.title,
    address: x.address,
    phone: x.phone,
    website: x.website,
    status: x.status,
    linkedAt: x.linkedAt,
    verification: x.verification ? { method: x.verification.method, name: x.verification.name, state: x.verification.state, startedAt: x.verification.startedAt, completedAt: x.verification.completedAt } : null,
    defaults: defaultsFor(client),
    updatedAt: x.updatedAt,
  };
}

/** Prefill for the create form. The owner's own profile first; empty fields are the owner's to fill. */
export function defaultsFor(client) {
  const p = client?.profile ?? {};
  return {
    title: str(client?.name, 200),
    phone: str(client?.phone, 40),
    website: str(client?.websiteUrl || p.website || "", 300),
    address: str(p.address, 200),
    town: str(client?.town, 80),
    postcode: "",
    province: "Santa Cruz de Tenerife",
    description: str(p.story || p.tagline, 750),
  };
}

export function requireApi(client) {
  if (!gbpApiEnabled()) throw new GbpError("Google API access is not switched on yet.", 403, "disabled");
  if (!gbpAuthView(client).connected) throw new GbpError("Connect your Google profile first.", 409, "not_connected");
}

/** A client bound to this business's token, refreshed if needed. */
export async function apiFor(client) {
  requireApi(client);
  const token = await accessToken(client);
  if (!token) throw new GbpError("Connect your Google profile again.", 401, "reconnect");
  return gbpClient({ accessToken: token });
}

const addressOf = (loc) => {
  const a = loc?.storefrontAddress ?? {};
  const lines = Array.isArray(a.addressLines) ? a.addressLines.filter(Boolean) : [];
  return [...lines, a.locality, a.administrativeArea, a.postalCode].filter(Boolean).join(", ");
};

const summary = (loc) => ({
  name: str(loc?.name, 200),
  title: str(loc?.title, 200),
  address: addressOf(loc),
  phone: str(loc?.phoneNumbers?.primaryPhone, 40),
  website: str(loc?.websiteUri, 300),
  placeId: str(loc?.metadata?.placeId, 200),
});

// --- pick an existing profile -------------------------------------------------------------------
export async function listAccounts(client, api) {
  const a = api ?? (await apiFor(client));
  const out = await a.accounts.list({ pageSize: 20 });
  return (Array.isArray(out?.accounts) ? out.accounts : [])
    .map((x) => ({ name: str(x?.name, 80), accountName: str(x?.accountName, 200), type: str(x?.type, 40) }))
    .filter((x) => isAccount(x.name));
}

export async function listLocations(client, api, account) {
  if (!isAccount(account)) throw new GbpError("Choose an account.", 400, "bad_account");
  const a = api ?? (await apiFor(client));
  const out = await a.locations.list(account, { readMask: "name,title,storefrontAddress,phoneNumbers,websiteUri,metadata", pageSize: 100 });
  return (Array.isArray(out?.locations) ? out.locations : []).map(summary).filter((x) => isLocation(x.name));
}

/** Keep G3's manual tracker in step with the real profile, so the admin view is not two truths. */
function mirrorStatus(client) {
  const g = ensureGbp(client);
  const s = g.google?.status;
  if (s === "verified") g.status = "verified";
  else if (s === "verification_pending") g.status = "verification_pending";
  else if (s === "linked") g.status = "created";
  g.updatedAt = now();
}

/** Link a profile the owner already manages. It must really be in the account they picked. */
export async function linkLocation(client, api, { account, location } = {}) {
  if (!isAccount(account)) throw new GbpError("Choose an account.", 400, "bad_account");
  if (!isLocation(location)) throw new GbpError("Choose a location.", 400, "bad_location");
  const a = api ?? (await apiFor(client));
  const found = (await listLocations(client, a, account)).find((x) => x.name === location);
  if (!found) throw new GbpError("That location is not in that account.", 404, "not_found");
  const x = ensureGoogle(client);
  Object.assign(x, {
    account, location: found.name, title: found.title, address: found.address,
    phone: found.phone, website: found.website, status: "linked",
    linkedAt: x.linkedAt || now(), updatedAt: now(), verification: null,
  });
  await refreshVerification(client, a);
  mirrorStatus(client);
  return x;
}

/** Re-read Google's own state, so a grown-up verification done in the GBP UI also shows here. */
export async function refreshVerification(client, api) {
  const x = ensureGoogle(client);
  if (!isLocation(x.location)) return x;
  const a = api ?? (await apiFor(client));
  let state = null;
  try { state = await a.verifications.state(x.location); } catch { state = null; }
  if (state?.hasVoiceOfMerchant === true) {
    x.status = "verified";
    if (x.verification) x.verification.state = "completed";
  } else if (x.verification?.startedAt) {
    x.status = "verification_pending";
  }
  x.updatedAt = now();
  mirrorStatus(client);
  return x;
}

// --- create a new profile -----------------------------------------------------------------------
const phoneE164 = (raw) => normalisePhone(String(raw ?? "").trim(), { defaultCountry: REGION })?.e164 ?? "";

/** Validate the form once and build the Location body Google wants. No network. */
export function buildLocation(form = {}) {
  const title = str(form.title, 200);
  if (title.length < 2) throw new GbpError("Give the business a name.", 400, "bad_title");
  const phone = phoneE164(form.phone);
  if (!phone) throw new GbpError("That phone number does not look right.", 400, "bad_phone");
  const address = str(form.address, 300);
  const town = str(form.town, 100);
  if (!address || !town) throw new GbpError("Add a street address and a town.", 400, "bad_address");
  const category = str(form.category, 120);
  if (!category.startsWith(CATEGORY_PREFIX)) throw new GbpError("Choose a category.", 400, "bad_category");
  const postcode = str(form.postcode, 20);
  const province = str(form.province, 100) || "Santa Cruz de Tenerife";
  const website = str(form.website, 300);
  if (website && !/^https?:\/\//i.test(website)) throw new GbpError("The website must start with https://.", 400, "bad_website");
  const description = clamp(str(form.description, 2000), 750);

  return {
    title,
    phoneNumbers: { primaryPhone: phone },
    storefrontAddress: {
      regionCode: REGION,
      languageCode: "es",
      addressLines: [address],
      locality: town,
      ...(postcode ? { postalCode: postcode } : {}),
      administrativeArea: province,
    },
    categories: { primaryCategory: { name: category } },
    ...(website ? { websiteUri: website } : {}),
    ...(description ? { profile: { description } } : {}),
  };
}

/** Search Google for a listing that already exists. The search also uses the API's 300/day budget. */
async function searchRaw(api, form = {}) {
  const title = str(form.title, 200);
  if (title.length < 2) throw new GbpError("Give the business a name.", 400, "bad_title");
  // An object is more accurate than a string, and Google only needs the title plus whatever we know.
  const query = {
    title,
    ...(str(form.address, 300) ? { storefrontAddress: { regionCode: REGION, languageCode: "es", addressLines: [str(form.address, 300)], locality: str(form.town, 100) } } : {}),
    ...(phoneE164(form.phone) ? { phoneNumbers: { primaryPhone: phoneE164(form.phone) } } : {}),
  };
  const out = await api.googleLocations.search(query, { pageSize: MAX_CANDIDATES });
  return (Array.isArray(out?.googleLocations) ? out.googleLocations : []).slice(0, MAX_CANDIDATES);
}

const candidate = (g, fallbackTitle) => {
  const s = summary(g?.location ?? {});
  return {
    name: str(g?.name, 200),
    title: s.title || fallbackTitle,
    address: s.address,
    phone: s.phone,
    website: s.website,
    // Present only when someone already owns it. That is a claim link, not a create path.
    claimUrl: str(g?.requestAdminRightsUri, 1000),
    claimed: !!str(g?.requestAdminRightsUri, 1000),
  };
};

export async function lookup(client, api, form = {}) {
  const a = api ?? (await apiFor(client));
  return (await searchRaw(a, form)).map((g) => candidate(g, str(form.title, 200)));
}

/** Dry run. This is the only sandbox Google has, so the preview button always uses it. */
export async function preview(client, api, form) {
  const a = api ?? (await apiFor(client));
  const location = buildLocation(form);
  const account = str(form.account, 80);
  if (!isAccount(account)) throw new GbpError("Choose an account.", 400, "bad_account");
  await a.locations.create(account, location, { validateOnly: true });
  return { ok: true, location };
}

/**
 * Create for real. Refuses while a *claimed* listing matches: the owner has to claim that one, and
 * creating a sibling would be exactly the duplicate Google suspends profiles for. An *unclaimed*
 * match is reused instead, which is Google's documented path.
 */
export async function create(client, api, form = {}, { requestId } = {}) {
  const a = api ?? (await apiFor(client));
  const account = str(form.account, 80);
  if (!isAccount(account)) throw new GbpError("Choose an account.", 400, "bad_account");
  const built = buildLocation(form);

  const raw = await searchRaw(a, form);
  const candidates = raw.map((g) => candidate(g, str(form.title, 200)));
  const claimed = candidates.find((c) => c.claimed);
  if (claimed) {
    const e = new GbpError("This business is already on Google. Claim it instead of creating a new one.", 409, "exists");
    e.candidates = candidates;
    throw e;
  }
  // Preserve the matched listing's identity (place id, maps URL) when Google gave us one. Google
  // documents `GoogleLocation.location` as reusable in create while the listing is unclaimed; a
  // resource name is not part of a create body, so it is dropped.
  const matched = raw.find((g, i) => !candidates[i].claimed && g?.location)?.location;
  const base = matched ? { ...matched } : null;
  if (base) delete base.name;
  const body = base ? { ...base, ...built } : built;

  const created = await a.locations.create(account, body, { validateOnly: false, ...(requestId ? { requestId } : {}) });
  const s = summary(created);
  const x = ensureGoogle(client);
  Object.assign(x, {
    account,
    location: s.name || "",
    title: s.title || built.title,
    address: s.address || addressOf(built),
    phone: s.phone || built.phoneNumbers.primaryPhone,
    website: s.website || built.websiteUri || "",
    status: "linked",
    verification: null,
    linkedAt: now(),
    updatedAt: now(),
  });
  await refreshVerification(client, a);
  mirrorStatus(client);
  return { google: x, candidates };
}

// --- categories ---------------------------------------------------------------------------------
// The create form needs a real ID (`categories/gcid:*`), not the kit's search hint. The list is big
// and stable, so one fetch per language per hour is enough and keeps the picker instant.
const catCache = new Map();
export function resetCategories() { catCache.clear(); }

export async function categories(client, api, { q = "", lang = "es" } = {}) {
  const a = api ?? (await apiFor(client));
  const language = lang === "en" ? "en" : "es";
  let list = catCache.get(language)?.list;
  if (!list || Date.now() - catCache.get(language).at > CATEGORY_TTL) {
    const out = [];
    let pageToken = "";
    for (let page = 0; page < 25; page++) {
      const r = await a.categories.list({ languageCode: language, regionCode: REGION, pageSize: 200, pageToken });
      out.push(...(Array.isArray(r?.categories) ? r.categories : []));
      pageToken = r?.nextPageToken ?? "";
      if (!pageToken) break;
    }
    list = out
      .map((c) => ({ name: str(c?.name, 120), displayName: str(c?.displayName, 120), categoryType: str(c?.categoryType, 40) }))
      .filter((c) => c.name.startsWith(CATEGORY_PREFIX) && c.displayName);
    catCache.set(language, { at: Date.now(), list });
  }
  const needle = str(q, 80).toLowerCase();
  return (needle ? list.filter((c) => c.displayName.toLowerCase().includes(needle)) : list).slice(0, 40);
}

// --- verification -------------------------------------------------------------------------------
/** Google decides which methods exist (postcard/phone/SMS/email/auto). We never assume a set. */
export async function verificationOptions(client, api) {
  const x = ensureGoogle(client);
  if (!isLocation(x.location)) throw new GbpError("Link or create a profile first.", 409, "not_linked");
  const a = api ?? (await apiFor(client));
  const out = await a.verifications.options(x.location, { languageCode: "es" });
  const options = (Array.isArray(out?.options) ? out.options : [])
    .map((o) => ({
      method: METHODS.includes(o?.verificationMethod) ? o.verificationMethod : str(o?.verificationMethod, 40),
      phoneNumber: str(o?.phoneNumber, 40),
      emailAddress: str(o?.emailAddress, 200),
    }))
    .filter((o) => o.method);
  const state = await a.verifications.state(x.location).catch(() => null);
  if (state?.hasVoiceOfMerchant === true) {
    x.status = "verified";
    if (x.verification) x.verification.state = "completed";
    x.updatedAt = now();
  }
  mirrorStatus(client);
  return {
    options,
    state: state ? { hasVoiceOfMerchant: state.hasVoiceOfMerchant === true, action: str(state.gainVoiceOfMerchant?.action, 60) } : null,
    status: x.status,
    verification: x.verification,
  };
}

export async function startVerification(client, api, { method, phoneNumber, emailAddress } = {}) {
  const x = ensureGoogle(client);
  if (!isLocation(x.location)) throw new GbpError("Link or create a profile first.", 409, "not_linked");
  if (!METHODS.includes(method)) throw new GbpError("Choose a verification method.", 400, "bad_method");
  const a = api ?? (await apiFor(client));
  const phone = method === "SMS" || method === "PHONE_CALL" ? phoneE164(str(phoneNumber, 40) || x.phone) : "";
  if ((method === "SMS" || method === "PHONE_CALL") && !phone) throw new GbpError("That phone number does not look right.", 400, "bad_phone");
  const email = str(emailAddress, 200);
  if (method === "EMAIL" && !email) throw new GbpError("Add the email address Google should write to.", 400, "bad_email");
  const body = {
    method,
    languageCode: "es",
    ...(phone ? { phoneNumber: phone } : {}),
    ...(method === "EMAIL" ? { emailAddress: email } : {}),
  };

  const out = await a.verifications.verify(x.location, body);
  x.verification = {
    method,
    name: str(out?.name, 300),
    state: str(out?.state, 40) || "pending",
    startedAt: now(),
    completedAt: "",
  };
  x.status = "verification_pending";
  x.updatedAt = now();
  mirrorStatus(client);
  return x;
}

export async function completeVerification(client, api, { pin } = {}) {
  const x = ensureGoogle(client);
  if (!x.verification?.name) throw new GbpError("Start the verification first.", 409, "not_started");
  const code = String(pin ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) throw new GbpError("That code should be 6 digits.", 400, "bad_pin");
  const a = api ?? (await apiFor(client));
  await a.verifications.complete(x.verification.name, code);
  x.verification.state = "completed";
  x.verification.completedAt = now();
  await refreshVerification(client, a);
  if (x.status !== "verified") x.status = "verification_pending"; // Google may still review it
  x.updatedAt = now();
  mirrorStatus(client);
  return x;
}

export { addressOf as locationAddress };
