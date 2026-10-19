// Digital menu: cleaning, allergens, caps, public view, import normalising, links on websites, page rendering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "menu-"));
process.env.PUBLIC_URL = "https://studio.example";
const M = await import("./menu.mjs");
const { menuPage, menuNotFoundPage, money } = await import("./menu-pages.mjs");
const { injectMenuCta, menuFor } = await import("./menu-links.mjs");
const { siteCta } = await import("./bookings-links.mjs");
const { db } = await import("./store.mjs");

db.clients.push({ id: "c1", name: "Bar <Uno>", profile: { colors: { primary: "#112233", accent: "#ff8800" } } });
const cfg = M.ensureConfig(db.clients[0]);

test("14 EU allergens; config is off by default, code is unguessable and unique; only the owner switches it on", () => {
  assert.equal(M.ALLERGENS.length, 14);
  assert.equal(cfg.enabled, false);
  assert.match(cfg.code, /^[a-z2-9]{8}$/);
  M.updateConfig(cfg, { enabled: true, languages: ["fr", "xx", "fr", "en"] }, { owner: false });
  assert.equal(cfg.enabled, false);
  assert.deepEqual(cfg.languages, ["fr", "en"]);
  M.updateConfig(cfg, { enabled: true, languages: ["es", "en"] }, { owner: true });
  assert.equal(cfg.enabled, true);
  assert.equal(M.menuUrl(cfg, "https://x.y"), `https://x.y/menu/${cfg.code}`);
});

test("cleanCategories: trims, drops unnamed, filters allergens, keeps cents, assigns unique ids", () => {
  const cats = M.cleanCategories([
    { name: { es: " Entrantes ", en: "Starters", zz: "no" }, items: [
      { name: { es: "Croquetas" }, description: { es: "De jamón" }, priceCents: 850.4, allergens: ["gluten", "milk", "bogus", "milk"], photo: "/menu/img/a.jpg", available: true },
      { name: { es: "" }, priceCents: 100 },
      { name: "Bare string", priceCents: "x", photo: "http://evil/x.png", available: false, id: "same" },
      { name: { en: "Dup id" }, id: "same", priceCents: -5 },
    ] },
    { name: {}, items: [{ name: { es: "Orphan" } }] },
  ], { defaultLang: "es" });
  assert.equal(cats.length, 1);
  assert.deepEqual(cats[0].name, { es: "Entrantes", en: "Starters" });
  const [a, b, c] = cats[0].items;
  assert.equal(a.priceCents, 850); assert.deepEqual(a.allergens, ["gluten", "milk"]); assert.equal(a.photo, "/menu/img/a.jpg");
  assert.deepEqual(b.name, { es: "Bare string" }); assert.equal(b.priceCents, null); assert.equal(b.photo, ""); assert.equal(b.available, false); assert.equal(b.id, "same");
  assert.notEqual(c.id, "same"); assert.equal(c.priceCents, null);
  assert.equal(new Set([a.id, b.id, c.id]).size, 3);
});

test("caps: 30 categories, 200 items each", () => {
  const big = Array.from({ length: 40 }, (_, i) => ({ name: { es: `C${i}` }, items: Array.from({ length: 250 }, (_, j) => ({ name: { es: `I${j}` } })) }));
  const out = M.cleanCategories(big);
  assert.equal(out.length, 30); assert.equal(out[0].items.length, 200);
});

test("public view: language fallback, unavailable items and empty categories hidden", async () => {
  await M.replaceCategories(cfg, [
    { name: { es: "Bebidas", en: "Drinks" }, items: [{ name: { es: "Agua", en: "Water" }, priceCents: 200 }, { name: { es: "Vino" }, priceCents: 350, available: false }] },
    { name: { es: "Postres" }, items: [{ name: { es: "Flan" }, available: false }] },
    { name: { es: "Platos" }, items: [{ name: { es: "Paella" }, description: { es: "Para <2>" }, priceCents: 1450, allergens: ["molluscs", "fish"] }] },
  ]);
  const en = M.publicView(cfg, db.clients[0], "en");
  assert.equal(en.lang, "en");
  assert.deepEqual(en.categories.map((c) => c.name), ["Drinks", "Platos"]); // Platos has no English: falls back to Spanish
  assert.deepEqual(en.categories[0].items.map((i) => i.name), ["Water"]);
  assert.equal(M.publicView(cfg, db.clients[0], "de").lang, "es"); // language not offered
  assert.ok(M.hasLiveMenu(cfg));
});

test("normalizeImport turns model JSON into a draft tree in the chosen language", () => {
  const d = M.normalizeImport({ categories: [{ name: "Pizzas", items: [{ name: "Margherita", price: "9,50", allergens: ["gluten", "x"] }, { name: "Quattro", price: null, description: "4 cheeses" }, { name: "" }] }, { name: "", items: [] }] }, "en");
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].name, { en: "Pizzas" });
  assert.equal(d[0].items[0].priceCents, 950); assert.deepEqual(d[0].items[0].allergens, ["gluten"]);
  assert.equal(d[0].items[1].priceCents, null);
  assert.deepEqual(M.normalizeImport("junk"), []);
});

test("import rejects PDFs clearly and bad images before any AI call", async () => {
  await assert.rejects(M.importFromImage(db.clients[0], cfg, "data:application/pdf;base64,AAAA", "es"), (e) => e.status === 415 && e.code === "pdf_unsupported");
  await assert.rejects(M.importFromImage(db.clients[0], cfg, "nope", "es"), (e) => e.status === 400);
});

test("translate validates languages and returns the tree untouched when nothing is missing", async () => {
  await assert.rejects(M.translate(db.clients[0], cfg, [], "xx", ["en"]), /language/);
  await assert.rejects(M.translate(db.clients[0], cfg, [], "es", ["es"]), /at least one/);
  const full = [{ name: { es: "A", en: "A" }, items: [{ name: { es: "B", en: "B" } }] }];
  const r = await M.translate(db.clients[0], cfg, full, "es", ["en"]);
  assert.deepEqual(r.categories[0].name, { es: "A", en: "A" });
});

test("money formats per language", () => {
  assert.match(money(850, "EUR", "es"), /8,50/);
  assert.match(money(1000, "EUR", "en"), /€10/);
  assert.equal(money(null), "");
});

test("page: business look, escaped text, switcher, jump bar, allergen legend, no unavailable dish", () => {
  const view = M.publicView(cfg, db.clients[0], "es");
  const html = menuPage({ view, client: { ...db.clients[0], logoFile: "logo-1.png" }, code: cfg.code });
  assert.match(html, /<html lang="es">/);
  assert.match(html, /--primary:#112233/); assert.match(html, /--accent:#ff8800/);
  assert.match(html, /\/media\/logo-1\.png/);
  assert.match(html, /Bar &lt;Uno&gt;/); assert.doesNotMatch(html, /Bar <Uno>/);
  assert.match(html, /Para &lt;2&gt;/);
  assert.match(html, new RegExp(`href="/menu/${cfg.code}\\?l=en"`));
  assert.match(html, /class="jump"/);
  assert.match(html, /Leyenda de alérgenos/); assert.match(html, /Moluscos/); assert.match(html, /Pescado/);
  assert.doesNotMatch(html, /Vino|Flan/);
  assert.match(menuPage({ view: M.publicView(cfg, db.clients[0], "en"), client: db.clients[0], code: cfg.code }), /Allergen key/);
  assert.match(menuNotFoundPage("en"), /Menu not found/);
});

test("website button: only with a live menu, stacked above the booking pill, replaced not duplicated", () => {
  const menu = menuFor(db.clients[0], { src: "website" });
  assert.equal(menu.url, `https://studio.example/menu/${cfg.code}?src=website`);
  const html = "<html><body><p>hi</p></body></html>";
  const alone = injectMenuCta(html, { menu, lang: "es" });
  assert.match(alone, /bottom:16px/); assert.match(alone, />Carta</);
  const stacked = injectMenuCta(alone, { menu, booking: true, lang: "en" });
  assert.match(stacked, /bottom:76px/); assert.match(stacked, />Menu</);
  assert.equal(stacked.match(/data-crier-menu/g).length, 1);
  assert.equal(injectMenuCta(stacked, { menu: null }), html);
  assert.match(siteCta(html, db.clients[0], "es"), /data-crier-menu/);
  cfg.enabled = false;
  assert.equal(menuFor(db.clients[0]), null);
  assert.doesNotMatch(siteCta(alone, db.clients[0], "es"), /data-crier-menu/);
  cfg.enabled = true;
});

test("removeClientData wipes the config", async () => {
  await M.removeClientData("c1");
  assert.equal(M.findConfig("c1"), undefined);
});
