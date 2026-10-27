// Public join, v2: a card per phone number, bound to the device. The card itself is L2's; this file
// is about what the route says, what it refuses to say, and what it refuses to create.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "loy-join-"));
const { db } = await import("./store.mjs");
const { handleLoyalty, limits, JOIN_LIMITS } = await import("./loyalty-routes.mjs");
const L = await import("./loyalty.mjs");

const cliente = (id, name) => { const c = { id, name, token: `portal-${id}`, languages: ["es"] }; db.clients.push(c); return c; };
const shopA = cliente("ja", "Casa Uno"), shopB = cliente("jb", "Bar Dos"), shopCap = cliente("jc", "Cap");
const live = (client, fields = {}) => { const p = L.createProgram(client, { type: "stamps", ...fields }); p.status = "live"; return p; };
const progA = live(shopA), progB = live(shopB), progCap = live(shopCap);

const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req, limit = 1e6) => new Promise((ok, fail) => {
  let s = ""; req.on("data", (c) => { s += c; if (s.length > limit) { fail(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } });
  req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { fail(Object.assign(new Error("bad json"), { status: 400 })); } });
});
let server, B;
const ctx = { send, readBody, isAdmin: () => false, clientByToken: (t) => db.clients.find((c) => c.token === t), baseUrl: () => "http://shop.test", clientIp: (req) => String(req.headers["x-test-ip"] ?? "1.1.1.1"), wallet: {} };
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
  const r = await fetch(B + path, { method, headers: { "Content-Type": "application/json", "x-test-ip": `10.1.${++ipn % 250}.1`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, setCookie: r.headers.get("set-cookie") ?? "", body: ct.includes("json") ? await r.json() : await r.text() };
};
const path = (p) => `/api/loyalty/join/${p.joinCode}`;
const cookieOf = (setCookie) => (setCookie.match(/lc_member=([^;]+)/) ?? [])[1] ?? "";

test("a new number gets a card, and the device gets a cookie it cannot read", async () => {
  const r = await call("POST", path(progA), { phone: "612 345 678", name: "Ana" });
  assert.equal(r.status, 201);
  assert.match(r.body.cardUrl, /^\/card\/[A-Za-z0-9_-]+$/);
  assert.match(r.setCookie, /lc_member=[A-Za-z0-9_-]{16,}/);
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /SameSite=Lax/);
  assert.match(r.setCookie, /Max-Age=63072000/);
  assert.ok(!("memberToken" in r.body), "the device secret is not readable by page script");

  const member = L.memberByPhone("+34 612 345 678");
  assert.ok(member, "stored under the normalised number");
  assert.equal(member.name, "Ana");
  const card = L.findByToken(r.body.cardUrl.slice("/card/".length));
  assert.equal(card.memberId, member.id);
  assert.equal(card.programId, progA.id);
  assert.equal(card.email, "");
});

test("the same device gets a second shop's card with no number typed", async () => {
  const first = await call("POST", path(progA), { phone: "+34 611 222 333" });
  assert.equal(first.status, 201);
  const cookie = `lc_member=${cookieOf(first.setCookie)}`;
  const membersBefore = L.ldb().members.length, cardsBefore = L.ldb().customers.length;

  const r = await call("POST", path(progB), {}, { cookie });
  assert.equal(r.status, 201, "a card for the new shop");
  assert.equal(L.ldb().members.length, membersBefore, "no second member");
  assert.equal(L.ldb().customers.length, cardsBefore + 1, "one card, not two");
  const card = L.findByToken(r.body.cardUrl.slice("/card/".length));
  assert.equal(card.programId, progB.id);
  assert.equal(card.memberId, L.memberByPhone("+34611222333").id);

  const again = await call("POST", path(progB), {}, { cookie });
  assert.equal(again.status, 200, "asking twice is not a second card");
  assert.equal(again.body.cardUrl, r.body.cardUrl);
  assert.equal(L.ldb().customers.length, cardsBefore + 1);
});

test("a number that is already registered gives nothing away on a new device", async () => {
  await call("POST", path(progA), { phone: "+34 600 111 222", name: "Bea" });
  const membersBefore = L.ldb().members.length, cardsBefore = L.ldb().customers.length;

  const r = await call("POST", path(progB), { phone: "0034600111222", name: "Not Bea" });
  assert.equal(r.status, 202);
  assert.deepEqual(r.body, { recovery: "verify" }, "no card, no name, no hint of which shop");
  assert.equal(r.setCookie, "", "and no device token for a number that was not proved");
  assert.equal(L.ldb().members.length, membersBefore);
  assert.equal(L.ldb().customers.length, cardsBefore);
  const bea = L.memberByPhone("+34600111222");
  assert.equal(L.ldb().customers.filter((c) => c.memberId === bea.id && c.programId === progB.id).length, 0, "no card at the other shop");
  // the typed name did not overwrite the member's
  assert.equal(bea.name, "Bea");
});

test("a number that cannot exist is a 400 and leaves nothing behind", async () => {
  const membersBefore = L.ldb().members.length, cardsBefore = L.ldb().customers.length;
  for (const bad of ["12345", "abcdefghi", "+34 512 345 678", "+340 612 345 678", "6123456789012345"]) {
    const r = await call("POST", path(progA), { phone: bad });
    assert.equal(r.status, 400, bad);
    assert.match(r.body.error, /phone number/);
  }
  assert.equal(L.ldb().members.length, membersBefore);
  assert.equal(L.ldb().customers.length, cardsBefore);
});

test("a device already set up for a number cannot silently take another", async () => {
  const first = await call("POST", path(progA), { phone: "+34 600 333 444" });
  const cookie = `lc_member=${cookieOf(first.setCookie)}`;
  const r = await call("POST", path(progB), { phone: "+34 600 555 666" }, { cookie });
  assert.equal(r.status, 409);
  assert.equal(L.memberByPhone("+34600555666"), undefined, "the other number was not created");
});

test("an unknown or stale device token falls back to the typed number, it does not throw", async () => {
  const r = await call("POST", path(progA), { phone: "+34 600 777 888", memberToken: "x".repeat(40) });
  assert.equal(r.status, 201);
  assert.match(r.setCookie, /lc_member=/);
  const stale = await call("POST", path(progB), { phone: "+34 600 777 888", memberToken: "y".repeat(40) });
  assert.equal(stale.status, 202, "a token nobody owns proves nothing");
});

test("a page cached before this change still joins with name and email", async () => {
  const r = await call("POST", path(progA), { name: "Vieja", email: "vieja@example.com", marketingConsent: true });
  assert.equal(r.status, 201);
  const card = L.findByToken(r.body.cardUrl.slice("/card/".length));
  assert.equal(card.memberId, undefined, "email joins make a card, not a member");
  assert.equal(card.email, "vieja@example.com");
  assert.equal(card.marketingConsent, true);
  assert.equal(r.setCookie, "", "and no device token is set for a card the page did not ask to keep");
});

test(`the same number gets ${JOIN_LIMITS.phone} tries an hour, across devices`, async () => {
  const phone = "+34 699 000 111";
  for (let i = 0; i < JOIN_LIMITS.phone; i++) {
    const r = await call("POST", path(progA), { phone }, { "x-test-ip": `10.2.0.${i + 1}` });
    assert.ok([201, 202].includes(r.status), `try ${i + 1}: ${r.status}`);
  }
  const r = await call("POST", path(progA), { phone }, { "x-test-ip": "10.2.0.99" });
  assert.equal(r.status, 429, "a new IP does not buy a sixth try for the same number");
});

test("a programme stops taking joins at its cap, whatever the number", async () => {
  const key = progCap.id;
  try {
    for (let i = 0; i < JOIN_LIMITS.program; i++) limits.joinProgram.fail(key);
    const r = await call("POST", path(progCap), { phone: "+34 655 444 333" }, { "x-test-ip": "10.3.0.1" });
    assert.equal(r.status, 429);
    assert.equal(L.memberByPhone("+34655444333"), undefined);
  } finally { limits.joinProgram.clear(key); }
});

test("a body that is not an object is a 400, not a 500", async () => {
  for (const body of [null, [1, 2], "text", 42]) {
    const r = await call("POST", path(progA), body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(typeof r.body.error, "string");
  }
});

test("the caps are the ones the plan asked for", () => {
  assert.deepEqual(JOIN_LIMITS, { ip: 60, phone: 5, program: 300 });
});

test("the join page knows what the device already has, and speaks the right language", async () => {
  const shop = cliente("jd", "Page Shop");
  const p = live(shop);

  const plain = await call("GET", `/join/${p.joinCode}`);
  assert.equal(plain.status, 200);
  assert.match(plain.body, /<html lang="es">/);
  assert.match(plain.body, /id="phone"/);
  assert.doesNotMatch(plain.body, /name="email"/);

  const en = await call("GET", `/join/${p.joinCode}`, undefined, { "accept-language": "en-GB,en;q=0.9" });
  assert.match(en.body, /<html lang="en">/);
  assert.match(en.body, /Get my card/);
  const forced = await call("GET", `/join/${p.joinCode}?l=en`, undefined, { "accept-language": "es-ES" });
  assert.match(forced.body, /<html lang="en">/, "the link beats the phone");

  const j = await call("POST", path(p), { phone: "+34 622 000 111" });
  assert.equal(j.status, 201);
  const cookie = `lc_member=${cookieOf(j.setCookie)}`;

  const known = await call("GET", `/join/${p.joinCode}`, undefined, { cookie });
  assert.match(known.body, /Ya tienes tu tarjeta/);
  assert.ok(known.body.includes(j.body.cardUrl), "the card link is the page");
  assert.doesNotMatch(known.body, /<form/);

  const other = await call("GET", `/join/${progB.joinCode}`, undefined, { cookie });
  assert.match(other.body, /Añadir esta tarjeta/);
  assert.doesNotMatch(other.body, /id="phone"/, "no typing on a device that already has a member");
  assert.match(other.body, /\/api\/loyalty\/join\//);
});
