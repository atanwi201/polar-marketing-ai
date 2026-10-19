// Digital menu: one per client business (db.menu.configs[], categories live on the config).
// Off until the owner enables it. Texts are language maps ({es, en, de, fr}); the public page falls back to the default language.
// Money is kept in cents (integers). Photos live in MEDIA_DIR/menu and are served at /menu/img/<file>.
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { db, id, now, MEDIA_DIR } from "./store.mjs";
import { complete, aiKey, extractJson, withClientAi } from "./openrouter.mjs";

export class MenuError extends Error {
  constructor(message, status = 400, code = "") { super(message); this.status = status; this.code = code; }
}

export const LANGS = ["es", "en", "de", "fr"];
export const LANG_NAMES = { es: "Spanish", en: "English", de: "German", fr: "French" };
export const CURRENCIES = ["EUR", "USD", "GBP"];
/** The 14 EU major allergens. */
export const ALLERGENS = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soy", "milk", "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"];
export const MAX_CATEGORIES = 30, MAX_ITEMS = 200;
export const PHOTO_DIR = join(MEDIA_DIR, "menu");
const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function mdb() {
  const m = (db.menu ??= {});
  m.configs ??= [];
  return m;
}

// ---- config ----
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const rcode = (n) => Array.from({ length: n }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
function uniqueCode() { let c; do c = rcode(8); while (mdb().configs.some((x) => x.code === c)); return c; }

export const findConfig = (clientId) => mdb().configs.find((c) => c.clientId === clientId);
export const findByCode = (code) => (typeof code === "string" ? mdb().configs.find((c) => c.code === code) : undefined);
export const clientOf = (cfg) => db.clients.find((c) => c.id === cfg?.clientId);
export const menuUrl = (cfg, base) => `${base}/menu/${cfg.code}`;

export function ensureConfig(client) {
  let c = findConfig(client.id);
  if (!c) {
    c = { clientId: client.id, enabled: false, code: uniqueCode(), languages: ["es", "en"], currency: "EUR", categories: [], createdAt: now(), updatedAt: now() };
    mdb().configs.push(c);
  }
  return c;
}

const cleanLangs = (l, fallback = ["es", "en"]) => {
  const out = [...new Set((Array.isArray(l) ? l : []).filter((x) => LANGS.includes(x)))];
  return out.length ? out : fallback;
};

/** `owner` may switch the feature on or off; the client may change languages and currency. */
export function updateConfig(cfg, b = {}, { owner = false } = {}) {
  if (owner && typeof b.enabled === "boolean") cfg.enabled = b.enabled;
  if (b.languages !== undefined) cfg.languages = cleanLangs(b.languages, cfg.languages);
  if (CURRENCIES.includes(b.currency)) cfg.currency = b.currency;
  cfg.updatedAt = now();
  return cfg;
}
export const configView = (cfg, base = "") => ({ enabled: cfg.enabled, code: cfg.code, url: menuUrl(cfg, base), languages: cfg.languages, currency: cfg.currency, allergens: ALLERGENS });

// ---- categories and items ----
const textMap = (m, n) => {
  const out = {};
  if (typeof m === "string") { const s = str(m, n); return s ? { _: s } : out; } // bare string: caller decides the language
  if (m && typeof m === "object") for (const l of LANGS) { const s = str(m[l], n); if (s) out[l] = s; }
  return out;
};
const safeId = (v) => (typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : "");
const PHOTO = /^\/menu\/img\/[\w.-]+$/;

function cleanPrice(it) {
  if (it?.priceCents === null || it?.priceCents === undefined || it?.priceCents === "") return null;
  const n = Number(it.priceCents);
  return Number.isFinite(n) && n >= 0 && n < 1e7 ? Math.round(n) : null;
}

/** Validate a full tree into stored categories: caps sizes, assigns ids, drops unnamed entries. Pure apart from id(). */
export function cleanCategories(list, { defaultLang = "es" } = {}) {
  if (!Array.isArray(list)) return [];
  const seenC = new Set(), seenI = new Set();
  const resolve = (m, n) => { const t = textMap(m, n); if (t._) { t[defaultLang] = t._; delete t._; } return t; };
  const uid = (v, seen) => { let x = safeId(v); if (!x || seen.has(x)) x = id() + Math.random().toString(36).slice(2, 5); seen.add(x); return x; };
  const out = [];
  for (const c of list.slice(0, MAX_CATEGORIES)) {
    const name = resolve(c?.name, 80);
    if (!Object.keys(name).length) continue;
    const items = [];
    for (const it of (Array.isArray(c.items) ? c.items : []).slice(0, MAX_ITEMS)) {
      const iname = resolve(it?.name, 120);
      if (!Object.keys(iname).length) continue;
      items.push({
        id: uid(it.id, seenI), name: iname, description: resolve(it.description, 400), priceCents: cleanPrice(it),
        allergens: [...new Set((Array.isArray(it.allergens) ? it.allergens : []).filter((a) => ALLERGENS.includes(a)))],
        photo: typeof it.photo === "string" && PHOTO.test(it.photo) ? it.photo : "",
        available: it.available !== false,
      });
    }
    out.push({ id: uid(c.id, seenC), name, items });
  }
  return out;
}

const photosOf = (cats) => new Set(cats.flatMap((c) => c.items.map((i) => i.photo)).filter(Boolean));
const fileOf = (url) => url.slice("/menu/img/".length);

/** Replace the whole tree. Photos no longer referenced are deleted from disk. */
export async function replaceCategories(cfg, list) {
  const before = photosOf(cfg.categories);
  cfg.categories = cleanCategories(list, { defaultLang: cfg.languages[0] });
  cfg.updatedAt = now();
  const after = photosOf(cfg.categories);
  for (const p of before) if (!after.has(p)) await unlink(join(PHOTO_DIR, fileOf(p))).catch(() => {});
  return cfg.categories;
}

export async function removeClientData(clientId) {
  const m = mdb();
  const cfg = m.configs.find((c) => c.clientId === clientId);
  for (const p of cfg ? photosOf(cfg.categories) : []) await unlink(join(PHOTO_DIR, fileOf(p))).catch(() => {});
  m.configs = m.configs.filter((c) => c.clientId !== clientId);
}

// ---- public view ----
export const pick = (m, lang, def) => m?.[lang] || m?.[def] || m?.[LANGS.find((l) => m?.[l])] || "";
export const itemAvailable = (i) => i.available !== false;
/** Does the business have a live menu worth linking to? (enabled and at least one available item) */
export const hasLiveMenu = (cfg) => !!cfg?.enabled && cfg.categories.some((c) => c.items.some(itemAvailable));
export const wantedLang = (cfg, l) => (cfg.languages.includes(l) ? l : cfg.languages[0]);

/** The menu as customers see it in one language: unavailable items and empty categories left out. */
export function publicView(cfg, client, lang) {
  const l = wantedLang(cfg, lang), def = cfg.languages[0];
  const categories = cfg.categories.map((c) => ({
    id: c.id, name: pick(c.name, l, def),
    items: c.items.filter(itemAvailable).map((i) => ({ id: i.id, name: pick(i.name, l, def), description: pick(i.description, l, def), priceCents: i.priceCents, allergens: i.allergens, photo: i.photo })),
  })).filter((c) => c.items.length);
  return { business: { name: client?.name ?? "" }, lang: l, languages: cfg.languages, currency: cfg.currency, categories };
}

// ---- photos ----
const PHOTO_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
/** Downsize an uploaded photo to a JPEG (max 1200px) and store it. Returns its public URL. */
export async function savePhoto(dataUrl) {
  const m = PHOTO_URL.exec(dataUrl ?? "");
  if (!m) throw new MenuError("Send a JPEG, PNG or WebP photo.");
  if (dataUrl.length > 12e6) throw new MenuError("That photo is too large. Try a smaller one.", 413);
  const buf = Buffer.from(m[2], "base64");
  let out;
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(buf);
    const k = Math.min(1, 1200 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    const cv = createCanvas(w, h), g = cv.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    out = cv.toBuffer("image/jpeg", 82);
  } catch { throw new MenuError("We could not read that photo. Try another one."); }
  await mkdir(PHOTO_DIR, { recursive: true });
  const file = `${id()}.jpg`;
  await writeFile(join(PHOTO_DIR, file), out);
  return `/menu/img/${file}`;
}

// ---- import from a photo of an existing menu ----
export const IMAGE_URL = /^data:image\/(jpeg|png|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/;
// The provider chain (openrouter.mjs complete) sends images as image_url parts, which chat models do not accept for PDFs.
export const PDF_URL = /^data:application\/pdf;base64,/;

const IMPORT_PROMPT = (lang) => `Read this restaurant or cafe menu. Reply with ONLY one JSON object, no prose:
{"categories":[{"name":string,"items":[{"name":string,"description":string,"price":number or null,"allergens":[...]}]}]}
Keep the menu's own sections and order. Write names and descriptions in ${LANG_NAMES[lang] ?? "the menu's language"} exactly as printed. price is a plain number with a dot for decimals and no currency symbol, or null when not printed. allergens only if the menu itself marks them, using ids from: ${ALLERGENS.join(", ")}; otherwise []. Never invent dishes or prices.`;

const cents = (v) => {
  if (v === null || v === undefined || v === "") return null;
  let s = String(v).replace(/[^\d.,-]/g, "");
  const comma = s.lastIndexOf(","), dot = s.lastIndexOf(".");
  s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = /\d/.test(s) ? Number(s) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 1e5 ? Math.round(n * 100) : null;
};

/** Model JSON into a draft tree in one language. Pure, for tests. */
export function normalizeImport(raw, lang = "es") {
  const r = raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(r) ? r : Array.isArray(r.categories) ? r.categories : [];
  const tree = list.map((c) => ({
    name: str(c?.name, 80),
    items: (Array.isArray(c?.items) ? c.items : []).map((it) => ({
      name: str(it?.name, 120), description: str(it?.description, 400), priceCents: cents(it?.price ?? it?.priceCents / 100), allergens: it?.allergens,
    })),
  }));
  return cleanCategories(tree, { defaultLang: lang });
}

async function importMenu(client, cfg, image, lang) {
  if (PDF_URL.test(image ?? "")) throw new MenuError("PDF files cannot be read yet. Send a photo or screenshot of the menu instead.", 415, "pdf_unsupported");
  if (!IMAGE_URL.test(image ?? "")) throw new MenuError("Send a JPEG, PNG or WebP photo.");
  if (image.length > 8e6) throw new MenuError("That photo is too large. Try a smaller one.", 413);
  if (!aiKey()) throw new MenuError("The menu reader is not available right now. Add the dishes by hand.", 503, "no_ai");
  const l = LANGS.includes(lang) ? lang : cfg.languages[0];
  let out;
  try {
    out = await complete({ key: aiKey(), tier: "quick", images: [image], prompt: IMPORT_PROMPT(l), json: true, maxTokens: 4000 });
  } catch (e) {
    console.warn("Menu import failed:", e.message);
    throw new MenuError("We could not read that menu. Try a sharper photo or add the dishes by hand.", 502, "import_failed");
  }
  const categories = normalizeImport(out.json ?? extractJson(out.text), l);
  if (!categories.length) throw new MenuError("We could not find any dishes in that photo. Try a sharper one.", 502, "import_empty");
  return { categories, lang: l, model: out.model };
}
export const importFromImage = withClientAi(importMenu);

// ---- translation (text tier) ----
/** Every translatable string of a tree: [{get, set}] closures so results can be written back. */
function slots(categories, from, to) {
  const out = [];
  const add = (obj, key) => {
    const src = obj[key]?.[from];
    if (!src) return;
    for (const t of to) if (!obj[key][t]) out.push({ obj: obj[key], lang: t, src });
  };
  for (const c of categories) { add(c, "name"); for (const i of c.items) { add(i, "name"); add(i, "description"); } }
  return out;
}

async function translateTree(client, cfg, categories, from, to) {
  if (!LANGS.includes(from)) throw new MenuError("Choose the language to translate from.");
  const targets = [...new Set((Array.isArray(to) ? to : []).filter((l) => LANGS.includes(l) && l !== from))];
  if (!targets.length) throw new MenuError("Choose at least one language to translate into.");
  const tree = cleanCategories(categories, { defaultLang: from });
  const work = slots(tree, from, targets);
  if (!work.length) return { categories: tree };
  if (!aiKey()) throw new MenuError("The translator is not available right now. Write the other languages by hand.", 503, "no_ai");
  for (const lang of targets) {
    const mine = work.filter((w) => w.lang === lang);
    for (let i = 0; i < mine.length; i += 120) {
      const chunk = mine.slice(i, i + 120);
      const prompt = `Translate these restaurant menu texts from ${LANG_NAMES[from]} to ${LANG_NAMES[lang]}. Keep dish names natural for a menu (leave proper names and well-known dish names as they are). Reply with ONLY one JSON object, no prose: {"t":[...]} holding exactly ${chunk.length} strings in the same order.\n${JSON.stringify(chunk.map((w) => w.src))}`;
      let out;
      try { out = await complete({ key: aiKey(), tier: "default", prompt, json: true, maxTokens: 4000 }); }
      catch (e) { console.warn("Menu translate failed:", e.message); throw new MenuError("We could not translate the menu right now. Try again in a moment.", 502, "translate_failed"); }
      const arr = (out.json ?? extractJson(out.text))?.t;
      if (!Array.isArray(arr) || arr.length !== chunk.length) throw new MenuError("We could not translate the menu right now. Try again in a moment.", 502, "translate_failed");
      chunk.forEach((w, k) => { const s = str(arr[k], 400); if (s) w.obj[lang] = s; });
    }
  }
  return { categories: tree };
}
export const translate = withClientAi(translateTree);
