// A declined business is shut out of every client-facing route; the owner's dashboard and other businesses are untouched.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "declined-"));
const PORT = 8811, B = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, path, body, headers = {}) => {
  const r = await fetch(B + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, data, text };
};
let srv;
before(async () => {
  srv = spawn(process.execPath, [join(import.meta.dirname, "index.mjs")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, SITES_DIR: join(dir, "sites"), PUBLIC_URL: "https://studio.example", ADMIN_TOKEN: "", OPENROUTER_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "", AI_PROVIDERS: "openrouter" },
    stdio: "ignore",
  });
  await sleep(900);
});
after(() => { srv?.kill(); rmSync(dir, { recursive: true, force: true }); });

const signup = async (name, languages) => (await fetch(B + "/api/signup", { method: "POST", body: JSON.stringify({ name, kind: "Bar", town: "X", phone: "+34 600", email: "a@b.es", languages, offer: "Tapas", acceptTerms: true }) }).then((r) => r.json()));

test("a declined business is blocked everywhere and sees the contact screen in its language", async () => {
  const es = await signup("Bar Declinado", ["es"]);
  const en = await signup("Declined Cafe", ["en"]);
  const ok = await signup("Bar Aprobado", ["es"]);
  const list = (await api("GET", "/api/studio")).data.clients;
  const idOf = (name) => list.find((c) => c.name === name).id;
  assert.equal((await api("POST", `/api/studio/clients/${idOf("Bar Declinado")}/decline`)).status, 200);
  assert.equal((await api("POST", `/api/studio/clients/${idOf("Declined Cafe")}/decline`)).status, 200);
  assert.equal((await api("POST", `/api/studio/clients/${idOf("Bar Aprobado")}/approve`)).status, 200);

  // Portal page and every portal API route, whatever the method.
  const page = await api("GET", `/portal/${es.token}`);
  assert.equal(page.status, 403);
  assert.match(page.text, /Tu negocio no ha sido aprobado/);
  assert.match(page.text, /mailto:atanwi85@gmail\.com/);
  assert.match(page.text, /\/brand\/tokens\.css/);
  assert.match((await api("GET", `/portal/${en.token}`)).text, /Your business was declined/);
  assert.match((await api("GET", `/portal/${en.token}?l=es`)).text, /Tu negocio/);
  for (const [m, path] of [["GET", ""], ["POST", "/briefs"], ["POST", "/profile"], ["GET", "/qr"], ["POST", "/upload"], ["GET", "/loyalty"], ["GET", "/bookings"], ["POST", "/messages"]]) {
    const r = await api(m, `/api/portal/${es.token}${path}`, m === "POST" ? {} : undefined);
    assert.equal(r.status, 403, `${m} ${path}`);
    assert.equal(r.data.code, "declined");
    assert.match(r.data.error, /atanwi85@gmail\.com/);
  }
  assert.match((await api("GET", `/api/portal/${en.token}`)).data.error, /Contact atanwi85@gmail\.com/);

  // Client login by code goes to the screen instead of the portal.
  const login = await api("POST", "/api/client-login", { code: es.code });
  assert.equal(login.status, 403);
  assert.equal(login.data.code, "declined");
  assert.equal(login.data.portalUrl, undefined);
  assert.equal((await api("GET", login.data.declinedUrl)).status, 403);
  assert.equal((await api("POST", "/api/client-login", { code: ok.code })).status, 200);
  assert.equal((await api("GET", `/api/portal/${ok.token}`)).status, 200);

  // Public booking, loyalty and website pages of a declined business.
  const cid = idOf("Bar Declinado");
  const bk = (await api("GET", `/api/studio/bookings?clientId=${cid}`)).data;
  const cfgCode = (bk.config ?? bk).code;
  assert.ok(cfgCode, "booking link exists");
  assert.equal((await api("GET", `/book/${cfgCode}`)).status, 403);
  assert.match((await api("GET", `/book/${cfgCode}`)).text, /atanwi85@gmail\.com/);
  assert.equal((await api("GET", `/api/book/${cfgCode}/info`)).status, 403);
  assert.equal((await api("POST", `/api/book/${cfgCode}`, {})).status, 403);
  const prog = (await api("POST", "/api/studio/loyalty/programs", { clientId: cid, name: "Club" })).data;
  const p = prog.program ?? prog;
  assert.equal((await api("GET", `/join/${p.joinCode}`)).status, 403);
  assert.equal((await api("GET", `/staff/${p.staffToken}`)).status, 403);
  assert.equal((await api("POST", `/api/loyalty/join/${p.joinCode}`, { name: "Ana" })).status, 403);
  const cs = (await api("GET", "/api/studio")).data.clients.find((c) => c.id === cid);
  mkdirSync(join(dir, "sites", "bar-declinado"), { recursive: true });
  writeFileSync(join(dir, "sites", "bar-declinado", "index.html"), "<h1>site</h1>");
  const slug = (await api("GET", "/api/studio")).data.clients.find((c) => c.id === cid).siteSlug;
  if (slug) assert.equal((await api("GET", `/sites/${slug}/`)).status, 403);
  void cs;

  // Approved business is unaffected.
  const okId = idOf("Bar Aprobado");
  const okBk = (await api("GET", `/api/studio/bookings?clientId=${okId}`)).data;
  assert.equal((await api("GET", `/book/${(okBk.config ?? okBk).code}`)).status, 200);
});
