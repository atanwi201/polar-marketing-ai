// Expense tracker: amounts, validation, summaries, receipt normalising, CSV/ODS export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "exp-"));
const X = await import("./expenses.mjs");
const { toCsv, toOds, rows } = await import("./expenses-export.mjs");
const { db } = await import("./store.mjs");

db.clients.push({ id: "c1", name: "Bar Uno" });
const cfg = X.ensureConfig(db.clients[0]);
X.updateConfig(cfg, { enabled: true, locations: [{ name: "Playa" }, { name: "Centro" }] }, { owner: true });
const [playa, centro] = cfg.locations;

test("off by default; only the owner can switch it on", () => {
  const c2 = X.ensureConfig({ id: "c2", name: "X" });
  assert.equal(c2.enabled, false);
  X.updateConfig(c2, { enabled: true }, { owner: false });
  assert.equal(c2.enabled, false);
  assert.equal(X.isEnabled("c2"), false);
  assert.equal(X.isEnabled("c1"), true);
});
test("toCents parses European and English amounts", () => {
  assert.equal(X.toCents("12,50"), 1250);
  assert.equal(X.toCents("1.234,56"), 123456);
  assert.equal(X.toCents("1,234.56"), 123456);
  assert.equal(X.toCents(7.1), 710);
  assert.equal(X.toCents("€ 3.99"), 399);
  assert.equal(X.toCents(""), null);
  assert.equal(X.toCents("abc"), null);
});
test("validation: date, total and location are required and checked", () => {
  assert.throws(() => X.addExpense(cfg, { date: "2026-13-40", total: 5 }), /date/);
  assert.throws(() => X.addExpense(cfg, { date: "2026-10-01" }), /total/);
  assert.throws(() => X.addExpense(cfg, { date: "2026-10-01", total: 5, locationId: "nope" }), /location/);
  const x = X.addExpense(cfg, { date: "2026-10-01", total: "12,50", locationId: playa.id, store: "  Spar ", category: "weird", items: [{ name: "Milk", qty: 2, price: "1,25" }, { name: "" }] });
  assert.equal(x.totalCents, 268);   // 2 x 1,25 + 7% IGIC: the typed total is not used
  assert.equal(x.category, "other"); assert.equal(x.store, "Spar");
  assert.deepEqual(x.items, [{ name: "Milk", qty: 2, priceCents: 125 }]);
});
test("list filters by month and location; summary totals add up", () => {
  X.addExpense(cfg, { date: "2026-10-15", total: 20, locationId: centro.id, category: "food" });
  X.addExpense(cfg, { date: "2026-10-20", total: 30, locationId: playa.id, category: "food" });
  X.addExpense(cfg, { date: "2026-09-02", total: 99, locationId: playa.id, category: "rent" });
  const oct = X.list("c1", { month: "2026-10" });
  assert.equal(oct.length, 3);
  assert.equal(oct[0].date, "2026-10-20");
  const s = X.summarize(oct, cfg);
  assert.equal(s.totalCents, 5268);   // 2,68 (milk + IGIC) + 20 + 30
  assert.deepEqual(s.byCategory.map((c) => [c.category, c.totalCents]), [["food", 5000], ["other", 268]]);
  assert.equal(X.list("c1", { month: "2026-10", locationId: centro.id }).length, 1);
  assert.ok(X.months("c1").includes("2026-09"));
});
test("a location that has expenses cannot be removed", () => {
  assert.throws(() => X.updateConfig(cfg, { locations: [{ id: centro.id, name: "Centro" }] }), (e) => e.status === 409);
  X.updateConfig(cfg, { locations: [{ id: playa.id, name: "Playa Norte" }, { id: centro.id, name: "Centro" }] });
  assert.equal(cfg.locations[0].name, "Playa Norte");
});
test("normalizeScan keeps what is readable and leaves the rest empty for review", () => {
  const d = X.normalizeScan({ store: "SPAR", location: "Centro, Santa Cruz", date: "2026-10-03", items: [{ name: "Pan", qty: 1, price: 1.2 }, { name: "Agua", qty: 2, price: "1,60" }], total: "2,80", tax: null, category: "food", currency: "EUR" }, cfg);
  assert.equal(d.locationId, centro.id); assert.equal(d.totalCents, 280); assert.equal(d.taxCents, null); assert.equal(d.items.length, 2);
  const bad = X.normalizeScan({ date: "03/10", total: "???", category: "x" }, cfg);
  assert.equal(bad.date, ""); assert.equal(bad.totalCents, null); assert.equal(bad.locationId, ""); assert.equal(bad.category, "other");
  assert.equal(X.normalizeScan("junk", cfg).store, "");
  assert.equal(X.normalizeScan({ items: [{ name: "a", price: 2 }, { name: "b", price: 3 }] }, cfg).totalCents, 500); // total from items when missing
});
test("CSV: numbers, quoting, spreadsheet-formula guard, BOM", () => {
  const items = [{ date: "2026-10-01", store: '=HYPERLINK("x")', locationId: playa.id, category: "food", items: [{ name: "a; b", qty: 2, priceCents: 100 }], taxCents: 50, totalCents: 1250, notes: 'say "hi"' }];
  const csv = toCsv(items, cfg, "en");
  assert.ok(csv.startsWith("﻿Date,Store,Location"));
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /12\.50/);
  assert.match(csv, /"say ""hi"""/);
  assert.equal(rows(items, cfg, "es")[0][0], "Fecha");
});
test("ODS is a valid OpenDocument zip: mimetype first and stored, sheet has the rows and a total", () => {
  const items = X.list("c1", { month: "2026-10" });
  const buf = toOds(items, cfg, "es", "2026-10");
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  assert.equal(buf.subarray(30, 38).toString(), "mimetype"); // first entry
  const files = unzipSync(new Uint8Array(buf));
  assert.equal(strFromU8(files["mimetype"]), "application/vnd.oasis.opendocument.spreadsheet");
  const content = strFromU8(files["content.xml"]);
  assert.equal((content.match(/<table:table-row>/g) ?? []).length, items.length + 2); // header + rows + total
  assert.match(content, /office:value="52\.68"/);
  assert.ok(files["META-INF/manifest.xml"]);
});

// ---- asking about the expenses ----

test("the answer is computed from the stored expenses, not guessed", () => {
  const a = X.answerExpenses(db.clients[0], cfg, { months: ["2026-10"], category: "", location: "", store: "", keywords: [], from: "", to: "" }, "es");
  assert.equal(a.totalCents, 5268);          // 2,68 (milk + IGIC) + 20 + 30
  assert.equal(a.count, 3);
  assert.equal(a.matches.length, 3);
  assert.match(a.answer, /52[,.]68/);        // the amount is in the text
  assert.match(a.answer, /octubre/i);        // and the month it is about
});
test("a question about a product sums only the matching lines", () => {
  const a = X.answerExpenses(db.clients[0], cfg, { months: [], category: "", location: "", store: "", keywords: ["milk"], from: "", to: "" }, "en");
  assert.equal(a.count, 1);
  assert.equal(a.totalCents, 125);            // the one milk line
  assert.equal(a.byProduct, true);
  assert.match(a.answer, /milk/i);
  const none = X.answerExpenses(db.clients[0], cfg, { months: [], category: "", location: "", store: "", keywords: ["caviar"], from: "", to: "" }, "en");
  assert.equal(none.totalCents, 0);
  assert.equal(none.matches.length, 0);
  assert.match(none.answer, /did not find caviar/i);
});
test("the filter narrows by category, location and shop", () => {
  const byCat = X.answerExpenses(db.clients[0], cfg, { months: [], category: "rent", location: "", store: "", keywords: [], from: "", to: "" }, "en");
  assert.equal(byCat.count, 1);
  assert.equal(byCat.totalCents, 9900);
  const byShop = X.answerExpenses(db.clients[0], cfg, { months: [], category: "", location: "", store: "spar", keywords: [], from: "", to: "" }, "en");
  assert.equal(byShop.count, 1);
  const byLoc = X.answerExpenses(db.clients[0], cfg, { months: [], category: "", location: "centro", store: "", keywords: [], from: "", to: "" }, "en");
  assert.equal(byLoc.totalCents, 2000);
});
test("a typed price is a unit price and a scanned one is the line price; the sum is right either way", () => {
  const typed = { totalCents: 250, items: [{ name: "Milk", qty: 2, priceCents: 125 }] };
  assert.equal(X.lineValue(typed, typed.items[0]), 250);        // 2 x 1,25
  const scanned = { totalCents: 250, items: [{ name: "Milk", qty: 2, priceCents: 250 }] };
  assert.equal(X.lineValue(scanned, scanned.items[0]), 250);    // the line already is 2,50
});
test("without a model the question is still read: month, category and product", () => {
  const months = ["2026-09", "2026-10"];
  const f = X.fallbackFilter("¿Cuánto gasté en leche en octubre?", months, ["Spar"], ["Playa"], ["Leche entera", "Pan de molde"]);
  assert.deepEqual(f.months, ["2026-10"]);       // "octubre" is read, in Spanish
  assert.ok(f.keywords.includes("leche"));      // and only the words that are real products
  assert.ok(!f.keywords.includes("cuanto"));
  const g = X.fallbackFilter("how much did I spend on rent in september", months, [], [], []);
  assert.deepEqual(g.months, ["2026-09"]);
  assert.equal(g.category, "rent");
  const h = X.fallbackFilter("¿cuánto gasté en alquiler?", months, [], [], []);
  assert.equal(h.category, "rent");              // Spanish category words work too
});
test("the receipt photo is kept with the expense, outside the public media folder", async () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const file = await X.saveReceipt(png, "abc123");
  assert.match(file, /^exp-abc123\.(jpg|png)$/);
  const buf = await X.readReceipt(file);
  assert.ok(buf && buf.length > 0);
  assert.equal(await X.readReceipt("../../etc/passwd"), null);
  assert.equal(await X.readReceipt("not-a-receipt.jpg"), null);
  // it must not be reachable through the public media folder
  assert.ok(!X.RECEIPT_DIR.endsWith("media"));
});

// ---- the total is the items plus the tax ----

test("the total is the items plus the IGIC; the business never types it", () => {
  const x = X.addExpense(cfg, { date: "2026-11-01", locationId: playa.id, category: "food", items: [{ name: "Tomates", qty: 2, price: "2,32" }] });
  assert.equal(X.itemsTotal(x.items), 464);   // 2 x 2,32
  assert.equal(x.taxCents, 32);               // 7% IGIC
  assert.equal(x.totalCents, 496);            // 4,64 + 0,32
  assert.equal(x.taxRate, 0.07);
});
test("the tax can be IVA 21% or none, and the tax printed on a receipt wins", () => {
  const a = X.addExpense(cfg, { date: "2026-11-02", locationId: playa.id, items: [{ name: "X", qty: 1, price: 10 }], taxRate: 0.21 });
  assert.equal(a.taxCents, 210); assert.equal(a.totalCents, 1210);
  const b = X.addExpense(cfg, { date: "2026-11-03", locationId: playa.id, items: [{ name: "X", qty: 1, price: 10 }], taxRate: 0 });
  assert.equal(b.taxCents, 0); assert.equal(b.totalCents, 1000);
  const c = X.addExpense(cfg, { date: "2026-11-04", locationId: playa.id, items: [{ name: "X", qty: 1, price: 10 }], tax: "0,70" });
  assert.equal(c.taxCents, 70); assert.equal(c.totalCents, 1070);
});
test("with no items the amount is typed (a whole rent)", () => {
  const r = X.addExpense(cfg, { date: "2026-11-05", locationId: playa.id, total: "800,00" });
  assert.equal(r.totalCents, 80000);
  assert.throws(() => X.addExpense(cfg, { date: "2026-11-06", locationId: playa.id }), /total/);
});
test("a scanned receipt adds up: the lines and the tax make its total", () => {
  const d = X.normalizeScan({ store: "Spar", date: "2026-10-03", items: [{ name: "Pan", qty: 1, price: 1.2 }], total: 1.2, tax: 0.08 }, cfg);
  assert.equal(d.totalCents, 120);
  assert.equal(X.itemsTotal(d.items) + d.taxCents, d.totalCents);
  assert.equal(d.taxRate, 0.07);   // 8 cents on 1,12 is 7%
});
test("the dictated summary says what was added and what the total is", () => {
  const s = X.dictationSummary([{ name: "Tomates", qty: 2, priceCents: 232 }], 0.07, "es", "EUR");
  assert.equal(s.netCents, 464);
  assert.equal(s.taxCents, 32);
  assert.equal(s.totalCents, 496);
  assert.match(s.text, /Tomates/);
  assert.match(s.text, /4,96/);
});
