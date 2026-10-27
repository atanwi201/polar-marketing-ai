import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "gbp-sec-"));
process.env.DATA_DIR = join(root, "data"); process.env.SITES_DIR = join(root, "sites");
const { db } = await import("./store.mjs");
const { handleGbp, limits } = await import("./gbp-routes.mjs");

const A = { id: "ta", name: "Casa Mar", kind: "Restaurante", town: "Los Cristianos", token: "tok-a", approval: { status: "approved" }, profile: { services: ["Menú"] }, photos: [{ file: "a.jpg" }] };
const B = { id: "tb", name: "Bar Solo", kind: "Bar", town: "Adeje", token: "tok-b", approval: { status: "approved" } };
const P = { id: "tp", name: "Pending SL", token: "tok-p", approval: { status: "pending" } };
db.clients.push(A, B, P);

/** Call the handler the way index.mjs does, with a captured response. */
async function call(token, { method = "GET", rest = [], body, lang } = {}, ip = `10.0.0.${Math.random()}`) {
  const req = { method, headers: lang ? { "x-lang": lang } : {} };
  const res = { headersSent: false, end() {} };
  let code = 0, payload;
  const ctx = {
    send: (_r, c, b) => { code = c; payload = b; },
    readBody: async () => body ?? {},
    clientIp: () => ip,
    clientByToken: (t) => db.clients.find((c) => c.token === t),
  };
  const seg = ["api", "portal", token, "gbp", ...rest];
  const handled = await handleGbp(req, res, new URL("http://x/api/portal/" + token + "/gbp"), seg, ctx);
  return { handled, code, payload };
}

test("an unknown portal token gets a 404 and no hint about who exists", async () => {
  for (const token of ["nope", "tok-a "]) {
    const r = await call(token);
    assert.equal(r.handled, true);
    assert.equal(r.code, 404);
    assert.equal(r.payload.error, "Unknown portal link");
  }
});

test("a business that is not approved cannot use the kit", async () => {
  const r = await call("tok-p", { lang: "es" });
  assert.equal(r.code, 403);
  assert.match(r.payload.error, /pendiente/i, "the message is localised for the client");
});

test("one tenant's token never returns another tenant's kit or data", async () => {
  const a = await call("tok-a", { method: "POST", rest: ["kit"], body: { lang: "es" } });
  assert.equal(a.code, 200);
  assert.equal(a.payload.gbp.kit.identity.name, "Casa Mar");

  const b = await call("tok-b", { method: "GET" });
  assert.equal(b.code, 200);
  assert.equal(b.payload.gbp.hasKit, false);
  assert.equal(JSON.stringify(b.payload).includes("Casa Mar"), false);
  assert.equal(JSON.stringify(b.payload).includes("Paul"), false);
});

test("status changes are validated and persisted on the right record", async () => {
  const bad = await call("tok-b", { method: "PATCH", body: { status: "casi" } });
  assert.equal(bad.code, 400);
  assert.equal(bad.payload.code, "bad_status");

  const ok = await call("tok-b", { method: "PATCH", body: { status: "created", notes: "  " + "x".repeat(2500) } });
  assert.equal(ok.code, 200);
  assert.equal(ok.payload.gbp.status, "created");
  assert.ok(ok.payload.gbp.notes.length <= 2000);
  assert.equal(db.clients.find((c) => c.id === "tb").gbp.status, "created");
  assert.equal(db.clients.find((c) => c.id === "ta").gbp.status, "not_started", "no bleed between clients");
});

test("the payload never carries secrets or another tenant's accounts", async () => {
  db.clients.find((c) => c.id === "ta").accounts = { facebook: { token: "SECRET-FB" } };
  const r = await call("tok-a", { method: "GET" });
  const body = JSON.stringify(r.payload);
  assert.equal(body.includes("SECRET-FB"), false);
  assert.equal(body.includes("tok-a"), false);
  assert.equal(body.includes("accounts"), false);
});

test("the generator is rate limited harder than reads", async () => {
  const ip = "10.9.9.9";
  let last;
  for (let i = 0; i < 7; i++) last = await call("tok-a", { method: "POST", rest: ["kit"], body: { lang: "es" } }, ip);
  assert.equal(last.code, 429, "the 7th generation in the hour is refused");
  assert.ok(limits.ai.blocked(ip));
});

test("only the documented methods answer; anything else is a 404, not a silent success", async () => {
  const r = await call("tok-a", { method: "DELETE" });
  assert.equal(r.code, 404);
  const wrong = await call("tok-a", { method: "POST", rest: ["publish"] });
  assert.equal(wrong.code, 404);
});
