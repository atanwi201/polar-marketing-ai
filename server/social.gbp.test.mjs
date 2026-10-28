// G8: Google local posts. The two things that matter here are policy and plumbing: a phone number never
// reaches Google's text field, and a caption that was only a phone number is refused (rather than sent as
// an empty or half-stripped post). The result has to land in `publishNote` like every other platform.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "social-gbp-"));
process.env.DATA_DIR = join(root, "data");
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://studio.test/api/gbp/callback";
process.env.TOKEN_ENC_KEY = "k".repeat(48);
process.env.GBP_API_ENABLED = "true";
delete process.env.PUBLIC_URL;

const fake = { posts: [], challenge: "", failPosts: 0 };

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  const form = text && req.headers["content-type"]?.includes("form") ? new URLSearchParams(text) : null;
  const url = new URL(req.url, "http://fake");
  const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  if (url.pathname === "/token") {
    if (form?.get("grant_type") === "authorization_code") {
      const sent = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (form.get("code") !== "good-code" || sent !== fake.challenge) return json(400, { error: "invalid_grant" });
      return json(200, { access_token: "at-social", refresh_token: "rt-social", expires_in: 3600, scope: "https://www.googleapis.com/auth/business.manage", token_type: "Bearer" });
    }
    if (form?.get("grant_type") === "refresh_token") return json(200, { access_token: "at-social", expires_in: 3600 });
  }

  if (url.pathname === "/bi/v1/accounts/1/locations" && req.method === "GET") {
    return json(200, { locations: [{ name: "locations/2", title: "Casa Mar", phoneNumbers: { primaryPhone: "+34600111222" } }] });
  }
  if (url.pathname === "/v4/accounts/1/locations/2/localPosts" && req.method === "POST") {
    if (fake.failPosts) return json(400, { error: { message: "badSummary" } });
    fake.posts.push(body);
    return json(200, { name: `accounts/1/locations/2/localPosts/${fake.posts.length}`, searchUrl: "https://maps.google.com/?cid=9" });
  }
  if (url.pathname === "/am/v1/accounts" && req.method === "GET") return json(200, { accounts: [{ name: "accounts/1", accountName: "Casa Mar" }] });
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
const social = await import("./social.mjs");
const { publish } = await import("./studio.mjs");

let seq = 0;
/** A client with a real (encrypted) token and a linked location, as the portal would leave it. */
async function linkedClient(over = {}) {
  const c = {
    id: `s${++seq}`, name: "Casa Mar", token: `tok-s${seq}`, phone: "600111222", town: "Los Cristianos",
    approval: { status: "approved" }, languages: ["es", "en"], platforms: ["google"],
    captions: undefined, profile: {}, websiteUrl: "https://casamar.test/", ...over,
  };
  db.clients.push(c);
  const { url, state } = auth.connectUrl(c);
  fake.challenge = new URL(url).searchParams.get("code_challenge");
  await auth.finishConnect({ state, code: "good-code", cookieState: state });
  const api = await gg.apiFor(c);
  await gg.linkLocation(c, api, { account: "accounts/1", location: "locations/2" });
  return { c, api };
}

const item = (over = {}) => ({
  id: "p1",
  captions: { es: "Hoy: pescado fresco del día, a la plancha.", en: "Today: fresh fish off the grill." },
  hashtags: ["LosCristianos", "Tenerife"],
  imageFile: "post-1.jpg",
  ...over,
});

// --- the sanitiser -------------------------------------------------------------------------------
test("a phone number is removed from a local post, and the rest of the caption survives", () => {
  const out = social.sanitiseGbpPost("Reserva en el 600 111 222.\n\nPescado fresco cada día.");
  assert.equal(out.removed, 1);
  assert.equal(out.text.includes("600"), false);
  assert.match(out.text, /Pescado fresco cada día\./);
  assert.match(out.text, /^Reserva en el/);

  const intl = social.sanitiseGbpPost("Llámanos al +34 600 111 222");
  assert.equal(intl.text.includes("600"), false);

  // Not phone numbers: a price, a year, a postcode.
  const keep = social.sanitiseGbpPost("Menú 12,50 € · desde 2026 · 38650");
  assert.equal(keep.removed, 0);
  assert.equal(keep.text, "Menú 12,50 € · desde 2026 · 38650");
});

test("a caption that is only a phone number is refused instead of posted empty", () => {
  assert.throws(() => social.sanitiseGbpPost("600 111 222"), /phone numbers/);
  assert.throws(() => social.sanitiseGbpPost("+34 600 111 222"), /phone numbers/);
  assert.throws(() => social.sanitiseGbpPost("   "), /phone numbers/);
});

test("Google's 1500-character limit is enforced, and a 9-digit-only number is the shortest one stripped", () => {
  const long = social.sanitiseGbpPost("a".repeat(2000));
  assert.equal(long.text.length, social.GBP_SUMMARY_MAX);
  const short = social.sanitiseGbpPost("Mesa para 8 personas, no 12345678.");
  assert.equal(short.removed, 0, "8 digits is a table size, not a phone");
  assert.equal(social.sanitiseGbpPost("Mesa para 8 personas, no 123456789.").removed, 1);
});

// --- connection gating ---------------------------------------------------------------------------
test("Google is not ready until the API is approved, the profile is linked and the owner has connected", () => {
  const fresh = { id: "x1" };
  const off = { ...process.env.GBP_API_ENABLED };
  const enabled = process.env.GBP_API_ENABLED;
  delete process.env.GBP_API_ENABLED;
  assert.equal(social.connections(fresh).google.ready, false);
  assert.match(social.connections(fresh).google.missing, /not approved/);
  process.env.GBP_API_ENABLED = enabled;

  assert.match(social.connections(fresh).google.missing, /portal/);
  gg.ensureGoogle(fresh).location = "locations/2";
  assert.match(social.connections(fresh).google.missing, /Connect the Google profile/);
  assert.equal(off !== undefined && enabled !== undefined, true);
});

// --- publishing ----------------------------------------------------------------------------------
test("a local post goes to Google with no photo when PUBLIC_URL is not public, and with a CTA", async () => {
  fake.posts = [];
  const { c } = await linkedClient();
  const res = await social.shareItem(c, item(), "google", { kind: "post", lang: "es" });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.url, "https://maps.google.com/?cid=9");
  assert.equal(fake.posts.length, 1);
  const body = fake.posts[0];
  assert.equal(body.topicType, "STANDARD");
  assert.equal(body.languageCode, "es");
  assert.match(body.summary, /pescado fresco/i);
  assert.equal(body.summary.includes("#LosCristianos"), true);
  assert.equal(body.media, undefined, "no public URL means no photo, not a broken link");
  assert.deepEqual(body.callToAction, { actionType: "LEARN_MORE", url: "https://casamar.test/" });
  assert.match(res.note, /photo skipped/, "the owner is told why their photo is not there");
  assert.equal(c.posts, undefined);
});

test("with a public URL the post carries the client's own photo", async () => {
  fake.posts = [];
  process.env.PUBLIC_URL = "https://studio.test";
  try {
    const { c } = await linkedClient();
    const res = await social.shareItem(c, item(), "google", { kind: "post", lang: "en" });
    assert.equal(res.ok, true, res.error);
    assert.equal(fake.posts[0].languageCode, "en");
    assert.deepEqual(fake.posts[0].media, [{ mediaFormat: "PHOTO", sourceUrl: "https://studio.test/media/post-1.jpg" }]);
    assert.equal(res.note, undefined, "a posted photo needs no explanation");
  } finally {
    delete process.env.PUBLIC_URL;
  }
});

test("a text-only post needs no image, but the other platforms still do", async () => {
  fake.posts = [];
  const { c } = await linkedClient();
  c.platforms = ["google", "facebook"];
  c.accounts = { facebook: { pageId: "1", token: "t" } };
  const plain = item({ imageFile: undefined });
  const google = await social.shareItem(c, plain, "google", { kind: "post", lang: "es" });
  assert.equal(google.ok, true, google.error);
  const facebook = await social.shareItem(c, plain, "facebook", { kind: "post", lang: "es" });
  assert.equal(facebook.ok, false);
  assert.match(facebook.error, /no image/);
  assert.equal(fake.posts.length, 1, "the Facebook failure did not touch Google");
});

test("a phone-only caption is refused before any Google call, and says why", async () => {
  fake.posts = [];
  const { c } = await linkedClient();
  const res = await social.shareItem(c, item({ captions: { es: "600 111 222" }, hashtags: [] }), "google", { kind: "post", lang: "es" });
  assert.equal(res.ok, false);
  assert.match(res.error, /phone numbers/);
  assert.equal(fake.posts.length, 0);
});

test("a Google failure is not silent: it is stored on the item", async () => {
  fake.posts = [];
  fake.failPosts = 1;
  try {
    const { c } = await linkedClient();
    const post = item();
    const res = await social.shareItem(c, post, "google", { kind: "post", lang: "es" });
    assert.equal(res.ok, false);
    assert.equal(post.shares["google:es"].ok, false);
    assert.equal(fake.posts.length, 0);
  } finally {
    fake.failPosts = 0;
  }
});

test("publish() writes Google's result into publishNote like every other platform", async () => {
  fake.posts = [];
  const { c } = await linkedClient();
  const post = item();
  await publish(c, post, "post");
  assert.match(post.publishNote, /Google: posted/);
  assert.equal(post.shares["google:es"].ok, true);

  const broken = item({ captions: { es: "600 111 222" }, hashtags: [] });
  await publish(c, broken, "post");
  assert.match(broken.publishNote, /Google: .*phone numbers/);
  assert.equal(broken.shares["google:es"].ok, false);
});

test("a disconnected Google connection is skipped instead of attempted", async () => {
  fake.posts = [];
  const c = { id: "nog", name: "Casa Mar", platforms: ["google"], languages: ["es"], approval: { status: "approved" } };
  db.clients.push(c);
  const post = item();
  await publish(c, post, "post");
  assert.equal(fake.posts.length, 0);
  assert.equal(post.publishNote, "Nothing connected yet: share it from the post");
  assert.equal(social.connections(c).google.ready, false);
});

test("checkAccounts reads the Google account name and never echoes a token", async () => {
  const { c } = await linkedClient();
  const out = await social.checkAccounts(c);
  assert.equal(out.google.ok, true);
  assert.equal(out.google.name, "Casa Mar");
  assert.equal(JSON.stringify(out).includes("at-social"), false);
  assert.equal(JSON.stringify(out).includes("rt-social"), false);
});
