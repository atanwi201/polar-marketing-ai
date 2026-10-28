// GBP OAuth: the connect flow, encrypted tokens, refresh and disconnect, against a fake Google server.
// No network: the fake listens on 127.0.0.1 and only knows the handful of responses we need.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "gbp-auth-"));
process.env.DATA_DIR = join(root, "data");
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://studio.test/api/gbp/callback";
process.env.TOKEN_ENC_KEY = "k".repeat(48);

const { db } = await import("./store.mjs");
const auth = await import("./gbp-auth.mjs");
const { ensureGbp } = await import("./gbp-kit.mjs");
const { handleGbp, limits } = await import("./gbp-routes.mjs");

const fake = { challenge: "", access: 0, expiresIn: 3600, dead: false, revoked: [], refreshes: 0 };
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = new URLSearchParams(Buffer.concat(chunks).toString());
  const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.url === "/token") {
    if (body.get("client_id") !== "test-client" || body.get("client_secret") !== "test-secret") return json(401, { error: "invalid_client" });
    if (body.get("grant_type") === "authorization_code") {
      if (body.get("code") !== "good-code") return json(400, { error: "invalid_grant" });
      const sent = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
      if (!fake.challenge || sent !== fake.challenge) return json(400, { error: "invalid_grant" }); // PKCE really checked
      return json(200, { access_token: `at-${++fake.access}`, refresh_token: "rt-1", expires_in: fake.expiresIn, scope: auth.SCOPE, token_type: "Bearer" });
    }
    if (body.get("grant_type") === "refresh_token") {
      if (fake.dead || body.get("refresh_token") !== "rt-1") return json(400, { error: "invalid_grant" });
      fake.refreshes++;
      // A refresh response has no refresh_token: the app must keep the stored one.
      return json(200, { access_token: `at-${++fake.access}`, expires_in: 3600, scope: auth.SCOPE, token_type: "Bearer" });
    }
  }
  if (req.url === "/revoke") { fake.revoked.push(body.get("token")); return json(200, {}); }
  json(404, { error: "not_found" });
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.GBP_OAUTH_AUTH_URL = `${base}/authorize`;
process.env.GBP_OAUTH_TOKEN_URL = `${base}/token`;
process.env.GBP_OAUTH_REVOKE_URL = `${base}/revoke`;
after(() => server.close());

let seq = 0;
const client = (extra = {}) => {
  const c = { id: `c${++seq}`, name: `Shop ${seq}`, token: `tok-${seq}`, approval: { status: "approved" }, ...extra };
  db.clients.push(c);
  return c;
};

/** Start the flow the way the route does and register its challenge with the fake. */
function start(c) {
  const { url, state } = auth.connectUrl(c);
  const u = new URL(url);
  fake.challenge = u.searchParams.get("code_challenge") ?? "";
  return { u, state };
}
const finish = (state) => auth.finishConnect({ state, code: "good-code", cookieState: state });

test("the connect URL asks for offline access, one scope, state and PKCE", () => {
  const c = client();
  const { u } = start(c);
  assert.equal(u.origin + u.pathname, `${base}/authorize`);
  assert.equal(u.searchParams.get("client_id"), "test-client");
  assert.equal(u.searchParams.get("redirect_uri"), "https://studio.test/api/gbp/callback");
  assert.equal(u.searchParams.get("scope"), auth.SCOPE);
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent", "otherwise Google may omit the refresh token");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.ok(u.searchParams.get("state").length >= 40);
  assert.ok(u.searchParams.get("code_challenge").length >= 40);
});

test("a state we did not issue, or the wrong cookie, changes nothing", async () => {
  const c = client();
  await assert.rejects(auth.finishConnect({ state: "made-up", code: "good-code", cookieState: "made-up" }), (e) => e.status === 400 && e.code === "state");
  const { state } = start(c);
  await assert.rejects(auth.finishConnect({ state, code: "good-code", cookieState: "other" }), (e) => e.code === "state");
  // Single use even after a failed attempt: the second try cannot succeed.
  await assert.rejects(auth.finishConnect({ state, code: "good-code", cookieState: state }), (e) => e.code === "state");
  assert.equal(c.gbp?.auth?.enc ?? "", "", "nothing was stored");
});

test("connect stores only ciphertext, and no view or serialised state carries a token", async () => {
  const c = client();
  const { state } = start(c);
  const done = await finish(state);
  assert.equal(done.id, c.id);
  const enc = c.gbp.auth.enc;
  assert.match(enc, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(c.gbp.mode, "api");
  assert.equal(auth.readTokens(c).accessToken, "at-1");
  const dump = JSON.stringify(c) + JSON.stringify(db);
  assert.equal(dump.includes("rt-1"), false, "no refresh token in the clear");
  assert.equal(dump.includes("at-1"), false, "no access token in the clear");
  const view = JSON.stringify(auth.gbpAuthView(c));
  assert.equal(view.includes("at-1") || view.includes("rt-1") || view.includes(enc), false);
});

test("a live access token is reused; an expired one is refreshed, keeping the refresh token", async () => {
  const c = client();
  fake.expiresIn = 0;                                 // expired the moment it is stored
  const { state } = start(c);
  await finish(state);
  const before = fake.refreshes;
  const token = await auth.accessToken(c);
  assert.equal(token, `at-${fake.access}`);
  assert.equal(fake.refreshes, before + 1);
  assert.equal(auth.readTokens(c).refreshToken, "rt-1", "the refresh response did not include one");
  const again = await auth.accessToken(c);
  assert.equal(again, token);
  assert.equal(fake.refreshes, before + 1, "a fresh token is not refreshed again");
  fake.expiresIn = 3600;
});

test("two callers at once share one refresh", async () => {
  const c = client();
  fake.expiresIn = 0;
  const { state } = start(c);
  await finish(state);
  const before = fake.refreshes;
  const [a, b] = await Promise.all([auth.accessToken(c), auth.accessToken(c)]);
  assert.equal(a, b);
  assert.equal(fake.refreshes, before + 1);
  fake.expiresIn = 3600;
});

test("invalid_grant clears the connection and asks for a reconnect", async () => {
  const c = client();
  fake.expiresIn = 0;
  const { state } = start(c);
  await finish(state);
  fake.dead = true;
  try {
    assert.equal(await auth.accessToken(c), "");
    assert.equal(c.gbp.auth.enc, "");
    assert.equal(c.gbp.mode, "manual");
    assert.equal(auth.gbpAuthView(c).connected, false);
    assert.equal(auth.gbpAuthView(c).lastError, "reconnect");
    assert.equal(JSON.stringify(c).includes("rt-1"), false);
  } finally { fake.dead = false; fake.expiresIn = 3600; }
});

test("disconnect revokes the grant, is idempotent and leaves no tokens", async () => {
  const c = client();
  const { state } = start(c);
  await finish(state);
  const before = fake.revoked.length;
  await auth.disconnect(c);
  assert.equal(fake.revoked.length, before + 1);
  assert.equal(fake.revoked.at(-1), "rt-1", "the refresh token is what gets revoked");
  assert.equal(auth.readTokens(c), null);
  assert.equal(c.gbp.mode, "manual");
  await auth.disconnect(c);
  assert.equal(fake.revoked.length, before + 1, "nothing left to revoke");
});

test("a ciphertext moved to another business, or edited, fails closed", async () => {
  const a = client(), b = client();
  const { state } = start(a);
  await finish(state);
  ensureGbp(b).auth = { ...a.gbp.auth };
  assert.equal(auth.readTokens(b), null, "the client id is authenticated");
  const parts = a.gbp.auth.enc.split(".");
  parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  a.gbp.auth.enc = parts.join(".");
  assert.equal(auth.readTokens(a), null, "tampering is detected");
  assert.equal(auth.gbpAuthView(a).connected, false);
  assert.equal(auth.gbpAuthView(a).lastError, "reconnect");
});

test("without TOKEN_ENC_KEY nothing pretends to be configured", async () => {
  const key = process.env.TOKEN_ENC_KEY;
  delete process.env.TOKEN_ENC_KEY;
  try {
    assert.equal(auth.gbpOAuthConfigured(), false);
    assert.throws(() => auth.connectUrl(client()), (e) => e.status === 503 && e.code === "not_configured");
    assert.equal(auth.gbpAuthView(client()).configured, false);
  } finally { process.env.TOKEN_ENC_KEY = key; }
});

// --- the HTTP surface ---------------------------------------------------------------------------------
async function call(token, { method = "GET", rest = [], cookie = "", query = "" } = {}) {
  const req = { method, headers: cookie ? { cookie } : {} };
  let status = 0, payload = null, headers = {};
  const res = {
    headersSent: false,
    writeHead(code, h) { status = code; headers = h ?? {}; this.headersSent = true; return this; },
    end() {},
  };
  const ctx = {
    send: (_r, code, body) => { status = code; payload = body; },
    readBody: async () => ({}),
    clientIp: () => `10.9.0.${Math.floor(Math.random() * 250)}`,
    clientByToken: (t) => db.clients.find((c) => c.token === t),
  };
  const path = token === null ? "/api/gbp/callback" : `/api/portal/${token}/gbp${rest.length ? "/" + rest.join("/") : ""}`;
  const handled = await handleGbp(req, res, new URL(`http://x${path}${query}`), path.split("/").filter(Boolean), ctx);
  return { handled, status, payload, headers };
}

test("the portal view says whether it is configured, and never contains a token", async () => {
  const c = client();
  const { state } = start(c);
  await finish(state);
  const r = await call(c.token);
  assert.equal(r.status, 200);
  assert.equal(r.payload.gbp.api.configured, true);
  assert.equal(r.payload.gbp.api.connected, true);
  const body = JSON.stringify(r.payload);
  assert.equal(body.includes("rt-1") || body.includes("at-"), false);
});

test("connect redirects to Google with an HttpOnly state cookie; unknown or pending businesses cannot start", async () => {
  const c = client();
  const r = await call(c.token, { rest: ["connect"] });
  assert.equal(r.status, 302);
  assert.match(r.headers.Location, /^http:\/\/127\.0\.0\.1:\d+\/authorize\?/);
  assert.match(r.headers["Set-Cookie"], /^gbp_oauth=[A-Za-z0-9_-]{40,}; Path=\/api\/gbp; HttpOnly; SameSite=Lax/);
  assert.equal((await call("nope", { rest: ["connect"] })).status, 404);
  const p = client({ approval: { status: "pending" } });
  assert.equal((await call(p.token, { rest: ["connect"] })).status, 403);
});

test("the callback rejects a missing or mismatched cookie and stores nothing", async () => {
  const c = client();
  const r = await call(c.token, { rest: ["connect"] });
  const state = new URL(r.headers.Location).searchParams.get("state");
  fake.challenge = new URL(r.headers.Location).searchParams.get("code_challenge");
  const noCookie = await call(null, { query: `?state=${state}&code=good-code` });
  assert.equal(noCookie.status, 400);
  const wrong = await call(null, { query: `?state=${state}&code=good-code`, cookie: "gbp_oauth=other" });
  assert.equal(wrong.status, 400);
  assert.equal(c.gbp?.auth?.enc ?? "", "");
});

test("the callback with the right cookie redirects to the portal, and 'cancel' goes back cleanly", async () => {
  const c = client();
  const r = await call(c.token, { rest: ["connect"] });
  const target = new URL(r.headers.Location);
  const state = target.searchParams.get("state");
  fake.challenge = target.searchParams.get("code_challenge");
  const ok = await call(null, { query: `?state=${state}&code=good-code`, cookie: `gbp_oauth=${state}` });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.Location, `/portal/${c.token}#/gbp`);
  assert.match(ok.headers["Set-Cookie"], /Max-Age=0/);
  assert.equal(auth.readTokens(c).accessToken !== "", true);

  const d = client();
  const r2 = await call(d.token, { rest: ["connect"] });
  const s2 = new URL(r2.headers.Location).searchParams.get("state");
  const cancel = await call(null, { query: `?error=access_denied&state=${s2}`, cookie: `gbp_oauth=${s2}` });
  assert.equal(cancel.status, 302);
  assert.equal(cancel.headers.Location, `/portal/${d.token}#/gbp`);
  assert.equal(d.gbp?.auth?.enc ?? "", "");
});
