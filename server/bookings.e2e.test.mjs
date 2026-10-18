// Booking routes against a temp DATA_DIR: public flow, customer cancel, owner scope, portal isolation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bk-e2e-"));
const { db } = await import("./store.mjs");
const { handleBookings } = await import("./bookings-routes.mjs");
const B = await import("./bookings.mjs");

db.clients.push({ id: "c1", name: "Bar Uno", token: "portal-one", kind: "restaurant" }, { id: "c2", name: "Hotel Dos", token: "portal-two", kind: "hotel" });
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, fail) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { fail(Object.assign(new Error("Invalid JSON"), { status: 400 })); } }); });
const ctx = { send, readBody, isAdmin: (r) => r.headers["x-admin-token"] === "secret", clientByToken: (t) => db.clients.find((c) => c.token === t), baseUrl: (r) => `http://${r.headers.host}`, clientIp: (r) => String(r.headers["x-test-ip"] ?? "1.1.1.1") };
let server, base, n = 0;
before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try { if (!(await handleBookings(req, res, url, url.pathname.split("/").filter(Boolean), ctx))) send(res, 404, { error: "nope" }); } catch (e) { send(res, 500, { error: e.message }); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "x-test-ip": `10.1.0.${++n % 250}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text() };
};
const ADMIN = { "x-admin-token": "secret" };
const future = (d) => B.addDays(B.localNow().date, d);
const st = {};

test("auth: owner needs admin, portal needs a known token", async () => {
  assert.equal((await call("GET", "/api/studio/bookings")).status, 401);
  assert.equal((await call("GET", "/api/portal/nope/bookings")).status, 404);
});
test("portal sets up the booking system; public page and info appear only once configured", async () => {
  const g = await call("GET", "/api/portal/portal-one/bookings");
  assert.equal(g.status, 200);
  assert.equal(g.body.config.enabled, false);
  st.code = g.body.config.code;
  assert.equal((await call("GET", `/book/${st.code}`)).status, 200);
  assert.equal((await call("POST", `/api/book/${st.code}`, { name: "A", email: "a@example.com", date: future(2), time: "20:00", party: 2 })).status, 409);
  const put = await call("PUT", "/api/portal/portal-one/bookings/config", { enabled: true, table: { week: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, ranges: [["20:00", "22:00"]] })), seats: 6 } });
  assert.equal(put.body.enabled, true);
});
test("customer books, cancels from the manage link; owner sees it", async () => {
  const av = await call("GET", `/api/book/${st.code}/availability?date=${future(2)}&party=2`);
  assert.ok(av.body.slots.some((s) => s.time === "20:00" && s.available));
  const no = await call("POST", `/api/book/${st.code}`, { name: "Ana", email: "", date: future(2), time: "20:00", party: 2 });
  assert.equal(no.status, 400);
  const ok = await call("POST", `/api/book/${st.code}`, { name: "Ana", email: "ana@example.com", date: future(2), time: "20:00", party: 2, lang: "en" });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.booking.status, "confirmed");
  assert.equal(ok.body.booking.manageToken, undefined);
  st.manage = ok.body.manageUrl;
  assert.equal((await call("GET", st.manage)).status, 200);
  assert.equal((await call("GET", "/booking/zzzzzzzzzzzz")).status, 404);
  const list = await call("GET", "/api/portal/portal-one/bookings");
  st.id = list.body.bookings[0].id;
  assert.equal(list.body.bookings.length, 1);
  assert.equal((await call("POST", `/api${st.manage}/cancel`)).body.booking.status, "cancelled");
});
test("owner can re-confirm; portal two cannot touch portal one's booking", async () => {
  const other = await call("PATCH", `/api/portal/portal-two/bookings/bookings/${st.id}`, { status: "confirmed" });
  assert.equal(other.status, 404);
  const r = await call("PATCH", `/api/studio/bookings/bookings/${st.id}?clientId=c1`, { status: "confirmed" }, ADMIN);
  assert.equal(r.body.status, "confirmed");
  const bad = await call("PATCH", `/api/studio/bookings/bookings/${st.id}?clientId=c1`, { status: "pending" }, ADMIN);
  assert.equal(bad.status, 409);
});
test("hotel flow over HTTP", async () => {
  const cfg = (await call("GET", "/api/portal/portal-two/bookings")).body.config;
  assert.equal(cfg.kind, "room");
  await call("PUT", "/api/portal/portal-two/bookings/config", { enabled: true });
  const q = `checkIn=${future(4)}&checkOut=${future(6)}&guests=2`;
  const av = await call("GET", `/api/book/${cfg.code}/availability?${q}`);
  const rt = av.body.rooms.find((r) => r.available);
  const ok = await call("POST", `/api/book/${cfg.code}`, { name: "Bo", email: "bo@example.com", checkIn: future(4), checkOut: future(6), guests: 2, roomTypeId: rt.id });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.booking.nights, 2);
});
test("owner and portal errors come back in Spanish when x-lang is es", async () => {
  const r = await call("PATCH", `/api/portal/portal-one/bookings/bookings/${st.id}`, { status: "pending" }, { "x-lang": "es" });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /no puede pasar a/);
  const en = await call("PATCH", `/api/portal/portal-one/bookings/bookings/${st.id}`, { status: "pending" });
  assert.match(en.body.error, /cannot become/);
});
