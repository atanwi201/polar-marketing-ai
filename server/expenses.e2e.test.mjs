// Expense routes: owner vs portal scope, off-by-default, scan with a mocked vision provider, export downloads.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock OpenRouter (the vision chain): model list + chat completions returning receipt JSON.
let lastChat;
const mock = http.createServer((req, res) => {
  let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "google/gemini-2.0-flash-exp:free", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, context_length: 100000 }] }));
    lastChat = JSON.parse(s);
    res.end(JSON.stringify({ model: "google/gemini-2.0-flash-exp:free", choices: [{ message: { content: 'Here:\n```json\n{"store":"Spar","location":"Centro","date":"2026-10-03","items":[{"name":"Pan","qty":1,"price":1.2}],"total":1.2,"tax":0.08,"currency":"EUR","category":"food"}\n```' } }] }));
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
process.env.OPENROUTER_API_KEY = "test-key";
process.env.AI_PROVIDERS = "openrouter";
process.env.GROQ_API_KEY = ""; process.env.MISTRAL_API_KEY = "";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "exp-e2e-"));

const { db } = await import("./store.mjs");
const { handleExpenses } = await import("./expenses-routes.mjs");
db.clients.push({ id: "c1", name: "Bar Uno", token: "portal-one" }, { id: "c2", name: "Hotel Dos", token: "portal-two" });
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, fail) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { fail(Object.assign(new Error("Invalid JSON"), { status: 400 })); } }); });
const ctx = { send, readBody, isAdmin: (r) => r.headers["x-admin-token"] === "secret", clientByToken: (t) => db.clients.find((c) => c.token === t), clientIp: (r) => String(r.headers["x-test-ip"] ?? "1.1.1.1") };
let server, base, n = 0;
before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try { if (!(await handleExpenses(req, res, url, url.pathname.split("/").filter(Boolean), ctx))) send(res, 404, { error: "nope" }); } catch (e) { send(res, 500, { error: e.message }); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); mock.close(); });
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "x-test-ip": `10.2.0.${++n % 250}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, headers: r.headers, body: ct.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const ADMIN = { "x-admin-token": "secret" };
const P = "/api/portal/portal-one/expenses", O = "/api/studio/expenses";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const st = {};

test("auth: owner needs admin, portal needs a known token", async () => {
  assert.equal((await call("GET", O)).status, 401);
  assert.equal((await call("GET", "/api/portal/nope/expenses")).status, 404);
});
test("off by default: portal sees only enabled:false and cannot scan or add; owner can turn it on", async () => {
  assert.deepEqual((await call("GET", P)).body, { config: { enabled: false } });
  assert.equal((await call("POST", `${P}/scan`, { image: PNG })).status, 403);
  assert.equal((await call("POST", `${P}/items`, { date: "2026-10-01", total: 1 })).status, 403);
  assert.equal((await call("PUT", `${P}/config`, { enabled: true })).status, 403);
  const ov = await call("GET", O, undefined, ADMIN);
  assert.equal(ov.body.businesses.find((b) => b.id === "c1").enabled, false);
  const on = await call("PUT", `${O}/config?clientId=c1`, { enabled: true }, ADMIN);
  assert.equal(on.body.enabled, true);
  assert.equal((await call("GET", P)).body.config.enabled, true);
  assert.equal((await call("GET", "/api/portal/portal-two/expenses")).body.config.enabled, false); // other business untouched
});
test("client cannot switch it off, but manages locations", async () => {
  const r = await call("PUT", `${P}/config`, { enabled: false, locations: [{ name: "Playa" }, { name: "Centro" }] });
  assert.equal(r.body.enabled, true);
  assert.deepEqual(r.body.locations.map((l) => l.name), ["Playa", "Centro"]);
  st.locs = r.body.locations;
});
test("scan sends the photo to the vision chain and returns a draft to review", async () => {
  assert.equal((await call("POST", `${P}/scan`, { image: "not an image" })).status, 400);
  const r = await call("POST", `${P}/scan`, { image: PNG });
  assert.equal(r.status, 200);
  assert.equal(r.body.draft.store, "Spar"); assert.equal(r.body.draft.totalCents, 120); assert.equal(r.body.draft.taxCents, 8);
  assert.equal(r.body.draft.locationId, st.locs[1].id);
  const parts = lastChat.messages.at(-1).content;
  assert.ok(parts.some((p) => p.type === "image_url" && p.image_url.url === PNG));
  assert.equal((await call("GET", `${P}`)).body.expenses.length, 0); // nothing saved until the client confirms
});
test("save, edit, filter, summary, delete; portal cannot touch another business", async () => {
  const a = await call("POST", `${P}/items`, { date: "2026-10-03", store: "Spar", total: "1,20", locationId: st.locs[1].id, category: "food", source: "scan" });
  assert.equal(a.status, 201); st.id = a.body.id;
  await call("POST", `${P}/items`, { date: "2026-10-05", total: 40, locationId: st.locs[0].id, category: "supplies" });
  assert.equal((await call("POST", `${P}/items`, { date: "2026-10-05", total: 40, locationId: "bad" })).status, 400);
  const es = await call("POST", `${P}/items`, { date: "x", total: 1 }, { "x-lang": "es" });
  assert.match(es.body.error, /fecha/);
  const g = await call("GET", `${P}?month=2026-10`);
  assert.equal(g.body.summary.totalCents, 4120); assert.equal(g.body.expenses.length, 2);
  assert.equal((await call("GET", `${P}?month=2026-10&locationId=${st.locs[1].id}`)).body.summary.totalCents, 120);
  assert.equal((await call("GET", `${P}?month=bad`)).status, 400);
  assert.equal((await call("PATCH", `${P}/items/${st.id}`, { total: 2 })).body.totalCents, 200);
  assert.equal((await call("DELETE", `/api/portal/portal-two/expenses/items/${st.id}`)).status, 403); // two is off
  await call("PUT", `${O}/config?clientId=c2`, { enabled: true }, ADMIN);
  assert.equal((await call("DELETE", `/api/portal/portal-two/expenses/items/${st.id}`)).status, 404);
  assert.equal((await call("GET", `${O}?clientId=c1&month=2026-10`, undefined, ADMIN)).body.expenses.length, 2); // owner sees the same data
  assert.equal((await call("DELETE", `${P}/items/${st.id}`)).status, 200);
});
test("export: .ods and .csv downloads for client and owner", async () => {
  const ods = await call("GET", `${P}/export?format=ods&month=2026-10`);
  assert.equal(ods.status, 200);
  assert.equal(ods.headers.get("content-type"), "application/vnd.oasis.opendocument.spreadsheet");
  assert.match(ods.headers.get("content-disposition"), /gastos-bar-uno-2026-10\.ods/);
  assert.equal(ods.body.subarray(0, 2).toString(), "PK");
  const csv = await call("GET", `/api/studio/expenses/export?clientId=c1&format=csv&month=2026-10&lang=en`, undefined, ADMIN);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.body.toString(), /Date,Store,Location/);
  assert.equal((await call("GET", `${O}/export?clientId=c1`)).status, 401);
});
