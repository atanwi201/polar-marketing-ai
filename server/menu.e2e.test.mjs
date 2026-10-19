// Menu routes: owner vs portal scope, off-by-default, import/translate with a mocked provider, photos, public page/JSON/QR.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let lastChat, mode = "import";
const mock = http.createServer((req, res) => {
  let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "google/gemini-2.0-flash-exp:free", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, context_length: 100000 }] }));
    lastChat = JSON.parse(s);
    const text = mode === "import"
      ? '```json\n{"categories":[{"name":"Tapas","items":[{"name":"Croquetas","description":"De jamón","price":"6,50","allergens":["gluten","milk"]},{"name":"Pulpo","price":14}]}]}\n```'
      : '{"t":["Tapas EN","Croquettes","Ham","Octopus"]}';
    res.end(JSON.stringify({ model: "google/gemini-2.0-flash-exp:free", choices: [{ message: { content: text } }] }));
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
process.env.OPENROUTER_API_KEY = "test-key";
process.env.AI_PROVIDERS = "openrouter";
process.env.GROQ_API_KEY = ""; process.env.MISTRAL_API_KEY = "";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "menu-e2e-"));

const { db } = await import("./store.mjs");
const { handleMenu } = await import("./menu-routes.mjs");
const { createCanvas } = await import("@napi-rs/canvas");
db.clients.push({ id: "c1", name: "Bar Uno", token: "portal-one" }, { id: "c2", name: "Hotel Dos", token: "portal-two" });
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, fail) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { fail(Object.assign(new Error("Invalid JSON"), { status: 400 })); } }); });
const ctx = { send, readBody, isAdmin: (r) => r.headers["x-admin-token"] === "secret", clientByToken: (t) => db.clients.find((c) => c.token === t), clientIp: (r) => String(r.headers["x-test-ip"] ?? "1.1.1.1"), baseUrl: () => "https://studio.example" };
let server, base, n = 0;
before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try { if (!(await handleMenu(req, res, url, url.pathname.split("/").filter(Boolean), ctx))) send(res, 404, { error: "nope" }); } catch (e) { send(res, 500, { error: e.message }); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); mock.close(); });
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "x-test-ip": `10.3.0.${++n % 250}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, headers: r.headers, body: ct.includes("json") ? await r.json() : ct.includes("text/html") || ct.includes("svg") ? await r.text() : Buffer.from(await r.arrayBuffer()) };
};
const ADMIN = { "x-admin-token": "secret" };
const P = "/api/portal/portal-one/menu", O = "/api/studio/menu";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const st = {};

test("auth: owner needs admin, portal needs a known token", async () => {
  assert.equal((await call("GET", O)).status, 401);
  assert.equal((await call("GET", "/api/portal/nope/menu")).status, 404);
});
test("off by default: portal sees only enabled:false and 403 on the rest; owner turns it on", async () => {
  assert.deepEqual((await call("GET", P)).body, { config: { enabled: false } });
  for (const [m, p] of [["PUT", ""], ["POST", "/photo"], ["POST", "/import"], ["POST", "/translate"]]) assert.equal((await call(m, P + p, {})).status, 403, p);
  assert.equal((await call("PUT", `${P}/config`, { enabled: true })).status, 403);
  assert.equal((await call("GET", O, undefined, ADMIN)).body.businesses.find((b) => b.id === "c1").enabled, false);
  const on = await call("PUT", `${O}/config?clientId=c1`, { enabled: true, languages: ["es", "en"] }, ADMIN);
  assert.equal(on.body.enabled, true); assert.equal(on.body.allergens.length, 14);
  assert.match(on.body.url, /^https:\/\/studio\.example\/menu\/[a-z2-9]{8}$/);
  st.code = on.body.code;
  const g = await call("GET", P);
  assert.equal(g.body.config.enabled, true); assert.deepEqual(g.body.categories, []);
  assert.equal((await call("GET", "/api/portal/portal-two/menu")).body.config.enabled, false);
});
test("client cannot switch off, but changes languages", async () => {
  const r = await call("PUT", `${P}/config`, { enabled: false, languages: ["en", "de"] });
  assert.equal(r.body.enabled, true); assert.deepEqual(r.body.languages, ["en", "de"]);
  await call("PUT", `${P}/config`, { languages: ["es", "en"] });
});
test("import: image goes to the vision chain and a draft comes back unsaved; PDFs get a clear error", async () => {
  const r = await call("POST", `${P}/import`, { image: PNG });
  assert.equal(r.status, 200);
  const cat = r.body.draft.categories[0];
  assert.deepEqual(cat.name, { es: "Tapas" });
  assert.equal(cat.items[0].priceCents, 650); assert.deepEqual(cat.items[0].allergens, ["gluten", "milk"]); assert.equal(cat.items[1].priceCents, 1400);
  assert.ok(lastChat.messages.at(-1).content.some((p) => p.type === "image_url" && p.image_url.url === PNG));
  assert.deepEqual((await call("GET", P)).body.categories, []);
  const pdf = await call("POST", `${P}/import`, { image: "data:application/pdf;base64,AAAA" }, { "x-lang": "es" });
  assert.equal(pdf.status, 415); assert.equal(pdf.body.code, "pdf_unsupported"); assert.match(pdf.body.error, /PDF/);
  assert.equal((await call("POST", `${P}/import`, { image: "junk" })).status, 400);
  st.draft = r.body.draft.categories;
});
test("translate fills the missing language without saving", async () => {
  mode = "translate";
  const r = await call("POST", `${P}/translate`, { categories: st.draft, from: "es", to: ["en"] });
  assert.equal(r.status, 200);
  assert.equal(r.body.categories[0].name.en, "Tapas EN");
  assert.equal(r.body.categories[0].items[0].name.en, "Croquettes");
  assert.equal(r.body.categories[0].items[0].description.en, "Ham");
  assert.equal(r.body.categories[0].items[1].name.en, "Octopus");
  assert.equal((await call("POST", `${P}/translate`, { categories: st.draft, from: "es", to: [] })).status, 400);
  st.full = r.body.categories;
});
test("photo upload is downsized and served; save the tree; owner sees the same data", async () => {
  const cv = createCanvas(2400, 1600); cv.getContext("2d").fillRect(0, 0, 2400, 1600);
  const up = await call("POST", `${P}/photo`, { image: `data:image/png;base64,${cv.toBuffer("image/png").toString("base64")}` });
  assert.equal(up.status, 200); assert.match(up.body.url, /^\/menu\/img\/[\w]+\.jpg$/);
  const img = await call("GET", up.body.url);
  assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.ok(img.body.length < 400000);
  assert.equal((await call("POST", `${P}/photo`, { image: "nope" })).status, 400);
  st.full[0].items[0].photo = up.body.url;
  st.full[0].items.push({ name: { es: "Sin plato" }, available: false });
  const put = await call("PUT", P, { categories: st.full });
  assert.equal(put.status, 200); assert.equal(put.body.categories[0].items[0].photo, up.body.url);
  assert.equal((await call("PUT", P, { categories: "x" })).status, 400);
  assert.equal((await call("GET", `${O}?clientId=c1`, undefined, ADMIN)).body.categories[0].items.length, 3);
  st.photo = up.body.url;
});
test("public page, JSON, QR and 404s", async () => {
  const page = await call("GET", `/menu/${st.code}`);
  assert.equal(page.status, 200); assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(page.body, /Croquetas/); assert.match(page.body, /Leyenda de alérgenos/); assert.doesNotMatch(page.body, /Sin plato/);
  assert.match(page.body, new RegExp(st.photo.replace(/\//g, "\\/")));
  assert.match((await call("GET", `/menu/${st.code}?l=en`)).body, /Croquettes/);
  const j = await call("GET", `/api/menu/${st.code}?l=en`);
  assert.equal(j.body.lang, "en"); assert.equal(j.body.categories[0].items.length, 2); assert.equal(j.body.categories[0].name, "Tapas EN");
  assert.match((await call("GET", `/menu/${st.code}/qr.svg`)).body, /<svg/);
  const png = await call("GET", `/menu/${st.code}/qr.png?download=1`);
  assert.equal(png.body.subarray(1, 4).toString(), "PNG"); assert.match(png.headers.get("content-disposition"), /attachment/);
  assert.equal((await call("GET", "/menu/nopecode")).status, 404);
  assert.equal((await call("GET", "/api/menu/nopecode")).status, 404);
  assert.equal((await call("GET", "/menu/img/..%2Fx")).status, 404);
});
test("switched off by the owner: public 404", async () => {
  await call("PUT", `${O}/config?clientId=c1`, { enabled: false }, ADMIN);
  assert.equal((await call("GET", `/menu/${st.code}`)).status, 404);
  assert.equal((await call("GET", `/api/menu/${st.code}`)).status, 404);
});
test("removing a photo from the tree deletes the file", async () => {
  await call("PUT", `${O}/config?clientId=c1`, { enabled: true }, ADMIN);
  st.full[0].items[0].photo = "";
  await call("PUT", P, { categories: st.full });
  assert.equal((await call("GET", st.photo)).status, 404);
});
