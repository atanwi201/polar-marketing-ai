// Marketing consent (plan Part C): the log, the card-page panel, the one-tap way out, the optional
// bonus, and the owner's send list. Everything here runs against the real routes and a temp DATA_DIR.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "loy-consent-"));
process.env.DATA_DIR = join(root, "data");
const { db } = await import("./store.mjs");
const { handleLoyalty } = await import("./loyalty-routes.mjs");
const L = await import("./loyalty.mjs");
const C = await import("./consent.mjs");

const shopA = { id: "ca", name: "Casa Uno", token: "portal-ca" }, shopB = { id: "cb", name: "Bar Dos", token: "portal-cb" };
db.clients.push(shopA, shopB);
const live = (client, fields = {}) => { const p = L.createProgram(client, { type: "stamps", ...fields }); p.status = "live"; return p; };
const progA = live(shopA, { consentBonus: 2 }), progB = live(shopB);

const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req, limit = 1e6) => new Promise((ok, fail) => {
  let s = ""; req.on("data", (c) => { s += c; if (s.length > limit) { fail(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } });
  req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { fail(Object.assign(new Error("bad json"), { status: 400 })); } });
});
let server, B;
const ctx = {
  send, readBody, isAdmin: (req) => req.headers["x-admin-token"] === "secret", clientByToken: (t) => db.clients.find((c) => c.token === t),
  baseUrl: () => "http://shop.test", clientIp: (req) => String(req.headers["x-test-ip"] ?? "9.9.9.9"), wallet: {},
};
before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try { if (!(await handleLoyalty(req, res, url, url.pathname.split("/").filter(Boolean), ctx))) send(res, 404, { error: "nope" }); }
    catch (e) { send(res, e.status ?? 500, { error: e.message }); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  B = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

let ipn = 0;
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(B + path, { method, headers: { "Content-Type": "application/json", "x-test-ip": `10.60.${++ipn % 250}.1`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, ct, headers: r.headers, body: ct.includes("json") ? await r.json() : await r.text() };
};
const member = (phone, name = "Ana") => L.findOrCreateMember({ phone, name }).member;
const cardOf = (m, p) => L.cardForMember(m, p).customer;
const clean = (p) => { p.status = "live"; return p; };

test("the log is append-only, latest answer wins, and the text shown is kept", () => {
  const m = member("+34 611 000 001"), card = cardOf(m, progA);
  const r1 = C.recordConsent({ member: m, customer: card, clientId: "ca", programId: progA.id, channel: "whatsapp", lang: "es", business: "Casa Uno", ip: "203.0.113.9", ua: "TestBrowser/1" });
  assert.equal(r1.granted, true);
  assert.equal(r1.textId, C.textId("whatsapp", "es"));
  assert.equal(r1.textShown, "Quiero recibir ofertas y novedades de Casa Uno por WhatsApp. Puedo darme de baja cuando quiera.");
  assert.equal(r1.ipHash.length, 32);
  assert.notEqual(r1.ipHash, "203.0.113.9", "the address is hashed, not stored");
  assert.ok(r1.uaHash);
  assert.ok(r1.unsubToken.length >= 24);
  assert.equal(C.hasConsent(m, "ca", "whatsapp"), true);
  assert.equal(C.rowsFor(m, "ca").length, 1);

  C.withdrawConsent({ member: m, clientId: "ca", channels: ["whatsapp"], lang: "en" });
  assert.equal(C.hasConsent(m, "ca", "whatsapp"), false);
  const rows = C.rowsFor(m, "ca");
  assert.equal(rows.length, 2, "a withdrawal is a new row, never an edit");
  assert.equal(rows.at(-1).granted, false);
  assert.equal(rows.at(-1).textId, C.withdrawTextId("en"));

  C.recordConsent({ member: m, customer: card, clientId: "ca", programId: progA.id, channel: "whatsapp", lang: "es", business: "Casa Uno" });
  assert.equal(C.hasConsent(m, "ca", "whatsapp"), true, "the newest yes wins");
  assert.equal(C.rowsFor(m, "ca").length, 3);
  assert.equal(rows[0].granted, true, "the old grant is still there, untouched");
  assert.equal(rows[0].textShown, r1.textShown);
});

test("an old boolean card keeps counting for email, never for WhatsApp", () => {
  const old = L.joinCustomer(progA, { name: "Vieja", email: "vieja@example.com", marketingConsent: true });
  assert.equal(C.hasConsent(old, "ca", "email"), true);
  assert.equal(C.hasConsent(old, "ca", "whatsapp"), false, "the old box was an email box");
  assert.deepEqual(C.consentState(old, "ca"), { whatsapp: false, email: true, decided: false });

  const m = member("+34 611 000 002"), card = cardOf(m, progA);
  card.marketingConsent = true;
  assert.equal(C.hasConsent(m, "ca", "email"), true, "no rows yet: the card's boolean is the answer");
  assert.equal(C.hasConsent(m, "ca", "whatsapp"), false);
  assert.equal(C.consentState(m, "ca").decided, false);

  C.recordConsent({ member: m, customer: card, clientId: "ca", programId: progA.id, channel: "whatsapp", lang: "es", business: "Casa Uno" });
  assert.equal(C.hasConsent(m, "ca", "whatsapp"), true);
  assert.equal(C.hasConsent(m, "ca", "email"), true, "untouched channel still falls back");
  assert.equal(card.marketingConsent, true, "email consent keeps the old flag on");

  C.withdrawConsent({ member: m, clientId: "ca", channels: ["email"], lang: "es" });
  assert.equal(C.hasConsent(m, "ca", "email"), false);
  assert.equal(card.marketingConsent, false, "the boolean follows the email channel");
  assert.equal(C.hasConsent(m, "ca", "whatsapp"), true, "withdrawing email does not touch WhatsApp");
});

test("both languages carry the same promise, and the version is on every row", () => {
  const es = C.consentText("email", "es", "Casa Uno"), en = C.consentText("email", "en", "Casa Uno");
  assert.equal(es, "Quiero recibir ofertas y novedades de Casa Uno por email. Puedo darme de baja cuando quiera.");
  assert.equal(en, "I want to receive offers and news from Casa Uno by email. I can unsubscribe at any time.");
  assert.notEqual(es, en);
  assert.match(C.textId("email", "es"), /^email-es-2026-10-v1$/);
  assert.equal(C.langOf("de"), "es", "anything that is not English gets Spanish");
  assert.match(C.consentText("whatsapp", "en", "Casa Uno"), /WhatsApp/);
});

test("the bonus lands once per card, ever", () => {
  const p = live(shopA, { consentBonus: 2 });
  const m = member("+34 611 000 003"), card = cardOf(m, p);
  const before = card.stamps;
  const b = L.grantConsentBonus(card, p);
  assert.deepEqual(b, { kind: "stamps", n: 2 });
  assert.equal(card.stamps, before + 2);
  assert.ok(card.consentBonusAt);
  assert.ok(L.txnsOf(card).some((t) => t.note === "Consent bonus" && t.stamps === 2));
  assert.equal(L.grantConsentBonus(card, p), null, "a second tick gives nothing");

  // Withdraw and come back: still nothing.
  C.recordConsent({ member: m, customer: card, clientId: "ca", programId: p.id, channel: "email", lang: "es", business: "Casa Uno" });
  C.withdrawConsent({ member: m, clientId: "ca", channels: C.CHANNELS });
  assert.equal(L.grantConsentBonus(card, p), null);

  const pts = live(shopA, { type: "points", consentBonus: 5 });
  const c2 = cardOf(member("+34 611 000 004"), pts);
  L.grantConsentBonus(c2, pts);
  assert.equal(c2.points, 5);
  assert.equal(c2.lifetimePoints, 5);

  const otherHere = live(shopA, { consentBonus: 2 });
  assert.equal(L.grantConsentBonus(cardOf(m, otherHere), otherHere), null, "once per person per shop, not per card");
  const otherShop = live(shopB, { consentBonus: 2 });
  assert.equal(L.grantConsentBonus(cardOf(m, otherShop), otherShop).n, 2, "another shop is another gift");

  const full = live(shopA, { consentBonus: 3 });
  const c3 = cardOf(member("+34 611 000 013"), full);
  c3.stamps = full.stamps.goal;
  assert.equal(L.grantConsentBonus(c3, full), null, "a full card cannot hold it");
  assert.equal(c3.consentBonusAt, undefined, "and the gift is not marked as spent");
  c3.stamps = full.stamps.goal - 1;
  assert.equal(L.grantConsentBonus(c3, full).n, 1, "only the room it has");
  assert.equal(c3.stamps, full.stamps.goal);

  assert.equal(L.grantConsentBonus(cardOf(m, live(shopA)), live(shopA)), null, "0 means off");
  assert.equal(L.createProgram(shopA, { consentBonus: 3 }).consentBonus, 3);
  assert.equal(L.createProgram(shopA, { consentBonus: 99 }).consentBonus, 10, "capped at ten");
});

test("the card page shows two unticked boxes, in the language of the link", async () => {
  const m = member("+34 611 000 005"), card = cardOf(m, progA);
  const es = await call("GET", `/card/${card.cardToken}`);
  assert.equal(es.status, 200);
  assert.match(es.body, /Ofertas y novedades/);
  assert.match(es.body, /id="c-whatsapp"/);
  assert.match(es.body, /id="c-email"/);
  assert.equal(/<input type="checkbox" id="c-whatsapp"[^>]*checked/.test(es.body), false, "never pre-ticked");
  assert.equal(/<input type="checkbox" id="c-email"[^>]*checked/.test(es.body), false);
  assert.match(es.body, /No gracias, solo la tarjeta/);
  assert.match(es.body, /Quiero recibir ofertas y novedades de Casa Uno por WhatsApp/);

  const en = await call("GET", `/card/${card.cardToken}?l=en`);
  assert.match(en.body, /Offers and news/);
  assert.match(en.body, /No thanks, just the card/);
  assert.match(en.body, /I want to receive offers and news from Casa Uno by email/);

  C.recordConsent({ member: m, customer: card, clientId: "ca", programId: progA.id, channel: "email", lang: "en", business: "Casa Uno" });
  const after = await call("GET", `/card/${card.cardToken}`);
  assert.match(after.body, /<input type="checkbox" id="c-email"[^>]*checked/, "the saved answer is shown");
  assert.equal(/<input type="checkbox" id="c-whatsapp"[^>]*checked/.test(after.body), false);
  assert.equal(after.body.includes('id="consentNo"'), false, "already answered, so it is not asked again");
});

test("posting from the card stores both channels, hashes the request, and pays the bonus once", async () => {
  const p = live(shopA, { consentBonus: 2 });
  const m = member("+34 611 000 006"), card = cardOf(m, p);
  const r = await call("POST", `/api/loyalty/card/${card.cardToken}/consent`, { whatsapp: true, email: true, lang: "es" }, { "user-agent": "PhoneBrowser/9", "x-test-ip": "198.51.100.7" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.consent, { whatsapp: true, email: true, decided: true });
  assert.equal(r.body.bonus.n, 2);
  assert.match(r.body.bonus.text, /Gracias/);
  const rows = C.rowsFor(m, "ca").filter((x) => x.programId === p.id);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.ipHash.length === 32 && x.ipHash !== "198.51.100.7"));
  assert.ok(rows.every((x) => x.uaHash));
  assert.equal(rows.find((x) => x.channel === "email").textShown, C.consentText("email", "es", "Casa Uno"));

  const second = await call("POST", `/api/loyalty/card/${card.cardToken}/consent`, { whatsapp: true, email: false, lang: "es" });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.consent, { whatsapp: true, email: false, decided: true });
  assert.equal(second.body.bonus, null, "no second gift");

  assert.equal((await call("POST", `/api/loyalty/card/${card.cardToken}/consent`, {})).status, 400);
  assert.equal((await call("POST", `/api/loyalty/card/${card.cardToken}/consent`, { whatsapp: "yes" })).status, 400, "booleans only");

  const old = L.joinCustomer(progA, { name: "Sin número", email: `old-${Date.now()}@example.com` });
  const noPhone = await call("POST", `/api/loyalty/card/${old.cardToken}/consent`, { email: true });
  assert.equal(noPhone.status, 409);
  assert.match(noPhone.body.error, /phone number/i);

  const pendingShop = { id: "cp", name: "Pendiente SL", token: "portal-cp", approval: { status: "pending" } };
  db.clients.push(pendingShop);
  const pending = live(pendingShop, { consentBonus: 0 });
  const pendingCard = cardOf(member("+34 611 000 012"), pending);
  const notApproved = await call("POST", `/api/loyalty/card/${pendingCard.cardToken}/consent`, { email: true });
  assert.equal(notApproved.status, 403, "a business that is not approved cannot collect consent");
});

test("unsubscribe: GET changes nothing, POST withdraws, a bad or used token stays neutral", async () => {
  const m = member("+34 611 000 007"), card = cardOf(m, progA);
  const row = C.recordConsent({ member: m, customer: card, clientId: "ca", programId: progA.id, channel: "whatsapp", lang: "es", business: "Casa Uno" });
  C.recordConsent({ member: m, customer: card, clientId: "ca", programId: progA.id, channel: "email", lang: "es", business: "Casa Uno" });

  const page = await call("GET", `/u/${row.unsubToken}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /Darte de baja/);
  assert.match(page.body, /Casa Uno/);
  assert.equal(page.body.includes(m.phone), false, "the page carries no phone");
  assert.equal(page.body.includes(card.cardToken), false, "and no card token");
  assert.equal(C.hasConsent(m, "ca", "whatsapp"), true, "a mail scanner opening the link does nothing");
  assert.equal(C.hasConsent(m, "ca", "email"), true);

  const bad = await call("GET", "/u/not-a-real-token-000000000000");
  assert.equal(bad.status, 200);
  assert.match(bad.body, /no es válido/);
  assert.equal((await call("POST", "/u/not-a-real-token-000000000000")).status, 200);

  const out = await call("POST", `/u/${row.unsubToken}`);
  assert.equal(out.status, 200);
  assert.match(out.body, /Hecho/);
  assert.equal(C.hasConsent(m, "ca", "whatsapp"), false);
  assert.equal(C.hasConsent(m, "ca", "email"), false);
  const n = C.rowsFor(m, "ca").length;

  const again = await call("POST", `/u/${row.unsubToken}`);
  assert.equal(again.status, 200);
  assert.match(again.body, /Ya estabas/);
  assert.equal(C.rowsFor(m, "ca").length, n, "a second click appends nothing");
  assert.equal(C.hasConsent(m, "ca", "whatsapp"), false);

  const en = await call("POST", `/u/${row.unsubToken}?l=en`);
  assert.match(en.body, /You were already unsubscribed/);
});

test("the send list is only the living yes answers, and never leaves its shop", () => {
  const p = live(shopA, { consentBonus: 0 });
  const a = member("+34 611 000 008"), b = member("+34 611 000 009");
  C.recordConsent({ member: a, customer: cardOf(a, p), clientId: "ca", programId: p.id, channel: "whatsapp", lang: "es", business: "Casa Uno" });
  C.recordConsent({ member: a, customer: cardOf(a, p), clientId: "ca", programId: p.id, channel: "email", lang: "es", business: "Casa Uno" });
  C.recordConsent({ member: b, customer: cardOf(b, progB), clientId: "cb", programId: progB.id, channel: "email", lang: "es", business: "Bar Dos" });
  C.withdrawConsent({ member: a, clientId: "ca", channels: ["email"] });

  const onlyA = C.consentedContacts({ clientId: "ca" }).filter((r) => r.phone === a.phone);
  assert.deepEqual(onlyA.map((r) => r.channel), ["whatsapp"], "the withdrawn email is gone");
  assert.equal(C.consentedContacts({ clientId: "ca" }).some((r) => r.phone === b.phone), false);
  assert.equal(C.consentedContacts({ clientId: "cb" }).every((r) => r.clientId === "cb"), true);
  assert.equal(C.consentedContacts().some((r) => r.phone === b.phone), true, "the owner sees every shop");
});

test("the owner and the portal download a CSV with no email, and the portal only its own rows", async () => {
  const p = live(shopA, { consentBonus: 0 });
  const a = member("+34 611 000 010");
  C.recordConsent({ member: a, customer: cardOf(a, p), clientId: "ca", programId: p.id, channel: "whatsapp", lang: "es", business: "Casa Uno" });

  const owner = await call("GET", "/api/studio/loyalty/consented.csv", undefined, { "x-admin-token": "secret" });
  assert.equal(owner.status, 200);
  assert.match(owner.ct, /text\/csv/);
  assert.match(String(owner.headers.get("content-disposition")), /attachment; filename="consented-contacts-/);
  const lines = owner.body.replace(/^\uFEFF/, "").trim().split("\n");
  assert.equal(lines[0], "phone,shop,channel,date,text_version");
  assert.ok(lines.some((l) => l.startsWith(`${a.phone},Casa Uno,whatsapp,`)), "E.164, shop, channel, date, version");
  assert.equal(owner.body.includes("@example.com"), false, "no email in the send list");

  const asPortal = await call("GET", `/api/portal/${shopA.token}/loyalty/consented.csv`);
  assert.equal(asPortal.status, 200);
  assert.ok(asPortal.body.includes("Casa Uno"));
  assert.equal(asPortal.body.includes("Bar Dos"), false);

  const otherShop = await call("GET", `/api/portal/${shopA.token}/loyalty/consented.csv?clientId=cb`);
  assert.equal(otherShop.body.includes("Bar Dos"), false, "a portal token cannot widen the scope");
  assert.equal((await call("GET", "/api/studio/loyalty/consented.csv")).status, 401);
});

test("consent posts are rate limited per address", async () => {
  const m = member("+34 611 000 011"), card = cardOf(m, progA);
  const ip = { "x-test-ip": "203.0.113.77" };
  let last;
  for (let i = 0; i < 30; i++) last = await call("POST", `/api/loyalty/card/${card.cardToken}/consent`, {}, ip);
  assert.equal(last.status, 400, "the first thirty are answered");
  assert.equal((await call("POST", `/api/loyalty/card/${card.cardToken}/consent`, {}, ip)).status, 429);
});
