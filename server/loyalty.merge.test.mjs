// L8: an old email card learns its owner's number (claim), two cards of the same person become one
// (merge), and the report that points at duplicates never writes anything.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "loy-merge-"));
process.env.DATA_DIR = join(root, "data");
const { db } = await import("./store.mjs");
const { handleLoyalty } = await import("./loyalty-routes.mjs");
const L = await import("./loyalty.mjs");
const { createOtpService, captureAdapter } = await import("./otp.mjs");
const { normalisePhone } = await import("./phone.mjs");
const { reportLoyalty, formatReport } = await import("../scripts/loyalty-members-report.mjs");

const shopA = { id: "ma", name: "Casa Uno", token: "portal-ma" }, shopB = { id: "mb", name: "Bar Dos", token: "portal-mb" };
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
  send, readBody, isAdmin: (req) => req.headers["x-admin-token"] === "secret", clientByToken: (t) => db.clients.find((c) => c.token === t),
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
  const r = await fetch(B + path, { method, headers: { "Content-Type": "application/json", "x-test-ip": `10.50.${++ipn % 250}.1`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, setCookie: r.headers.get("set-cookie") ?? "", body: ct.includes("json") ? await r.json() : await r.text() };
};
const cookie = (setCookie, name) => (new RegExp(`${name}=([^;]+)`).exec(setCookie) ?? [])[1] ?? "";
const oldCard = (program, name = "Vieja Clienta", email = `old-${Math.random().toString(36).slice(2)}@example.com`) => L.joinCustomer(program, { name, email });
const lastCode = (phone) => (String(adapter.sent.get(normalisePhone(phone).e164)).match(/\b(\d{6})\b/) ?? [])[1];
const claim = (card, phone) => call("POST", `/api/loyalty/card/${card.cardToken}/claim`, { phone });
const claimVerify = (card, phone, code) => call("POST", `/api/loyalty/card/${card.cardToken}/claim/verify`, { phone, code });

test("an old email card can add a number: it keeps its email, name, stamps and token", async () => {
  const phone = "+34 622 000 001";
  const old = oldCard(progA, "Vieja Clienta", "vieja@example.com");
  old.stamps = 3;

  const page = await call("GET", `/card/${old.cardToken}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /Use this card in other shops/);
  assert.match(page.body, /Add my number/);

  const started = await claim(old, phone);
  assert.equal(started.status, 202);
  assert.deepEqual(started.body, { sent: true });

  const ok = await claimVerify(old, phone, lastCode(phone));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, cardUrl: `/card/${old.cardToken}` });

  const member = L.memberByPhone(phone);
  assert.ok(member, "the number created a member");
  assert.equal(old.memberId, member.id);
  assert.equal(old.phone, member.phone, "the card now carries the canonical number");
  assert.equal(old.email, "vieja@example.com", "the email is not touched");
  assert.equal(old.name, "Vieja Clienta");
  assert.equal(old.stamps, 3, "the balance is not touched");
  assert.ok(member.phoneVerifiedAt, "proving the number is recorded");
  assert.equal(cookie(ok.setCookie, "lc_member"), member.memberToken);

  // The prompt is gone on the next visit, and a second claim changes nothing.
  const again = await call("GET", `/card/${old.cardToken}`);
  assert.equal(again.body.includes("Add my number"), false);
  assert.equal((await claim(old, "+34 622 000 002")).status, 409);
  assert.equal(old.memberId, member.id);
});

test("with no SMS provider the prompt is not rendered and the route says so", async () => {
  const old = oldCard(progA);
  const real = ctx.otp;
  ctx.otp = createOtpService();
  try {
    const page = await call("GET", `/card/${old.cardToken}`);
    assert.equal(page.body.includes("Add my number"), false, "no dead-end form");
    const r = await claim(old, "+34 622 000 010");
    assert.equal(r.status, 503);
    assert.match(r.body.error, /not set up/i);
    assert.equal(old.memberId, undefined);
  } finally { ctx.otp = real; }
});

test("a number that already has a card at this shop is a 409, and no balance moves", async () => {
  const phone = "+34 622 000 011";
  const member = L.memberByPhone(phone) ?? L.findOrCreateMember({ phone, name: "Ana" }).member;
  const existing = L.cardForMember(member, progA).customer;
  existing.stamps = 7;
  const old = oldCard(progA, "Otra Tarjeta");

  assert.equal((await claim(old, phone)).status, 202);
  const r = await claimVerify(old, phone, lastCode(phone));
  assert.equal(r.status, 409);
  assert.match(r.body.error, /already has a card/i);
  assert.equal(old.memberId, undefined, "the old card is not linked");
  assert.equal(existing.stamps, 7);
  assert.equal(existing.memberId, member.id);
});

test("wrong codes count down, lock, and an expired one is gone", async () => {
  const phone = "+34 622 000 012";
  const old = oldCard(progA);
  await claim(old, phone);
  const real = lastCode(phone);
  const wrong = String((Number(real[0]) + 1) % 10) + real.slice(1);

  const first = await claimVerify(old, phone, wrong);
  assert.equal(first.status, 401);
  assert.equal(first.body.triesLeft, 2);
  assert.equal((await claimVerify(old, phone, wrong)).body.triesLeft, 1);
  const locked = await claimVerify(old, phone, wrong);
  assert.equal(locked.status, 423);
  assert.equal(locked.body.triesLeft, 0);
  assert.equal(old.memberId, undefined);

  // A code that has run out of time is 410, not a wrong guess.
  let ms = Date.now();
  const realSvc = ctx.otp;
  ctx.otp = createOtpService({ adapter, now: () => ms });
  try {
    const other = oldCard(progA);
    const p2 = "+34 622 000 013";
    await claim(other, p2);
    ms += 11 * 60e3;
    const gone = await claimVerify(other, p2, lastCode(p2));
    assert.equal(gone.status, 410);
    assert.match(gone.body.error, /expired/i);
    assert.equal(other.memberId, undefined);
  } finally { ctx.otp = realSvc; }
});

test("merge adds the balances up, moves the history and keeps both card links and the old QR id", () => {
  const p = live(shopA);
  const keep = oldCard(p, "Ana", "ana@example.com");
  const gone = oldCard(p, "Ana", "ana2@example.com");
  keep.stamps = 2; gone.stamps = 3;
  keep.points = 10; gone.points = 5;
  keep.lifetimePoints = 10; gone.lifetimePoints = 5;
  keep.visits = 2; gone.visits = 1;
  keep.lastVisitAt = "2026-01-01T00:00:00.000Z";
  gone.lastVisitAt = "2026-02-01T00:00:00.000Z";
  keep.createdAt = "2025-01-01T00:00:00.000Z";
  gone.createdAt = "2024-06-01T00:00:00.000Z";
  const txn = { id: "t-gone", programId: p.id, customerId: gone.id, clientId: p.clientId, at: "2026-02-01T00:00:00.000Z", type: "visit", stamps: 1, points: 0, amountEur: 0, note: "", by: "staff" };
  L.ldb().txns.push(txn);
  L.ldb().devices.push({ id: "d-gone", serial: gone.id, kind: "apple" });

  const keepToken = keep.cardToken, goneToken = gone.cardToken, goneId = gone.id;
  const out = L.mergeCards(p, keep.id, goneToken);

  assert.equal(out.keep, keep);
  assert.equal(keep.stamps, 5);
  assert.equal(keep.points, 15);
  assert.equal(keep.lifetimePoints, 15);
  assert.equal(keep.visits, 3);
  assert.equal(keep.lastVisitAt, "2026-02-01T00:00:00.000Z");
  assert.equal(keep.createdAt, "2024-06-01T00:00:00.000Z", "the resulting card looks as old as the oldest");
  assert.equal(keep.email, "ana@example.com", "an existing value wins");
  assert.equal(L.ldb().customers.some((c) => c.id === goneId), false);
  assert.equal(txn.customerId, keep.id);
  assert.equal(L.ldb().devices.find((d) => d.id === "d-gone").serial, keep.id);
  assert.ok(L.txnsOf(keep).some((t) => t.type === "adjust" && /Merged card/.test(t.note)), "the merge is in the history");

  assert.equal(L.findByToken(keepToken), keep);
  assert.equal(L.findByToken(goneToken), keep, "the old URL still opens the card");
  assert.equal(L.findCustomer(goneId), keep, "an already-printed QR still resolves");
  assert.equal(L.lookupByCode(`LC1-${goneId}`).customer, keep);
  assert.equal(L.txnsOf(keep).length, 4);
  assert.throws(() => L.mergeCards(p, keep.id, goneToken), (e) => e.status === 400 && /two different/.test(e.message), "the absorbed token is an alias of the survivor now");
});

test("merge refuses two different numbers, a card from another shop, and the same card twice", () => {
  const p = live(shopA);
  const a = L.cardForMember(L.findOrCreateMember({ phone: "+34 622 000 021" }).member, p).customer;
  const b = L.cardForMember(L.findOrCreateMember({ phone: "+34 622 000 022" }).member, p).customer;
  assert.throws(() => L.mergeCards(p, a.id, b.id), (e) => e.status === 409 && /two different numbers/.test(e.message));
  assert.equal(L.ldb().customers.includes(a) && L.ldb().customers.includes(b), true);

  const other = oldCard(progB);
  assert.throws(() => L.mergeCards(p, a.id, other.id), (e) => e.status === 404);
  assert.throws(() => L.mergeCards(p, a.id, a.id), (e) => e.status === 400);
  assert.throws(() => L.mergeCards(p, "nope", a.id), (e) => e.status === 404);
});

test("the merge route needs confirmation, and the owner or the shop's own portal can do it", async () => {
  const p = live(shopA);
  const keep = oldCard(p), gone = oldCard(p);

  const unconfirmed = await call("POST", `/api/studio/loyalty/programs/${p.id}/merge`, { keepId: keep.id, mergeId: gone.id }, { "x-admin-token": "secret" });
  assert.equal(unconfirmed.status, 400);
  assert.equal(L.ldb().customers.some((c) => c.id === gone.id), true);

  const wrongShop = await call("POST", `/api/portal/${shopB.token}/loyalty/programs/${p.id}/merge`, { keepId: keep.id, mergeId: gone.id, confirm: true });
  assert.equal(wrongShop.status, 404, "a portal token cannot touch another shop's programme");

  const viaPortal = await call("POST", `/api/portal/${shopA.token}/loyalty/programs/${p.id}/merge`, { keepId: keep.cardToken, mergeId: gone.id, confirm: true });
  assert.equal(viaPortal.status, 200);
  assert.equal(viaPortal.body.ok, true);
  assert.equal(viaPortal.body.card.id, keep.id);
  assert.equal(viaPortal.body.mergedId, gone.id);
  assert.equal(L.ldb().customers.some((c) => c.id === gone.id), false, "both invocations reach the same merge");
});

test("the report counts duplicates and old cards, and never writes", () => {
  const file = join(root, "studio.json");
  const data = {
    loyalty: {
      programs: [{ id: "rp1", name: "Casa", clientId: "c1", status: "live" }, { id: "rp2", name: "Bar", clientId: "c2", status: "live" }],
      members: [{ id: "rm1", phone: "+34612345678", name: "Ana" }],
      customers: [
        { id: "rc1", programId: "rp1", name: "Ana", email: "ana@example.com", phone: "", memberId: "rm1", createdAt: "2025-01-01T00:00:00.000Z", cardToken: "t1" },
        { id: "rc2", programId: "rp1", name: "Ana vieja", email: "ANA@example.com", phone: "612 345 678", createdAt: "2024-01-01T00:00:00.000Z", cardToken: "t2" },
        { id: "rc3", programId: "rp1", name: "Sin número", email: "sin@example.com", phone: "", createdAt: "2025-02-01T00:00:00.000Z", cardToken: "t3" },
        { id: "rc4", programId: "rp2", name: "Ana", email: "ana@example.com", phone: "+34612345678", createdAt: "2025-03-01T00:00:00.000Z", cardToken: "t4" },
        { id: "rc5", programId: "gone", name: "Huérfana", email: "", phone: "", createdAt: "2025-04-01T00:00:00.000Z", cardToken: "t5" },
      ],
    },
  };
  writeFileSync(file, JSON.stringify(data, null, 1));
  const hash = () => createHash("sha256").update(readFileSync(file)).digest("hex");
  const before = hash();

  const report = reportLoyalty(data);
  assert.equal(report.dryRun, true);
  assert.equal(report.totals.programs, 2);
  assert.equal(report.totals.cards, 5);
  assert.equal(report.totals.withPhone, 3);
  assert.equal(report.totals.withoutPhone, 2);
  assert.equal(report.totals.oldCards, 4);
  assert.equal(report.totals.duplicatePhoneGroups, 1, "same number, two spellings, same programme");
  assert.equal(report.totals.duplicatePhoneCards, 2);
  assert.equal(report.totals.duplicateEmailGroups, 1);
  assert.equal(report.orphans.length, 1);

  const text = formatReport(report);
  assert.match(text, /DRY RUN/);
  assert.match(text, /\+34 6 ••• •• 678/);
  assert.equal(text.includes("+34612345678"), false, "the full number is never printed");
  assert.equal(text.includes("ana@example.com"), false, "the full email is never printed");
  assert.match(text, /a\*+@example\.com/);

  const run = spawnSync(process.execPath, [join(import.meta.dirname, "..", "scripts", "loyalty-members-report.mjs"), "--data", file, "--json"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.file, file);
  assert.equal(parsed.totals.duplicatePhoneGroups, 1);
  assert.equal(hash(), before, "the file is byte-for-byte the same after the run");
});
