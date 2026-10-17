// Pure logic for the WhatsApp receptionist: data types, availability, the multilingual
// rule-based responder used in demo mode, and the live AI prompt.
import type { Lang, Rec } from "../core/types";
import { eur } from "../core/plans";

/* ---------- Types ---------- */

/** Operator text with optional translations. `en` is the approved source. */
export type MText = { en: string } & Partial<Record<Lang, string>>;

export interface Trip {
  id: string;
  name: string;
  times: string[]; // "10:00"
  durationH: number;
  capacity: number;
  priceAdult: number;
  priceChild: number;
  childAge: string; // "3-11"
  keywords: string; // comma separated, any language
}
export interface Zone { name: string; fee: number; note: string } // fee per booking
export interface Faq { id: string; q: string; keys: string; a: MText }
export type ChannelId = "whatsapp" | "instagram" | "web" | "google";
export type ChannelState = "connected" | "pending" | "off";

export interface Bot extends Rec {
  clientId: string;
  active: boolean;
  trips: Trip[];
  zones: Zone[];
  meetingPoint: string;
  faq: Faq[];
  weatherRule: MText;
  cancellationRule: MText;
  languages: Lang[];
  handoffPhone: string;
  handoffHours: string;
  reminderHours: number[];
  reviewRequest: boolean;
  channels: Record<ChannelId, ChannelState>;
  baselineResponseMin: number;
}

export interface Reminder { kind: "reminder" | "review"; at: string; status: "scheduled" | "sent" | "cancelled" }
export type BookingStatus = "awaiting payment" | "paid" | "cancelled" | "weather-cancelled";
export interface Booking extends Rec {
  clientId: string;
  tripId: string;
  tripName: string;
  date: string;
  time: string;
  adults: number;
  children: number;
  guestName: string;
  guestPhone: string;
  lang: Lang;
  hotel?: string;
  zone?: string;
  total: number;
  status: BookingStatus;
  code: string;
  paymentLink: string;
  channel: ChannelId;
  chatId?: string;
  reminders: Reminder[];
}
export interface Block extends Rec { clientId: string; tripId: string; date: string; time: string; reason: string }

export interface Msg { from: "guest" | "bot" | "owner" | "note"; text: string; at: string }
export type Ask = "trip" | "date" | "group" | "time" | "pickup" | "confirm";
export interface QState {
  tripId?: string;
  date?: string;
  time?: string;
  adults?: number;
  children?: number;
  hotel?: string;
  zone?: string;
  noPickup?: boolean;
  lastAsk?: Ask;
  booking?: boolean; // the guest is in a booking flow
}
export interface Chat extends Rec {
  clientId: string;
  channel: ChannelId;
  guestName: string;
  guestPhone: string;
  lang?: Lang;
  messages: Msg[];
  state: QState;
  status: "open" | "booked" | "handoff" | "closed";
  bookingId?: string;
  firstResponseSec?: number;
  live?: boolean;
}
export interface Handoff extends Rec {
  clientId: string;
  chatId: string;
  guestName: string;
  guestPhone: string;
  lang: Lang;
  reason: string;
  summary: string;
  status: "open" | "resolved";
  taskId?: string;
  live: boolean;
  resolvedAt?: string;
}

export interface Turn {
  lang: Lang;
  reply: string;
  state: QState;
  action: "none" | "book" | "handoff";
  handoffReason?: string;
  summary?: string;
}

/* ---------- Dates and availability ---------- */

export const isoDay = (offset = 0) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 864e5);

export const LIVE_STATUSES: BookingStatus[] = ["awaiting payment", "paid"];

export interface SlotInfo { cap: number; booked: number; left: number; block?: Block }
export function slotInfo(bot: Bot, bookings: Booking[], blocks: Block[], tripId: string, date: string, time: string): SlotInfo {
  const trip = bot.trips.find((t) => t.id === tripId);
  const cap = trip?.capacity ?? 0;
  const booked = bookings
    .filter((b) => b.clientId === bot.clientId && b.tripId === tripId && b.date === date && b.time === time && LIVE_STATUSES.includes(b.status))
    .reduce((s, b) => s + b.adults + b.children, 0);
  const block = blocks.find((k) => k.clientId === bot.clientId && k.tripId === tripId && k.date === date && k.time === time);
  return { cap, booked, left: block ? 0 : Math.max(0, cap - booked), block };
}

export const BOOK_AHEAD_DAYS = 60;

export function bookingTotal(trip: Trip, adults: number, children: number, zone?: Zone) {
  return adults * trip.priceAdult + children * trip.priceChild + (zone?.fee ?? 0);
}

export function bookingCode(clientName: string) {
  const letters = clientName.replace(/[^A-Za-zÁÉÍÓÚÑ ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("").slice(0, 3) || "BK";
  const n = Math.floor(Date.now() / 1000).toString(36).toUpperCase().slice(-4);
  return `${letters}-${n}`;
}

/** Reminders as WhatsApp utility templates before the trip, plus an optional review request. */
export function scheduleReminders(bot: Bot, date: string, time: string): Reminder[] {
  const start = new Date(`${date}T${time}:00`);
  const out: Reminder[] = bot.reminderHours
    .map((h) => ({ kind: "reminder" as const, at: new Date(start.getTime() - h * 36e5).toISOString(), status: "scheduled" as const }))
    .filter((r) => new Date(r.at).getTime() > Date.now());
  if (bot.reviewRequest) out.push({ kind: "review", at: new Date(start.getTime() + 26 * 36e5).toISOString(), status: "scheduled" });
  return out;
}

/* ---------- Text helpers ---------- */

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, words: string[]) => words.some((w) => (w.includes(" ") ? text.includes(w) : new RegExp(`\\b${esc(w)}\\b`).test(text)));
export const tx = (t: MText, lang: Lang): { text: string; fallback: boolean } =>
  t[lang] ? { text: t[lang]!, fallback: false } : { text: t.en, fallback: lang !== "en" };

/* ---------- Language detection ---------- */

const LANG_WORDS: Partial<Record<Lang, string[]>> = {
  en: "hi hello hey we are the and for how much price prices cost book booking tomorrow today people adults kids children please thanks thank yes want would like can trip boat whales whale pickup staying our us my what when time is there do you any".split(" "),
  de: "hallo guten tag ich wir sind und fur wie viel kostet kosten preis buchen morgen ubermorgen heute personen erwachsene erwachsenen kinder kind bitte danke ja nein mochten mochte konnen gibt es abholung wohnen im walbeobachtung wale boot uhr wann ist noch frei platze".split(" "),
  it: "ciao buongiorno salve siamo e per quanto costa prezzo prenotare prenotazione domani dopodomani oggi persone adulti bambini bambino grazie vorrei vorremmo possiamo gita barca balene delfini albergo alle quando orario ci sono posti della".split(" "),
  es: "hola buenas buenos dias somos y para cuanto cuesta precio reservar reserva manana pasado hoy personas adultos ninos nino gracias quiero queremos podemos excursion barco ballenas delfines recogida estamos alojados cuando hora hay plazas".split(" "),
  nl: "wij zijn voor hoeveel kost prijs boeken personen kinderen volwassenen bedankt graag duiken hoe laat".split(" "),
  fr: "bonjour nous sommes pour combien prix reserver demain personnes enfants adultes merci oui voudrions bateau".split(" "),
};

export function detectLang(text: string): { lang: Lang | null; score: number } {
  const t = tokens(text);
  let best: Lang | null = null;
  let score = 0;
  for (const [l, words] of Object.entries(LANG_WORDS) as [Lang, string[]][]) {
    const s = t.filter((w) => words.includes(w)).length;
    if (s > score) { best = l; score = s; }
  }
  return { lang: best, score };
}

/* ---------- Parsing ---------- */

const MONTHS: Record<string, number> = {};
[
  "january february march april may june july august september october november december",
  "januar februar marz april mai juni juli august september oktober november dezember",
  "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre",
  "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre",
  "jan feb _ apr _ jun jul aug sep oct nov dec",
  "_ _ mrz _ _ _ _ _ sept okt _ dez",
].forEach((row) => row.split(" ").forEach((m, i) => { if (m !== "_") MONTHS[m] = i; }));
MONTHS["setiembre"] = 8;

const WEEKDAYS: Record<string, number> = {};
[
  "sunday monday tuesday wednesday thursday friday saturday",
  "sonntag montag dienstag mittwoch donnerstag freitag samstag",
  "domenica lunedi martedi mercoledi giovedi venerdi sabato",
  "domingo lunes martes miercoles jueves viernes sabado",
].forEach((row) => row.split(" ").forEach((w, i) => { WEEKDAYS[w] = i; }));

const NUM_WORDS: Record<string, number> = {};
[
  "_ one two three four five six seven eight nine ten eleven twelve",
  "_ ein zwei drei vier funf sechs sieben acht neun zehn elf zwolf",
  "_ uno due tre quattro cinque sei sette otto nove dieci undici dodici",
  "_ un dos tres cuatro cinco seis siete ocho nueve diez once doce",
].forEach((row) => row.split(" ").forEach((w, i) => { if (w !== "_") NUM_WORDS[w] = i; }));
Object.assign(NUM_WORDS, { eine: 1, einer: 1, einem: 1, una: 1, uno: 1 });

export type Intent = "greet" | "price" | "times" | "duration" | "book" | "yes" | "no" | "pickup" | "weather" | "cancelpolicy" | "human" | "sensitive" | "offtopic" | "thanks";

const INTENT_WORDS: Record<Intent, string[]> = {
  greet: ["hi", "hello", "hey", "hallo", "guten tag", "ciao", "buongiorno", "salve", "hola", "buenas", "buenos dias"],
  price: ["price", "prices", "cost", "costs", "how much", "rate", "rates", "preis", "preise", "kostet", "kosten", "wie viel", "wieviel", "prezzo", "prezzi", "quanto costa", "costo", "precio", "precios", "cuanto cuesta", "cuanto vale", "tarifa"],
  times: ["what time", "when", "times", "schedule", "depart", "departure", "start", "wann", "uhrzeit", "abfahrt", "orario", "orari", "partenza", "a che ora", "horario", "horarios", "salida", "a que hora", "cuando"],
  duration: ["how long", "duration", "wie lange", "dauer", "quanto dura", "durata", "cuanto dura", "duracion"],
  book: ["book", "booking", "reserve", "reservation", "available", "availability", "seats", "space", "buchen", "reservieren", "platz", "platze", "frei", "verfugbar", "prenotare", "prenotazione", "posti", "disponibile", "disponibilita", "reservar", "reserva", "plazas", "disponible", "disponibilidad", "hay sitio"],
  yes: ["yes", "yeah", "yep", "ok", "okay", "sure", "confirm", "go ahead", "ja", "gerne", "genau", "passt", "bestatige", "jawohl", "si", "certo", "va bene", "confermo", "perfetto", "vale", "claro", "confirmo", "perfecto", "de acuerdo"],
  no: ["no", "nein", "nope", "non", "not now", "doch nicht", "lieber nicht"],
  pickup: ["pickup", "pick up", "pick-up", "transfer", "collect", "abholung", "abholen", "prelievo", "trasferimento", "navetta", "recogida", "recoger", "traslado"],
  weather: ["weather", "wind", "waves", "rough", "storm", "wetter", "wellen", "sturm", "meteo", "vento", "mare mosso", "onde", "tiempo", "viento", "olas", "temporal"],
  cancelpolicy: ["cancel", "cancellation", "refund", "stornieren", "storno", "stornierung", "erstattung", "annullare", "cancellazione", "rimborso", "cancelar", "cancelacion", "reembolso", "devolucion"],
  human: ["human", "real person", "agent", "owner", "manager", "speak to", "talk to", "call me", "mensch", "mitarbeiter", "anrufen", "persona real", "operatore", "parlare con", "chiamare", "hablar con", "humano", "llamar"],
  sensitive: ["wheelchair", "rollstuhl", "sedia a rotelle", "silla de ruedas", "pregnant", "schwanger", "incinta", "embarazada", "allergy", "allergie", "allergia", "alergia", "complaint", "beschwerde", "reclamo", "queja", "lost", "verloren", "perso", "perdido", "private charter", "privat", "privato", "privado", "discount", "rabatt", "sconto", "descuento", "invoice", "rechnung", "fattura", "factura", "group rate"],
  offtopic: ["poem", "gedicht", "poesia", "poema", "essay", "homework", "hausaufgaben", "compiti", "deberes", "python", "javascript", "recipe", "rezept", "ricetta", "receta", "joke", "witz", "barzelletta", "chiste", "politics", "politik", "politica", "bitcoin", "crypto", "translate", "ubersetze", "traduci", "traduce", "president", "capital of"],
  thanks: ["thanks", "thank you", "danke", "grazie", "gracias", "bedankt", "merci"],
};

export interface Parsed {
  lang: Lang | null;
  langScore: number;
  date?: string;
  pastDate?: boolean;
  adults?: number;
  children?: number;
  total?: number;
  time?: string;
  timePref?: "am" | "pm";
  hotel?: string;
  zone?: string;
  noPickup?: boolean;
  tripId?: string;
  faqIds: string[];
  intents: Set<Intent>;
}

function nextWeekday(target: number, today: string) {
  const dow = new Date(today + "T12:00:00Z").getUTCDay();
  const diff = (target - dow + 7) % 7 || 7;
  return addDays(today, diff);
}

function makeDate(day: number, month: number, year: number | undefined, today: string): { date?: string; past?: boolean } {
  const y0 = year ?? Number(today.slice(0, 4));
  const y = y0 < 100 ? 2000 + y0 : y0;
  const dt = new Date(Date.UTC(y, month, day, 12));
  if (dt.getUTCMonth() !== month || day < 1) return {};
  let iso = dt.toISOString().slice(0, 10);
  if (iso < today) {
    if (year != null) return { date: iso, past: true };
    iso = new Date(Date.UTC(y + 1, month, day, 12)).toISOString().slice(0, 10);
  }
  return { date: iso };
}

export function parseDate(raw: string, today: string, lastAsk?: Ask): { date?: string; past?: boolean; pref?: "am" | "pm" } {
  let t = " " + norm(raw) + " ";
  let pref: "am" | "pm" | undefined;
  // Strip greetings and "morning" phrases that look like "tomorrow".
  t = t.replace(/guten morgen|buenas tardes|buenos dias|buon pomeriggio/g, " ");
  if (/por la manana|de la manana|esta manana|heute morgen|morgen fruh|morgens|vormittag|morning|mattina|mattino|ochtend|matin/.test(t)) pref = "am";
  if (/afternoon|nachmittag|pomeriggio|por la tarde|de la tarde|middag|apres-midi/.test(t)) pref = "pm";
  if (/heute morgen|esta manana/.test(t)) return { date: today, pref };
  t = t.replace(/por la manana|de la manana|morgen fruh/g, (m) => (m === "morgen fruh" ? "morgen" : " "));

  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return { date: iso, past: iso < today, pref };
  }
  if (/day after tomorrow|ubermorgen|dopodomani|pasado manana/.test(t)) return { date: addDays(today, 2), pref };
  if (/\b(tomorrow|morgen|domani|manana|demain)\b/.test(t)) return { date: addDays(today, 1), pref };
  if (/\b(today|tonight|heute|oggi|hoy|vandaag|aujourd'hui)\b/.test(t)) return { date: today, pref };

  for (const x of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th|\.)?\s*(?:de\s+|of\s+)?([a-z]{3,10})\b/g)) {
    if (MONTHS[x[2]] == null) continue;
    const r = makeDate(Number(x[1]), MONTHS[x[2]], undefined, today);
    if (r.date) return { ...r, pref };
  }
  for (const x of t.matchAll(/\b([a-z]{3,10})\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    if (MONTHS[x[1]] == null) continue;
    const r = makeDate(Number(x[2]), MONTHS[x[1]], undefined, today);
    if (r.date) return { ...r, pref };
  }
  m = t.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b(?!\s*(?:people|personen|persone|personas|adults|pax|uhr|h\b))/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    const r = makeDate(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : undefined, today);
    if (r.date) return { ...r, pref };
  }
  for (const [w, i] of Object.entries(WEEKDAYS)) if (new RegExp(`\\b${w}\\b`).test(t)) return { date: nextWeekday(i, today), pref };
  if (lastAsk === "date") {
    m = t.match(/^\s*(?:the\s+|am\s+|il\s+|el\s+)?(\d{1,2})(?:st|nd|rd|th|\.)?\s*$/);
    if (m) {
      const day = Number(m[1]);
      const mo = Number(today.slice(5, 7)) - 1;
      const r = makeDate(day, mo, undefined, today);
      if (r.date) return { ...r, pref };
    }
  }
  return { pref };
}

function withDigits(t: string) {
  return t.split(/(\s+)/).map((w) => (NUM_WORDS[w] != null ? String(NUM_WORDS[w]) : w)).join("");
}

export function parseGroup(raw: string, lastAsk?: Ask): { adults?: number; children?: number; total?: number } {
  const t = " " + withDigits(norm(raw).replace(/[,;!?]/g, " ")) + " ";
  const out: { adults?: number; children?: number; total?: number } = {};
  let m = t.match(/(\d{1,2})\s*(adults?|erwachsenen?|adulti|adulto|adultos|volwassenen|adultes)\b/);
  if (m) out.adults = Number(m[1]);
  m = t.match(/(\d{1,2})\s*(kids?|children|child|kindern?|kind|kinderen|bambini|bambino|bambina|bimbi|ragazzi|ninos|nino|ninas|nina|hijos|enfants)\b/);
  if (m) out.children = Number(m[1]);
  m = t.match(/(\d{1,2})\s*(people|persons|person|pax|guests|of us|personen|leute|persone|personas|gente|mensen|personnes)\b/)
    ?? t.match(/(?:we are|we're|there are|wir sind|siamo(?: in)?|somos|wij zijn|nous sommes)\s+(\d{1,2})\b/)
    ?? t.match(/(?:family of|famiglia di|familia de)\s+(\d{1,2})\b/)
    ?? t.match(/(?:\bfor|\bfur|\bper|\bpara)\s+(\d{1,2})(?![\d:.,])(?!\s*(?:€|eur|euro|uhr|am\b|pm\b|h\b|o'?clock|de\b|del\b|of\b|[a-z]+ber\b))/);
  if (m) out.total = Number(m[1]);
  if (/\b(zu zweit|in due|a couple|my (wife|husband|partner) and i|mi pareja y yo|mia moglie e io)\b/.test(t) && out.total == null && out.adults == null) out.total = 2;
  if (lastAsk === "group" && out.total == null && out.adults == null) {
    m = t.match(/^\s*(\d{1,2})\s*$/);
    if (m) out.total = Number(m[1]);
  }
  return out;
}

export function parseTime(raw: string, times: string[], lastAsk?: Ask): string | undefined {
  const t = norm(raw);
  const hours: { h: number; flex: boolean }[] = [];
  for (const m of t.matchAll(/\b(\d{1,2})(?:[:h](\d{2})|\.(00|15|30|45))\b/g)) hours.push({ h: Number(m[1]), flex: false });
  for (const m of t.matchAll(/\b(\d{1,2})\s*(am|pm)\b/g)) hours.push({ h: Number(m[1]) % 12 + (m[2] === "pm" ? 12 : 0), flex: false });
  for (const m of t.matchAll(/\b(\d{1,2})\s*(uhr|o'?clock)\b/g)) hours.push({ h: Number(m[1]), flex: true });
  for (const m of t.matchAll(/\b(?:at|um|alle|a las|a la|om|vers)\s+(\d{1,2})\b(?![:.\d])/g)) hours.push({ h: Number(m[1]), flex: true });
  if (lastAsk === "time") { const m = t.match(/^\s*(\d{1,2})\s*$/); if (m) hours.push({ h: Number(m[1]), flex: true }); }
  for (const { h, flex } of hours) {
    const hit = times.find((x) => { const xh = Number(x.split(":")[0]); return xh === h || (flex && h >= 1 && h <= 7 && xh === h + 12); });
    if (hit) return hit;
  }
  return undefined;
}

const HOTEL_RE = /\b(hotel|aparthotel|apartamentos|apartments?|resort|villa|residence|residencia)\s+((?:[\wÁÉÍÓÚÑÜáéíóúñü'&-]+\s?){1,5})/i;
const HOTEL_STOP = new Set("in en im at a al and und y e we wir noi nos need brauchen for fur für para per with mit con please bitte near by and, from von da desde ci tomorrow morgen domani mañana manana".split(" "));
function hotelName(text: string): string | undefined {
  const m = text.match(HOTEL_RE);
  if (!m) return undefined;
  const words: string[] = [];
  for (const w of m[2].trim().split(/\s+/)) { if (HOTEL_STOP.has(w.toLowerCase())) break; words.push(w); }
  if (!words.length) return undefined;
  const label = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return `${label} ${words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}`;
}
const NO_PICKUP_RE = /(no pickup|without pickup|no need for pickup|don'?t need (a )?pickup|we have a car|own car|rental car|hire car|meet (you )?at the (harbou?r|port|marina)|come to the (harbou?r|port|marina)|ohne abholung|keine abholung|mietwagen|selbst zum hafen|zum hafen kommen|senza (transfer|pickup|prelievo|navetta)|abbiamo (la|una) macchina|al porto da soli|veniamo al porto|sin recogida|tenemos coche|vamos al puerto|vamos directamente al puerto|nos vemos en el puerto)/;

export function parse(text: string, bot: Bot, today: string, lastAsk?: Ask): Parsed {
  const n = " " + norm(text) + " ";
  const { lang, score } = detectLang(text);
  const d = parseDate(text, today, lastAsk);
  const g = parseGroup(text, lastAsk);
  const intents = new Set<Intent>();
  (Object.keys(INTENT_WORDS) as Intent[]).forEach((k) => { if (has(n, INTENT_WORDS[k])) intents.add(k); });
  if (/\?/.test(text) && intents.has("yes")) intents.delete("yes");

  let tripId: string | undefined;
  if (bot.trips.length === 1) tripId = bot.trips[0].id;
  else {
    for (const tr of bot.trips) {
      const keys = [tr.name, ...tr.keywords.split(",")].map((k) => norm(k).trim()).filter((k) => k.length > 2);
      if (has(n, keys)) { tripId = tr.id; break; }
    }
  }
  if (!tripId && lastAsk === "trip") {
    const m = n.match(/^\s*(\d)\s*$/);
    if (m && bot.trips[Number(m[1]) - 1]) tripId = bot.trips[Number(m[1]) - 1].id;
  }
  const allTimes = [...new Set((tripId ? bot.trips.filter((x) => x.id === tripId) : bot.trips).flatMap((x) => x.times))];
  const time = parseTime(text, allTimes, lastAsk);
  if (!tripId && time) {
    const owners = bot.trips.filter((x) => x.times.includes(time));
    if (owners.length === 1) tripId = owners[0].id;
  }

  let zone: string | undefined;
  for (const z of bot.zones) {
    const zn = norm(z.name);
    const last = zn.split(" ").pop() ?? "";
    if (n.includes(zn) || (last.length > 4 && new RegExp(`\\b${last}\\b`).test(n))) { zone = z.name; break; }
  }
  const hotel = hotelName(text);

  const faqIds = bot.faq
    .filter((f) => has(n, f.keys.split(",").map((k) => norm(k).trim()).filter((k) => k.length > 2)))
    .map((f) => f.id);

  return {
    lang, langScore: score,
    date: d.date, pastDate: d.past, timePref: d.pref,
    adults: g.adults, children: g.children, total: g.total,
    time, hotel, zone, noPickup: NO_PICKUP_RE.test(n), tripId, faqIds, intents,
  };
}

/* ---------- Reply templates (EN/DE/IT/ES) ---------- */

type TL = "en" | "de" | "it" | "es";
const LOCALE: Record<TL, string> = { en: "en-GB", de: "de-DE", it: "it-IT", es: "es-ES" };
export const fmtDay = (iso: string, l: TL) =>
  new Date(iso + "T12:00:00").toLocaleDateString(LOCALE[l], { weekday: "long", day: "numeric", month: "long" });

interface Summary { trip: string; date: string; time: string; adults: number; children: number; pickup: string; total: string }
interface Tpl {
  greet: (biz: string) => string;
  askTrip: (names: string[]) => string;
  askDate: string;
  askGroup: string;
  askTime: (date: string, opts: string[]) => string;
  askPickup: (zones: string[], meeting: string) => string;
  askArea: (hotel: string, zones: string[]) => string;
  price: (lines: string[]) => string;
  priceLine: (trip: string, a: string, c: string, age: string) => string;
  times: (trip: string, times: string, h: number) => string;
  full: (date: string, time: string, alts: string[]) => string;
  confirm: (s: Summary) => string;
  booked: (code: string, link: string, rem: string) => string;
  handoff: (phone: string, hours: string) => string;
  tooBig: (cap: number) => string;
  offtopic: (biz: string) => string;
  thanks: string;
  change: string;
  past: string;
  tooFar: string;
  inEnglish: string;
  weather: string;
  cancel: string;
  pickupFee: (z: string, fee: string) => string;
  meet: (p: string) => string;
  seats: (n: number) => string;
  kidsWord: string;
  noPickup: (m: string) => string;
  free: string;
}

export const T: Record<TL, Tpl> = {
  en: {
    greet: (b) => `Hi! This is the ${b} booking assistant. Tell me your date and group size and I will check seats for you.`,
    askTrip: (n) => `Which trip would you like? ${n.join(" / ")}`,
    askDate: "Which date would you like to go?",
    askGroup: "How many people are you? Please tell me adults and children.",
    askTime: (d, o) => `For ${d} we have: ${o.join(", ")}. Which time suits you?`,
    askPickup: (z, m) => `Do you need hotel pickup? We pick up in ${z.join(", ")}. Or meet us at ${m}.`,
    askArea: (h, z) => `Thanks. Which area is ${h} in? We pick up in ${z.join(", ")}.`,
    price: (l) => `Our prices:\n${l.join("\n")}`,
    priceLine: (t, a, c, age) => `${t}: adults ${a}, children ${age} ${c}`,
    times: (t, x, h) => `${t} leaves at ${x} and lasts about ${h} hours.`,
    full: (d, t, a) => (a.length ? `Sorry, ${d} at ${t} does not have enough seats. Free options: ${a.join(", ")}.` : `Sorry, ${d} is fully booked. Would another date work?`),
    confirm: (s) => `Here is your booking:\n${s.trip}, ${s.date} at ${s.time}\n${s.adults} adult${s.adults === 1 ? "" : "s"}${s.children ? `, ${s.children} ${s.children === 1 ? "child" : "children"}` : ""}\n${s.pickup}\nTotal: ${s.total}\n\nReply YES to confirm and I will send the payment link.`,
    booked: (c, l, r) => `Booked. Your reference is ${c}.\nPay here to secure your seats: ${l}\n${r}`,
    handoff: (p, h) => `Good question. I will pass this to the team so you get the right answer. They will reply here shortly (${h}), or call ${p}.`,
    tooBig: (c) => `Our boat takes up to ${c} guests per trip, so a group your size needs a private arrangement.`,
    offtopic: (b) => `Sorry, I can only help with ${b} trips, prices and bookings.`,
    thanks: "You are welcome! Anything else I can help with?",
    change: "No problem. What would you like to change?",
    past: "That date has already passed. Which upcoming date would you like?",
    tooFar: "We take bookings up to 60 days ahead. Could you pick an earlier date?",
    inEnglish: "",
    weather: "Weather policy:",
    cancel: "Cancellation policy:",
    pickupFee: (z, f) => `${z} (${f})`,
    meet: (p) => `Meeting point: ${p}`,
    seats: (n) => `${n} seats left`,
    kidsWord: "children", free: "free",
    noPickup: (m) => `No pickup. Meeting point: ${m}`,
  },
  de: {
    greet: (b) => `Hallo! Hier ist der Buchungsassistent von ${b}. Nennen Sie mir Datum und Personenzahl, dann prüfe ich die freien Plätze.`,
    askTrip: (n) => `Welche Tour möchten Sie? ${n.join(" / ")}`,
    askDate: "An welchem Tag möchten Sie fahren?",
    askGroup: "Wie viele Personen sind Sie? Bitte Erwachsene und Kinder angeben.",
    askTime: (d, o) => `Am ${d} haben wir: ${o.join(", ")}. Welche Uhrzeit passt Ihnen?`,
    askPickup: (z, m) => `Brauchen Sie eine Hotelabholung? Wir holen ab in ${z.join(", ")}. Oder Treffpunkt: ${m}.`,
    askArea: (h, z) => `Danke. In welchem Ort liegt ${h}? Wir holen ab in ${z.join(", ")}.`,
    price: (l) => `Unsere Preise:\n${l.join("\n")}`,
    priceLine: (t, a, c, age) => `${t}: Erwachsene ${a}, Kinder ${age} ${c}`,
    times: (t, x, h) => `${t} startet um ${x} und dauert etwa ${h} Stunden.`,
    full: (d, t, a) => (a.length ? `Leider ist am ${d} um ${t} nicht genug Platz. Freie Termine: ${a.join(", ")}.` : `Leider ist der ${d} ausgebucht. Passt ein anderer Tag?`),
    confirm: (s) => `Ihre Buchung:\n${s.trip}, ${s.date} um ${s.time}\n${s.adults} Erwachsene${s.children ? `, ${s.children} ${s.children === 1 ? "Kind" : "Kinder"}` : ""}\n${s.pickup}\nGesamt: ${s.total}\n\nAntworten Sie mit JA, dann schicke ich den Zahlungslink.`,
    booked: (c, l, r) => `Gebucht. Ihre Buchungsnummer ist ${c}.\nHier bezahlen, um die Plätze zu sichern: ${l}\n${r}`,
    handoff: (p, h) => `Gute Frage. Ich gebe das an das Team weiter, damit Sie die richtige Antwort bekommen. Sie melden sich hier in Kürze (${h}), oder rufen Sie ${p} an.`,
    tooBig: (c) => `Unser Boot fasst bis zu ${c} Gäste pro Fahrt, für Ihre Gruppe brauchen wir eine private Lösung.`,
    offtopic: (b) => `Entschuldigung, ich kann nur bei Touren, Preisen und Buchungen von ${b} helfen.`,
    thanks: "Gern geschehen! Kann ich sonst noch helfen?",
    change: "Kein Problem. Was möchten Sie ändern?",
    past: "Dieses Datum liegt in der Vergangenheit. Welcher kommende Tag passt Ihnen?",
    tooFar: "Wir nehmen Buchungen bis 60 Tage im Voraus an. Passt ein früherer Termin?",
    inEnglish: "(Antwort des Teams auf Englisch:)",
    weather: "Wetterregel:",
    cancel: "Stornobedingungen:",
    pickupFee: (z, f) => `${z} (${f})`,
    meet: (p) => `Treffpunkt: ${p}`,
    seats: (n) => `noch ${n} Plätze`,
    kidsWord: "Kinder", free: "gratis",
    noPickup: (m) => `Keine Abholung. Treffpunkt: ${m}`,
  },
  it: {
    greet: (b) => `Ciao! Sono l'assistente prenotazioni di ${b}. Dimmi la data e quante persone siete e controllo i posti liberi.`,
    askTrip: (n) => `Quale escursione preferite? ${n.join(" / ")}`,
    askDate: "Per quale giorno volete prenotare?",
    askGroup: "Quante persone siete? Indicatemi adulti e bambini.",
    askTime: (d, o) => `Per ${d} abbiamo: ${o.join(", ")}. Quale orario preferite?`,
    askPickup: (z, m) => `Vi serve il prelievo in hotel? Passiamo a ${z.join(", ")}. Oppure ci vediamo a ${m}.`,
    askArea: (h, z) => `Grazie. In quale zona si trova ${h}? Passiamo a ${z.join(", ")}.`,
    price: (l) => `I nostri prezzi:\n${l.join("\n")}`,
    priceLine: (t, a, c, age) => `${t}: adulti ${a}, bambini ${age} ${c}`,
    times: (t, x, h) => `${t} parte alle ${x} e dura circa ${h} ore.`,
    full: (d, t, a) => (a.length ? `Mi dispiace, ${d} alle ${t} non ci sono abbastanza posti. Disponibili: ${a.join(", ")}.` : `Mi dispiace, ${d} è tutto esaurito. Va bene un altro giorno?`),
    confirm: (s) => `Ecco la vostra prenotazione:\n${s.trip}, ${s.date} alle ${s.time}\n${s.adults} ${s.adults === 1 ? "adulto" : "adulti"}${s.children ? `, ${s.children} ${s.children === 1 ? "bambino" : "bambini"}` : ""}\n${s.pickup}\nTotale: ${s.total}\n\nRispondete SÌ per confermare e vi mando il link di pagamento.`,
    booked: (c, l, r) => `Prenotato. Il vostro codice è ${c}.\nPagate qui per bloccare i posti: ${l}\n${r}`,
    handoff: (p, h) => `Bella domanda. La passo al team così avrete la risposta giusta. Vi rispondono qui a breve (${h}), oppure chiamate ${p}.`,
    tooBig: (c) => `La barca porta fino a ${c} ospiti per uscita, per un gruppo come il vostro serve un'uscita privata.`,
    offtopic: (b) => `Scusate, posso aiutare solo con escursioni, prezzi e prenotazioni di ${b}.`,
    thanks: "Prego! Posso aiutarvi in altro?",
    change: "Nessun problema. Cosa volete cambiare?",
    past: "Quella data è già passata. Quale giorno volete?",
    tooFar: "Accettiamo prenotazioni fino a 60 giorni prima. Potete scegliere una data più vicina?",
    inEnglish: "(Risposta del team in inglese:)",
    weather: "Regola meteo:",
    cancel: "Cancellazione:",
    pickupFee: (z, f) => `${z} (${f})`,
    meet: (p) => `Punto d'incontro: ${p}`,
    seats: (n) => `${n} posti liberi`,
    kidsWord: "bambini", free: "gratis",
    noPickup: (m) => `Nessun prelievo. Punto d'incontro: ${m}`,
  },
  es: {
    greet: (b) => `¡Hola! Soy el asistente de reservas de ${b}. Dime la fecha y cuántas personas sois y miro las plazas libres.`,
    askTrip: (n) => `¿Qué excursión os interesa? ${n.join(" / ")}`,
    askDate: "¿Qué día queréis ir?",
    askGroup: "¿Cuántas personas sois? Dime adultos y niños, por favor.",
    askTime: (d, o) => `Para el ${d} tenemos: ${o.join(", ")}. ¿Qué hora os va mejor?`,
    askPickup: (z, m) => `¿Necesitáis recogida en el hotel? Recogemos en ${z.join(", ")}. O nos vemos en ${m}.`,
    askArea: (h, z) => `Gracias. ¿En qué zona está ${h}? Recogemos en ${z.join(", ")}.`,
    price: (l) => `Nuestros precios:\n${l.join("\n")}`,
    priceLine: (t, a, c, age) => `${t}: adultos ${a}, niños ${age} ${c}`,
    times: (t, x, h) => `${t} sale a las ${x} y dura unas ${h} horas.`,
    full: (d, t, a) => (a.length ? `Lo siento, el ${d} a las ${t} no quedan plazas suficientes. Opciones libres: ${a.join(", ")}.` : `Lo siento, el ${d} está completo. ¿Os va bien otro día?`),
    confirm: (s) => `Esta es vuestra reserva:\n${s.trip}, ${s.date} a las ${s.time}\n${s.adults} ${s.adults === 1 ? "adulto" : "adultos"}${s.children ? `, ${s.children} ${s.children === 1 ? "niño" : "niños"}` : ""}\n${s.pickup}\nTotal: ${s.total}\n\nResponded SÍ para confirmar y os envío el enlace de pago.`,
    booked: (c, l, r) => `Reservado. Vuestra referencia es ${c}.\nPagad aquí para asegurar las plazas: ${l}\n${r}`,
    handoff: (p, h) => `Buena pregunta. Se lo paso al equipo para daros la respuesta correcta. Os contestan aquí en breve (${h}), o llamad al ${p}.`,
    tooBig: (c) => `El barco lleva hasta ${c} personas por salida, para un grupo así hace falta una salida privada.`,
    offtopic: (b) => `Lo siento, solo puedo ayudar con excursiones, precios y reservas de ${b}.`,
    thanks: "¡De nada! ¿Te ayudo con algo más?",
    change: "Sin problema. ¿Qué queréis cambiar?",
    past: "Esa fecha ya ha pasado. ¿Qué día queréis?",
    tooFar: "Aceptamos reservas hasta 60 días antes. ¿Podéis elegir una fecha más cercana?",
    inEnglish: "(Respuesta del equipo en inglés:)",
    weather: "Norma por mal tiempo:",
    cancel: "Cancelación:",
    pickupFee: (z, f) => `${z} (${f})`,
    meet: (p) => `Punto de encuentro: ${p}`,
    seats: (n) => `${n} plazas libres`,
    kidsWord: "niños", free: "gratis",
    noPickup: (m) => `Sin recogida. Punto de encuentro: ${m}`,
  },
};

export const replyLang = (lang: Lang, bot: Bot): TL =>
  (["en", "de", "it", "es"] as const).includes(lang as TL) && bot.languages.includes(lang) ? (lang as TL) : "en";

export function reminderLine(l: TL, rems: Reminder[]) {
  const n = rems.filter((r) => r.kind === "reminder").length;
  if (!n) return "";
  const s: Record<TL, string> = {
    en: `I will send you ${n} reminder${n > 1 ? "s" : ""} before the trip.`,
    de: `Ich schicke Ihnen ${n} Erinnerung${n > 1 ? "en" : ""} vor der Tour.`,
    it: `Vi manderò ${n} promemoria prima dell'escursione.`,
    es: `Os enviaré ${n} recordatorio${n > 1 ? "s" : ""} antes de la excursión.`,
  };
  return s[l];
}

/* ---------- Rule-based responder (demo mode) ---------- */

export interface Ctx {
  bot: Bot;
  bizName: string;
  bookings: Booking[];
  blocks: Block[];
  chat: Chat;
  text: string;
  today: string;
}

function alternatives(ctx: Ctx, tripId: string, date: string, group: number, l: TL): string[] {
  const { bot, bookings, blocks, today } = ctx;
  const trip = bot.trips.find((t) => t.id === tripId)!;
  const out: string[] = [];
  for (let i = 0; i < 10 && out.length < 3; i++) {
    const d = addDays(date, i);
    if (d < today) continue;
    for (const time of trip.times) {
      if (out.length >= 3) break;
      const s = slotInfo(bot, bookings, blocks, tripId, d, time);
      if (s.left >= group) out.push(`${fmtDay(d, l)} ${time} (${T[l].seats(s.left)})`);
    }
  }
  return out;
}

export function ruleRespond(ctx: Ctx): Turn {
  const { bot, chat, text, today, bizName } = ctx;
  const prev = chat.state;
  const p = parse(text, bot, today, prev.lastAsk);
  const guestMsgs = chat.messages.filter((m) => m.from === "guest").length;
  const lang: Lang = p.lang && (p.langScore >= 2 || !chat.lang || guestMsgs <= 1) ? p.lang : chat.lang ?? p.lang ?? "en";
  const l = replyLang(lang, bot);
  const L = T[l];
  const s: QState = { ...prev };
  const parts: string[] = [];
  const handoff = (reason: string, prefix = ""): Turn => ({
    lang, state: { ...s, lastAsk: undefined }, action: "handoff", handoffReason: reason,
    reply: (prefix ? prefix + " " : "") + L.handoff(bot.handoffPhone, bot.handoffHours),
    summary: demoSummary(ctx, s, lang, reason),
  });

  const pickupNo = prev.lastAsk === "pickup" && p.intents.has("no");
  const newInfo = !!(p.date || p.adults != null || p.children != null || p.total != null || p.time || p.zone || p.hotel || p.noPickup || pickupNo || (p.tripId && bot.trips.length > 1));

  if (p.intents.has("offtopic") && !newInfo) return { lang, state: s, action: "none", reply: L.offtopic(bizName) };
  if (p.intents.has("sensitive")) return handoff("Needs a personal answer (special request, discount, complaint or medical).");
  if (p.intents.has("human")) return handoff("Guest asked to talk to a person.");

  // Merge what the guest told us.
  if (p.tripId) s.tripId = p.tripId;
  if (p.pastDate) parts.push(L.past);
  else if (p.date) {
    if (daysBetween(today, p.date) > BOOK_AHEAD_DAYS) parts.push(L.tooFar);
    else { if (p.date !== s.date) s.time = undefined; s.date = p.date; }
  }
  if (p.adults != null) s.adults = p.adults;
  if (p.children != null) s.children = p.children;
  if (p.total != null) { s.children = p.children ?? s.children ?? 0; s.adults = p.adults ?? Math.max(1, p.total - (s.children ?? 0)); }
  if (p.time) s.time = p.time;
  if (p.zone) { s.zone = p.zone; s.noPickup = false; }
  if (p.hotel) s.hotel = p.hotel;
  if (p.noPickup || (prev.lastAsk === "pickup" && p.intents.has("no") && !p.zone && !p.hotel)) { s.noPickup = true; s.zone = undefined; }
  if (newInfo || p.intents.has("book")) s.booking = true;

  // Confirmation step.
  if (prev.lastAsk === "confirm" && !newInfo) {
    if (p.intents.has("yes")) return { lang, state: { ...s, lastAsk: undefined }, action: "book", reply: "" };
    if (p.intents.has("no")) return { lang, state: { ...s, lastAsk: undefined }, action: "none", reply: L.change };
  }

  // Information answers from the operator's data only.
  const trips = s.tripId ? bot.trips.filter((t) => t.id === s.tripId) : bot.trips;
  if (p.intents.has("price")) {
    const lines = trips.map((t) => L.priceLine(t.name, eur(t.priceAdult), eur(t.priceChild), `(${t.childAge})`));
    const fees = bot.zones.filter((z) => z.fee > 0).map((z) => L.pickupFee(z.name, eur(z.fee)));
    if (fees.length) lines.push(`${l === "en" ? "Pickup" : l === "de" ? "Abholung" : l === "it" ? "Prelievo" : "Recogida"}: ${fees.join(", ")}`);
    parts.push(L.price(lines));
  }
  if (p.intents.has("times") || p.intents.has("duration")) trips.forEach((t) => parts.push(L.times(t.name, t.times.join(" / "), t.durationH)));
  for (const id of p.faqIds.slice(0, 2)) {
    const f = bot.faq.find((x) => x.id === id)!;
    const r = tx(f.a, l);
    parts.push(r.fallback && L.inEnglish ? `${L.inEnglish}\n${r.text}` : r.text);
  }
  if (p.intents.has("weather")) { const r = tx(bot.weatherRule, l); parts.push(`${L.weather} ${r.fallback ? L.inEnglish + " " : ""}${r.text}`); }
  if (p.intents.has("cancelpolicy")) { const r = tx(bot.cancellationRule, l); parts.push(`${L.cancel} ${r.fallback ? L.inEnglish + " " : ""}${r.text}`); }
  if (p.intents.has("pickup") && !s.booking) parts.push(L.askPickup(bot.zones.map((z) => L.pickupFee(z.name, z.fee ? eur(z.fee) : L.free)), bot.meetingPoint));

  const answered = parts.length > 0;
  const finish = (ask: Ask | undefined, q?: string): Turn => {
    const reply = [...parts, q].filter(Boolean).join("\n\n");
    return { lang, state: { ...s, lastAsk: ask }, action: "none", reply };
  };

  if (!s.booking) {
    if (answered) return finish(undefined);
    if (p.intents.has("thanks")) return finish(undefined, L.thanks);
    if (p.intents.has("greet")) return finish(undefined, L.greet(bizName));
    return handoff("The assistant could not match this question to the approved answers.");
  }

  // Qualify: trip, date, group, time, pickup.
  if (!s.tripId) return finish("trip", L.askTrip(bot.trips.map((t) => t.name)));
  const trip = bot.trips.find((t) => t.id === s.tripId)!;
  if (!s.date) return finish("date", L.askDate);
  if (s.adults == null) return finish("group", L.askGroup);
  const group = (s.adults ?? 0) + (s.children ?? 0);
  if (group > trip.capacity) return handoff(`Group of ${group} is above the ${trip.capacity}-seat capacity (private charter request).`, L.tooBig(trip.capacity));
  const day = fmtDay(s.date, l);
  if (!s.time) {
    const free = trip.times.filter((t) => slotInfo(bot, ctx.bookings, ctx.blocks, trip.id, s.date!, t).left >= group);
    const pref = p.timePref ? free.find((t) => (Number(t.slice(0, 2)) < 12) === (p.timePref === "am")) : undefined;
    if (pref) s.time = pref;
    else if (free.length === 1 && trip.times.length === 1) s.time = free[0];
    else if (!free.length) {
      const alts = alternatives(ctx, trip.id, addDays(s.date, 1), group, l);
      s.date = undefined;
      return finish("date", L.full(day, trip.times.join("/"), alts));
    }
    else return finish("time", L.askTime(day, free.map((t) => `${t} (${L.seats(slotInfo(bot, ctx.bookings, ctx.blocks, trip.id, s.date!, t).left)})`)));
  }
  const info = slotInfo(bot, ctx.bookings, ctx.blocks, trip.id, s.date, s.time!);
  if (info.left < group) {
    const alts = alternatives(ctx, trip.id, s.date, group, l);
    const t0 = s.time!;
    s.time = undefined;
    return finish("time", L.full(day, t0, alts));
  }
  if (!s.zone && !s.noPickup) {
    if (s.hotel) return finish("pickup", L.askArea(s.hotel, bot.zones.map((z) => z.name)));
    return finish("pickup", L.askPickup(bot.zones.map((z) => L.pickupFee(z.name, z.fee ? eur(z.fee) : L.free)), bot.meetingPoint));
  }
  const zone = bot.zones.find((z) => z.name === s.zone);
  const sum: Summary = {
    trip: trip.name, date: day, time: s.time!, adults: s.adults ?? 0, children: s.children ?? 0,
    pickup: zone ? `${l === "en" ? "Pickup" : l === "de" ? "Abholung" : l === "it" ? "Prelievo" : "Recogida"}: ${s.hotel ? s.hotel + ", " : ""}${zone.name}${zone.note ? ` (${zone.note})` : ""}` : L.noPickup(bot.meetingPoint),
    total: eur(bookingTotal(trip, s.adults ?? 0, s.children ?? 0, zone)),
  };
  return finish("confirm", L.confirm(sum));
}

export function demoSummary(ctx: Ctx, s: QState, lang: Lang, reason: string) {
  const trip = ctx.bot.trips.find((t) => t.id === s.tripId);
  const known = [
    trip && `trip ${trip.name}`,
    s.date && `date ${s.date}`,
    s.time && `time ${s.time}`,
    s.adults != null && `${s.adults} adults${s.children ? ` + ${s.children} children` : ""}`,
    s.zone ? `pickup ${s.hotel ? s.hotel + ", " : ""}${s.zone}` : s.noPickup ? "no pickup" : s.hotel ? `staying at ${s.hotel}` : "",
  ].filter(Boolean);
  return `${ctx.chat.guestName} (${lang.toUpperCase()}) wrote: "${ctx.text.slice(0, 160)}". ${reason} Known so far: ${known.length ? known.join(", ") : "nothing yet"}. Next step: reply on WhatsApp in ${lang.toUpperCase()} within the 24-hour window.`;
}

/* ---------- Live AI prompt ---------- */

export function livePrompt(ctx: Ctx, availability: string): string {
  const { bot, chat, text, today, bizName } = ctx;
  const data = {
    business: bizName,
    trips: bot.trips.map(({ keywords: _k, ...t }) => t),
    pickupZones: bot.zones,
    meetingPoint: bot.meetingPoint,
    faq: bot.faq.map((f) => ({ q: f.q, a: f.a.en })),
    weatherRule: bot.weatherRule.en,
    cancellationRule: bot.cancellationRule.en,
    languages: bot.languages,
    handoff: { phone: bot.handoffPhone, hours: bot.handoffHours },
  };
  const history = chat.messages.slice(-12).map((m) => `${m.from}: ${m.text}`).join("\n");
  return `You are the WhatsApp booking receptionist for ${bizName} in Tenerife. Meta policy: you may ONLY help with this business's trips, prices, availability and bookings. Politely refuse anything else.
Today is ${today}. Answer ONLY from the operator data and availability below. Never invent prices, times, rules or seats. If the answer is not in the data, or the guest asks for a discount, has a medical or accessibility need, complains, or wants a person, set action "handoff".
Detect the guest's language and reply in it (supported: ${bot.languages.join(", ")}; otherwise English). Keep replies short, friendly, WhatsApp style, no markdown.
Qualify in this order: trip (if several), date (max ${BOOK_AHEAD_DAYS} days ahead), group size (adults and children), departure time with enough seats, hotel pickup zone or meeting at the harbour. When everything is known and seats are enough, send a summary with the total (adults x adult price + children x child price + pickup fee) and ask the guest to reply YES. Only after the guest clearly confirms that summary set action "book" and write a short thank-you (the system appends the payment link and reference).

OPERATOR DATA:
${JSON.stringify(data)}

AVAILABILITY (seats left per departure, next 21 days; 0 = full or cancelled):
${availability}

CURRENT BOOKING STATE: ${JSON.stringify(chat.state)}

CONVERSATION SO FAR:
${history || "(new conversation)"}

NEW GUEST MESSAGE: ${text}

Return JSON exactly in this shape:
{"lang":"en|de|it|es|nl|fr|sv","reply":"text to send","state":{"tripId":"id or null","date":"YYYY-MM-DD or null","time":"HH:MM or null","adults":number|null,"children":number|null,"hotel":"string or null","zone":"zone name or null","noPickup":true|false,"lastAsk":"trip|date|group|time|pickup|confirm|null","booking":true|false},"action":"none|book|handoff","handoffReason":"short English reason or empty","summary":"2-3 sentence English summary for the owner if handoff, else empty"}`;
}

export function availabilityText(bot: Bot, bookings: Booking[], blocks: Block[], today: string, days = 21) {
  const rows: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const cells = bot.trips.flatMap((t) => t.times.map((time) => `${t.id}@${time}=${slotInfo(bot, bookings, blocks, t.id, d, time).left}`));
    rows.push(`${d}: ${cells.join(" ")}`);
  }
  return rows.join("\n");
}

/** Validate a state that came back from the AI against the operator data. */
export function cleanState(raw: Partial<Record<keyof QState, unknown>> | undefined, bot: Bot, prev: QState): QState {
  if (!raw || typeof raw !== "object") return prev;
  const str = (v: unknown) => (typeof v === "string" && v && v !== "null" ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" && v >= 0 && v < 100 ? Math.round(v) : undefined);
  const tripId = str(raw.tripId) && bot.trips.some((t) => t.id === raw.tripId) ? (raw.tripId as string) : bot.trips.length === 1 ? bot.trips[0].id : prev.tripId;
  const trip = bot.trips.find((t) => t.id === tripId);
  const date = str(raw.date) && /^\d{4}-\d{2}-\d{2}$/.test(raw.date as string) ? (raw.date as string) : prev.date;
  const time = str(raw.time) && trip?.times.includes(raw.time as string) ? (raw.time as string) : undefined;
  const zone = str(raw.zone) && bot.zones.some((z) => z.name === raw.zone) ? (raw.zone as string) : undefined;
  const asks: Ask[] = ["trip", "date", "group", "time", "pickup", "confirm"];
  return {
    tripId, date, time,
    adults: num(raw.adults) ?? prev.adults,
    children: num(raw.children) ?? prev.children,
    hotel: str(raw.hotel) ?? prev.hotel,
    zone, noPickup: raw.noPickup === true,
    lastAsk: asks.includes(raw.lastAsk as Ask) ? (raw.lastAsk as Ask) : undefined,
    booking: raw.booking === true || prev.booking,
  };
}
