// Reservations: one booking system per client business (db.bookings), no payments.
// Restaurants book table slots (party size + opening hours); small hotels book rooms (date range + availability).
// Dates are local calendar strings (YYYY-MM-DD), times "HH:MM", in the business's timezone (default Europe/Madrid).
import { randomInt } from "node:crypto";
import { db, id, token, now } from "./store.mjs";

export class BookingError extends Error {
  constructor(message, status = 400, code = "") { super(message); this.status = status; this.code = code; }
}

export const KINDS = ["table", "room"];
export const STATUSES = ["pending", "confirmed", "cancelled", "no_show", "completed"];
export const ACTIVE = ["pending", "confirmed"]; // statuses that hold capacity
export const LANGS = ["es", "en"];

export function bdb() {
  const b = (db.bookings ??= {});
  b.configs ??= []; b.items ??= [];
  return b;
}

const num = (v, min, max, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const bool = (v, d) => (typeof v === "boolean" ? v : d);
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const rcode = (n) => Array.from({ length: n }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

// ---- date helpers (pure calendar math, no timezone surprises) ----
const toDays = (d) => Math.round(Date.parse(d + "T00:00:00Z") / 864e5);
const fromDays = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
export const addDays = (d, n) => fromDays(toDays(d) + n);
export const nightsBetween = (a, b) => toDays(b) - toDays(a);
const dow = (d) => new Date(d + "T00:00:00Z").getUTCDay(); // 0 = Sunday
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const validDate = (d) => typeof d === "string" && DATE.test(d) && fromDays(toDays(d)) === d;

/** The business's current local date and minutes since midnight. */
export function localNow(tz = "Europe/Madrid", at = Date.now()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
  } catch { return localNow("Europe/Madrid", at); }
}

// ---- config ----
export const clientOf = (cfg) => db.clients.find((c) => c.id === cfg?.clientId);
export const findConfig = (clientId) => bdb().configs.find((c) => c.clientId === clientId);
export const findByCode = (code) => (typeof code === "string" ? bdb().configs.find((c) => c.code === code) : undefined);

/** Room-like businesses default to rooms; everything else to tables. */
export const guessKind = (client = {}) => (/hotel|hostal|hostel|apart|alojamiento|guest|pension|pensión|casa rural|b&b|lodg|inn\b/i.test(`${client.kind ?? ""} ${client.name ?? ""}`) ? "room" : "table");

const DEFAULT_WEEK = () => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, ranges: day === 1 ? [] : [["13:00", "16:00"], ["20:00", "23:00"]] }));

export function defaultConfig(client) {
  const kind = guessKind(client);
  return {
    clientId: client.id, kind, enabled: false, code: uniqueCode(), createdAt: now(), updatedAt: now(),
    timezone: "Europe/Madrid", langs: ["es", "en"], autoConfirm: true, advanceDays: kind === "room" ? 365 : 60, notice: "", closedDates: [],
    table: { week: DEFAULT_WEEK(), seats: 40, slotMinutes: 30, durationMinutes: 90, minParty: 1, maxParty: 10, minNoticeMinutes: 60 },
    room: { roomTypes: [{ id: id(), name: "Double room", count: 4, maxGuests: 2, priceEur: 0, description: "" }], minNights: 1, maxNights: 14, checkIn: "15:00", checkOut: "11:00" },
  };
}
function uniqueCode() { let c; do c = rcode(7); while (bdb().configs.some((x) => x.code === c)); return c; }

/** The config for a client, created (disabled) on first use. */
export function ensureConfig(client) {
  let c = findConfig(client.id);
  if (!c) { c = defaultConfig(client); bdb().configs.push(c); }
  return c;
}

function cleanWeek(w, d) {
  if (!Array.isArray(w)) return d;
  const byDay = new Map();
  for (const e of w) {
    const day = num(e?.day, 0, 6, -1);
    if (day < 0) continue;
    const ranges = (Array.isArray(e.ranges) ? e.ranges : []).map((r) => [str(r?.[0], 5), str(r?.[1], 5)]).filter(([a, b]) => TIME.test(a) && TIME.test(b) && mins(a) < mins(b)).slice(0, 4);
    byDay.set(day, { day, ranges });
  }
  return [0, 1, 2, 3, 4, 5, 6].map((day) => byDay.get(day) ?? { day, ranges: [] });
}

/** Validate and apply owner/portal changes. Unknown keys are ignored. */
export function updateConfig(cfg, b = {}) {
  if (b.kind !== undefined && KINDS.includes(b.kind)) cfg.kind = b.kind;
  cfg.enabled = bool(b.enabled, cfg.enabled);
  cfg.autoConfirm = bool(b.autoConfirm, cfg.autoConfirm);
  if (b.langs !== undefined) { const l = (Array.isArray(b.langs) ? b.langs : []).filter((x) => LANGS.includes(x)); cfg.langs = l.length ? [...new Set(l)] : ["es"]; }
  cfg.advanceDays = num(b.advanceDays, 1, 730, cfg.advanceDays);
  if (b.notice !== undefined) cfg.notice = str(b.notice, 300);
  if (b.closedDates !== undefined) cfg.closedDates = [...new Set((Array.isArray(b.closedDates) ? b.closedDates : []).filter(validDate))].sort().slice(0, 400);
  if (typeof b.timezone === "string") { try { new Intl.DateTimeFormat("en", { timeZone: b.timezone }); cfg.timezone = b.timezone; } catch { /* keep */ } }
  if (b.table && typeof b.table === "object") {
    const t = cfg.table, n = b.table;
    t.week = cleanWeek(n.week, t.week);
    t.seats = num(n.seats, 1, 1000, t.seats);
    t.slotMinutes = [15, 30, 60].includes(Number(n.slotMinutes)) ? Number(n.slotMinutes) : t.slotMinutes;
    t.durationMinutes = num(n.durationMinutes, 15, 480, t.durationMinutes);
    t.minParty = num(n.minParty, 1, 50, t.minParty);
    t.maxParty = Math.max(t.minParty, num(n.maxParty, 1, 100, t.maxParty));
    t.minNoticeMinutes = num(n.minNoticeMinutes, 0, 14 * 1440, t.minNoticeMinutes);
  }
  if (b.room && typeof b.room === "object") {
    const r = cfg.room, n = b.room;
    if (Array.isArray(n.roomTypes)) {
      r.roomTypes = n.roomTypes.slice(0, 20).map((x) => ({
        id: str(x?.id, 40) || id(), name: str(x?.name, 60), count: num(x?.count, 1, 200, 1), maxGuests: num(x?.maxGuests, 1, 20, 2),
        priceEur: Math.max(0, Math.round(Number(x?.priceEur) * 100) / 100 || 0), description: str(x?.description, 200),
      })).filter((x) => x.name);
    }
    r.minNights = num(n.minNights, 1, 60, r.minNights);
    r.maxNights = Math.max(r.minNights, num(n.maxNights, 1, 90, r.maxNights));
    if (TIME.test(n.checkIn ?? "")) r.checkIn = n.checkIn;
    if (TIME.test(n.checkOut ?? "")) r.checkOut = n.checkOut;
  }
  cfg.updatedAt = now();
  return cfg;
}

// ---- availability ----
const itemsOf = (cfg) => bdb().items.filter((x) => x.clientId === cfg.clientId);
const active = (x) => ACTIVE.includes(x.status);

function dayRules(cfg, date) {
  if (!validDate(date)) throw new BookingError("Choose a valid date.", 400, "date");
  const n = localNow(cfg.timezone);
  if (date < n.date) throw new BookingError("That date is in the past.", 400, "past");
  if (nightsBetween(n.date, date) > cfg.advanceDays) throw new BookingError("That date is too far ahead.", 400, "far");
  return n;
}

/** Table slots for a date and party size: [{time, available}] (only bookable ones are returned as available). */
export function tableSlots(cfg, date, party, at = Date.now()) {
  const t = cfg.table;
  const size = Math.floor(Number(party));
  if (!Number.isFinite(size) || size < t.minParty || size > t.maxParty) throw new BookingError(`Parties of ${t.minParty} to ${t.maxParty} can book online.`, 400, "party");
  const n = dayRules(cfg, date);
  if (cfg.closedDates.includes(date)) return [];
  const day = t.week.find((d) => d.day === dow(date));
  const list = [];
  const taken = itemsOf(cfg).filter((x) => x.kind === "table" && active(x) && x.date === date);
  for (const [open, close] of day?.ranges ?? []) {
    // the last seating starts one slot before closing time
    for (let m = mins(open); m + t.slotMinutes <= mins(close); m += t.slotMinutes) {
      const time = hhmm(m);
      const tooSoon = date === n.date && m < n.minutes + t.minNoticeMinutes;
      const used = taken.filter((x) => mins(x.time) < m + t.durationMinutes && m < mins(x.time) + t.durationMinutes).reduce((s, x) => s + x.party, 0);
      list.push({ time, available: !tooSoon && used + size <= t.seats });
    }
  }
  return list;
}

/** Room types free for every night of [checkIn, checkOut) for this many guests. */
export function roomAvailability(cfg, checkIn, checkOut, guests) {
  const r = cfg.room;
  if (!validDate(checkIn) || !validDate(checkOut)) throw new BookingError("Choose valid dates.", 400, "date");
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < r.minNights || nights > r.maxNights) throw new BookingError(`Stays of ${r.minNights} to ${r.maxNights} nights can book online.`, 400, "nights");
  dayRules(cfg, checkIn);
  if (nightsBetween(localNow(cfg.timezone).date, checkOut) > cfg.advanceDays + r.maxNights) throw new BookingError("That date is too far ahead.", 400, "far");
  const g = Math.floor(Number(guests));
  if (!Number.isFinite(g) || g < 1) throw new BookingError("How many guests?", 400, "guests");
  const closed = Array.from({ length: nights }, (_, i) => addDays(checkIn, i)).some((d) => cfg.closedDates.includes(d));
  const taken = itemsOf(cfg).filter((x) => x.kind === "room" && active(x) && x.checkIn < checkOut && checkIn < x.checkOut);
  return r.roomTypes.filter((rt) => rt.maxGuests >= g).map((rt) => {
    let free = rt.count;
    for (let i = 0; i < nights; i++) {
      const d = addDays(checkIn, i);
      free = Math.min(free, rt.count - taken.filter((x) => x.roomTypeId === rt.id && x.checkIn <= d && d < x.checkOut).length);
    }
    return { id: rt.id, name: rt.name, maxGuests: rt.maxGuests, priceEur: rt.priceEur, description: rt.description, free: closed ? 0 : Math.max(0, free), available: !closed && free > 0, nights };
  });
}

// ---- bookings ----
let onChange = () => {};
/** index.mjs wires this to the transactional mailer: onChange(booking, event) */
export const setOnBookingChange = (fn) => { onChange = typeof fn === "function" ? fn : () => {}; };
const fire = (b, ev) => { try { const r = onChange(b, ev); if (r?.catch) r.catch(() => {}); } catch { /* mail never breaks a booking */ } };

export function createBooking(cfg, input = {}, { source = "link", by = "customer", allowClosed = false } = {}) {
  if (!cfg.enabled && !allowClosed) throw new BookingError("Online bookings are not open for this business right now.", 409, "closed");
  const name = str(input.name, 80), email = str(input.email, 120), phone = str(input.phone, 30);
  if (!name) throw new BookingError("Please enter your name.", 400, "name");
  if (!email) throw new BookingError("Please enter your email address.", 400, "email");
  if (!EMAIL.test(email)) throw new BookingError("That email address does not look right.", 400, "email");
  const lang = LANGS.includes(input.lang) && cfg.langs.includes(input.lang) ? input.lang : cfg.langs[0];
  const t = now();
  const b = {
    id: id(), clientId: cfg.clientId, kind: cfg.kind, status: cfg.autoConfirm || by === "owner" ? "confirmed" : "pending", name, email: email.toLowerCase(), phone, lang,
    notes: str(input.notes, 400), source: str(source, 20) || "link", manageToken: token(), createdAt: t, updatedAt: t, history: [{ at: t, status: "", by }],
  };
  if (cfg.kind === "table") {
    const party = Math.floor(Number(input.party)), date = str(input.date, 10), time = str(input.time, 5);
    const slot = (by === "owner" ? bypass(cfg, date, party) : tableSlots(cfg, date, party)).find((s) => s.time === time);
    if (!slot || !slot.available) throw new BookingError("That time was just taken. Please pick another.", 409, "taken");
    Object.assign(b, { date, time, party });
  } else {
    const checkIn = str(input.checkIn, 10), checkOut = str(input.checkOut, 10), guests = Math.floor(Number(input.guests));
    const rt = cfg.room.roomTypes.find((x) => x.id === input.roomTypeId);
    if (!rt) throw new BookingError("Choose a room type.", 400, "room");
    const opt = roomAvailability(cfg, checkIn, checkOut, guests).find((x) => x.id === rt.id);
    if (!opt || !opt.available) throw new BookingError("That room is no longer available for those dates.", 409, "taken");
    Object.assign(b, { checkIn, checkOut, guests, roomTypeId: rt.id, roomName: rt.name, nights: opt.nights });
  }
  bdb().items.push(b);
  fire(b, "created");
  return b;
}
// Staff adding a booking by hand may use slots inside the notice window.
function bypass(cfg, date, party) {
  const saved = cfg.table.minNoticeMinutes;
  try { cfg.table.minNoticeMinutes = 0; return tableSlots(cfg, date, party); } finally { cfg.table.minNoticeMinutes = saved; }
}

export const findBooking = (bid) => bdb().items.find((x) => x.id === bid);
export const findByManageToken = (t) => (typeof t === "string" && t.length >= 8 ? bdb().items.find((x) => x.manageToken === t) : undefined);

const OWNER_MOVES = { pending: ["confirmed", "cancelled"], confirmed: ["cancelled", "no_show", "completed"], no_show: ["confirmed"], completed: [], cancelled: ["confirmed"] };
/** Change a booking's status. Customers may only cancel; staff follow OWNER_MOVES (re-confirming checks capacity). */
export function setStatus(b, status, { by = "owner" } = {}) {
  if (!STATUSES.includes(status)) throw new BookingError("Unknown status.", 400);
  if (b.status === status) return b;
  if (by === "customer") {
    if (status !== "cancelled" || !ACTIVE.includes(b.status)) throw new BookingError("This booking can no longer be cancelled online.", 409);
    if (startsAt(b) <= Date.now()) throw new BookingError("This booking has already started.", 409);
  } else if (!OWNER_MOVES[b.status]?.includes(status)) throw new BookingError(`A ${b.status.replace("_", "-")} booking cannot become ${status.replace("_", "-")}.`, 409);
  if (status === "no_show" && startsAt(b) > Date.now()) throw new BookingError("You can mark a no-show once the booking time has passed.", 409);
  if (status === "confirmed" && !ACTIVE.includes(b.status)) {
    const cfg = findConfig(b.clientId);
    if (!hasRoom(cfg, b, bdb().items.filter((x) => x !== b))) throw new BookingError("There is no longer room for this booking. Free up space first.", 409, "taken");
  }
  b.history.push({ at: now(), status, by, from: b.status });
  b.status = status;
  b.updatedAt = now();
  fire(b, status);
  return b;
}
function hasRoom(cfg, b, others) {
  const mine = others.filter((x) => x.clientId === b.clientId && active(x));
  if (b.kind === "table") {
    const d = cfg.table.durationMinutes, m = mins(b.time);
    const used = mine.filter((x) => x.kind === "table" && x.date === b.date && mins(x.time) < m + d && m < mins(x.time) + d).reduce((s, x) => s + x.party, 0);
    return used + b.party <= cfg.table.seats;
  }
  const rt = cfg.room.roomTypes.find((x) => x.id === b.roomTypeId);
  if (!rt) return false;
  for (let i = 0; i < b.nights; i++) {
    const d = addDays(b.checkIn, i);
    if (mine.filter((x) => x.kind === "room" && x.roomTypeId === rt.id && x.checkIn <= d && d < x.checkOut).length >= rt.count) return false;
  }
  return true;
}
/** Approximate start instant (UTC ms) of a booking in the business's timezone. */
export function startsAt(b) {
  const cfg = findConfig(b.clientId);
  const tz = cfg?.timezone ?? "Europe/Madrid";
  const date = b.kind === "table" ? b.date : b.checkIn, time = b.kind === "table" ? b.time : cfg?.room.checkIn ?? "15:00";
  const guess = Date.parse(`${date}T${time}:00Z`);
  const l = localNow(tz, guess);
  return guess - ((Date.parse(`${l.date}T00:00:00Z`) + l.minutes * 60e3) - guess);
}

export function stats(cfg) {
  const items = itemsOf(cfg), today = localNow(cfg.timezone).date;
  const when = (x) => (x.kind === "table" ? x.date : x.checkIn);
  return {
    total: items.length, pending: items.filter((x) => x.status === "pending").length,
    upcoming: items.filter((x) => active(x) && when(x) >= today).length,
    today: items.filter((x) => active(x) && when(x) === today).length,
    noShows: items.filter((x) => x.status === "no_show").length, cancelled: items.filter((x) => x.status === "cancelled").length,
  };
}

/** Public-safe view of a booking (the customer's own page). */
export const bookingView = ({ id, kind, status, name, email, phone, lang, notes, source, createdAt, date, time, party, checkIn, checkOut, guests, roomName, nights }) =>
  ({ id, kind, status, name, email, phone, lang, notes, source, createdAt, date, time, party, checkIn, checkOut, guests, roomName, nights });
/** Owner view adds history. */
export const ownerView = (b) => ({ ...bookingView(b), updatedAt: b.updatedAt, history: b.history, roomTypeId: b.roomTypeId });

export const bookingUrl = (cfg, baseUrl) => `${baseUrl}/book/${cfg.code}`;
export const manageUrl = (b, baseUrl) => `${baseUrl}/booking/${b.manageToken}`;

export function configView(cfg, baseUrl) {
  return { ...cfg, bookingUrl: bookingUrl(cfg, baseUrl), clientName: clientOf(cfg)?.name ?? "", stats: stats(cfg) };
}
/** What the public booking page may see. */
export function publicInfo(cfg) {
  const c = clientOf(cfg) ?? {};
  const out = { code: cfg.code, kind: cfg.kind, enabled: cfg.enabled, autoConfirm: cfg.autoConfirm, langs: cfg.langs, notice: cfg.notice, advanceDays: cfg.advanceDays, timezone: cfg.timezone, today: localNow(cfg.timezone).date,
    business: { name: c.name ?? "", town: c.town ?? "", phone: c.phone ?? "", logoFile: c.logoFile ?? "" } };
  if (cfg.kind === "table") out.table = { minParty: cfg.table.minParty, maxParty: cfg.table.maxParty, week: cfg.table.week, durationMinutes: cfg.table.durationMinutes };
  else out.room = { roomTypes: cfg.room.roomTypes, minNights: cfg.room.minNights, maxNights: cfg.room.maxNights, checkIn: cfg.room.checkIn, checkOut: cfg.room.checkOut };
  return out;
}

/** Remove all of a business's booking data (when the client is deleted). */
export function removeClientData(clientId) {
  const b = bdb();
  b.configs = b.configs.filter((c) => c.clientId !== clientId);
  b.items = b.items.filter((x) => x.clientId !== clientId);
}
