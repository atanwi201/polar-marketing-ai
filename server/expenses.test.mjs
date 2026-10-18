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
  assert.equal(x.totalCents, 1250); assert.equal(x.category, "other"); assert.equal(x.store, "Spar");
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
  assert.equal(s.totalCents, 6250);
  assert.deepEqual(s.byCategory.map((c) => [c.category, c.totalCents]), [["food", 5000], ["other", 1250]]);
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
  assert.match(content, /office:value="62\.50"/);
  assert.ok(files["META-INF/manifest.xml"]);
});
