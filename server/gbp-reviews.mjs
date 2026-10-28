// Reviews and replies (plan G9). The reviews themselves are Google's: nothing here persists a
// reviewer's name or the text they wrote. What we keep on `client.gbp.reviews` is our own state — the
// auto-reply switch, the timestamp of the last automatic pass, drafts the AI wrote, and which review
// ids we have already answered.
//
// The rule that shapes this file: a 1-3 star review is never sent automatically. It is not a setting;
// `sendReply(..., { auto: true })` refuses it, so a bug in the sweep cannot answer a complaint with a
// cheerful template. The owner can still reply by hand after reading it.
//
// Replies are also held to Google's reply policy: no phone numbers, no links, no compensation offers.
// The AI is told so, and `checkReply()` refuses the obvious cases before the call.
import { db, save, now } from "./store.mjs";
import { ensureGbp, GbpError } from "./gbp-kit.mjs";
import { gbpApiEnabled } from "./gbp.mjs";
import { gbpAuthView } from "./gbp-auth.mjs";
import { ensureGoogle, apiFor } from "./gbp-google.mjs";
import { complete, aiKey, withClientAi } from "./openrouter.mjs";

/** Google's own limit for a review reply. */
export const REPLY_MAX = 4096;
/** What we ask the AI for: a shop reply, not an essay. */
export const DRAFT_MAX = 600;
/** Below this, a review is never answered without a human reading it first. */
export const AUTO_MIN_RATING = 4;
/** How often the automatic pass runs per business. */
export const AUTO_EVERY_MS = 6 * 3600e3;
/** Each automatic pass answers at most this many, so one bad day cannot spam the profile. */
export const AUTO_MAX_PER_PASS = 10;

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const isLocation = (v) => /^locations\/[A-Za-z0-9_-]+$/.test(String(v ?? ""));
const isAccount = (v) => /^accounts\/[A-Za-z0-9_-]+$/.test(String(v ?? ""));
const LANG_NAMES = { es: "Spanish", en: "English", de: "German", it: "Italian", nl: "Dutch", sv: "Swedish", fr: "French" };
/** A run of digits that could be dialled. At least 9, so a price or a year is not a phone. */
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;

/**
 * The review state that belongs to us. Everything is optional and defaults to "off", so a client that
 * predates G9 behaves exactly as before.
 */
export function ensureReviews(client) {
  const g = ensureGbp(client);
  const r = g.reviews && typeof g.reviews === "object" ? g.reviews : (g.reviews = {});
  if (typeof r.auto !== "boolean") r.auto = false;
  if (!r.drafts || typeof r.drafts !== "object") r.drafts = {};
  if (!r.sent || typeof r.sent !== "object") r.sent = {};
  if (!Number.isFinite(r.autoAt)) r.autoAt = 0;
  if (!Number.isFinite(r.failedAt)) r.failedAt = 0;
  if (typeof r.lastError !== "string") r.lastError = "";
  if (typeof r.lastSyncAt !== "string") r.lastSyncAt = "";
  return r;
}

/** What the portal may see of the settings. No drafts, no reviewer data. */
export function reviewSettings(client) {
  const r = ensureReviews(client);
  return { auto: r.auto, autoAt: r.autoAt, lastSyncAt: r.lastSyncAt, lastError: r.lastError, drafted: Object.keys(r.drafts).length };
}

function requireLinked(client) {
  const x = ensureGoogle(client);
  if (!isLocation(x.location)) throw new GbpError("Link or create a profile first.", 409, "not_linked");
  if (!isAccount(x.account)) throw new GbpError("Link the profile again to read its reviews.", 409, "not_linked");
  return x;
}

/** Ready to talk to Google at all: flag on, profile linked, token connected. */
export function reviewReady(client) {
  if (!gbpApiEnabled()) return { ready: false, reason: "disabled" };
  const g = ensureGoogle(client);
  if (!isLocation(g.location) || !isAccount(g.account)) return { ready: false, reason: "not_linked" };
  const auth = gbpAuthView(client);
  if (!auth.connected) return { ready: false, reason: auth.lastError === "reconnect" ? "reconnect" : "not_connected" };
  return { ready: true, reason: "" };
}

// --- reading ------------------------------------------------------------------------------------
/**
 * One review, shaped for the portal. `reviewer` is shown because the owner sees it on Google anyway,
 * but it is never written to disk by this module.
 */
export function normaliseReview(raw) {
  const id = str(raw?.reviewId, 200) || str(raw?.name, 300).split("/").pop() || "";
  const rating = Number(raw?.starRating);
  const reply = typeof raw?.reviewReply?.comment === "string" && raw.reviewReply.comment.trim()
    ? { comment: str(raw.reviewReply.comment, REPLY_MAX), at: str(raw.reviewReply.updateTime, 40) }
    : null;
  return {
    id,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 0,
    comment: str(raw?.comment, 4000),
    reviewer: str(raw?.reviewer?.displayName, 120),
    createdAt: str(raw?.createTime, 40),
    at: str(raw?.updateTime || raw?.createTime, 40),
    reply,
  };
}

export function summaryOf(reviews) {
  const list = Array.isArray(reviews) ? reviews : [];
  const rated = list.filter((r) => r.rating > 0);
  return {
    count: list.length,
    average: rated.length ? Math.round((rated.reduce((sum, r) => sum + r.rating, 0) / rated.length) * 10) / 10 : 0,
    unreplied: list.filter((r) => !r.reply).length,
  };
}

export async function listReviews(client, api, { max = 200 } = {}) {
  const x = requireLinked(client);
  const a = await apiFor(client, api);
  const raw = await a.reviews.listAll(x.account, x.location, { max });
  const r = ensureReviews(client);
  r.lastSyncAt = now();
  return raw.map(normaliseReview).filter((v) => v.id);
}

/** The review a request is about: from the list the caller already has, or a fresh read. */
async function findReview(client, api, reviewId, reviews) {
  const id = str(reviewId, 200);
  if (!id) throw new GbpError("Choose a review first.", 400, "bad_review");
  const list = Array.isArray(reviews) ? reviews : await listReviews(client, api);
  const found = list.find((v) => v.id === id);
  if (!found) throw new GbpError("That review is no longer on the profile.", 404, "not_found");
  return found;
}

// --- writing a reply ----------------------------------------------------------------------------
/** Google's reply policy in the two cases that matter. Returns the message for a refusal. */
export function checkReply(text) {
  const t = String(text ?? "").trim();
  if (!t) return "Write the reply first.";
  if (t.length > REPLY_MAX) return `A reply can be at most ${REPLY_MAX} characters.`;
  const numbers = (t.match(PHONE_RE) ?? []).filter((m) => {
    const digits = m.replace(/\D/g, "").length;
    return digits >= 9 && digits <= 15;
  });
  if (numbers.length) return "Google does not allow phone numbers in replies.";
  if (/https?:\/\//i.test(t)) return "Google does not allow links in replies.";
  // Narrow on purpose: "gluten free" is a menu fact, "we will refund you" is a public promise.
  if (/\b(reembolso|devoluci[oó]n|descuento|refund|discount)\b/i.test(t)) {
    return "Do not offer refunds or discounts in a public reply.";
  }
  return "";
}

/** Strip the model's packaging: quotes, a "Respuesta:" label, stray blank lines, the length cap. */
export function cleanDraft(text) {
  let t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  t = t.replace(/^(respuesta|reply|re:|response)\s*[:\-–]\s*/i, "").trim();
  t = t.replace(/^["'“”«»]+|["'“”«»]+$/g, "").trim();
  t = t.replace(/\n{3,}/g, "\n\n");
  if (t.length > DRAFT_MAX) {
    const cut = t.slice(0, DRAFT_MAX);
    t = cut.slice(0, Math.max(cut.lastIndexOf(" "), DRAFT_MAX - 80)).trim();
  }
  return t;
}

/** Everything the model needs, and nothing about the reviewer beyond what they wrote. */
export function draftPrompt(client, review, lang = "es") {
  const name = str(client.name, 200) || "the business";
  const kind = str(client.kind, 80);
  const town = str(client.town, 80);
  const language = LANG_NAMES[lang] ?? "Spanish";
  const rating = review.rating || "?";
  const stars = `${rating} star${rating === 1 ? "" : "s"}`;
  const tone = str(client.tone, 120) || "warm, direct, human";
  const low = review.rating > 0 && review.rating <= 3;
  return [
    `Business: ${name}${kind ? ` (${kind})` : ""}${town ? ` in ${town}` : ""}. Tone: ${tone}.`,
    `A customer left a ${stars} review${review.comment ? `:\n"""${review.comment}"""` : " with no text."}`,
    `Write the owner's public reply in ${language}, as one short paragraph of at most 400 characters.`,
    low
      ? "They are not happy. Apologise once and sincerely, take it seriously without admitting anything you cannot verify, and invite them to speak with the owner in person or by the contact details on the profile. Do not argue, do not blame them, do not explain the business's side at length."
      : "Thank them for the specific thing they mention, add one concrete detail only if it is in the review, and invite them back. No invented facts, no exclamation spam.",
    "Never promise refunds, discounts, free items or compensation. Never ask for personal data. No phone numbers, no links, no hashtags. Do not use the customer's name unless they wrote it themselves. Return the reply text only.",
  ].join("\n");
}

const writeReply = withClientAi(async function writeReply(client, review, lang, completeFn) {
  // Explicit undefined means "use the real provider chain"; an injected function is for tests.
  const call = completeFn === undefined ? (aiKey() ? complete : null) : completeFn;
  if (!call) throw new GbpError("No AI is configured, so write the reply yourself.", 503, "ai_unavailable");
  let out;
  try {
    out = await call({
      key: aiKey(),
      system: "You write public replies to Google reviews for small businesses in Tenerife. You are the owner: first person, plain language, never corporate.",
      prompt: draftPrompt(client, review, lang),
      tier: "default",
    });
  } catch (e) {
    console.warn("[gbp reviews] draft failed:", e.message);
    throw new GbpError("The AI is not answering right now. Write the reply yourself.", 503, "ai_unavailable");
  }
  const text = cleanDraft(out.text);
  if (!text) throw new GbpError("The AI returned nothing usable. Write the reply yourself.", 502, "ai_unavailable");
  return { text, model: str(out.model, 120) };
});

/** A draft in the client's own tone. Stored so the owner can send it from another device. */
export async function draftReply(client, api, reviewId, { lang = "es", reviews, keep = true, complete: completeFn } = {}) {
  const review = await findReview(client, api, reviewId, reviews);
  if (review.reply) throw new GbpError("This review already has a reply.", 409, "already_replied");
  const { text, model } = await writeReply(client, review, LANG_NAMES[lang] ? lang : "es", completeFn);
  if (keep) {
    const r = ensureReviews(client);
    r.drafts[review.id] = { text, at: now(), model };
  }
  return { review, draft: text };
}

/**
 * Send one reply. `auto: true` is the sweep's path: it may only touch 4-5 stars, and the check lives
 * here rather than in the caller so it cannot be forgotten.
 */
export async function sendReply(client, api, { reviewId, comment, replace = false, auto = false, reviews } = {}) {
  const x = requireLinked(client);
  const text = String(comment ?? "").replace(/\r\n/g, "\n").trim();
  const problem = checkReply(text);
  if (problem) throw new GbpError(problem, 400, "bad_reply");
  const review = await findReview(client, api, reviewId, reviews);
  if (auto && review.rating < AUTO_MIN_RATING) {
    throw new GbpError("Only 4 and 5 star reviews are answered automatically.", 409, "not_auto");
  }
  if (review.reply && !replace) throw new GbpError("This review already has a reply.", 409, "already_replied");
  const a = await apiFor(client, api);
  await a.reviews.reply(x.account, x.location, review.id, text);
  const r = ensureReviews(client);
  r.sent[review.id] = { at: now(), rating: review.rating, auto: !!auto };
  delete r.drafts[review.id];
  return { review: { ...review, reply: { comment: text, at: now() } }, replaced: !!review.reply };
}

export function setAutoReply(client, { auto } = {}) {
  if (typeof auto !== "boolean") throw new GbpError("Choose whether to answer automatically.", 400, "bad_setting");
  const r = ensureReviews(client);
  r.auto = auto;
  // Turning it on now would otherwise answer every old review on the next pass.
  if (auto) r.autoAt = Date.now();
  return reviewSettings(client);
}

// --- the automatic pass -------------------------------------------------------------------------
/**
 * One pass over every business that asked for automatic replies. Best effort per business: a Google
 * error marks the client's own state and never stops the loop. Returns what was actually sent.
 */
export async function autoReplies({ at = Date.now(), clients = db.clients, api, max = AUTO_MAX_PER_PASS, complete: completeFn } = {}) {
  const sent = [];
  for (const client of clients) {
    const r = ensureReviews(client);
    if (!r.auto) continue;
    if (at - r.autoAt < AUTO_EVERY_MS) continue;
    r.autoAt = at;
    const state = reviewReady(client);
    if (!state.ready) { r.lastError = state.reason; await save(); continue; }
    try {
      const reviews = await listReviews(client, api);
      const todo = reviews.filter((v) => !v.reply && v.rating >= AUTO_MIN_RATING).slice(0, max);
      for (const review of todo) {
        // A draft that breaks policy is simply not sent: the owner still sees the review as unreplied.
        const { draft } = await draftReply(client, api, review.id, { reviews, keep: false, complete: completeFn });
        if (checkReply(draft)) continue;
        await sendReply(client, api, { reviewId: review.id, comment: draft, auto: true, reviews });
        sent.push({ clientId: client.id, reviewId: review.id, rating: review.rating });
      }
      r.lastError = "";
    } catch (e) {
      r.lastError = str(e?.code, 40) || "failed";
      console.warn("[gbp reviews] automatic pass failed:", e?.message ?? e);
    }
    await save();
  }
  return sent;
}

/** Start the periodic pass. Only businesses with the switch on are touched, and only every 6 hours. */
export function startReviewAutoReplies() {
  setInterval(() => { void autoReplies().catch((e) => console.warn("[gbp reviews] sweep:", e.message)); }, 30 * 60e3).unref();
}
