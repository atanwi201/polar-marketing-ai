// Expenses: receipt scanner + monthly expense tracker, one per client business (db.expenses).
// Off until the owner enables it. Locations are the branches of a franchise; every expense belongs to one.
// Dates are local calendar strings (YYYY-MM-DD). Money is kept in cents (integers).
import { db, id, now } from "./store.mjs";
import { complete, aiKey, extractJson, withClientAi } from "./openrouter.mjs";
import { transcribe, speak } from "./voice.mjs";
import { mkdir, writeFile, readFile, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "./store.mjs";

export class ExpenseError extends Error {
  constructor(message, status = 400, code = "") { super(message); this.status = status; this.code = code; }
}

export const CATEGORIES = ["food", "supplies", "utilities", "rent", "transport", "marketing", "equipment", "services", "other"];
export const CURRENCIES = ["EUR", "USD", "GBP"];
/** Tax rates the business can pick. The Canaries charge IGIC 7%; the rest of Spain IVA 21%. */
export const TAX_RATES = [0.07, 0.21, 0];
export const TAX_RATE_LABEL = { 0.07: "igic", 0.21: "iva", 0: "none" };
const DATE = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
/** Lower case without accents, so "Pollo" and "pollo" match the same line. */
const norm = (v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

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

/** The tax rate the business picked: IGIC 7% (Canarias), IVA 21% or none. */
export const cleanRate = (v) => (TAX_RATES.includes(Number(v)) ? Number(v) : 0.07);

/** Validate input into a stored expense (without id). `cfg` supplies the allowed locations. */
export function cleanExpense(cfg, b = {}, prev = {}) {
  const date = b.date ?? prev.date;
  if (!validDate(date)) throw new ExpenseError("Choose a valid date.");
  const locationId = b.locationId ?? prev.locationId ?? cfg.locations[0]?.id;
  if (!cfg.locations.some((l) => l.id === locationId)) throw new ExpenseError("Choose a valid location.");
  const category = b.category ?? prev.category ?? "other";
  const items = "items" in b ? cleanItems(b.items) : prev.items ?? [];
  // The tax: a rate on the net sum, or the exact amount the business typed (what a receipt prints).
  const taxRate = "taxRate" in b ? cleanRate(b.taxRate) : (prev.taxRate ?? 0.07);
  const taxIncluded = "taxIncluded" in b ? b.taxIncluded === true : prev.taxIncluded === true;
  const fixed = "tax" in b ? toCents(b.tax) : null;
  const taxCents = taxOf(items, { taxCents: fixed, taxRate, taxIncluded });
  // The total is always the items plus the tax. With no items there is nothing to add up, so the
  // business types the amount (a whole rent, for example).
  const typed = "total" in b ? toCents(b.total) : null;
  const totalCents = items.length ? totalOf(items, taxCents) : (typed ?? prev.totalCents);
  if (totalCents === null || totalCents === undefined || totalCents < 0) throw new ExpenseError("Enter the total amount.");
  return {
    date, locationId, totalCents, taxCents, taxRate, taxIncluded,
    store: "store" in b ? str(b.store, 120) : prev.store ?? "",
    category: CATEGORIES.includes(category) ? category : "other",
    items,
    notes: "notes" in b ? str(b.notes, 500) : prev.notes ?? "",
    source: b.source === "scan" ? "scan" : prev.source ?? "manual",
    photoFile: receiptFile(prev),   // the photo file is set by the route, never by the client
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

export const expenseView = ({ id, locationId, date, store, category, items, totalCents, taxCents, taxRate, taxIncluded, notes, source, createdAt, updatedAt, photoFile }) =>
  ({ id, locationId, date, store, category, items, totalCents, taxCents, taxRate: taxRate ?? 0, taxIncluded: taxIncluded === true, notes, source, createdAt, updatedAt, hasPhoto: !!receiptFile({ photoFile }) });

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
  const gone = e.items.filter((x) => x.clientId === clientId);
  e.items = e.items.filter((x) => x.clientId !== clientId);
  e.configs = e.configs.filter((c) => c.clientId !== clientId);
  return Promise.all(gone.map((x) => removeReceipt(receiptFile(x))));  // the receipt photos go with it
}

// ---- receipt photos ----
// They live in data/receipts, NOT in data/media: a receipt is the business's money, and data/media is
// served to anyone who knows the file name. They are only reachable through the expenses API.
export const RECEIPT_DIR = join(DATA_DIR, "receipts");
const RECEIPT_NAME = /^exp-[a-z0-9]{4,40}\.(jpg|jpeg|png|webp)$/;
const PHOTO_URL = /^data:image\/(jpeg|png|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/;

export const receiptFile = (x) => (typeof x?.photoFile === "string" && RECEIPT_NAME.test(x.photoFile) ? x.photoFile : "");
export const hasReceipt = (x) => !!receiptFile(x);

/** Store the receipt photo next to the data. Returns the file name to keep in the record. */
export async function saveReceipt(dataUrl, expenseId) {
  if (!PHOTO_URL.test(dataUrl ?? "")) throw new ExpenseError("Send a JPEG, PNG or WebP photo.");
  if (dataUrl.length > 12e6) throw new ExpenseError("That photo is too large. Try a smaller one.", 413);
  const m = /^data:image\/(jpeg|png|webp|heic|heif);base64,(.+)$/.exec(dataUrl);
  const buf = Buffer.from(m[2], "base64");
  let out = buf, ext = m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg";
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(buf);
    const k = Math.min(1, 1400 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    const cv = createCanvas(w, h), g = cv.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    out = cv.toBuffer("image/jpeg", 82);
    ext = "jpg";
  } catch { /* no canvas here: keep the original bytes */ }
  await mkdir(RECEIPT_DIR, { recursive: true, mode: 0o700 });
  const file = `exp-${String(expenseId ?? "").replace(/[^\w-]/g, "").slice(0, 40) || id()}.${ext}`;
  await writeFile(join(RECEIPT_DIR, file), out);
  return file;
}

/** The bytes of a receipt, for the owner or for the business that owns the expense. */
export async function readReceipt(file) {
  if (!RECEIPT_NAME.test(file ?? "")) return null;
  try { return await readFile(join(RECEIPT_DIR, file)); } catch { return null; }
}
export async function removeReceipt(file) {
  if (!RECEIPT_NAME.test(file ?? "")) return;
  await unlink(join(RECEIPT_DIR, file)).catch(() => {});
}

// ---- receipt scanning ----
const SCAN_PROMPT = `Read this shop receipt photo. Reply with ONLY one JSON object, no prose:
{"store": string, "location": string (branch/address/city printed on the receipt, or ""), "date": "YYYY-MM-DD" or "", "items": [{"name": string, "qty": number, "price": number (the price of ONE unit, without tax)}], "total": number (what the customer paid, with tax), "tax": number or null (the IGIC / IVA / VAT amount if printed), "currency": "EUR"|"USD"|"GBP"|"", "category": one of ${CATEGORIES.join("|")}}
The prices on a receipt are the base price without tax, and the tax is printed apart. If a line shows a line total, divide it by the quantity to get the price of one unit.
Use dots for decimals and plain numbers (no currency symbols). If a value is not readable use "" or null. Never invent items.`;

export const IMAGE_URL = /^data:image\/(jpeg|png|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/;

/** The rate a receipt seems to use, so the form can show "IGIC 7%" next to it. */
export function rateOf(net, tax) {
  if (!net || !tax) return 0;
  const r = tax / net;
  return TAX_RATES.find((x) => x && Math.abs(x - r) < 0.02) ?? 0;
}

/** Normalise the model's JSON into a draft the client reviews. Pure, for tests. */
export function normalizeScan(raw, cfg) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const loc = str(r.location, 120).toLowerCase();
  const match = loc ? cfg.locations.find((l) => loc.includes(l.name.toLowerCase()) || l.name.toLowerCase().includes(loc)) : null;
  const items = cleanItems(Array.isArray(r.items) ? r.items : []);
  const total = toCents(r.total);
  let taxCents = toCents(r.tax);
  // The receipt's total is the truth. If the lines and the tax do not add up to it, the last line
  // takes the difference (that is how a receipt rounds); if that is impossible, the tax takes it.
  if (items.length && total != null) {
    const net = itemsTotal(items);
    const tax = taxCents ?? 0;
    const diff = total - net - tax;
    if (diff !== 0) {
      const last = items[items.length - 1];
      const per = Math.max(1, last.qty || 1);
      const next = last.priceCents + Math.round(diff / per);
      if (next >= 0) last.priceCents = next;
      else taxCents = total - net;
    }
  }
  const net = itemsTotal(items);
  return {
    store: str(r.store, 120), receiptLocation: str(r.location, 120), date: validDate(r.date) ? r.date : "",
    locationId: match?.id ?? "", category: CATEGORIES.includes(r.category) ? r.category : "other",
    items, totalCents: total ?? (items.length ? net + (taxCents ?? 0) : null), taxCents, taxRate: rateOf(net, taxCents),
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

// ---------- asking about the expenses ----------
// The model only turns the question into a filter. Every number in the answer is computed here from
// the stored expenses, so the AI can never invent an amount.

/** One line per expense, for the model to read: date | shop | branch | category | total | products. */
export function ledgerFor(items, cfg, limit = 60) {
  const loc = new Map(cfg.locations.map((l) => [l.id, l.name]));
  return items.slice(0, limit).map((x) => {
    const its = (x.items ?? []).map((i) => `${i.name} x${i.qty}`).join(", ");
    return `${x.date} | ${x.store || "-"} | ${loc.get(x.locationId) ?? "-"} | ${x.category} | ${(x.totalCents / 100).toFixed(2)} | ${its}`;
  }).join("\n");
}

/** Month words the question may use, so the model can match "last month" to a real month. */
const MONTH_WORDS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","setiembre","octubre","noviembre","diciembre",
  "january","february","march","april","may","june","july","august","september","october","november","december"];

const monthName = (m, lang) => {
  const [y, mo] = String(m).split("-").map(Number);
  const d = new Date(Date.UTC(y, (mo || 1) - 1, 1));
  if (isNaN(d)) return String(m);
  const s = new Intl.DateTimeFormat(lang === "en" ? "en-IE" : "es-ES", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Category words in Spanish and English, so a question in either language finds them. */
const CATEGORY_WORDS = {
  food: ["food", "comida", "bebida", "drinks", "restaurant", "restaurante", "catering", "cocina"],
  supplies: ["supplies", "suministros", "material", "productos", "consumibles"],
  utilities: ["utilities", "utilities", "suministros basicos", "luz", "agua", "gas", "electricidad", "agua", "internet", "telefono"],
  rent: ["rent", "alquiler", "alquileres", "renta", "lease"],
  transport: ["transport", "transporte", "gasolina", "combustible", "taxi", "uber", "parking", "parking", "viajes"],
  marketing: ["marketing", "publicidad", "promocion", "anuncios", "ads"],
  equipment: ["equipment", "equipamiento", "equipo", "maquinaria", "herramientas"],
  services: ["services", "servicios", "profesional", "asesoria", "gestoria", "reparaciones"],
  other: ["other", "otros", "varios", "misc"],
};

/** Does the question mention this phrase? Word by word, so "gaste" is not "gas". */
const mentions = (text, phrase) => {
  const want = norm(phrase).split(/[^a-z0-9]+/).filter(Boolean);
  const got = norm(text).split(/[^a-z0-9]+/).filter(Boolean);
  return want.length > 0 && want.every((w) => got.includes(w));
};

/** Rule-based reading of the question, used when there is no AI key. */
export function fallbackFilter(question, months, stores, locs, products = []) {
  const q = norm(question);
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);
  const found = months.filter((m) => {
    const [y, mo] = m.split("-").map(Number);
    const d = new Date(Date.UTC(y, (mo || 1) - 1, 1));
    const names = ["en", "es"].map((l) => norm(new Intl.DateTimeFormat(l, { month: "long", timeZone: "UTC" }).format(d)));
    return words.some((w) => w.length >= 3 && names.some((n) => n.startsWith(w) || n.includes(w)));
  });
  const cat = CATEGORIES.find((c) => (CATEGORY_WORDS[c] ?? []).some((w) => mentions(question, w))) ?? "";
  const store = stores.find((s) => mentions(question, s)) ?? "";
  const loc = locs.find((l) => mentions(question, l)) ?? "";
  // the words of the question that are actually product names in the expenses
  const kws = words.filter((w) => w.length >= 3 && products.some((p) => norm(p).includes(w)));
  return { months: found.length ? found : [], category: cat, location: loc, store, keywords: kws.slice(0, 4), from: "", to: "" };
}

const FILTER_SHAPE = `{"months":["2026-10"],"category":"","branch":"","shop":"","products":[],"from":"","to":""}`;

/** The model reads the question and picks what it is about. It may only choose values that exist. */
async function interpretFilter(client, cfg, question, history, lang) {
  const items = list(client.id, {});
  const months = [...new Set(items.map((x) => x.date.slice(0, 7)))].sort();
  const stores = [...new Set(items.map((x) => x.store).filter(Boolean))].slice(0, 40);
  const locs = cfg.locations.map((l) => l.name);
  const products = [...new Set(items.flatMap((x) => (x.items ?? []).map((i) => i.name)).filter(Boolean))].slice(0, 120);
  if (!aiKey() || !items.length) return fallbackFilter(question, months, stores, locs, products);
  const prompt =
    `You read a shop's expense list and work out what a question is about.\n` +
    `Expenses, one per line: date | shop | branch | category | total | products\n${ledgerFor(items, cfg)}\n\n` +
    `Months that exist: ${months.join(", ") || "(none)"}\nShops that exist: ${stores.join(", ") || "(none)"}\nBranches: ${locs.join(", ") || "(none)"}\n` +
    `Categories: ${CATEGORIES.join(", ")}\n` +
    (history?.length ? `Earlier questions in this chat:\n${history.map((h) => `Q: ${h.q}\nA: ${h.a}`).join("\n")}\n` : "") +
    `Question (written in ${lang === "en" ? "English" : "Spanish"}): """${String(question).slice(0, 500)}"""\n` +
    `Answer with JSON only, exactly this shape: ${FILTER_SHAPE}\n` +
    `- months: the months the question is about, from the list above; [] means every month\n` +
    `- category: one of the categories, or ""\n` +
    `- branch: a branch from the list, or ""\n` +
    `- shop: part of a shop name from the list, or ""\n` +
    `- products: the words the question uses for the products it asks about (up to 4), copied from the list\n` +
    `- from/to: YYYY-MM-DD when the question names a date range, otherwise ""\n` +
    `Do not answer the question. Only say what it is about.`;
  try {
    const out = await complete({ key: aiKey(), prompt, json: true, tier: "default" });
    const j = out.json ?? {};
    return {
      months: Array.isArray(j.months) ? j.months.filter((m) => validMonth(m)).slice(0, 24) : [],
      category: CATEGORIES.includes(j.category) ? j.category : "",
      location: locs.find((l) => norm(l) === norm(j.branch)) ?? "",
      store: typeof j.shop === "string" ? j.shop.slice(0, 80) : "",
      keywords: Array.isArray(j.products) ? j.products.filter((k) => typeof k === "string" && k.trim()).slice(0, 4) : [],
      from: validDate(j.from) ? j.from : "",
      to: validDate(j.to) ? j.to : "",
    };
  } catch (e) {
    console.warn("Expenses question failed:", e.message);
    return fallbackFilter(question, months, stores, locs, products);
  }
}

/** What one line of a receipt is worth.
 *  A line's price can be the price of the line (scanned receipts) or the price of one unit (typed by
 *  hand). The receipt's own total says which one it is, so the sum is right either way. */
export function lineValue(x, item) {
  const items = x.items ?? [];
  if (!items.length) return 0;
  const qty = Number(item.qty) || 1;
  if (qty === 1) return item.priceCents;
  const asLines = items.reduce((n, i) => n + i.priceCents, 0);
  const asUnits = items.reduce((n, i) => n + i.priceCents * (Number(i.qty) || 1), 0);
  if (asLines === x.totalCents && asUnits !== x.totalCents) return item.priceCents;  // the price is the line
  if (asUnits === x.totalCents) return item.priceCents * qty;                       // the price is per unit
  return item.priceCents;
}

/** The net sum of the items: what the business paid before the tax. */
export const itemsTotal = (items) => (items ?? []).reduce((n, it) => n + (Number(it.priceCents) || 0) * (Number(it.qty) || 1), 0);

/** The tax of an expense: a rate on the net sum, or a fixed amount the business typed. */
export function taxOf(items, { taxCents = null, taxRate = 0.07, taxIncluded = false } = {}) {
  if (taxIncluded) return 0;
  if (taxCents != null) return taxCents;
  return Math.round(itemsTotal(items) * (Number(taxRate) || 0));
}

/** The total of an expense: the items plus the tax. Never typed by hand when there are items. */
export const totalOf = (items, tax) => itemsTotal(items) + (tax ?? 0);

/** The exact answer: the numbers come from the stored expenses, never from the model. */
export function answerExpenses(client, cfg, filter, lang = "es") {
  const en = lang === "en";
  const items = list(client.id, {});
  const loc = new Map(cfg.locations.map((l) => [l.id, l.name]));
  const money = (cents) => { try { return new Intl.NumberFormat(en ? "en-IE" : "es-ES", { style: "currency", currency: cfg.currency || "EUR" }).format(cents / 100); } catch { return (cents / 100).toFixed(2) + " " + (cfg.currency || "EUR"); } };
  const months = (Array.isArray(filter.months) ? filter.months : []).filter(validMonth);
  const cat = CATEGORIES.includes(filter.category) ? filter.category : "";
  const locF = norm(filter.location), storeF = norm(filter.store);
  const kws = (Array.isArray(filter.keywords) ? filter.keywords : []).map(norm).filter(Boolean).slice(0, 5);
  const from = validDate(filter.from) ? filter.from : "", to = validDate(filter.to) ? filter.to : "";

  const matched = items.filter((x) =>
    (!months.length || months.includes(x.date.slice(0, 7))) &&
    (!cat || x.category === cat) &&
    (!locF || norm(loc.get(x.locationId)).includes(locF)) &&
    (!storeF || norm(x.store).includes(storeF)) &&
    (!from || x.date >= from) && (!to || x.date <= to));

  const lines = [];
  for (const x of matched) for (const it of (x.items ?? [])) {
    if (kws.length && !kws.some((k) => norm(it.name).includes(k))) continue;
    lines.push({ id: x.id, date: x.date, store: x.store, location: loc.get(x.locationId) ?? "", name: it.name, qty: it.qty, priceCents: it.priceCents, valueCents: lineValue(x, it) });
  }
  const byProduct = kws.length > 0;
  const totalCents = byProduct ? lines.reduce((n, l) => n + l.valueCents, 0) : matched.reduce((n, x) => n + x.totalCents, 0);
  const period = months.length === 1 ? monthName(months[0], lang)
    : months.length > 1 ? months.map((m) => monthName(m, lang)).join(en ? " and " : " y ")
    : (from || to ? `${from || "…"} → ${to || "…"}` : (en ? "all your expenses" : "todos tus gastos"));
  const inPeriod = months.length ? (en ? `In ${period}` : `En ${period}`) : (en ? "In total" : "En total");

  const matchIds = [...new Set((byProduct ? lines : matched.map((x) => ({ id: x.id }))).map((x) => x.id))].slice(0, 40);
  const matches = matched.filter((x) => matchIds.includes(x.id))
    .map((x) => ({ id: x.id, date: x.date, store: x.store, totalCents: x.totalCents, hasPhoto: hasReceipt(x) }));

  let answer;
  if (!matched.length) {
    answer = en ? `I found no expenses for ${period}.` : `No encontré gastos de ${period}.`;
  } else if (byProduct) {
    const what = kws.slice(0, 2).join(en ? " or " : " o ");
    answer = !lines.length
      ? (en ? `I did not find ${what} in your expenses.` : `No encontré ${what} en tus gastos.`)
      : en ? `${inPeriod} you spent ${money(totalCents)} on ${what}, across ${lines.length} ${lines.length === 1 ? "line" : "lines"}.`
      : `${inPeriod} gastaste ${money(totalCents)} en ${what}, en ${lines.length} ${lines.length === 1 ? "línea" : "líneas"}.`;
  } else {
    answer = en
      ? `${inPeriod} you spent ${money(totalCents)} across ${matched.length} ${matched.length === 1 ? "expense" : "expenses"}.`
      : `${inPeriod} gastaste ${money(totalCents)} en ${matched.length} ${matched.length === 1 ? "gasto" : "gastos"}.`;
  }
  const top = (byProduct ? lines : matched.map((x) => ({ date: x.date, store: x.store, name: "", qty: 0, valueCents: x.totalCents })))
    .sort((a, b) => b.valueCents - a.valueCents).slice(0, 8);
  return { answer, totalCents, count: byProduct ? lines.length : matched.length, receiptCount: matched.length, period, top, matches, byProduct };
}

/** Answer a question about the expenses of this business. */
export async function askExpenses(client, cfg, question, history = [], lang = "es") {
  const filter = await interpretFilter(client, cfg, question, history, lang);
  const out = answerExpenses(client, cfg, filter, lang);
  return { ...out, filter };
}

// ---- dictation: what the business says becomes items ----
const DICTATE_PROMPT = `The owner of a shop is dictating what they bought. Turn it into a list of items.
Answer with JSON only: {"items":[{"name": string, "qty": number, "price": number (the price of one unit, without tax)}], "store": string or "", "note": string or ""}
Rules:
- one item per thing they bought, with a short plain name
- qty is how many; "un kilo", "el kilo" or "media docena" is qty 1
- price is what one unit costs, without tax; use a dot for the decimals
- if they say a line total ("tres kilos de tomates a seis euros"), divide it by the quantity
- if no price is said, use 0
- never invent an item that was not said
`;

/** Read what the business dictated into items. The model only reads the words; the maths is ours. */
export async function parseDictation(client, cfg, text, lang = "es") {
  const said = String(text ?? "").trim().slice(0, 2000);
  if (!said) return { items: [], text: said, store: "", note: "" };
  if (!aiKey()) return { items: [], text: said, store: "", note: "", model: "no AI key" };
  try {
    const out = await complete({ key: aiKey(), prompt: `${DICTATE_PROMPT}\nThey said:\n"""${said}"""`, json: true, tier: "quick", maxTokens: 900 });
    const j = out.json ?? {};
    return { items: cleanItems(Array.isArray(j.items) ? j.items : []), text: said, store: str(j.store, 120), note: str(j.note, 200), model: out.model };
  } catch (e) {
    console.warn("Could not read the dictated items:", e.message);
    return { items: [], text: said, store: "", note: "" };
  }
}

/** What the business hears after dictating: the items added and the new total. */
export function dictationSummary(items, taxRate, lang = "es", currency = "EUR") {
  const money = (cents) => { try { return new Intl.NumberFormat(lang === "en" ? "en-IE" : "es-ES", { style: "currency", currency }).format(cents / 100); } catch { return (cents / 100).toFixed(2) + " " + currency; } };
  const net = itemsTotal(items);
  const tax = taxOf(items, { taxRate });
  const total = totalOf(items, tax);
  const names = items.map((i) => `${i.qty > 1 ? i.qty + " x " : ""}${i.name}`).join(", ");
  const text = lang === "en"
    ? `Added: ${names}. The total is ${money(total)}.`
    : `Añadido: ${names}. El total es ${money(total)}.`;
  return { text, totalCents: total, netCents: net, taxCents: tax, currency };
}

/** Dictate: the recording becomes text, the text becomes items, and the business hears the new total.
 *  `body.audio` is a data URL of the recording; `body.text` is used when the browser listened itself. */
export async function dictate(client, cfg, body = {}, lang = "es") {
  const current = cleanItems(Array.isArray(body.items) ? body.items : []);
  const taxRate = cleanRate(body.taxRate);
  let text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
  let provider = null;
  const audio = typeof body.audio === "string" ? body.audio : "";
  if (audio) {
    const m = /^data:audio\/([a-z0-9.+-]+);base64,(.+)$/i.exec(audio);
    if (m) {
      const heard = await transcribe(Buffer.from(m[2], "base64"), `audio/${m[1]}`, { lang });
      if (heard) { text = heard.text; provider = heard.provider; }
    }
  }
  if (!text) return { items: [], text: "", speech: null, error: "no_speech" };
  const parsed = await parseDictation(client, cfg, text, lang);
  const items = [...current, ...parsed.items];
  const summary = dictationSummary(items, taxRate, lang, cfg.currency || "EUR");
  let speech = null;
  const said = await speak(summary.text, lang);
  if (said?.buffer?.length) speech = `data:audio/${said.ext};base64,${said.buffer.toString("base64")}`;
  return {
    items: parsed.items, text, provider, store: parsed.store, note: parsed.note,
    netCents: summary.netCents, taxCents: summary.taxCents, totalCents: summary.totalCents,
    summary: summary.text, speech, model: parsed.model,
  };
}

