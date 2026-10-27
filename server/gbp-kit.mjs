// The Google Business Profile fallback kit (plan B.2): everything a shop needs to set up or claim its
// profile by hand while the API access request is pending. This module never calls Google — the API
// needs Basic access approval and a profile that is 60+ days old (docs/gbp-api-notes.md), which is
// weeks away. It builds text the owner can paste, plus a status the portal can track.
//
// It must not invent facts: the description and posts are written only from the client's own profile,
// with the AI optional (no key = a usable draft from their own words, not an error). It must not
// pretend to know Google's category IDs either: those come from the categories API, which is behind
// the same approval, so we hand back names to search for in the picker.
import { now } from "./store.mjs";
import { complete, aiKey, extractJson, withClientAi } from "./openrouter.mjs";

export const STATUSES = ["not_started", "created", "verification_pending", "verified"];
export const DESC_MAX = 750;
/** Google's limit for a local post's summary text. */
export const POST_MAX = 1500;
export const POSTS = 10;
export const MAX_PHOTOS = 10;

const LANG_NAME = { es: "Spanish", en: "English" };
const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export class GbpError extends Error {
  constructor(message, status = 400, code = "") { super(message); this.status = status; this.code = code; }
}

/** GS1-style clamp that never cuts a word in half, and never returns more than `max` chars. */
export function clamp(text, max) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, "");
}

/**
 * Google's content policy forbids phone numbers in post text (they belong in the profile's phone
 * field, where they are clickable). Strip only runs that really look like a number, so prices,
 * years and opening times survive.
 */
export function redactPhones(text) {
  return String(text ?? "").replace(/(\+?\d[\d\s().-]{6,}\d)/g, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 9 ? "" : m;
  }).replace(/\s{2,}/g, " ").replace(/\(\s*\)|\[\s*\]/g, "").trim();
}

/** The manual mode block on the client. Idempotent; never overwrites an existing kit or status. */
export function ensureGbp(client) {
  if (!client.gbp || typeof client.gbp !== "object") {
    client.gbp = { mode: "manual", status: "not_started", notes: "", kit: null, updatedAt: now() };
  }
  if (!STATUSES.includes(client.gbp.status)) client.gbp.status = "not_started";
  if (typeof client.gbp.notes !== "string") client.gbp.notes = "";
  return client.gbp;
}

export function setStatus(client, { status, notes } = {}) {
  if (status !== undefined && !STATUSES.includes(status)) throw new GbpError("Choose a valid status.", 400, "bad_status");
  if (notes !== undefined && typeof notes !== "string") throw new GbpError("Notes must be text.", 400, "bad_notes");
  const g = ensureGbp(client);
  if (status !== undefined) g.status = status;
  if (notes !== undefined) g.notes = clamp(notes, 2000);
  g.updatedAt = now();
  return g;
}

/** What the portal and the admin dashboard get. No secrets, no other tenants. */
export function gbpView(client) {
  const g = ensureGbp(client);
  return { mode: g.mode, status: g.status, notes: g.notes, updatedAt: g.updatedAt, hasKit: !!g.kit, kit: g.kit };
}

/** Facts straight from the client record, so the kit is right even with no AI and no network. */
export function baseKit(client, lang = "es") {
  const p = client.profile ?? {};
  const town = str(client.town, 80);
  const kind = str(client.kind, 80);
  const services = Array.isArray(p.services) ? p.services.map((s) => str(typeof s === "string" ? s : s?.name, 120)).filter(Boolean).slice(0, 12) : [];
  const story = str(p.story, 1500) || str(client.offer, 1500);
  const tagline = str(p.tagline, 160);

  // No AI: the owner's own words, ordered by what reads best first, cut to Google's limit.
  const description = clamp([town ? `${client.name} — ${kind || "negocio"} en ${town}.` : `${client.name} — ${kind || "negocio"}.`, story || tagline].filter(Boolean).join(" "), DESC_MAX);

  return {
    mode: "manual",
    lang: LANG_NAME[lang] ? lang : "es",
    identity: {
      name: str(client.name, 200),
      kind,
      town,
      phone: str(client.phone, 40),
      website: str(client.websiteUrl || client.domain, 200),
      hours: str(client.hours, 400),
    },
    description,
    // Names to search in Google's category picker, never IDs: we cannot read the category list
    // without the API, and a wrong ID would be worse than a search term.
    categoryHints: [...new Set([kind, ...services.slice(0, 3)].filter(Boolean))].slice(0, 4),
    services,
    posts: [],
    photos: (Array.isArray(client.photos) ? client.photos : []).slice(0, MAX_PHOTOS).map((ph) => ({
      file: str(ph?.file, 200),
      alt: clamp([str(client.name, 80), kind, town].filter(Boolean).join(" · "), 200),
    })).filter((ph) => ph.file),
    source: "profile",
    generatedAt: now(),
  };
}

const POST_TYPES = ["update", "offer", "event"];

function promptFor(client, kit, lang) {
  return `You write Google Business Profile content for a small business in Tenerife.
Business: ${kit.identity.name}. Type: ${kit.identity.kind || "not given"}. Town: ${kit.identity.town || "not given"}.
Hours: ${kit.identity.hours || "not given"}. Services: ${kit.services.join(", ") || "not given"}.
Their own words: ${str(client.profile?.story, 800) || str(client.offer, 800) || "not given"}.

Write in ${LANG_NAME[lang] || "Spanish"}, in their voice, warm and concrete, never salesy.

Reply with ONLY one JSON object, no prose:
{"description":"...","categoryHints":["..."],"posts":[{"type":"update|offer|event","text":"..."}]}

Rules:
- "description": at most ${DESC_MAX} characters. Plain facts from the input. No prices, no phone numbers, no claims you cannot support.
- "posts": exactly ${POSTS} items. Each "text" at most ${POST_MAX} characters, one idea each, no hashtag spam (two at most), never a phone number.
- "categoryHints": 1-3 plain category names to type into Google's category picker (for example "Hair salon", "Restaurant", "Boat tour agency"). Names only, no IDs.
- Do not invent awards, years in business, ratings, or staff names.`;
}

/** Keep the AI honest: only the fields we asked for, clamped and de-phoned. */
function mergeAi(base, json) {
  if (!json || typeof json !== "object") return base;
  const description = clamp(str(json.description, 4000), DESC_MAX);
  const posts = Array.isArray(json.posts)
    ? json.posts.map((p) => ({
        type: POST_TYPES.includes(p?.type) ? p.type : "update",
        text: clamp(redactPhones(str(p?.text, 4000)), POST_MAX),
      })).filter((p) => p.text).slice(0, POSTS)
    : [];
  const hints = Array.isArray(json.categoryHints)
    ? json.categoryHints.map((h) => str(h, 80)).filter(Boolean).slice(0, 4)
    : [];
  return {
    ...base,
    description: description || base.description,
    categoryHints: hints.length ? hints : base.categoryHints,
    posts: posts.length ? posts : base.posts,
    source: description || posts.length ? "ai" : "profile",
    generatedAt: now(),
  };
}

/**
 * Build the kit. `complete` is injectable so tests never touch the network; otherwise the normal
 * provider chain is used, and with no key at all the profile-only draft comes back with `source:
 * "profile"` rather than an error (the checklist must work on day one).
 */
export async function draftKit(client, { lang = "es", complete: completeFn } = {}) {
  const l = LANG_NAME[lang] ? lang : "es";
  const base = baseKit(client, l);
  // Explicit null means "no AI at all" (tests, and shops with no provider configured).
  const call = completeFn === undefined ? (aiKey() ? complete : null) : completeFn;
  if (!call) return base;
  try {
    const out = await call({ key: aiKey(), tier: "default", prompt: promptFor(client, base, l), json: true, maxTokens: 3000 });
    return mergeAi(base, out?.json ?? extractJson(out?.text ?? ""));
  } catch (e) {
    // A provider outage must not block a shop that is ready to set its profile up today.
    console.warn("[gbp] kit generation failed:", str(e?.message, 200));
    return base;
  }
}

export const buildKit = withClientAi(draftKit);
