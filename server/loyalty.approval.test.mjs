import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "loyalty-approval-"));
process.env.DATA_DIR = join(root, "data"); process.env.SITES_DIR = join(root, "sites");
const { db } = await import("./store.mjs");
const L = await import("./loyalty.mjs");
const { handleLoyalty } = await import("./loyalty-routes.mjs");

const approved = { id: "ok", name: "Aprobado SL", token: "tok-ok", approval: { status: "approved" }, languages: ["es"] };
const pending = { id: "pen", name: "Pendiente SL", token: "tok-pen", approval: { status: "pending" }, languages: ["es"] };
db.clients.push(approved, pending);

const live = (client) => { const p = L.createProgram(client, { type: "stamps" }); p.status = "live"; return p; };
const progOk = live(approved);
const progPending = live(pending);

/** Call the real handler the way index.mjs does. */
async function call(seg, { method = "GET", body, ip = `10.1.1.${Math.random()}` } = {}) {
  const req = { method, headers: {} };
  const res = { headersSent: false, writeHead: (c) => { res.code = c; }, end: (b) => { res.body = b ?? ""; } };
  let json, code = 0;
  const ctx = {
    send: (_r, c, b) => { code = c; json = b; },
    readBody: async () => body ?? {},
    clientIp: () => ip,
    baseUrl: () => "https://example.test",
    wallet: { status: async () => ({ configured: false, missing: [], passTypeId: "", pushReady: false, publicUrlHttps: false }) },
  };
  const handled = await handleLoyalty(req, res, new URL("https://example.test/x"), seg, ctx);
  return { handled, code, json, html: res.body, status: res.code };
}

test("a pending business cannot issue cards: join page and join API both look like a dead link", async () => {
  const page = await call(["join", progPending.joinCode]);
  assert.equal(page.status, 404);
  assert.match(page.html, /Link not valid/);

  const api = await call(["api", "loyalty", "join", progPending.joinCode], { method: "POST", body: { name: "Ana", email: "ana@example.com" } });
  assert.equal(api.code, 404);
  assert.equal(api.json.error, "This link is not valid.", "identical to an unknown code: no state leak");
  assert.equal(L.ldb().customers.length, 0, "and no card was created");
});

test("an approved business still joins normally", async () => {
  const api = await call(["api", "loyalty", "join", progOk.joinCode], { method: "POST", body: { name: "Ana", email: "ana@example.com" } });
  assert.equal(api.code, 201);
  assert.match(api.json.cardUrl, /^\/card\//);
  assert.equal(L.ldb().customers.length, 1);
});

test("pending businesses cannot look up or stamp, and the staff page is not served", async () => {
  const page = await call(["staff", progPending.staffToken]);
  assert.equal(page.status, 404);

  const lookup = await call(["api", "loyalty", "staff", progPending.staffToken, "lookup"], { method: "POST", body: { code: "LC1-x" } });
  assert.equal(lookup.code, 403);
  assert.match(lookup.json.error, /not active yet/);
});

test("a customer who already has a card keeps it if the business later goes back to pending", async () => {
  const c = L.ldb().customers[0];
  approved.approval = { status: "pending" };
  const page = await call(["card", c.cardToken]);
  assert.equal(page.status, 200, "the card is the customer's, not the shop's: it must not break");
  assert.match(page.html, /Aprobado SL/);
  const view = await call(["api", "loyalty", "card", c.cardToken]);
  assert.equal(view.code, 200);
  assert.equal(view.json.customer.name, "Ana");
  approved.approval = { status: "approved" };
});
