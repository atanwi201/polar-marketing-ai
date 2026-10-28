// The GBP wrapper against a local fake of the five hosts. No network, no approval needed: what is tested
// here is the plumbing (paths, masks, retry, edit budget, error codes), not Google's behaviour.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const seen = [];
const fake = { respond: null };
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const body = raw.length ? (() => { try { return JSON.parse(raw.toString("utf8")); } catch { return null; } })() : null;
  const entry = { method: req.method, url: req.url, headers: req.headers, body, raw };
  seen.push(entry);
  const [status, payload, headers] = fake.respond?.(entry) ?? [200, {}];
  res.writeHead(status, { "content-type": "application/json", ...(headers ?? {}) });
  res.end(payload === undefined ? "" : JSON.stringify(payload));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.GBP_AM_BASE = `${origin}/am/v1`;
process.env.GBP_BI_BASE = `${origin}/bi/v1`;
process.env.GBP_V4_BASE = `${origin}/v4`;
process.env.GBP_VERIF_BASE = `${origin}/verif/v1`;
process.env.GBP_PERF_BASE = `${origin}/perf/v1`;
process.env.GBP_UPLOAD_BASE = `${origin}/upload/v1`;
after(() => server.close());

const gbp = await import("./gbp.mjs");
const api = (opts = {}) => gbp.gbpClient({ accessToken: "tok-123", sleep: async () => {}, ...opts });
const reset = (respond) => { seen.length = 0; fake.respond = respond ?? (() => [200, {}]); gbp.resetEditLimits(); };

test("accounts and locations carry the token and a read mask, always", async () => {
  reset((r) => (r.url.includes("/accounts/1/locations") ? [200, { locations: [] }] : [200, { accounts: [] }]));
  await api().accounts.list();
  await api().locations.list("accounts/1");
  const [a, l] = seen;
  assert.equal(a.url, "/am/v1/accounts?pageSize=20");
  assert.equal(a.headers.authorization, "Bearer tok-123");
  const u = new URL(l.url, "http://x");
  assert.equal(u.pathname, "/bi/v1/accounts/1/locations");
  assert.match(u.searchParams.get("readMask"), /regularHours/);
  assert.equal(u.searchParams.get("readMask").includes(" "), false);
});

test("a location patch sends only the updateMask fields and counts against the budget", async () => {
  reset((r) => [200, { name: "locations/1", title: r.body?.title }]);
  const patch = await api().locations.patch("locations/1", { title: "Nuevo" }, { updateMask: "title,websiteUri" });
  assert.equal(patch.title, "Nuevo");
  assert.equal(seen[0].method, "PATCH");
  assert.match(seen[0].url, /^\/bi\/v1\/locations\/1\?updateMask=title%2CwebsiteUri$/);
  await assert.rejects(api().locations.patch("locations/1", {}, {}), (e) => e.code === "invalid");
});

test("the 11th edit in a minute is refused locally, without calling Google", async () => {
  reset();
  for (let i = 0; i < 10; i++) await api().locations.patch("locations/two", { title: `t${i}` }, { updateMask: "title" });
  assert.equal(seen.length, 10);
  await assert.rejects(api().locations.patch("locations/two", { title: "x" }, { updateMask: "title" }), (e) => e.code === "edit_limit" && e.status === 429 && e.retryAt > Date.now());
  assert.equal(seen.length, 10, "the refused edit never reached the network");
  assert.equal(gbp.friendly(new gbp.GbpApiError("x", 429, "edit_limit")), "Has hecho muchos cambios seguidos. Espera un minuto y vuelve a intentarlo.");
});

test("create defaults to validateOnly and always sends a requestId", async () => {
  reset();
  await api().locations.create("accounts/1", { title: "Casa" });
  await api().locations.create("accounts/1", { title: "Casa" }, { validateOnly: false, requestId: "fixed-1" });
  const [dry, real] = seen.map((r) => new URL(r.url, "http://x"));
  assert.equal(dry.searchParams.get("validateOnly"), "true");
  assert.ok(dry.searchParams.get("requestId").length >= 20);
  assert.equal(real.searchParams.get("validateOnly"), "false");
  assert.equal(real.searchParams.get("requestId"), "fixed-1");
  assert.deepEqual(seen[0].body, { title: "Casa" });
});

test("a GET is retried on 5xx with backoff; a 400 is not retried", async () => {
  let n = 0;
  reset(() => (++n < 3 ? [500, { error: { message: "boom" } }] : [200, { locations: [] }]));
  const sleeps = [];
  const client = gbp.gbpClient({ accessToken: "t", sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual(await client.locations.list("accounts/1"), { locations: [] });
  assert.equal(seen.length, 3);
  assert.ok(sleeps[0] >= 500 && sleeps[1] >= 1000, "exponential");

  reset(() => [400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "bad mask" } }]);
  const sleeps2 = [];
  await assert.rejects(gbp.gbpClient({ accessToken: "t", sleep: async (ms) => { sleeps2.push(ms); } }).locations.list("accounts/1"), (e) => e.code === "invalid" && e.status === 400);
  assert.equal(seen.length, 1);
  assert.deepEqual(sleeps2, []);
});

test("429 honours Retry-After and is retried even for a POST", async () => {
  let n = 0;
  reset(() => (++n === 1 ? [429, { error: { status: "RESOURCE_EXHAUSTED" } }, { "retry-after": "1" }] : [200, { name: "accounts/1/locations/9" }]));
  const sleeps = [];
  const client = gbp.gbpClient({ accessToken: "t", sleep: async (ms) => { sleeps.push(ms); } });
  await client.locations.create("accounts/1", { title: "Casa" }, { validateOnly: false });
  assert.equal(seen.length, 2);
  assert.ok(sleeps[0] >= 1000, `waited for Retry-After (${sleeps[0]})`);
});

test("a create is not replayed after a network error, a GET is", async () => {
  const boom = async () => { throw new Error("socket"); };
  const client = gbp.gbpClient({ accessToken: "t", fetchImpl: boom, sleep: async () => {} });
  await assert.rejects(client.posts.create("accounts/1", "locations/1", { summary: "x" }), (e) => e.code === "network");
  let calls = 0;
  const flaky = async () => { calls++; if (calls < 2) throw new Error("socket"); return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); };
  const ok = gbp.gbpClient({ accessToken: "t", fetchImpl: flaky, sleep: async () => {} });
  assert.deepEqual(await ok.locations.get("locations/1"), {});
  assert.equal(calls, 2);
});

test("Google's 403 allow-list error becomes access_pending with a human sentence", async () => {
  reset(() => [403, { error: { code: 403, status: "PERMISSION_DENIED", message: "not enabled", details: [{ reason: "SERVICE_DISABLED" }] } }]);
  await assert.rejects(api().accounts.list(), (e) => {
    assert.equal(e.code, "access_pending");
    assert.equal(e.reason, "SERVICE_DISABLED");
    assert.match(gbp.friendly(e, "es"), /todavía no nos ha dado acceso/);
    assert.match(gbp.friendly(e, "en"), /API access/);
    return true;
  });
  reset(() => [403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "FORBIDDEN" }] } }]);
  await assert.rejects(api().accounts.list(), (e) => e.code === "forbidden");
});

test("401 asks for a reconnect, and a missing token never builds a client", async () => {
  reset(() => [401, { error: { status: "UNAUTHENTICATED" } }]);
  await assert.rejects(api().accounts.list(), (e) => e.code === "reconnect" && /conectar/i.test(gbp.friendly(e, "es")));
  assert.throws(() => gbp.gbpClient({ accessToken: "" }), (e) => e.code === "reconnect");
});

test("reviews are listed page by page and listAll stops at the cap", async () => {
  reset((r) => {
    const u = new URL(r.url, "http://x");
    return u.searchParams.get("pageToken") ? [200, { reviews: [{ reviewId: "r3" }] }] : [200, { reviews: [{ reviewId: "r1" }, { reviewId: "r2" }], nextPageToken: "p2" }];
  });
  const all = await api().reviews.listAll("accounts/1", "locations/2");
  assert.deepEqual(all.map((r) => r.reviewId), ["r1", "r2", "r3"]);
  assert.equal(seen.length, 2);
  assert.equal(new URL(seen[0].url, "http://x").searchParams.get("orderBy"), "updateTime desc");
});

test("replies, deletes, posts and media use the documented paths and bodies", async () => {
  reset();
  await api().reviews.reply("accounts/1", "locations/2", "rev/with?chars", "Gracias");
  assert.equal(seen.at(-1).method, "PUT");
  assert.match(seen.at(-1).url, /\/v4\/accounts\/1\/locations\/2\/reviews\/rev%2Fwith%3Fchars\/reply$/);
  assert.deepEqual(seen.at(-1).body, { comment: "Gracias" });

  await api().reviews.deleteReply("accounts/1", "locations/2", "abc");
  assert.equal(seen.at(-1).method, "DELETE");

  await api().posts.create("accounts/1", "locations/2", { summary: "Hola", topicType: "STANDARD" });
  assert.match(seen.at(-1).url, /\/v4\/accounts\/1\/locations\/2\/localPosts$/);

  await api().media.createFromUrl("accounts/1", "locations/2", { sourceUrl: "https://x.test/a.jpg" });
  assert.deepEqual(seen.at(-1).body, { sourceUrl: "https://x.test/a.jpg", mediaFormat: "PHOTO", locationAssociation: { category: "ADDITIONAL" } });
});

test("media bytes go startUpload -> raw upload -> media.create", async () => {
  reset((r) => (r.url.endsWith("/media:startUpload") ? [200, { resourceName: "media/abc" }] : r.url.startsWith("/upload/v1/media/")
    ? [200, {}]
    : [200, { name: "accounts/1/locations/2/media/9" }]));
  const out = await api().media.uploadBytes("accounts/1", "locations/2", { buffer: Buffer.from([1, 2, 3]), contentType: "image/png" });
  assert.equal(out.name, "accounts/1/locations/2/media/9");
  assert.equal(seen[0].url, "/v4/media:startUpload");
  assert.equal(seen[1].url, "/upload/v1/media/media/abc?upload_type=media");
  assert.equal(seen[1].headers["content-type"], "image/png");
  assert.deepEqual([...seen[1].raw], [1, 2, 3]);
  assert.equal(seen[2].url, "/v4/accounts/1/locations/2/media");
  assert.equal(seen[2].body.resourceName, "media/abc");
});

test("performance asks for each metric separately with a date range", async () => {
  reset();
  await api().performance.daily("locations/2", { metrics: ["CALL_CLICKS", "WEBSITE_CLICKS"], from: { year: 2026, month: 10, day: 1 }, to: { year: 2026, month: 10, day: 7 } });
  const u = new URL(seen[0].url, "http://x");
  assert.equal(u.pathname, "/perf/v1/locations/2:fetchMultiDailyMetricsTimeSeries");
  assert.deepEqual(u.searchParams.getAll("dailyMetrics"), ["CALL_CLICKS", "WEBSITE_CLICKS"]);
  assert.equal(u.searchParams.get("dailyRange.start_date.day"), "1");
  assert.equal(u.searchParams.get("dailyRange.end_date.day"), "7");
});

test("verification uses whatever Google offers, and a PIN completes it", async () => {
  reset();
  await api().verifications.options("locations/2", { languageCode: "es" });
  await api().verifications.verify("locations/2", { method: "SMS", phoneNumber: "+34600000000" });
  await api().verifications.complete("locations/2/verifications/v1", "123456");
  await api().verifications.state("locations/2");
  assert.equal(seen[0].url, "/verif/v1/locations/2:fetchVerificationOptions");
  assert.equal(seen[1].url, "/verif/v1/locations/2:verify");
  assert.deepEqual(seen[2].body, { pin: "123456" });
  assert.equal(seen[3].url, "/verif/v1/locations/2:getVoiceOfMerchantState");
});

test("the API flag is off unless someone turns it on", () => {
  const before = process.env.GBP_API_ENABLED;
  try {
    delete process.env.GBP_API_ENABLED;
    assert.equal(gbp.gbpApiEnabled(), false);
    process.env.GBP_API_ENABLED = "true";
    assert.equal(gbp.gbpApiEnabled(), true);
    process.env.GBP_API_ENABLED = "no";
    assert.equal(gbp.gbpApiEnabled(), false);
  } finally {
    if (before === undefined) delete process.env.GBP_API_ENABLED; else process.env.GBP_API_ENABLED = before;
  }
});
