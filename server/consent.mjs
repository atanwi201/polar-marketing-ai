// Marketing consent (plan Part C): an append-only log with the exact text shown, per shop and per
// channel, plus the one-tap way out. The boolean on the card (`marketingConsent`) is still written,
// for every old reader, but the log is what a send must check and what proves what was agreed.
//
// Channels are WhatsApp and email (ATD's decision). SMS stays for card recovery only, never offers.
// A row is never edited: withdrawing appends `granted:false`, and `hasConsent` looks at the latest
// row for that (person, shop, channel). A customer with no rows is an old boolean card, so the
// boolean is the fallback for email (the channel it was collected for) and nothing collected before
// this module existed stops working.
import { createHash, randomBytes } from "node:crypto";
import { db, save, id, now } from "./store.mjs";
import { ldb, memberOf } from "./loyalty.mjs";

export const CHANNELS = ["whatsapp", "email"];
export const CONSENT_VERSION = "2026-10-v1";

export const CONSENT_COPY = {
  es: {
    title: "Ofertas y novedades",
    benefit: "Te avisamos de recompensas, ofertas y de cuando casi tienes tu premio.",
    label: { whatsapp: "WhatsApp", email: "Email" },
    text: {
      whatsapp: (biz) => `Quiero recibir ofertas y novedades de ${biz} por WhatsApp. Puedo darme de baja cuando quiera.`,
      email: (biz) => `Quiero recibir ofertas y novedades de ${biz} por email. Puedo darme de baja cuando quiera.`,
    },
    save: "Guardar",
    decline: "No gracias, solo la tarjeta",
    saved: "Guardado.",
    withdrawn: "He pedido dejar de recibir ofertas",
    unsubTitle: "Darte de baja",
    unsubBody: (biz) => `Dejaremos de enviarte ofertas y novedades de ${biz}. Tu tarjeta y tus sellos no cambian.`,
    unsubBtn: "Darme de baja",
    unsubDone: "Hecho. No te enviaremos más ofertas de este negocio.",
    unsubInvalid: "Este enlace no es válido o ya no se puede usar.",
    unsubAgain: "Ya estabas dado de baja. No cambia nada.",
    bonus: (n, kind) => `¡Gracias! Te hemos sumado ${n} ${kind === "points" ? (n === 1 ? "punto" : "puntos") : (n === 1 ? "sello" : "sellos")}.`,
  },
  en: {
    title: "Offers and news",
    benefit: "We'll let you know about rewards, offers, and when you're close to a prize.",
    label: { whatsapp: "WhatsApp", email: "Email" },
    text: {
      whatsapp: (biz) => `I want to receive offers and news from ${biz} on WhatsApp. I can unsubscribe at any time.`,
      email: (biz) => `I want to receive offers and news from ${biz} by email. I can unsubscribe at any time.`,
    },
    save: "Save",
    decline: "No thanks, just the card",
    saved: "Saved.",
    withdrawn: "I asked to stop receiving offers",
    unsubTitle: "Unsubscribe",
    unsubBody: (biz) => `We will stop sending you offers and news from ${biz}. Your card and stamps are unchanged.`,
    unsubBtn: "Unsubscribe",
    unsubDone: "Done. We will not send you any more offers from this business.",
    unsubInvalid: "This link is not valid any more.",
    unsubAgain: "You were already unsubscribed. Nothing changes.",
    bonus: (n, kind) => `Thanks! We added ${n} ${kind === "points" ? (n === 1 ? "point" : "points") : (n === 1 ? "stamp" : "stamps")}.`,
  },
};

export const langOf = (v) => (v === "en" ? "en" : "es");
export const textId = (channel, lang) => `${channel}-${langOf(lang)}-${CONSENT_VERSION}`;
export const withdrawTextId = (lang) => `withdraw-${langOf(lang)}-${CONSENT_VERSION}`;
export const consentText = (channel, lang, business) => {
  const c = CONSENT_COPY[langOf(lang)];
  return (c.text[channel] ?? (() => ""))(String(business ?? "").trim() || "…");
};

const sha = (v) => (v ? createHash("sha256").update(String(v)).digest("hex").slice(0, 32) : "");

/** Every consent row for this person at this shop, oldest first. */
export const rowsFor = (member, clientId) => ldb().consents.filter((r) => r.memberId === member?.id && r.clientId === clientId);

/** The latest row per channel, or undefined when this person never answered here. */
export function latestFor(member, clientId) {
  const out = {};
  for (const channel of CHANNELS) {
    const rows = rowsFor(member, clientId).filter((r) => r.channel === channel);
    out[channel] = rows.at(-1);
  }
  return out;
}

/**
 * Has this person agreed to this channel at this shop? Latest row wins. With no rows at all, the
 * legacy per-card boolean still counts — but only for email, because that is the channel it was
 * collected for. Treating it as a yes to WhatsApp would put words in the customer's mouth.
 */
export function hasConsent(who, clientId, channel) {
  if (!CHANNELS.includes(channel)) return false;
  const member = who?.memberToken ? who : (who?.memberId ? memberOf(who) : undefined);
  if (member) {
    const latest = latestFor(member, clientId)[channel];
    if (latest) return latest.granted === true;
    return channel === "email" && ldb().customers.some((c) => c.memberId === member.id && c.clientId === clientId && c.marketingConsent === true);
  }
  return channel === "email" && who?.marketingConsent === true;
}

/** `{whatsapp, email, decided}` for the card page. `decided` is false until any row exists. */
export function consentState(member, clientId) {
  const latest = latestFor(member, clientId);
  return {
    whatsapp: hasConsent(member, clientId, "whatsapp"),
    email: hasConsent(member, clientId, "email"),
    decided: CHANNELS.some((ch) => !!latest[ch]),
  };
}

/** Mirror email consent onto the card's boolean, so readers that predate the log keep working. */
function syncBooleans(member, clientId) {
  const email = consentState(member, clientId).email;
  for (const c of ldb().customers) if (c.memberId === member.id && c.clientId === clientId) c.marketingConsent = email;
}

/**
 * Append a grant. `customer` is the card the person was looking at; it is copied onto the row so an
 * erasure by card still finds it, but the member is the identity. `textShown` is built here from the
 * server's copy, never from the request.
 */
export function recordConsent({ member, customer, clientId, programId, channel, lang = "es", business = "", source = "card", ip = "", ua = "" } = {}) {
  if (!member || !CHANNELS.includes(channel)) return undefined;
  const row = {
    id: id(), memberId: member.id, customerId: customer?.id ?? "", clientId, programId: programId ?? customer?.programId ?? "",
    channel, textId: textId(channel, lang), textShown: consentText(channel, lang, business), granted: true, at: now(),
    ipHash: sha(ip), uaHash: sha(ua), source: String(source || "card").slice(0, 20),
    unsubToken: randomBytes(24).toString("base64url"),
  };
  ldb().consents.push(row);
  syncBooleans(member, clientId);
  void save();
  return row;
}

/** Append a withdrawal per channel; the card's boolean mirrors the email channel only. */
export function withdrawConsent({ member, clientId, channels = CHANNELS, lang = "es", source = "card", ip = "", ua = "" } = {}) {
  if (!member) return [];
  const list = (Array.isArray(channels) ? channels : [channels]).filter((ch) => CHANNELS.includes(ch));
  const out = [];
  for (const channel of list) {
    const row = {
      id: id(), memberId: member.id, customerId: "", clientId, programId: "", channel,
      textId: withdrawTextId(lang), textShown: CONSENT_COPY[langOf(lang)].withdrawn, granted: false, at: now(),
      ipHash: sha(ip), uaHash: sha(ua), source: String(source || "card").slice(0, 20), unsubToken: "",
    };
    ldb().consents.push(row);
    out.push(row);
  }
  syncBooleans(member, clientId);
  void save();
  return out;
}

/** The person and shop behind an unsubscribe link. */
export function byUnsubToken(token) {
  if (typeof token !== "string" || token.length < 24) return undefined;
  const row = ldb().consents.find((r) => r.unsubToken === token);
  if (!row) return undefined;
  const member = ldb().members.find((m) => m.id === row.memberId);
  const client = db.clients.find((c) => c.id === row.clientId);
  return member && client ? { row, member, client } : undefined;
}

/**
 * One row per (person, shop, channel) whose latest answer is yes. This is what an export or a send
 * list may use; `programName` is the programme the consent was given on, not a promise about which
 * programmes the person joined later.
 */
export function consentedContacts({ clientId } = {}) {
  const members = new Map(ldb().members.map((m) => [m.id, m]));
  const programs = new Map(ldb().programs.map((p) => [p.id, p]));
  const clients = new Map(db.clients.map((c) => [c.id, c]));
  const best = new Map();
  ldb().consents.forEach((r) => {
    if (!r.memberId || !CHANNELS.includes(r.channel)) return;
    if (clientId && r.clientId !== clientId) return;
    best.set(`${r.memberId}|${r.clientId}|${r.channel}`, r);
  });
  const out = [];
  for (const row of best.values()) {
    if (row.granted !== true) continue;
    const member = members.get(row.memberId);
    if (!member?.phone) continue;
    out.push({
      phone: member.phone,
      clientId: row.clientId,
      clientName: clients.get(row.clientId)?.name ?? "",
      programName: programs.get(row.programId)?.name ?? "",
      channel: row.channel,
      at: row.at,
      textId: row.textId,
    });
  }
  out.sort((a, b) => a.clientName.localeCompare(b.clientName) || a.phone.localeCompare(b.phone) || a.channel.localeCompare(b.channel));
  return out;
}
