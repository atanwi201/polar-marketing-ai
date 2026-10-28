// G7: the info/hours manager and the photo uploader, against a fake of the Business Information API and
// the v4 media endpoints. The important assertions are about *what is not sent*: a one-field edit must
// produce a one-field update mask, and a photo that Google would reject must never leave the server.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "gbp-info-"));
process.env.DATA_DIR = join(root, "data");
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://studio.test/api/gbp/callback";
process.env.TOKEN_ENC_KEY = "k".repeat(48);
process.env.GBP_API_ENABLED = "true";
mkdirSync(join(root, "data", "media"), { recursive: true });

const seed = () => ({
  name: "locations/2",
  title: "Casa Mar",
  phoneNumbers: { primaryPhone: "+34600111222" },
  storefrontAddress: {
    regionCode: "ES", languageCode: "es", addressLines: ["Calle del Mar 4"],
    locality: "Los Cristianos", postalCode: "38650", administrativeArea: "Santa Cruz de Tenerife",
  },
  websiteUri: "https://casamar.test/",
  categories: { primaryCategory: { name: "categories/gcid:restaurant", displayName: "Restaurante" } },
  profile: { description: "Comida casera frente al mar." },
  regularHours: { periods: [{ openDay: "MONDAY", openTime: "09:00", closeDay: "MONDAY", closeTime: "17:00" }] },
  metadata: { placeId: "p2" },
});

const fake = {
  loc: seed(),
  patches: [],
  uploads: [],
  media: [],
  challenge: "",
  seen: [],
};

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const text = raw.toString("utf8");
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
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
      return json(200, { access_token: "at-info", refresh_token: "rt-info", expires_in: 3600, scope: "https://www.googleapis.com/auth/business.manage", token_type: "Bearer" });
    }
    if (form?.get("grant_type") === "refresh_token") return json(200, { access_token: "at-info", expires_in: 3600 });
  }

  if (url.pathname === "/bi/v1/accounts/1/locations" && req.method === "GET") return json(200, { locations: [fake.loc] });
  if (url.pathname === "/bi/v1/locations/2" && req.method === "GET") return json(200, fake.loc);
  if (url.pathname === "/bi/v1/locations/2" && req.method === "PATCH") {
    fake.patches.push({ body, updateMask: url.searchParams.get("updateMask") ?? "" });
    fake.loc = { ...fake.loc, ...(body ?? {}) };
    return json(200, fake.loc);
  }

  if (url.pathname === "/v4/accounts/1/locations/2/media" && req.method === "GET") return json(200, { mediaItems: fake.media });
  if (url.pathname === "/v4/accounts/1/locations/2/media" && req.method === "POST") {
    fake.uploads.push({ step: "create", body });
    return json(200, {
      name: "accounts/1/locations/2/media/m2",
      locationAssociation: { category: body?.locationAssociation?.category ?? "" },
      googleUrl: "https://lh3.googleusercontent.com/m2",
    });
  }
  if (url.pathname === "/v4/media:startUpload") {
    fake.uploads.push({ step: "start", body });
    return json(200, { resourceName: "media/ref1" });
  }
  if (url.pathname === "/upload/v1/media/ref1") {
    fake.uploads.push({ step: "bytes", contentType: req.headers["content-type"], length: raw.length });
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

const { db, MEDIA_DIR } = await import("./store.mjs");
const auth = await import("./gbp-auth.mjs");
const gg = await import("./gbp-google.mjs");
const info = await import("./gbp-info.mjs");
const { handleGbp } = await import("./gbp-routes.mjs");

let seq = 0;
async function linkedClient() {
  const c = {
    id: `i${++seq}`, name: "Casa Mar", token: `tok-i${seq}`, phone: "600111222",
    approval: { status: "approved" }, photos: [], profile: { address: "Calle del Mar 4" },
  };
  db.clients.push(c);
  const { url, state } = auth.connectUrl(c);
  fake.challenge = new URL(url).searchParams.get("code_pkce") ?? new URL(url).searchParams.get("code_challenge");
  await auth.finishConnect({ state, code: "good-code", cookieState: state });
  const api = await gg.apiFor(c);
  await gg.linkLocation(c, api, { account: "accounts/1", location: "locations/2" });
  return { c, api };
}

const reset = () => {
  fake.loc = seed();
  fake.patches = [];
  fake.uploads = [];
  fake.media = [];
  fake.seen = [];
  gg.resetCategories();
};

const formFrom = (over = {}) => {
  const p = info.profileFromLocation(fake.loc);
  return {
    title: p.title, phone: p.phone, website: p.website, description: p.description,
    category: p.category, categoryName: p.categoryName, address: p.address, town: p.town,
    postcode: p.postcode, province: p.province, hours: p.hours, ...over,
  };
};

// --- hours ---------------------------------------------------------------------------------------
test("hours round-trip, including a close after midnight", () => {
  const periods = info.periodsFromHours({
    MONDAY: { open: "09:00", close: "17:00" },
    SATURDAY: { open: "20:00", close: "02:00" },
    SUNDAY: null,
  });
  assert.deepEqual(periods[0], { openDay: "MONDAY", openTime: "09:00", closeDay: "MONDAY", closeTime: "17:00" });
  assert.deepEqual(periods[1], { openDay: "SATURDAY", openTime: "20:00", closeDay: "SUNDAY", closeTime: "02:00" });
  const back = info.hoursFromPeriods(periods);
  assert.deepEqual(back.MONDAY, { open: "09:00", close: "17:00" });
  assert.deepEqual(back.SATURDAY, { open: "20:00", close: "02:00" });
  assert.equal(back.SUNDAY, null, "a period that starts on Saturday does not open Sunday");
  assert.equal(info.periodsFromHours({ MONDAY: { open: "9:00", close: "17:00" } }).length, 0, "a malformed time is dropped");
});

// --- reading -------------------------------------------------------------------------------------
test("a profile is read from Google, not from our cache", async () => {
  reset();
  const { c, api } = await linkedClient();
  c.gbp.google.title = "Stale title";
  const p = await info.readProfile(c, api);
  assert.equal(p.title, "Casa Mar");
  assert.equal(p.phone, "+34600111222");
  assert.equal(p.categoryName, "Restaurante");
  assert.equal(p.address, "Calle del Mar 4");
  assert.equal(p.postcode, "38650");
  assert.deepEqual(p.hours.MONDAY, { open: "09:00", close: "17:00" });
  assert.equal(p.hours.TUESDAY, null);
});

// --- the diff ------------------------------------------------------------------------------------
test("one changed field means one update-mask field, and the preview writes nothing", async () => {
  reset();
  const { c, api } = await linkedClient();
  const form = formFrom({ description: "Cocina de mercado, todos los días." });
  const plan = await info.saveProfile(c, api, form);
  assert.equal(plan.applied, false);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].field, "profile.description");
  assert.equal(plan.updateMask, "profile.description");
  assert.deepEqual(Object.keys(plan.body), ["profile"]);
  assert.equal(fake.patches.length, 0, "preview never patches");
});

test("applying sends only the changed field and updates the local cache", async () => {
  reset();
  const { c, api } = await linkedClient();
  const form = formFrom({ phone: "600 111 223" });
  const out = await info.saveProfile(c, api, form, { apply: true });
  assert.equal(out.applied, true);
  assert.equal(fake.patches.length, 1);
  assert.equal(fake.patches[0].updateMask, "phoneNumbers.primaryPhone");
  assert.deepEqual(Object.keys(fake.patches[0].body), ["phoneNumbers"]);
  assert.equal(fake.patches[0].body.phoneNumbers.primaryPhone, "+34600111223");
  assert.equal(fake.loc.phoneNumbers.primaryPhone, "+34600111223");
  assert.equal(c.gbp.google.phone, "+34600111223", "the portal's copy follows Google");
});

test("formatting differences are not changes: a phone typed locally and a trailing slash", async () => {
  reset();
  const { c, api } = await linkedClient();
  const plan = await info.saveProfile(c, api, formFrom({ phone: "600111222", website: "https://casamar.test" }));
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.updateMask, "");
  assert.equal(fake.patches.length, 0);
});

test("address and hours are one mask each, with a per-line change list", async () => {
  reset();
  const { c, api } = await linkedClient();
  const form = formFrom({
    town: "Adeje",
    hours: {
      MONDAY: { open: "10:00", close: "18:00" },
      TUESDAY: { open: "10:00", close: "18:00" },
      WEDNESDAY: null, THURSDAY: null, FRIDAY: null, SATURDAY: null, SUNDAY: null,
    },
  });
  const out = await info.saveProfile(c, api, form, { apply: true });
  const fields = out.changes.map((x) => x.field);
  assert.deepEqual(fields, ["storefrontAddress.locality", "regularHours.periods.MONDAY", "regularHours.periods.TUESDAY"]);
  assert.equal(fake.patches[0].updateMask, "storefrontAddress,regularHours.periods");
  assert.deepEqual(Object.keys(fake.patches[0].body).sort(), ["regularHours", "storefrontAddress"]);
  assert.equal(fake.patches[0].body.storefrontAddress.locality, "Adeje");
  assert.deepEqual(fake.patches[0].body.regularHours.periods.map((p) => p.openDay), ["MONDAY", "TUESDAY"]);
});

test("a category change is a category-only patch", async () => {
  reset();
  const { c, api } = await linkedClient();
  const out = await info.saveProfile(c, api, formFrom({ category: "categories/gcid:bar", categoryName: "Bar" }), { apply: true });
  assert.equal(out.changes[0].from, "Restaurante");
  assert.equal(out.changes[0].to, "Bar");
  assert.equal(fake.patches[0].updateMask, "categories.primaryCategory.name");
  assert.deepEqual(fake.patches[0].body, { categories: { primaryCategory: { name: "categories/gcid:bar" } } });
});

test("an invalid form is rejected before any Google call", async () => {
  reset();
  const { c, api } = await linkedClient();
  await assert.rejects(info.saveProfile(c, api, formFrom({ hours: { MONDAY: { open: "9:00", close: "17:00" } } }), { apply: true }), (e) => e.code === "bad_hours");
  await assert.rejects(info.saveProfile(c, api, formFrom({ phone: "abc" }), { apply: true }), (e) => e.code === "bad_phone");
  assert.equal(fake.patches.length, 0);
});

// --- photos --------------------------------------------------------------------------------------
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function photoClient(files) {
  const c = { id: "pc1", photos: files.map((file) => ({ file })) };
  for (const [file, buffer] of Object.entries(fakeFiles)) writeFileSync(join(MEDIA_DIR, file), buffer);
  return c;
}
const fakeFiles = {};

test("a photo must be one of the client's own, inside the media dir, and really a JPEG or PNG", async () => {
  fakeFiles["own.jpg"] = jpeg;
  fakeFiles["own.png"] = png;
  fakeFiles["bad.jpg"] = Buffer.from("not an image");
  fakeFiles["huge.jpg"] = Buffer.alloc(info.PHOTO_MAX_BYTES + 1, 1);
  const c = photoClient(["own.jpg", "own.png", "bad.jpg", "huge.jpg"]);

  const ok = await info.readPhoto(c, "own.jpg");
  assert.equal(ok.contentType, "image/jpeg");
  assert.equal(ok.buffer.length, jpeg.length);
  assert.equal((await info.readPhoto(c, "own.png")).contentType, "image/png");

  await assert.rejects(info.readPhoto(c, "../own.jpg"), (e) => e.code === "bad_photo");
  await assert.rejects(info.readPhoto(c, "someone-else.jpg"), (e) => e.code === "bad_photo");
  await assert.rejects(info.readPhoto(c, "bad.jpg"), (e) => e.code === "bad_photo");
  await assert.rejects(info.readPhoto(c, "huge.jpg"), (e) => e.code === "too_large");
});

test("photos already on the profile are listed with the URL the owner sees", async () => {
  reset();
  const { c, api } = await linkedClient();
  fake.media = [{
    name: "accounts/1/locations/2/media/m1", locationAssociation: { category: "EXTERIOR" },
    googleUrl: "https://lh3.googleusercontent.com/m1", thumbnailUrl: "https://lh3.googleusercontent.com/t1",
  }];
  const list = await info.listPhotos(c, api);
  assert.equal(list.length, 1);
  assert.equal(list[0].category, "EXTERIOR");
  assert.equal(list[0].googleUrl, "https://lh3.googleusercontent.com/m1");
});

test("uploading checks the category, then uploads the bytes in the documented three steps", async () => {
  reset();
  const { c, api } = await linkedClient();
  fakeFiles["shop.jpg"] = jpeg;
  writeFileSync(join(MEDIA_DIR, "shop.jpg"), jpeg);
  c.photos = [{ file: "shop.jpg" }];
  await assert.rejects(info.uploadPhoto(c, api, { file: "shop.jpg", category: "SELFIE" }), (e) => e.code === "bad_category");
  assert.equal(fake.uploads.length, 0);

  const media = await info.uploadPhoto(c, api, { file: "shop.jpg", category: "EXTERIOR" });
  assert.deepEqual(fake.uploads.map((u) => u.step), ["start", "bytes", "create"]);
  assert.equal(fake.uploads[0].body.fileName, "shop.jpg");
  assert.equal(fake.uploads[1].contentType, "image/jpeg");
  assert.equal(fake.uploads[1].length, jpeg.length);
  assert.deepEqual(fake.uploads[2].body.locationAssociation, { category: "EXTERIOR" });
  assert.deepEqual(fake.uploads[2].body.dataRef, { resourceName: "media/ref1" }, "create references the upload the documented way");
  assert.equal(media.name, "accounts/1/locations/2/media/m2");
  assert.equal(media.googleUrl, "https://lh3.googleusercontent.com/m2");
});

// --- HTTP ----------------------------------------------------------------------------------------
async function call(c, { method = "GET", rest = [], body, lang } = {}) {
  const req = { method, headers: lang ? { "x-lang": lang } : {} };
  const res = { headersSent: false, end() {} };
  let status = 0, payload = null;
  const ctx = {
    send: (_r, code, b) => { status = code; payload = b; },
    readBody: async () => body ?? {},
    clientIp: () => `10.8.0.${Math.floor(Math.random() * 250)}`,
    clientByToken: (t) => db.clients.find((x) => x.token === t),
  };
  const seg = ["api", "portal", c.token, "gbp", ...rest];
  const handled = await handleGbp(req, res, new URL(`http://x/api/portal/${c.token}/gbp`), seg, ctx);
  return { handled, status, payload };
}

test("the manager's routes read, preview, apply and upload without leaking tokens", async () => {
  reset();
  const { c } = await linkedClient();
  const own = `route-${c.id}.jpg`;
  writeFileSync(join(MEDIA_DIR, own), jpeg);
  c.photos = [{ file: own }];

  const read = await call(c, { rest: ["google", "info"] });
  assert.equal(read.status, 200);
  assert.equal(read.payload.profile.title, "Casa Mar");
  assert.deepEqual(read.payload.ownPhotos, [own]);

  const preview = await call(c, { method: "POST", rest: ["google", "info", "preview"], body: { ...formFrom(), description: "Nueva descripción." } });
  assert.equal(preview.status, 200);
  assert.equal(preview.payload.changes.length, 1);
  assert.equal(fake.patches.length, 0);

  const saved = await call(c, { method: "POST", rest: ["google", "info"], body: { ...formFrom(), description: "Nueva descripción." } });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.applied, true);
  assert.equal(fake.patches[0].updateMask, "profile.description");

  const bad = await call(c, { method: "POST", rest: ["google", "photos"], body: { file: "../evil.jpg", category: "EXTERIOR" }, lang: "es" });
  assert.equal(bad.status, 400);
  assert.equal(bad.payload.code, "bad_photo");

  const up = await call(c, { method: "POST", rest: ["google", "photos"], body: { file: own, category: "EXTERIOR" } });
  assert.equal(up.status, 200);
  assert.equal(up.payload.photo.name, "accounts/1/locations/2/media/m2");
  assert.equal(JSON.stringify(up.payload).includes("at-info"), false, "no token in any response");
});
