import test from "node:test";
import assert from "node:assert/strict";
import { bookPage, managePage } from "./bookings-pages.mjs";

const HOSTILE = `<script>alert(1)</script>"&'`;
const table = (o = {}) => ({ code: "abc2345", kind: "table", enabled: true, autoConfirm: false, langs: ["es", "en"], notice: "Mesa max 90 min", advanceDays: 60, timezone: "Europe/Madrid", today: "2026-10-18",
  business: { name: HOSTILE, town: "La Gomera", phone: "+34 922 000 000", logoFile: "" }, table: { minParty: 1, maxParty: 10, week: [], durationMinutes: 90 }, ...o });
const room = () => ({ ...table(), kind: "room", table: undefined, room: { roomTypes: [{ id: "r1", name: "Double", count: 2, maxGuests: 2, priceEur: 80 }], minNights: 1, maxNights: 14, checkIn: "15:00", checkOut: "11:00" } });
const booking = { id: "b1", kind: "table", status: "pending", name: HOSTILE, email: "a@b.es", phone: "", lang: "es", notes: "", date: "2026-10-20", time: "20:00", party: 2 };

test("both pages render full documents", () => {
  for (const html of [bookPage({ info: table(), baseUrl: "http://x", lang: "en", source: "link" }), bookPage({ info: room() }), managePage({ booking, info: table(), baseUrl: "http://x", cancellable: true })]) {
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<\/html>$/);
    assert.match(html, /\/brand\/tokens\.css/);
  }
});

test("hostile business name and booking values are escaped", () => {
  for (const html of [bookPage({ info: table() }), managePage({ booking, info: table(), cancellable: false })]) {
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") || html.includes("\\u003cscript\\u003ealert(1)"));
    // every </script> in the page belongs to our own tags
    assert.equal((html.match(/<script/g) || []).length, (html.match(/<\/script>/g) || []).length);
  }
});

test("Spanish and English strings are present, language limited to info.langs", () => {
  const html = bookPage({ info: table(), lang: "en" });
  assert.match(html, /Book a table/);
  assert.match(html, /Reserva una mesa/);
  assert.match(html, /<html lang="en"/);
  assert.match(bookPage({ info: table({ langs: ["es"] }), lang: "en" }), /<html lang="es"/);
  assert.ok(!bookPage({ info: table({ langs: ["es"] }) }).includes('data-lang="en"'));
  const m = managePage({ booking, info: table(), cancellable: true });
  assert.match(m, /Awaiting confirmation/);
  assert.match(m, /Pendiente de confirmar/);
});

test("email is a required email input; phone optional", () => {
  const html = bookPage({ info: table() });
  assert.match(html, /<input[^>]*id="email"[^>]*type="email"[^>]*required/);
  assert.doesNotMatch(html, /<input[^>]*id="phone"[^>]*required/);
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.match(html, /Mesa max 90 min/);
});

test("disabled business shows closed state without a form", () => {
  const html = bookPage({ info: table({ enabled: false }) });
  assert.doesNotMatch(html, /<form/);
  assert.match(html, /Online booking is unavailable/);
});
