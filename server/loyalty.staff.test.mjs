// Staff scanner v2: find a customer by their phone, and enrol one at the till (plan A.5).
// The QR/typed-code lookup next to it is covered by loyalty.e2e.test.mjs and must keep working.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "loy-staff-"));
const { db } = await import("./store.mjs");
const { handleLoyalty } = await import("./loyalty-routes.mjs");
const L = await import("./loyalty.mjs");

const shopA = { id: "sa", name: "Casa Uno", token: "portal-sa" }, shopB = { id: "sb", name: "Bar Dos", token: "portal-sb" };
db.clients.push(shopA, shopB);
const live = (client, fields = {}) => { const p = L.createProgram(client, { type: "stamps", ...fields }); p.status = "live"; return p; };
const progA = live(shopA), progB = live(shopB);

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
  const r = await fetch(B + path, { method, headers: { "Content-Type": "application/json", "x-test-ip": `10.20.${++ipn % 250}.1`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text() };
};
const staff = (p, action) => `/api/loyalty/staff/${p.staffToken}/${action}`;
const card = (phone, program) => {
  const { member } = L.findOrCreateMember({ phone });
  return L.cardForMember(member, program).customer;
};

const anaMember = L.memberByPhone("+34 612 345 678") ?? L.findOrCreateMember({ phone: "+34 612 345 678", name: "Ana Pérez" }).member;
const ana = card("+34 612 345 678", progA);
ana.name = anaMember.name = "Ana Pérez"; // the record keeps the full name; the staff screen must not get all of it
const bruno = card("+34 699 111 678", progA);
const otra = card("+34 612 345 678", progB); // the same person, another shop

test("last digits find this shop's card, with the number masked and the name cut to a first name", async () => {
  const r = await call("POST", staff(progA, "find"), { phone: "678" });
  assert.equal(r.status, 200);
  const ids = r.body.matches.map((c) => c.id);
  assert.ok(ids.includes(ana.id) && ids.includes(bruno.id), "both numbers ending 678");
  assert.ok(!ids.includes(otra.id), "never another shop's card, even for the same person");
  const one = r.body.matches.find((c) => c.id === ana.id);
  assert.equal(one.name, "Ana");
  assert.equal(one.phone, "+34 6 ••• •• 678");
  assert.equal(one.stamps, ana.stamps, "the balances the till needs");
  assert.equal(one.id, ana.id);
  assert.ok(!JSON.stringify(r.body).includes("+34612345678"), "the full number is not in the payload");
});

test("a full number matches exactly, not by its last six digits", async () => {
  const r = await call("POST", staff(progA, "find"), { phone: "612 345 678" });
  assert.deepEqual(r.body.matches.map((c) => c.id), [ana.id]);
  const same = await call("POST", staff(progA, "find"), { phone: "+34 612 345 678" });
  assert.deepEqual(same.body.matches.map((c) => c.id), [ana.id]);
});

test("fewer than three digits is refused rather than listing the shop", async () => {
  for (const phone of ["", "6", "67", "ab"]) {
    const r = await call("POST", staff(progA, "find"), { phone });
    assert.equal(r.status, 400, JSON.stringify(phone));
  }
  const missing = await call("POST", staff(progA, "find"), {});
  assert.equal(missing.status, 400);
});

test("at most five results, however many numbers end the same way", async () => {
  const program = live(shopA);
  for (let i = 0; i < 8; i++) card(`+34 700 00${i} 123`, program);
  const r = await call("POST", staff(program, "find"), { phone: "123" });
  assert.equal(r.status, 200);
  assert.equal(r.body.matches.length, 5);
});

test("cards from before the phone-first join are still findable", async () => {
  const old = L.joinCustomer(progA, { name: "Vieja", email: "vieja@example.com", phone: "622 333 444" });
  const r = await call("POST", staff(progA, "find"), { phone: "444" });
  const hit = r.body.matches.find((c) => c.id === old.id);
  assert.ok(hit, "the free-text phone was normalised for the search");
  assert.equal(hit.name, "Vieja");
  assert.equal(hit.phone, "+34 6 ••• •• 444");
});

test("enrol at the till makes one card, with no marketing consent", async () => {
  const before = L.ldb().customers.length;
  const r = await call("POST", staff(progA, "enrol"), { phone: "655 123 987", name: "Carla" });
  assert.equal(r.status, 201);
  assert.equal(r.body.created, true);
  assert.match(r.body.cardUrl, /^\/card\//);
  assert.equal(L.ldb().customers.length, before + 1);

  const c = L.findByToken(r.body.cardUrl.slice("/card/".length));
  assert.equal(c.programId, progA.id);
  assert.equal(c.marketingConsent, false, "the shop cannot tick consent on the customer's behalf");
  assert.equal(L.memberByPhone("+34655123987").name, "Carla");
  assert.equal(L.txnsOf(c).filter((t) => t.type === "join").length, 1);

  const again = await call("POST", staff(progA, "enrol"), { phone: "+34655123987", name: "Carla" });
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false, "no second card, no second welcome bonus");
  assert.equal(again.body.cardUrl, r.body.cardUrl);
  assert.equal(L.ldb().customers.length, before + 1);

  const found = await call("POST", staff(progA, "find"), { phone: "987" });
  assert.ok(found.body.matches.some((x) => x.id === c.id), "and it is findable straight away");
});

test("enrol refuses a number that cannot exist and creates nothing", async () => {
  const before = L.ldb().customers.length, members = L.ldb().members.length;
  for (const phone of ["12345", "abcdef", "+340 612 345 678", ""]) {
    const r = await call("POST", staff(progA, "enrol"), { phone });
    assert.equal(r.status, 400, JSON.stringify(phone));
  }
  assert.equal(L.ldb().customers.length, before);
  assert.equal(L.ldb().members.length, members);
});

test("a wrong staff token answers 404 and cannot enrol anyone", async () => {
  const before = L.ldb().customers.length;
  for (const action of ["find", "enrol"]) {
    const r = await call("POST", `/api/loyalty/staff/not-a-token-xxxx/${action}`, { phone: "612 345 678" });
    assert.equal(r.status, 404, action);
  }
  assert.equal(L.ldb().customers.length, before);
});

test("a business that is not approved cannot enrol at the till either", async () => {
  const shop = { id: "sp", name: "Pending", token: "portal-sp", approval: { status: "pending" } };
  db.clients.push(shop);
  const p = live(shop);
  const before = L.ldb().customers.length, memberId = L.memberByPhone("+34612345678").id;
  for (const action of ["find", "enrol"]) {
    const r = await call("POST", staff(p, action), { phone: "612 345 678" });
    assert.equal(r.status, 403, action);
  }
  assert.equal(L.ldb().customers.length, before);
  assert.equal(L.memberByPhone("+34612345678").id, memberId, "the existing member is untouched");
});
