// Expenses: receipt scanner + monthly expense tracker, one per client business (db.expenses).
// Off until the owner enables it. Locations are the branches of a franchise; every expense belongs to one.
// Dates are local calendar strings (YYYY-MM-DD). Money is kept in cents (integers).
import { db, id, now } from "./store.mjs";
import { complete, aiKey, extractJson, withClientAi } from "./openrouter.mjs";

export class ExpenseError extends Error {
  constructor(message, status = 400, code = "") { super(message); this.status = status; this.code = code; }
}

export const CATEGORIES = ["food", "supplies", "utilities", "rent", "transport", "marketing", "equipment", "services", "other"];
export const CURRENCIES = ["EUR", "USD", "GBP"];
const DATE = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function edb() {
  const e = (db.expenses ??= {});
  e.configs ??= []; e.items ??= [];
  return e;
}

export const validDate = (d) => {
  if (typeof d !== "string" || !DATE.test(d)) return false;
  const t = Date.parse(d + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
};
export const validMonth = (m) => typeof m === "string" && MONTH.test(m);
export const today = () => new Date().toISOString().slice(0, 10);

/** Cents from a number or a string like "12,50" / "1.234,56" / "12.50"; null when not a usable amount. */
export function toCents(v) {
  if (v === null || v === undefined || v === "") return null;
  let n;
  if (typeof v === "number") n = v;
  else {
    let s = String(v).replace(/[^\d.,-]/g, "");
    const comma = s.lastIndexOf(","), dot = s.lastIndexOf(".");
    if (comma > dot) s = s.replace(/\./g, "").replace(",", "."); // 1.234,56
    else s = s.replace(/,/g, ""); // 1,234.56
    n = /\d/.test(s) ? Number(s) : NaN;
  }
  return Number.isFinite(n) && Math.abs(n) < 1e7 ? Math.round(n * 100) : null;
}

// ---- config ----
export const findConfig = (clientId) => edb().configs.find((c) => c.clientId === clientId);
export function ensureConfig(client) {
  let c = findConfig(client.id);
  if (!c) {
    c = { clientId: client.id, enabled: false, currency: "EUR", locations: [{ id: id(), name: "Main" }], createdAt: now(), updatedAt: now() };
    edb().configs.push(c);
  }
  return c;
}
/** Is the feature on for this business? (portal and scanner only work when it is) */
export const isEnabled = (clientId) => !!findConfig(clientId)?.enabled;

/** `owner` may switch the feature on or off; the client may only change locations and currency. */
export function updateConfig(cfg, b = {}, { owner = false } = {}) {
  if (owner && typeof b.enabled === "boolean") cfg.enabled = b.enabled;
  if (CURRENCIES.includes(b.currency)) cfg.currency = b.currency;
  if (Array.isArray(b.locations)) {
    const seen = new Set(), out = [];
    for (const l of b.locations.slice(0, 50)) {
      const name = str(l?.name, 80);
      if (!name) continue;
      let lid = str(l?.id, 40);
      if (!lid || seen.has(lid)) lid = id();
      seen.add(lid);
      out.push({ id: lid, name });
    }
    if (!out.length) throw new ExpenseError("Add at least one location.");
    const kept = new Set(out.map((l) => l.id));
    const used = edb().items.filter((x) => x.clientId === cfg.clientId && !kept.has(x.locationId));
    if (used.length) throw new ExpenseError("A location with expenses cannot be removed. Rename it instead.", 409, "location_in_use");
    cfg.locations = out;
  }
  cfg.updatedAt = now();
  return cfg;
}
export const configView = (cfg) => ({ enabled: cfg.enabled, currency: cfg.currency, locations: cfg.locations, categories: CATEGORIES });

// ---- expenses ----
function cleanItems(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 200).map((it) => ({
    name: str(it?.name, 120),
    qty: Math.min(9999, Math.max(0, Number(it?.qty) || 1)),
    priceCents: toCents(it?.price ?? it?.priceCents / 100) ?? 0,
  })).filter((it) => it.name);
}

/** Validate input into a stored expense (without id). `cfg` supplies the allowed locations. */
export function cleanExpense(cfg, b = {}, prev = {}) {
  const date = b.date ?? prev.date;
  if (!validDate(date)) throw new ExpenseError("Choose a valid date.");
  const totalCents = "total" in b ? toCents(b.total) : prev.totalCents;
  if (totalCents === null || totalCents === undefined || totalCents < 0) throw new ExpenseError("Enter the total amount.");
  const locationId = b.locationId ?? prev.locationId ?? cfg.locations[0]?.id;
  if (!cfg.locations.some((l) => l.id === locationId)) throw new ExpenseError("Choose a valid location.");
  const category = b.category ?? prev.category ?? "other";
  const taxCents = "tax" in b ? toCents(b.tax) : prev.taxCents ?? null;
  return {
    date, locationId, totalCents, taxCents,
    store: "store" in b ? str(b.store, 120) : prev.store ?? "",
    category: CATEGORIES.includes(category) ? category : "other",
    items: "items" in b ? cleanItems(b.items) : prev.items ?? [],
    notes: "notes" in b ? str(b.notes, 500) : prev.notes ?? "",
    source: b.source === "scan" ? "scan" : prev.source ?? "manual",
  };
}

export function addExpense(cfg, b) {
  const x = { id: id(), clientId: cfg.clientId, ...cleanExpense(cfg, b), createdAt: now(), updatedAt: now() };
  edb().items.push(x);
  return x;
}
export function editExpense(cfg, x, b) {
  Object.assign(x, cleanExpense(cfg, b, x), { updatedAt: now() });
  return x;
}
export const findExpense = (eid) => edb().items.find((x) => x.id === eid);
export function removeExpense(x) { const a = edb().items; a.splice(a.indexOf(x), 1); }

export const expenseView = ({ id, locationId, date, store, category, items, totalCents, taxCents, notes, source, createdAt, updatedAt }) =>
  ({ id, locationId, date, store, category, items, totalCents, taxCents, notes, source, createdAt, updatedAt });

/** Expenses of a business, newest first, optionally limited to a month (YYYY-MM) and/or a location. */
export function list(clientId, { month = "", locationId = "" } = {}) {
  return edb().items
    .filter((x) => x.clientId === clientId && (!month || x.date.startsWith(month)) && (!locationId || x.locationId === locationId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/** Totals for a list of expenses: overall, per category and per location (cents). */
export function summarize(items, cfg) {
  const byCategory = {}, byLocation = {};
  let total = 0;
  for (const x of items) {
    total += x.totalCents;
    byCategory[x.category] = (byCategory[x.category] ?? 0) + x.totalCents;
    byLocation[x.locationId] = (byLocation[x.locationId] ?? 0) + x.totalCents;
  }
  return {
    totalCents: total, count: items.length,
    byCategory: CATEGORIES.filter((c) => byCategory[c]).map((c) => ({ category: c, totalCents: byCategory[c] })),
    byLocation: cfg.locations.filter((l) => byLocation[l.id]).map((l) => ({ locationId: l.id, name: l.name, totalCents: byLocation[l.id] })),
  };
}
/** Months (YYYY-MM, newest first) that have expenses, plus the current month. */
export function months(clientId) {
  const s = new Set([today().slice(0, 7)]);
  for (const x of edb().items) if (x.clientId === clientId) s.add(x.date.slice(0, 7));
  return [...s].sort().reverse();
}

export function removeClientData(clientId) {
  const e = edb();
  e.items = e.items.filter((x) => x.clientId !== clientId);
  e.configs = e.configs.filter((c) => c.clientId !== clientId);
}

// ---- receipt scanning ----
const SCAN_PROMPT = `Read this shop receipt photo. Reply with ONLY one JSON object, no prose:
{"store": string, "location": string (branch/address/city printed on the receipt, or ""), "date": "YYYY-MM-DD" or "", "items": [{"name": string, "qty": number, "price": number (line total)}], "total": number, "tax": number or null (IGIC / IVA / VAT amount if printed), "currency": "EUR"|"USD"|"GBP"|"", "category": one of ${CATEGORIES.join("|")}}
Use dots for decimals and plain numbers (no currency symbols). If a value is not readable use "" or null. Never invent items.`;

export const IMAGE_URL = /^data:image\/(jpeg|png|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/;

/** Normalise the model's JSON into a draft the client reviews. Pure, for tests. */
export function normalizeScan(raw, cfg) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const loc = str(r.location, 120).toLowerCase();
  const match = loc ? cfg.locations.find((l) => loc.includes(l.name.toLowerCase()) || l.name.toLowerCase().includes(loc)) : null;
  const items = cleanItems(Array.isArray(r.items) ? r.items : []);
  const total = toCents(r.total);
  const sum = items.reduce((a, it) => a + it.priceCents, 0);
  return {
    store: str(r.store, 120), receiptLocation: str(r.location, 120), date: validDate(r.date) ? r.date : "",
    locationId: match?.id ?? "", category: CATEGORIES.includes(r.category) ? r.category : "other",
    items, totalCents: total ?? (sum || null), taxCents: toCents(r.tax),
    currency: CURRENCIES.includes(r.currency) ? r.currency : "",
  };
}

/** Send the receipt image to the vision-capable provider chain (free ones first, the client's own pick respected). */
async function scanReceipt(client, cfg, image) {
  if (!IMAGE_URL.test(image ?? "")) throw new ExpenseError("Send a JPEG, PNG or WebP photo.");
  if (image.length > 8e6) throw new ExpenseError("That photo is too large. Try a smaller one.", 413);
  if (!aiKey()) throw new ExpenseError("The receipt reader is not available right now. Enter the expense by hand.", 503, "no_ai");
  let out;
  try {
    out = await complete({ key: aiKey(), tier: "quick", images: [image], prompt: SCAN_PROMPT, json: true, maxTokens: 1500 });
  } catch (e) {
    console.warn("Receipt scan failed:", e.message);
    throw new ExpenseError("We could not read that receipt. Try a sharper photo or enter it by hand.", 502, "scan_failed");
  }
  return { ...normalizeScan(out.json ?? extractJson(out.text), cfg), model: out.model };
}
export const scan = withClientAi(scanReceipt);
