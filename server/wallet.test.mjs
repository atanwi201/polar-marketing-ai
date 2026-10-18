import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";

const dir = mkdtempSync(join(tmpdir(), "wallet-"));
process.env.DATA_DIR = dir;
const { handleWallet, pushUpdate } = await import("./wallet.mjs");

for (const n of ["signer", "wwdr"]) execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, `${n}.key`), "-out", join(dir, `${n}.pem`), "-days", "2", "-subj", `/CN=${n}`], { stdio: "ignore" });
const env = { APPLE_PASS_TYPE_ID: "pass.t", APPLE_TEAM_ID: "TEAM123456", PUBLIC_URL: "https://c.example.com", APPLE_PASS_CERT_PATH: join(dir, "signer.pem"), APPLE_PASS_KEY_PATH: join(dir, "signer.key"), APPLE_WWDR_PATH: join(dir, "wwdr.pem") };

const L = { programs: [{ id: "p1", clientId: "c1", name: "Club", type: "stamps", design: { background: "#112233", foreground: "#ffffff", label: "#cccccc", accent: "#ff0000", layout: "minimal" }, stamps: { goal: 5 }, rewards: [] }], customers: [], txns: [], devices: [], templates: [] };
const AUTH = "auth-token-0123456789";
L.customers.push({ id: "k1", programId: "p1", clientId: "c1", authToken: AUTH, name: "A", stamps: 1, updatedAt: "2026-01-02T00:00:00.000Z" });
L.customers.push({ id: "k2", programId: "p1", clientId: "c1", authToken: "other-token-0123456789", name: "B", stamps: 0, updatedAt: "2026-01-05T00:00:00.000Z" });

const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const ctx = { send, env, ldb: () => L, readBody: (req) => Promise.resolve(req.body ?? {}) };

async function call(method, path, { body, auth, headers = {} } = {}) {
  const url = new URL(path, "https://c.example.com");
  const req = Object.assign(new EventEmitter(), { method, headers: { host: "c.example.com", ...(auth ? { authorization: `ApplePass ${auth}` } : {}), ...headers }, body });
  const out = { code: 0, headers: {}, chunks: [] };
  const res = { writeHead(c, h = {}) { out.code = c; out.headers = h; }, end(b) { if (b) out.chunks.push(Buffer.from(b)); } };
  const handled = await handleWallet(req, res, url, url.pathname.split("/").filter(Boolean), ctx);
  const raw = Buffer.concat(out.chunks);
  return { handled, code: out.code, headers: out.headers, raw, json: () => JSON.parse(raw.toString()) };
}
const reg = "/wallet/v1/devices/dev1/registrations/pass.t";

test("ignores other paths", async () => { assert.equal((await call("GET", "/api/x")).handled, false); });

test("registration needs the pass auth token, 201 then 200, delete removes", async () => {
  assert.equal((await call("POST", `${reg}/k1`, { body: { pushToken: "aa" } })).code, 401);
  assert.equal((await call("POST", `${reg}/k1`, { body: { pushToken: "aa" }, auth: "wrong-token-000000000" })).code, 401);
  assert.equal((await call("POST", `${reg}/k1`, { body: { pushToken: "aa" }, auth: AUTH })).code, 201);
  assert.equal((await call("POST", `${reg}/k1`, { body: { pushToken: "bb" }, auth: AUTH })).code, 200);
  assert.equal(L.devices.length, 1);
  assert.equal(L.devices[0].pushToken, "bb");
  assert.equal((await call("POST", `${reg}/k1`, { body: {}, auth: AUTH })).code, 400);
  assert.equal((await call("POST", `/wallet/v1/devices/dev1/registrations/pass.other/k1`, { body: { pushToken: "x" }, auth: AUTH })).code, 404);
  assert.equal((await call("DELETE", `${reg}/k1`, { auth: AUTH })).code, 200);
  assert.equal(L.devices.length, 0);
});

test("serial listing honours passesUpdatedSince: 200 with tag, 204 when nothing newer", async () => {
  await call("POST", `${reg}/k1`, { body: { pushToken: "aa" }, auth: AUTH });
  await call("POST", `${reg}/k2`, { body: { pushToken: "aa" }, auth: "other-token-0123456789" });
  const all = await call("GET", reg);
  assert.equal(all.code, 200);
  assert.deepEqual(all.json().serialNumbers.sort(), ["k1", "k2"]);
  const tag = all.json().lastUpdated;
  assert.equal(tag, String(Date.parse("2026-01-05T00:00:00.000Z")));
  assert.equal((await call("GET", `${reg}?passesUpdatedSince=${tag}`)).code, 204);
  const some = await call("GET", `${reg}?passesUpdatedSince=${Date.parse("2026-01-03T00:00:00Z")}`);
  assert.deepEqual(some.json().serialNumbers, ["k2"]);
  assert.equal((await call("GET", "/wallet/v1/devices/nobody/registrations/pass.t")).code, 204);
});

test("pass download: 401 without token, 200 pkpass, 304 when unchanged", async () => {
  const p = "/wallet/v1/passes/pass.t/k1";
  assert.equal((await call("GET", p)).code, 401);
  assert.equal((await call("GET", p, { auth: "other-token-0123456789" })).code, 401);
  const r = await call("GET", p, { auth: AUTH });
  assert.equal(r.code, 200);
  assert.equal(r.headers["Content-Type"], "application/vnd.apple.pkpass");
  assert.equal(r.raw.slice(0, 2).toString(), "PK");
  assert.equal((await call("GET", p, { auth: AUTH, headers: { "if-modified-since": r.headers["Last-Modified"] } })).code, 304);
  assert.equal((await call("GET", "/wallet/v1/passes/pass.t/nope", { auth: AUTH })).code, 401);
});

test("log endpoint answers 200", async () => {
  const warn = console.warn; console.warn = () => {};
  try { assert.equal((await call("POST", "/wallet/v1/log", { body: { logs: ["hello"] } })).code, 200); } finally { console.warn = warn; }
});

test("404 when wallet is not configured", async () => {
  const saved = ctx.env; ctx.env = {};
  try { assert.equal((await call("GET", reg)).code, 404); } finally { ctx.env = saved; }
});

test("pushUpdate sends to each device with the pass type topic and drops 410s", async () => {
  L.devices.length = 0;
  L.devices.push({ deviceId: "d1", pushToken: "tok1", serial: "k1", passTypeId: "pass.t" }, { deviceId: "d2", pushToken: "tok2", serial: "k1", passTypeId: "pass.t" }, { deviceId: "d3", pushToken: "tok3", serial: "k2", passTypeId: "pass.t" });
  let seen;
  const sender = async (tokens, opts) => { seen = { tokens, opts }; return tokens.map((token) => ({ token, status: token === "tok2" ? 410 : 200 })); };
  const r = await pushUpdate(L.customers[0], { sender, env, ldb: L });
  assert.deepEqual(seen.tokens, ["tok1", "tok2"]);
  assert.equal(seen.opts.topic, "pass.t");
  assert.deepEqual([r.sent, r.removed, r.failed], [1, 1, 0]);
  assert.deepEqual(L.devices.map((d) => d.pushToken), ["tok1", "tok3"]);
  assert.equal((await pushUpdate(L.customers[1], { sender: async () => [{ token: "tok3", status: 500 }], env, ldb: L })).failed, 1);
  assert.equal((await pushUpdate({ id: "none" }, { sender, env, ldb: L })).sent, 0);
  assert.equal((await pushUpdate(L.customers[0], { sender, env: { ...env, PUBLIC_URL: "http://x" }, ldb: L })).skipped, "PUBLIC_URL is not https");
});
