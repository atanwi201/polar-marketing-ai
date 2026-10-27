// Recovery (plan A.4, L5): a code sent to the number, or the staff confirming at the till. Both end
// with the card on the requesting device and nothing revealed to a device that cannot prove it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "loy-recovery-"));
const { db } = await import("./store.mjs");
const { handleLoyalty } = await import("./loyalty-routes.mjs");
const L = await import("./loyalty.mjs");
const { createOtpService, captureAdapter } = await import("./otp.mjs");
const { normalisePhone } = await import("./phone.mjs");

const shopA = { id: "ra", name: "Casa Uno", token: "portal-ra" }, shopB = { id: "rb", name: "Bar Dos", token: "portal-rb" };
db.clients.push(shopA, shopB);
const live = (client, fields = {}) => { const p = L.createProgram(client, { type: "stamps", ...fields }); p.status = "live"; return p; };
const progA = live(shopA), progB = live(shopB);

const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req, limit = 1e6) => new Promise((ok, fail) => {
  let s = ""; req.on("data", (c) => { s += c; if (s.length > limit) { fail(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } });
  req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { fail(Object.assign(new Error("bad json"), { status: 400 })); } });
});
let server, B;
const adapter = captureAdapter();
const ctx = {
  send, readBody, isAdmin: () => false, clientByToken: (t) => db.clients.find((c) => c.token === t),
  baseUrl: () => "http://shop.test", clientIp: (req) => String(req.headers["x-test-ip"] ?? "9.9.9.9"), wallet: {},
  otp: createOtpService({ adapter }),
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
  const r = await fetch(B + path, { method, headers: { "Content-Type": "application/json", "x-test-ip": `10.30.${++ipn % 250}.1`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, setCookie: r.headers.get("set-cookie") ?? "", body: ct.includes("json") ? await r.json() : await r.text() };
};
const cookie = (setCookie, name) => (new RegExp(`${name}=([^;]+)`).exec(setCookie) ?? [])[1] ?? "";
const joinAt = (program, body, headers) => call("POST", `/api/loyalty/join/${program.joinCode}`, body, headers);
const codeOf = (program, phone, headers) => call("POST", `/api/loyalty/join/${program.joinCode}/code`, { phone }, headers);
const verifyOf = (program, code, c) => call("POST", `/api/loyalty/join/${program.joinCode}/verify`, { code }, c ? { cookie: `lc_recovery=${c}` } : {});
const waitOf = (program, c) => call("GET", `/api/loyalty/join/${program.joinCode}/wait`, undefined, c ? { cookie: `lc_recovery=${c}` } : {});
const staff = (program, action, body) => call("POST", `/api/loyalty/staff/${program.staffToken}/${action}`, body ?? {});
const lastCode = (phone) => (String(adapter.sent.get(normalisePhone(phone).e164)).match(/\b(\d{6})\b/) ?? [])[1];
const memberOn = async (phone, name, program = progA) => {
  const r = await joinAt(program, { phone, name });
  assert.equal(r.status, 201, `join ${phone}`);
  return { member: L.memberByPhone(phone), card: L.findByToken(r.body.cardUrl.slice("/card/".length)), deviceCookie: cookie(r.setCookie, "lc_member") };
};

test("a code sent to the phone opens the card on the requesting device", async () => {
  const phone = "+34 611 000 001";
  const { member, card, deviceCookie } = await memberOn(phone, "Ana Pérez");
  assert.equal(member.name, "Ana Pérez");

  const newDevice = await joinAt(progA, { phone });
  assert.equal(newDevice.status, 202, "the join itself refuses to hand over a known number");

  const started = await codeOf(progA, phone);
  assert.equal(started.status, 202);
  assert.deepEqual(started.body, { recovery: "sms", sent: true });
  const rec = cookie(started.setCookie, "lc_recovery");
  assert.match(rec, /^[A-Za-z0-9_-]{16,}$/);
  assert.equal(cookie(started.setCookie, "lc_member"), "", "the code is not the card");
  assert.match(started.setCookie, /HttpOnly/);

  const row = L.recoveries().at(-1);
  assert.equal(row.state, "pending");
  assert.equal(row.method, "sms");
  assert.equal(row.programId, progA.id);
  assert.equal(row.memberId, member.id);
  assert.equal(row.phone, "+34611000001");
  assert.match(row.secretHash, /^[0-9a-f]{64}$/, "the cookie secret is stored as a hash");
  assert.equal(JSON.stringify(row).includes(rec), false, "and the secret itself is nowhere in the data");

  assert.deepEqual((await waitOf(progA, rec)).body, { state: "pending" });

  const wrong = await verifyOf(progA, "000000" === lastCode(phone) ? "111111" : "000000", rec);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.triesLeft, 2);
  assert.match(wrong.body.error, /not right/);

  const ok = await verifyOf(progA, lastCode(phone), rec);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { state: "confirmed", cardUrl: `/card/${card.cardToken}` }, "the same card as the old device");
  const device = cookie(ok.setCookie, "lc_member");
  assert.equal(device, member.memberToken);
  assert.ok(member.phoneVerifiedAt, "proving the number is recorded on the member");
  assert.equal(L.recoveries().at(-1).confirmedBy, "sms");

  // The device now behaves like the old one: the join page shows the card, and polling still answers.
  const page = await call("GET", `/join/${progA.joinCode}`, undefined, { cookie: `lc_member=${device}` });
  assert.match(page.body, /Ya tienes tu tarjeta/);
  assert.ok(page.body.includes(`/card/${card.cardToken}`));
  assert.deepEqual((await waitOf(progA, rec)).body, { state: "confirmed", cardUrl: `/card/${card.cardToken}` });
  assert.equal(cookie((await waitOf(progA, rec)).setCookie, "lc_member"), member.memberToken);
  assert.equal(deviceCookie, device, "both browsers hold the member's token: it identifies the person, not the phone");
});

test("three wrong guesses lock the code, and the right one stops working too", async () => {
  const phone = "+34 611 000 002";
  await memberOn(phone, "Bea");
  const started = await codeOf(progA, phone);
  const rec = cookie(started.setCookie, "lc_recovery");
  const real = lastCode(phone);
  const wrong = String((Number(real[0]) + 1) % 10) + real.slice(1);

  assert.equal((await verifyOf(progA, wrong, rec)).body.triesLeft, 2);
  assert.equal((await verifyOf(progA, wrong, rec)).body.triesLeft, 1);
  const locked = await verifyOf(progA, wrong, rec);
  assert.equal(locked.status, 423);
  assert.equal(locked.body.triesLeft, 0);
  assert.match(locked.body.error, /too many/i);

  const after = await verifyOf(progA, real, rec);
  assert.equal(after.status, 423, "a locked code cannot be redeemed even with the right digits");
  assert.equal(L.memberByPhone(phone).phoneVerifiedAt, "", "and nobody was verified");
});

test("with no SMS provider the staff confirm it at the till, and only for their own shop", async () => {
  const phone = "+34 611 000 003";
  const { member, card } = await memberOn(phone, "Carla Ruiz");
  const other = await memberOn("+34 611 000 099", "Otro", progB);

  const real = ctx.otp;
  ctx.otp = createOtpService();
  try {
    const started = await codeOf(progA, phone);
    assert.equal(started.status, 202);
    assert.deepEqual(started.body, { recovery: "staff", sent: false }, "no provider is not an error, it is a different path");
    const rec = cookie(started.setCookie, "lc_recovery");
    assert.ok(rec);
    assert.equal(L.recoveries().at(-1).method, "staff");

    const queue = await staff(progA, "waiting");
    assert.equal(queue.status, 200);
    const mine = queue.body.requests.find((r) => r.name === "Carla");
    assert.ok(mine, "the till sees the request");
    assert.equal(mine.phone, "+34 6 ••• •• 003", "masked, not the number itself");
    assert.equal(JSON.stringify(queue.body).includes("+34611000003"), false);
    assert.ok(!queue.body.requests.some((r) => r.name === "Otro"), "never another shop's queue");

    const foreign = await staff(progB, "confirm", { id: mine.id });
    assert.equal(foreign.status, 404, "another shop cannot confirm it");
    assert.equal((await waitOf(progA, rec)).body.state, "pending", "and the phone is still waiting");

    assert.equal((await staff(progA, "confirm", { id: mine.id })).status, 200);
    const done = await waitOf(progA, rec);
    assert.deepEqual(done.body, { state: "confirmed", cardUrl: `/card/${card.cardToken}` });
    assert.equal(cookie(done.setCookie, "lc_member"), member.memberToken);
    assert.equal(member.phoneVerifiedAt, "", "the staff vouched for the person, not for the number");

    // It left the queue.
    assert.equal((await staff(progA, "waiting")).body.requests.some((r) => r.id === mine.id), false);
    // And an already-confirmed request is not confirmed twice.
    assert.equal((await staff(progA, "confirm", { id: mine.id })).status, 410);
  } finally { ctx.otp = real; }
});

test("a request that ran out of time is expired everywhere", async () => {
  const phone = "+34 611 000 004";
  await memberOn(phone, "Dani");
  const started = await codeOf(progA, phone);
  const rec = cookie(started.setCookie, "lc_recovery");
  const row = L.recoveries().at(-1);
  row.expiresAt = new Date(Date.now() - 1000).toISOString();

  assert.deepEqual((await waitOf(progA, rec)).body, { state: "expired" });
  const verify = await verifyOf(progA, lastCode(phone), rec);
  assert.equal(verify.status, 410);
  assert.match(verify.body.error, /expired/i);

  assert.equal((await staff(progA, "waiting")).body.requests.some((r) => r.id === row.id), false);
  assert.equal((await staff(progA, "confirm", { id: row.id })).status, 410);
});

test("a stale or invented cookie proves nothing", async () => {
  assert.deepEqual((await waitOf(progA, "")).body, { state: "missing" });
  assert.deepEqual((await waitOf(progA, "x".repeat(24))).body, { state: "missing" });
  const verify = await verifyOf(progA, "123456", "x".repeat(24));
  assert.equal(verify.status, 404);
  assert.match(verify.body.error, /expired/i);
});

test("a number nobody has gets the same answer and creates no request", async () => {
  const before = L.recoveries().length;
  const started = await codeOf(progA, "+34 611 000 005");
  assert.equal(started.status, 202);
  assert.deepEqual(started.body, { recovery: "sms", sent: false }, "same shape as a member, different nothing");
  assert.equal(started.setCookie, "", "and no recovery cookie");
  assert.equal(L.recoveries().length, before);

  const old = ctx.otp;
  ctx.otp = createOtpService();
  try {
    const noKey = await codeOf(progA, "+34 611 000 006");
    assert.equal(noKey.status, 202);
    assert.deepEqual(noKey.body, { recovery: "staff", sent: false });
    assert.equal(L.recoveries().length, before);
  } finally { ctx.otp = old; }
});

test("five tries per number per hour and ten per address", async () => {
  const phone = "+34 611 000 007";
  for (let i = 0; i < 5; i++) {
    const r = await codeOf(progA, phone, { "x-test-ip": `10.40.0.${i + 1}` });
    assert.equal(r.status, 202, `try ${i + 1}`);
  }
  const sixth = await codeOf(progA, phone, { "x-test-ip": "10.40.0.99" });
  assert.equal(sixth.status, 429, "a new address does not buy another try for the same number");

  const ip = { "x-test-ip": "10.41.0.1" };
  let last;
  for (let i = 0; i < 10; i++) last = await codeOf(progA, `+34 611 100 0${String(i).padStart(2, "0")}`, ip);
  assert.ok([202, 429].includes(last.status));
  assert.equal((await codeOf(progA, "+34 611 100 099", ip)).status, 429, "the address cap stops a script enumerating numbers");
});

test("erasing the person takes their recovery rows too", async () => {
  const phone = "+34 611 000 008";
  const { member } = await memberOn(phone, "Eva");
  await codeOf(progA, phone);
  assert.ok(L.recoveries().some((r) => r.memberId === member.id));

  await L.eraseMember(phone);
  assert.equal(L.recoveries().some((r) => r.memberId === member.id), false);
  assert.equal(L.recoveries().some((r) => r.phone === phone.replace(/\s/g, "")), false);
});
