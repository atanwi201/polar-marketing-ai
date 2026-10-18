// The loyalty routes against a temp DATA_DIR: owner scope, portal scope, public join/card and the staff scanner.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "loy-e2e-"));
delete process.env.APPLE_PASS_TYPE_ID;
const { db } = await import("./store.mjs");
const { handleLoyalty } = await import("./loyalty-routes.mjs");
const L = await import("./loyalty.mjs");
const { walletStatus } = await import("./pass.mjs");

db.clients.push({ id: "c1", name: "Cafe Uno", token: "portal-one" }, { id: "c2", name: "Bar Dos", token: "portal-two" });
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req, limit = 1e6) => new Promise((ok, fail) => {
  let s = ""; req.on("data", (c) => { s += c; if (s.length > limit) { fail(Object.assign(new Error("Request too large"), { status: 413 })); req.destroy(); } });
  req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { fail(Object.assign(new Error("Invalid JSON"), { status: 400 })); } });
});
let designCalls = [], pushed = [];
let server, B;
const ctx = {
  send, readBody, isAdmin: (req) => req.headers["x-admin-token"] === "secret", clientByToken: (t) => db.clients.find((c) => c.token === t),
  baseUrl: (req) => `http://${req.headers.host}`, clientIp: (req) => String(req.headers["x-test-ip"] ?? "1.1.1.1"),
  designProgram: async (p, o) => { designCalls.push(o); if (o.prompt === "boom") throw new Error("no ai"); return { background: "#112233", cardTitle: "Designed", accent: "nonsense", generatedBy: { model: "fake", at: "" } }; },
  wallet: { status: () => walletStatus({}), buildPass: async () => Buffer.from("x"), push: async () => {} },
};
before(async () => {
  L.setOnCardChanged((c) => pushed.push(c.id));
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
  const r = await fetch(B + path, { method, headers: { "Content-Type": "application/json", "x-test-ip": `10.0.0.${++ipn % 250}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, ct, body: ct.includes("json") ? await r.json() : ct.startsWith("text") || ct.includes("svg") || ct.includes("manifest") ? await r.text() : Buffer.from(await r.arrayBuffer()) };
};
const ADMIN = { "x-admin-token": "secret" };
const OWNER = "/api/studio/loyalty", P1 = "/api/portal/portal-one/loyalty", P2 = "/api/portal/portal-two/loyalty";
const st = {};

test("owner scope needs admin; portal needs a known token", async () => {
  assert.equal((await call("GET", OWNER + "/")).status, 401);
  assert.equal((await call("GET", "/api/portal/nope/loyalty/")).status, 404);
  const r = await call("GET", OWNER + "/", undefined, ADMIN);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.programs, []);
  assert.equal(r.body.clients.length, 2);
  assert.equal(r.body.wallet.configured, false);
});

test("create programmes: owner picks the business, portal is locked to its own", async () => {
  assert.equal((await call("POST", OWNER + "/programs", { name: "X" }, ADMIN)).status, 400);
  const a = await call("POST", OWNER + "/programs", { clientId: "c1", name: "Coffee card", type: "stamps", prompt: "warm cosy cafe" }, ADMIN);
  assert.equal(a.status, 201);
  assert.equal(a.body.status, "draft");
  assert.equal(a.body.design.background, "#112233");
  assert.equal(a.body.design.accent.startsWith("#"), true);
  assert.equal(a.body.design.generatedBy.model, "fake");
  assert.equal(a.body.clientName, "Cafe Uno");
  assert.match(a.body.joinUrl, /\/join\/[a-z0-9]{6}$/);
  st.p1 = a.body;
  // portal ignores a clientId for another business
  const b = await call("POST", P2 + "/programs", { clientId: "c1", name: "Dos card" });
  assert.equal(b.status, 201);
  assert.equal(b.body.clientId, "c2");
  st.p2 = b.body;
  const bad = await call("POST", OWNER + "/programs", { clientId: "c1", name: "Offline", prompt: "boom" }, ADMIN);
  assert.equal(bad.status, 201);
  assert.match(bad.body.designError, /unchanged|could not/);
});

test("portal never sees or touches another business", async () => {
  const list = await call("GET", P1 + "/");
  assert.deepEqual(list.body.programs.map((p) => p.id), [st.p1.id, ...list.body.programs.slice(1).map((p) => p.id)].slice(0, list.body.programs.length));
  assert.ok(list.body.programs.every((p) => p.clientId === "c1"));
  assert.equal(list.body.clients, undefined);
  for (const [m, path, body] of [["GET", `/programs/${st.p2.id}`], ["PATCH", `/programs/${st.p2.id}`, { name: "hack" }], ["DELETE", `/programs/${st.p2.id}`, { confirm: true }], ["POST", `/programs/${st.p2.id}/design`, { prompt: "abc" }], ["GET", `/programs/${st.p2.id}/customers`], ["GET", `/programs/${st.p2.id}/qr`], ["POST", `/programs/${st.p2.id}/regenerate-staff-token`, {}], ["POST", `/programs/${st.p2.id}/duplicate`, {}]]) {
    assert.equal((await call(m, P1 + path, body)).status, 404, `${m} ${path}`);
  }
  assert.equal(L.findProgram(st.p2.id).name, "Dos card");
});

test("patch: validates, goes live, pushes wallet updates for changed designs", async () => {
  const r = await call("PATCH", OWNER + `/programs/${st.p1.id}`, { status: "live", stamps: { goal: 4, perVisit: 1 }, rewards: [{ name: "Free coffee", kind: "stamps", cost: 4, expiresDays: 30 }], name: "  Coffee club  ", type: "bogus" }, ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "live");
  assert.equal(r.body.name, "Coffee club");
  assert.equal(r.body.type, "stamps");
  assert.equal(r.body.rewards[0].cost, 4);
  st.reward = r.body.rewards[0].id;
  st.p1 = r.body;
});

test("public join, card page, card JSON, qr, manifest, pass", async () => {
  assert.equal((await call("GET", "/join/zzzzzz")).status, 404);
  const page = await call("GET", `/join/${st.p1.joinCode}`);
  assert.equal(page.status, 200);
  assert.ok(page.ct.startsWith("text/html"));
  assert.ok(!page.body.includes(st.p1.staffToken));
  assert.equal((await call("POST", `/api/loyalty/join/${st.p1.joinCode}`, { name: "" })).status, 400);
  assert.equal((await call("POST", `/api/loyalty/join/nope12`, { name: "A" })).status, 404);
  const j = await call("POST", `/api/loyalty/join/${st.p1.joinCode}`, { name: "Ana", email: "ana@example.com", marketingConsent: true });
  assert.equal(j.status, 201);
  assert.match(j.body.cardUrl, /^\/card\/.{20,}/);
  st.cardUrl = j.body.cardUrl;
  const tok = st.cardUrl.split("/")[2];
  const v = await call("GET", `/api/loyalty/card/${tok}`);
  assert.equal(v.status, 200);
  assert.equal(v.body.customer.name, "Ana");
  assert.equal(v.body.wallet.available, false);
  assert.ok(v.body.code.startsWith("LC1-"));
  assert.equal(v.body.program.staffToken, undefined);
  st.code = v.body.code; st.cid = v.body.customer.id;
  assert.equal((await call("GET", st.cardUrl)).status, 200);
  assert.equal((await call("GET", `/card/bad-token-123`)).status, 404);
  assert.equal((await call("GET", `/api/loyalty/card/bad-token-123`)).status, 404);
  const qr = await call("GET", st.cardUrl + "/qr.svg");
  assert.ok(qr.body.includes("<svg"));
  const man = await call("GET", st.cardUrl + "/manifest.webmanifest");
  assert.ok(man.body.name);
  const pk = await call("GET", st.cardUrl + "/pass.pkpass");
  assert.equal(pk.status, 404);
  assert.ok(pk.body.error);
});

test("join is refused while a programme is draft", async () => {
  const r = await call("POST", `/api/loyalty/join/${st.p2.joinCode}`, { name: "Z", email: "z@example.com" });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /not open yet/);
});

test("staff scanner: lookup, visit, double scan, redeem, wrong token", async () => {
  const S = `/api/loyalty/staff/${st.p1.staffToken}`;
  assert.equal((await call("POST", `/api/loyalty/staff/wrong-token-0000/lookup`, { code: st.code })).status, 404);
  assert.equal((await call("GET", `/staff/wrong-token-0000`)).status, 404);
  assert.equal((await call("GET", `/staff/${st.p1.staffToken}`)).status, 200);
  const lk = await call("POST", S + "/lookup", { code: st.code });
  assert.equal(lk.status, 200);
  assert.equal(lk.body.customer.name, "Ana");
  assert.equal(lk.body.program.rewards[0].name, "Free coffee");
  assert.equal((await call("POST", S + "/lookup", { code: "LC1-doesnotexist" })).status, 404);
  const rec = await call("POST", S + "/record", { customerId: st.cid, kind: "visit" });
  assert.equal(rec.status, 200);
  assert.equal(rec.body.customer.stamps, 1);
  assert.match(rec.body.message, /1 of 4/);
  const dup = await call("POST", S + "/record", { customerId: st.cid, kind: "visit" });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /Try again/);
  assert.equal((await call("POST", S + "/record", { customerId: st.cid, kind: "redeem", rewardId: st.reward })).status, 422);
  assert.equal((await call("POST", S + "/record", { customerId: st.cid, kind: "bogus" })).status, 400);
  assert.equal((await call("POST", S + "/record", { customerId: st.cid, kind: "purchase", amountEur: "abc" })).status, 400);
  // a card from another programme cannot be used with this staff link
  const other = L.joinCustomer(L.findProgram(st.p2.id) && Object.assign(L.findProgram(st.p2.id), { status: "live" }), { name: "Other", email: "o@example.com" });
  assert.equal((await call("POST", S + "/lookup", { code: `LC1-${other.id}` })).status, 404);
  assert.equal((await call("POST", S + "/record", { customerId: other.id, kind: "visit" })).status, 404);
  st.other = other;
});

test("redeem through staff after enough stamps (via owner adjust)", async () => {
  const adj = await call("POST", OWNER + `/programs/${st.p1.id}/customers/${st.cid}/adjust`, { stamps: 3, note: "Gift" }, ADMIN);
  assert.equal(adj.status, 200);
  assert.equal(adj.body.stamps, 4);
  assert.equal((await call("POST", OWNER + `/programs/${st.p1.id}/customers/${st.cid}/adjust`, { stamps: "x" }, ADMIN)).status, 400);
  assert.equal((await call("POST", OWNER + `/programs/${st.p1.id}/customers/${st.cid}/adjust`, {}, ADMIN)).status, 400);
  pushed.length = 0;
  const r = await call("POST", `/api/loyalty/staff/${st.p1.staffToken}/record`, { customerId: st.cid, kind: "redeem", rewardId: st.reward });
  assert.equal(r.status, 200);
  assert.equal(r.body.customer.stamps, 0);
  assert.match(r.body.message, /Reward given/);
  assert.ok(pushed.includes(st.cid));
});

test("owner and portal customer views; portal cannot reach foreign customers", async () => {
  const d = await call("GET", OWNER + `/programs/${st.p1.id}`, undefined, ADMIN);
  assert.equal(d.body.customers.length, 1);
  assert.ok(d.body.txns.length >= 3);
  assert.equal(d.body.stats.rewardsRedeemed, 1);
  assert.equal(d.body.customers[0].authToken, undefined);
  assert.equal(d.body.customers[0].cardToken, undefined);
  const one = await call("GET", P1 + `/programs/${st.p1.id}/customers/${st.cid}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.redemptions.length, 1);
  assert.equal(one.body.authToken, undefined);
  assert.equal((await call("GET", P2 + `/programs/${st.p1.id}/customers/${st.cid}`)).status, 404);
  assert.equal((await call("GET", P1 + `/programs/${st.p1.id}/customers/${st.other.id}`)).status, 404);
  const adj = await call("POST", P1 + `/programs/${st.p1.id}/customers/${st.cid}/adjust`, { points: 5 });
  assert.equal(adj.status, 200);
  assert.equal(L.txnsOf(L.findCustomer(st.cid)).at(-1).by, "portal");
});

test("design regeneration keeps chosen fields; templates; duplicate; qr; staff token", async () => {
  const before = (await call("GET", OWNER + `/programs/${st.p1.id}`, undefined, ADMIN)).body.design;
  assert.equal((await call("POST", OWNER + `/programs/${st.p1.id}/design`, { prompt: "x" }, ADMIN)).status, 400);
  const d = await call("POST", OWNER + `/programs/${st.p1.id}/design`, { prompt: "bold neon", keep: ["cardTitle"] }, ADMIN);
  assert.equal(d.status, 200);
  assert.equal(d.body.design.cardTitle, before.cardTitle);
  assert.equal(d.body.design.prompt, "bold neon");
  assert.deepEqual(designCalls.at(-1), { prompt: "bold neon", keep: ["cardTitle"] });
  const t = await call("POST", P1 + `/programs/${st.p1.id}/save-template`, { name: "Neon" });
  assert.equal(t.status, 201);
  assert.equal(t.body.clientId, "c1");
  assert.equal((await call("POST", P1 + `/programs/${st.p1.id}/save-template`, {})).status, 400);
  assert.equal((await call("POST", P2 + "/programs/from-template", { templateId: t.body.id, name: "Steal" })).status, 404);
  const ft = await call("POST", P1 + "/programs/from-template", { templateId: t.body.id, name: "From tpl" });
  assert.equal(ft.status, 201);
  assert.equal(ft.body.design.background, d.body.design.background);
  assert.equal((await call("GET", P1 + "/")).body.templates.length, 1);
  assert.equal((await call("GET", P2 + "/")).body.templates.length, 0);
  const dup = await call("POST", P1 + `/programs/${st.p1.id}/duplicate`, {});
  assert.equal(dup.status, 201);
  assert.equal(dup.body.status, "draft");
  const q = await call("GET", P1 + `/programs/${st.p1.id}/qr`);
  assert.match(q.body.svg, /<svg/);
  assert.equal(q.body.url, st.p1.joinUrl);
  const png = await call("GET", P1 + `/programs/${st.p1.id}/qr.png`);
  assert.equal(png.body.subarray(1, 4).toString(), "PNG");
  const rg = await call("POST", P1 + `/programs/${st.p1.id}/regenerate-staff-token`, {});
  assert.notEqual(rg.body.staffToken, st.p1.staffToken);
  assert.match(rg.body.staffUrl, /\/staff\//);
  assert.equal((await call("POST", `/api/loyalty/staff/${st.p1.staffToken}/lookup`, { code: st.code })).status, 404);
  assert.equal((await call("POST", `/api/loyalty/staff/${rg.body.staffToken}/lookup`, { code: st.code })).status, 200);
});

test("delete needs paused/draft and confirm", async () => {
  const live = st.p1.id;
  assert.equal((await call("DELETE", OWNER + `/programs/${live}`, { confirm: true }, ADMIN)).status, 409);
  assert.equal((await call("PATCH", OWNER + `/programs/${live}`, { status: "paused" }, ADMIN)).status, 200);
  assert.equal((await call("DELETE", OWNER + `/programs/${live}`, {}, ADMIN)).status, 400);
  assert.equal((await call("DELETE", OWNER + `/programs/${live}`, { confirm: true }, ADMIN)).status, 200);
  assert.equal((await call("GET", OWNER + `/programs/${live}`, undefined, ADMIN)).status, 404);
  assert.equal((await call("GET", st.cardUrl)).status, 404);
});

test("limits: join, staff and bad-token guesses are rate limited; oversized bodies are refused", async () => {
  const ip = { "x-test-ip": "9.9.9.9" };
  const p = L.findProgram(st.p2.id);
  const codeJ = p.joinCode;
  let last;
  for (let i = 0; i < 12; i++) last = await call("POST", `/api/loyalty/join/${codeJ}`, { name: "N" + i, email: `n${i}@example.com` }, ip);
  assert.equal(last.status, 429);
  const g = { "x-test-ip": "8.8.8.8" };
  for (let i = 0; i < 20; i++) await call("POST", `/api/loyalty/staff/guess-${i}-xxxxxxxx/lookup`, { code: "x" }, g);
  assert.equal((await call("POST", `/api/loyalty/staff/${p.staffToken}/lookup`, { code: "x" }, g)).status, 429);
  // the server cuts the connection (or answers 413) when the body is over the limit
  const big = await call("POST", `/api/loyalty/join/${codeJ}`, { name: "x".repeat(50000) }, { "x-test-ip": "7.7.7.7" }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
});
