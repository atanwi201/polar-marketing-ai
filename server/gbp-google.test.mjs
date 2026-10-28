// G6: the create/claim wizard and verification, against a fake of the five Google hosts plus a fake
// OAuth token endpoint. What matters here is the order of operations, not Google's behaviour:
// search first, never create over a claimed listing, reuse an unclaimed match, and render exactly the
// verification options Google returns.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "gbp-google-"));
process.env.DATA_DIR = join(root, "data");
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://studio.test/api/gbp/callback";
process.env.TOKEN_ENC_KEY = "k".repeat(48);
process.env.GBP_API_ENABLED = "true";

const fake = {
  accounts: [{ name: "accounts/1", accountName: "Casa Mar SL", type: "PERSONAL" }],
  locations: [{
    name: "locations/2",
    title: "Casa Mar",
    storefrontAddress: { addressLines: ["Calle del Mar 4"], locality: "Los Cristianos", postalCode: "38650", regionCode: "ES" },
    phoneNumbers: { primaryPhone: "+34600111222" },
    websiteUri: "https://casamar.test",
    metadata: { placeId: "place-2" },
  }],
  matches: [],
  options: [
    { verificationMethod: "ADDRESS", languageCode: "es" },
    { verificationMethod: "SMS", phoneNumber: "+34600111222", languageCode: "es" },
  ],
  voice: false,
  created: [],
  verifyBodies: [],
  completed: [],
  challenge: "",
  seen: [],
};

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const text = raw.toString("utf8");
  const body = text && req.headers["content-type"]?.includes("json") ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  const form = text && req.headers["content-type"]?.includes("form") ? new URLSearchParams(text) : null;
  const url = new URL(req.url, "http://fake");
  fake.seen.push({ method: req.method, url: req.url, body });
  const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  if (url.pathname === "/token") {
    if (form?.get("client_id") !== "test-client" || form?.get("client_secret") !== "test-secret") return json(401, { error: "invalid_client" });
    if (form?.get("grant_type") === "authorization_code") {
      if (form.get("code") !== "good-code") return json(400, { error: "invalid_grant" });
      const sent = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (sent !== fake.challenge) return json(400, { error: "invalid_grant" });
      return json(200, { access_token: "at-wizard", refresh_token: "rt-wizard", expires_in: 3600, scope: "https://www.googleapis.com/auth/business.manage", token_type: "Bearer" });
    }
    if (form?.get("grant_type") === "refresh_token") return json(200, { access_token: "at-wizard", expires_in: 3600 });
  }

  if (url.pathname === "/am/v1/accounts") return json(200, { accounts: fake.accounts });

  if (url.pathname === "/bi/v1/accounts/1/locations" && req.method === "GET") {
    return json(200, { locations: fake.locations });
  }
  if (url.pathname === "/bi/v1/accounts/1/locations" && req.method === "POST") {
    if (url.searchParams.get("validateOnly") !== "true") fake.created.push(body);
    return json(200, { name: "locations/3", ...(body ?? {}) });
  }

  if (url.pathname === "/bi/v1/googleLocations:search") return json(200, { googleLocations: fake.matches });

  if (url.pathname === "/bi/v1/categories") {
    return json(200, { categories: [
      { name: "categories/gcid:restaurant", displayName: "Restaurante", categoryType: "FOOD" },
      { name: "categories/gcid:bar", displayName: "Bar", categoryType: "FOOD" },
    ] });
  }

  const loc = "/verif/v1/locations/2";
  if (url.pathname === `${loc}:fetchVerificationOptions`) return json(200, { options: fake.options });
  if (url.pathname === `${loc}:getVoiceOfMerchantState`) return json(200, { hasVoiceOfMerchant: fake.voice, gainVoiceOfMerchant: { action: "verify" } });
  if (url.pathname === `${loc}:verify`) {
    fake.verifyBodies.push(body);
    return json(200, { name: "locations/2/verifications/v1", state: "PENDING" });
  }
  if (url.pathname === `${loc}/verifications/v1:complete`) {
    fake.completed.push(body);
    return json(200, {});
  }

  if (url.pathname === "/revoke") return json(200, {});
  json(404, { error: "not_found" });
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.GBP_AM_BASE = `${base}/am/v1`;
process.env.GBP_BI_BASE = `${base}/bi/v1`;
process.env.GBP_V4_BASE = `${base}/v4`;
process.env.GBP_VERIF_BASE = `${base}/verif/v1`;
process.env.GBP_PERF_BASE = `${base}/perf/v1`;
process.env.GBP_UPLOAD_BASE = `${base}/upload/v1`;
process.env.GBP_OAUTH_AUTH_URL = `${base}/authorize`;
process.env.GBP_OAUTH_TOKEN_URL = `${base}/token`;
process.env.GBP_OAUTH_REVOKE_URL = `${base}/revoke`;
after(() => server.close());

const { db } = await import("./store.mjs");
const auth = await import("./gbp-auth.mjs");
const gg = await import("./gbp-google.mjs");
const { handleGbp, limits } = await import("./gbp-routes.mjs");

let seq = 0;
async function linkedClient(extra = {}) {
  const c = { id: `g${++seq}`, name: `Casa ${seq}`, town: "Los Cristianos", phone: "600111222", websiteUrl: "https://casa.test", token: `tok-${seq}`, approval: { status: "approved" }, profile: { address: "Calle del Mar 4" }, ...extra };
  db.clients.push(c);
  const { url, state } = auth.connectUrl(c);
  fake.challenge = new URL(url).searchParams.get("code_challenge");
  await auth.finishConnect({ state, code: "good-code", cookieState: state });
  return c;
}

const reset = () => {
  fake.seen.length = 0;
  fake.matches = [];
  fake.created = [];
  fake.verifyBodies = [];
  fake.completed = [];
  fake.voice = false;
  fake.options = [
    { verificationMethod: "ADDRESS", languageCode: "es" },
    { verificationMethod: "SMS", phoneNumber: "+34600111222", languageCode: "es" },
  ];
  gg.resetCategories();
};

const form = (over = {}) => ({
  account: "accounts/1",
  title: "Casa Nueva",
  phone: "600111222",
  address: "Calle Nueva 8",
  town: "Los Cristianos",
  postcode: "38650",
  province: "Santa Cruz de Tenerife",
  category: "categories/gcid:restaurant",
  website: "https://casanueva.test",
  description: "Comida casera frente al mar.",
  ...over,
});

// --- picking an existing profile -----------------------------------------------------------------
test("accounts and locations are read from the connected profile, with a guard on malformed names", async () => {
  reset();
  const c = await linkedClient();
  const api = await gg.apiFor(c);
  assert.deepEqual(await gg.listAccounts(c, api), [{ name: "accounts/1", accountName: "Casa Mar SL", type: "PERSONAL" }]);
  const locations = await gg.listLocations(c, api, "accounts/1");
  assert.equal(locations[0].name, "locations/2");
  assert.equal(locations[0].address.includes("Los Cristianos"), true);
  await assert.rejects(gg.listLocations(c, api, "accounts/../../evil"), (e) => e.code === "bad_account");
});

test("linking a location stores only that profile, and refuses one outside the account", async () => {
  reset();
  const c = await linkedClient();
  const api = await gg.apiFor(c);
  await assert.rejects(gg.linkLocation(c, api, { account: "accounts/1", location: "locations/999" }), (e) => e.status === 404);
  await gg.linkLocation(c, api, { account: "accounts/1", location: "locations/2" });
  assert.equal(c.gbp.google.location, "locations/2");
  assert.equal(c.gbp.google.title, "Casa Mar");
  assert.equal(c.gbp.google.status, "linked");
  assert.equal(c.gbp.mode, "api", "a linked profile still keeps the token connection");
  assert.equal(c.gbp.status, "created", "the manual tracker follows the API profile");
});

// --- duplicate search / claim --------------------------------------------------------------------
test("lookup distinguishes a claimed listing (claim URL) from an unclaimed one", async () => {
  reset();
  const c = await linkedClient();
  const api = await gg.apiFor(c);
  fake.matches = [
    { name: "googleLocations/g1", location: { title: "Casa Nueva", storefrontAddress: { addressLines: ["Calle Nueva 8"], locality: "Los Cristianos" } }, requestAdminRightsUri: "https://business.google.com/claim/g1" },
    { name: "googleLocations/g2", location: { title: "Casa Nueva 2", storefrontAddress: { addressLines: ["Calle Otra 1"], locality: "Adeje" } } },
  ];
  const out = await gg.lookup(c, api, form());
  assert.equal(out.length, 2);
  assert.equal(out[0].claimed, true);
  assert.equal(out[0].claimUrl, "https://business.google.com/claim/g1");
  assert.equal(out[1].claimed, false);
  assert.equal(out[1].claimUrl, "");
  const sent = fake.seen.find((r) => r.url.startsWith("/bi/v1/googleLocations:search"));
  assert.equal(sent.body.location.title, "Casa Nueva", "the object form is more accurate than a string");
});

test("create refuses with 409 and the candidates while a claimed listing matches, and creates nothing", async () => {
  reset();
  const c = await linkedClient();
  const api = await gg.apiFor(c);
  fake.matches = [{ name: "googleLocations/g1", location: { title: "Casa Nueva" }, requestAdminRightsUri: "https://business.google.com/claim/g1" }];
  await assert.rejects(gg.create(c, api, form()), (e) => {
    assert.equal(e.status, 409);
    assert.equal(e.code, "exists");
    assert.equal(e.candidates.length, 1);
    assert.equal(e.candidates[0].claimed, true);
    return true;
  });
  assert.equal(fake.created.length, 0, "no create call was made");
  assert.equal(c.gbp.google?.location ?? "", "", "nothing was stored");
});

test("create reuses an unclaimed match so the profile keeps its place id", async () => {
  reset();
  const c = await linkedClient();
  const api = await gg.apiFor(c);
  fake.matches = [{
    name: "googleLocations/g2",
    location: { title: "Casa Nueva", storefrontAddress: { addressLines: ["Calle Nueva 8"], locality: "Los Cristianos" }, metadata: { placeId: "place-8" } },
  }];
  const out = await gg.create(c, api, form(), { requestId: "fixed-request-1" });
  assert.equal(fake.created.length, 1);
  const body = fake.created[0];
  assert.equal(body.title, "Casa Nueva");
  assert.equal(body.metadata.placeId, "place-8", "the matched listing's identity survives");
  assert.equal(body.name, undefined, "a resource name is not a create field");
  assert.equal(body.phoneNumbers.primaryPhone, "+34600111222");
  assert.equal(body.categories.primaryCategory.name, "categories/gcid:restaurant");
  const sent = fake.seen.find((r) => r.url.startsWith("/bi/v1/accounts/1/locations") && r.method === "POST");
  assert.equal(new URL(sent.url, "http://x").searchParams.get("validateOnly"), "false");
  assert.equal(new URL(sent.url, "http://x").searchParams.get("requestId"), "fixed-request-1");
  assert.equal(out.google.location, "locations/3");
  assert.equal(c.gbp.google.status, "linked");
});

// --- form validation and the dry run -------------------------------------------------------------
test("buildLocation validates before any network call, and the preview uses validateOnly", async () => {
  reset();
  const c = await linkedClient();
  const api = await gg.apiFor(c);
  for (const [patch, code] of [[{ title: "" }, "bad_title"], [{ phone: "abc" }, "bad_phone"], [{ address: "" }, "bad_address"], [{ category: "restaurante" }, "bad_category"], [{ website: "casanueva.test" }, "bad_website"]]) {
    await assert.rejects(gg.preview(c, api, form(patch)), (e) => e.code === code, code);
  }
  assert.equal(fake.seen.filter((r) => r.method === "POST" && r.url.startsWith("/bi/")).length, 0, "nothing reached Google");
  const dry = await gg.preview(c, api, form());
  assert.equal(dry.ok, true);
  assert.equal(dry.location.storefrontAddress.regionCode, "ES");
  const sent = fake.seen.find((r) => r.url.startsWith("/bi/v1/accounts/1/locations") && r.method === "POST");
  assert.equal(new URL(sent.url, "http://x").searchParams.get("validateOnly"), "true");
  assert.equal(fake.created.length, 0);
});

test("categories come back as IDs the create call can use, and a query filters them", async () => {
  reset();
  const c = await linkedClient();
  const api = await gg.apiFor(c);
  const all = await gg.categories(c, api, { lang: "es" });
  assert.deepEqual(all.map((x) => x.name), ["categories/gcid:restaurant", "categories/gcid:bar"]);
  const one = await gg.categories(c, api, { q: "bar", lang: "es" });
  assert.deepEqual(one.map((x) => x.displayName), ["Bar"]);
  const before = fake.seen.filter((r) => r.url.startsWith("/bi/v1/categories")).length;
  await gg.categories(c, api, { q: "rest", lang: "es" });
  assert.equal(fake.seen.filter((r) => r.url.startsWith("/bi/v1/categories")).length, before, "the second read is cached");
});

// --- verification --------------------------------------------------------------------------------
test("verification options are whatever Google returns, never a fixed set", async () => {
  reset();
  const c = await linkedClient();
  const api = await gg.apiFor(c);
  await gg.linkLocation(c, api, { account: "accounts/1", location: "locations/2" });
  const v = await gg.verificationOptions(c, api);
  assert.deepEqual(v.options.map((o) => o.method), ["ADDRESS", "SMS"]);
  assert.equal(v.options[1].phoneNumber, "+34600111222");

  reset();
  fake.options = [{ verificationMethod: "EMAIL", emailAddress: "owner@casa.test" }];
  const only = await gg.verificationOptions(c, api);
  assert.deepEqual(only.options.map((o) => o.method), ["EMAIL"], "a region that only offers email still works");
});

test("starting and completing a verification keeps the status honest", async () => {
  reset();
  const c = await linkedClient();
  const api = await gg.apiFor(c);
  await gg.linkLocation(c, api, { account: "accounts/1", location: "locations/2" });

  await assert.rejects(gg.startVerification(c, api, { method: "FAX" }), (e) => e.code === "bad_method");
  await gg.startVerification(c, api, { method: "SMS", phoneNumber: "600111222" });
  assert.equal(c.gbp.google.status, "verification_pending");
  assert.equal(c.gbp.status, "verification_pending");
  assert.equal(c.gbp.google.verification.name, "locations/2/verifications/v1");
  assert.equal(fake.verifyBodies[0].method, "SMS");
  assert.equal(fake.verifyBodies[0].phoneNumber, "+34600111222");

  await assert.rejects(gg.completeVerification(c, api, { pin: "12" }), (e) => e.code === "bad_pin");
  assert.equal(fake.completed.length, 0);

  fake.voice = true;
  await gg.completeVerification(c, api, { pin: "123456" });
  assert.equal(fake.completed[0].pin, "123456");
  assert.equal(c.gbp.google.status, "verified");
  assert.equal(c.gbp.status, "verified", "G3's tracker is not a second truth");
  assert.equal(c.gbp.google.verification.state, "completed");
});

test("a verification done in Google's own UI is picked up by refresh", async () => {
  reset();
  const c = await linkedClient();
  const api = await gg.apiFor(c);
  await gg.linkLocation(c, api, { account: "accounts/1", location: "locations/2" });
  assert.equal(c.gbp.google.status, "linked");
  fake.voice = true;
  await gg.refreshVerification(c, api);
  assert.equal(c.gbp.google.status, "verified");
  assert.equal(c.gbp.status, "verified");
});

test("the flag and the connection are gates, checked before any Google call", async () => {
  reset();
  const c = await linkedClient();
  const off = process.env.GBP_API_ENABLED;
  delete process.env.GBP_API_ENABLED;
  try {
    assert.throws(() => gg.requireApi(c), (e) => e.status === 403 && e.code === "disabled");
    assert.equal(gg.googleView(c).enabled, false);
  } finally { process.env.GBP_API_ENABLED = off; }

  const plain = { id: "plain", token: "tok-plain", approval: { status: "approved" } };
  db.clients.push(plain);
  assert.throws(() => gg.requireApi(plain), (e) => e.status === 409 && e.code === "not_connected");
});

// --- the HTTP surface ----------------------------------------------------------------------------
async function call(c, { method = "GET", rest = [], body, lang, ip } = {}) {
  const req = { method, headers: lang ? { "x-lang": lang } : {} };
  const res = { headersSent: false, end() {} };
  let status = 0, payload = null;
  const ctx = {
    send: (_r, code, b) => { status = code; payload = b; },
    readBody: async () => body ?? {},
    clientIp: () => ip ?? `10.7.0.${Math.floor(Math.random() * 250)}`,
    clientByToken: (t) => db.clients.find((x) => x.token === t),
  };
  const seg = ["api", "portal", c.token, "gbp", ...rest];
  const handled = await handleGbp(req, res, new URL(`http://x/api/portal/${c.token}/gbp`), seg, ctx);
  return { handled, status, payload };
}

test("the portal view carries the wizard state and no token", async () => {
  reset();
  const c = await linkedClient();
  const r = await call(c);
  assert.equal(r.status, 200);
  assert.equal(r.payload.gbp.google.enabled, true);
  assert.equal(r.payload.gbp.google.connected, true);
  assert.equal(r.payload.gbp.google.status, "not_linked");
  assert.equal(r.payload.gbp.google.defaults.title, c.name);
  const dump = JSON.stringify(r.payload);
  assert.equal(dump.includes("at-wizard") || dump.includes("rt-wizard"), false);
});

test("with the API flag off, every wizard route answers 403 disabled and calls nothing", async () => {
  reset();
  const c = await linkedClient();
  const before = fake.seen.length;
  const off = process.env.GBP_API_ENABLED;
  delete process.env.GBP_API_ENABLED;
  try {
    for (const [method, rest] of [["GET", ["google", "accounts"]], ["POST", ["google", "lookup"]], ["POST", ["google", "create"]], ["GET", ["google", "verification"]]]) {
      const r = await call(c, { method, rest, body: form() });
      assert.equal(r.status, 403, `${method} ${rest.join("/")}`);
      assert.equal(r.payload.code, "disabled");
    }
    assert.equal(fake.seen.length, before, "no Google request left the server");
  } finally { process.env.GBP_API_ENABLED = off; }
});

test("the wizard routes answer accounts, lookup, a 409 with candidates, and a dry run", async () => {
  reset();
  const c = await linkedClient();
  const accounts = await call(c, { rest: ["google", "accounts"] });
  assert.equal(accounts.status, 200);
  assert.equal(accounts.payload.accounts[0].name, "accounts/1");

  const locations = await call(c, { rest: ["google", "locations"], body: undefined });
  // account comes from the query string, so a missing one is a clear 400.
  assert.equal(locations.status, 400);
  assert.equal(locations.payload.code, "bad_account");

  fake.matches = [{ name: "googleLocations/g1", location: { title: "Casa Nueva" }, requestAdminRightsUri: "https://business.google.com/claim/g1" }];
  const lookup = await call(c, { method: "POST", rest: ["google", "lookup"], body: form(), lang: "es" });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.payload.candidates[0].claimed, true);

  const refused = await call(c, { method: "POST", rest: ["google", "create"], body: form(), lang: "es" });
  assert.equal(refused.status, 409);
  assert.equal(refused.payload.code, "exists");
  assert.match(refused.payload.error, /Reclama/i);
  assert.equal(refused.payload.candidates.length, 1);
  assert.equal(fake.created.length, 0);

  fake.matches = [];
  const dry = await call(c, { method: "POST", rest: ["google", "preview"], body: form() });
  assert.equal(dry.status, 200);
  assert.equal(dry.payload.ok, true);
});

test("the wizard can link, start and complete a verification over HTTP, and the view follows", async () => {
  reset();
  const c = await linkedClient();
  const link = await call(c, { method: "POST", rest: ["google", "link"], body: { account: "accounts/1", location: "locations/2" } });
  assert.equal(link.status, 200);
  assert.equal(link.payload.google.location, "locations/2");

  const options = await call(c, { rest: ["google", "verification"] });
  assert.equal(options.status, 200);
  assert.deepEqual(options.payload.verification.options.map((o) => o.method), ["ADDRESS", "SMS"]);

  const start = await call(c, { method: "POST", rest: ["google", "verification"], body: { method: "SMS", phoneNumber: "600111222" } });
  assert.equal(start.status, 200);
  assert.equal(start.payload.google.status, "verification_pending");
  assert.equal(start.payload.google.verification.method, "SMS");

  fake.voice = true;
  const done = await call(c, { method: "POST", rest: ["google", "verification", "complete"], body: { pin: "123456" } });
  assert.equal(done.status, 200);
  assert.equal(done.payload.google.status, "verified");

  const refresh = await call(c, { method: "POST", rest: ["google", "refresh"] });
  assert.equal(refresh.status, 200);
  assert.equal(refresh.payload.google.status, "verified");
  assert.equal(db.clients.find((x) => x.id === c.id).gbp.google.status, "verified", "persisted");
});

test("pending businesses cannot use the wizard even with a token", async () => {
  reset();
  const p = { id: "pending-1", name: "Pendiente", token: "tok-pending", approval: { status: "pending" } };
  db.clients.push(p);
  const r = await call(p, { rest: ["google", "accounts"] });
  assert.equal(r.status, 403);
  assert.equal(fake.seen.some((x) => x.url.startsWith("/am/")), false);
});
