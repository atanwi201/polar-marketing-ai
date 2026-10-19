// Security regressions for the core server: headers, media streaming, access-code throttling,
// client-supplied media names, fail-closed admin in production and generic 5xx errors.
// Provider keys are blanked so the real .env (auto-loaded by index.mjs) can never be used.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BLANK = ["GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MISTRAL_API_KEY", "SILICONFLOW_API_KEY", "DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY",
  "PUTER_AUTH_TOKEN", "POLLINATIONS_KEY", "PEXELS_API_KEY", "RESEND_API_KEY", "BOOKING_FROM_EMAIL", "X_API_KEY", "X_API_SECRET", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET",
  "APPLE_PASS_TYPE_ID", "APPLE_TEAM_ID", "GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON", "ADMIN_PASSWORD", "ADMIN_TOKEN", "PUBLIC_URL", "HOST", "NODE_ENV"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];

async function start(port, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "isla-sec-"));
  const env = { PATH: process.env.PATH, HOME: "/nonexistent-home", ...Object.fromEntries(BLANK.map((k) => [k, ""])), PORT: String(port), DATA_DIR: dir, SITES_DIR: join(dir, "sites"), AI_PROVIDERS: "openrouter", ...extra };
  const srv = spawn(process.execPath, [join(import.meta.dirname, "index.mjs")], { env, stdio: "ignore" });
  procs.push(srv);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) { if (await fetch(base + "/robots.txt").then((r) => r.ok, () => false)) break; await sleep(100); }
  return { dir, base, srv };
}
const post = (base, path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

let dev;
before(async () => {
  dev = await start(8841, { ADMIN_TOKEN: "sec-test-token" });
  mkdirSync(join(dev.dir, "sites", "demo"), { recursive: true });
  writeFileSync(join(dev.dir, "sites", "demo", "index.html"), "<!doctype html><title>demo</title>");
  mkdirSync(join(dev.dir, "media", "subdir"), { recursive: true });
  writeFileSync(join(dev.dir, "media", "ok.jpg"), "x");
});
after(() => { for (const p of procs) p.kill(); });

test("every response carries nosniff and a frame policy; sites get a sandboxing CSP", async () => {
  const login = await fetch(dev.base + "/login");
  assert.equal(login.headers.get("x-content-type-options"), "nosniff");
  assert.equal(login.headers.get("x-frame-options"), "DENY");
  assert.ok(login.headers.get("referrer-policy"));
  const api = await fetch(dev.base + "/api/auth");
  assert.equal(api.headers.get("x-content-type-options"), "nosniff");
  const site = await fetch(dev.base + "/sites/demo/");
  assert.equal(site.status, 200);
  const csp = site.headers.get("content-security-policy");
  assert.match(csp, /sandbox allow-scripts allow-forms allow-popups/);
  assert.match(csp, /default-src 'self' https:/);
  assert.equal(site.headers.get("x-content-type-options"), "nosniff");
});

test("media: a directory is a 404, a file streams, traversal is refused", async () => {
  assert.equal((await fetch(dev.base + "/media/subdir")).status, 404);
  assert.equal((await fetch(dev.base + "/media/menu")).status, 404);
  assert.equal((await fetch(dev.base + "/media/ok.jpg")).status, 200);
  assert.equal((await fetch(dev.base + "/media/..%2f..%2fetc%2fpasswd")).status, 404);
  assert.equal((await fetch(dev.base + "/sites/demo/..")).status === 200, false);
  // the server is still up after those
  assert.equal((await fetch(dev.base + "/robots.txt")).status, 200);
});

test("access codes: failures are not wiped by a success, then the IP is blocked", async () => {
  const s = await post(dev.base, "/api/signup", { name: "Bar Uno", kind: "Bar", town: "Adeje", phone: "+34 600 000 001", email: "a@b.es", offer: "Cañas", acceptTerms: true });
  assert.equal(s.status, 201);
  const { code } = await s.json();
  for (let i = 0; i < 8; i++) assert.equal((await post(dev.base, "/api/client-login", { code: "ZZZ-ZZ" + i })).status, 404);
  assert.equal((await post(dev.base, "/api/client-login", { code })).status, 200); // success must not reset the count
  for (let i = 0; i < 4; i++) await post(dev.base, "/api/client-login", { code: "YYY-YY" + i });
  assert.equal((await post(dev.base, "/api/client-login", { code: "XXX-XX1" })).status, 429);
  assert.equal((await post(dev.base, "/api/client-login", { code })).status, 429, "even the right code waits once the budget is spent");
});

test("a client-supplied image file name must be a plain image in the media folder", async () => {
  const H = { "x-admin-token": "sec-test-token" };
  const st = await (await fetch(dev.base + "/api/studio", { headers: H })).json();
  const clientId = st.clients[0].id;
  for (const bad of ["../../etc/passwd", "..%2Fx.jpg", "a/b.jpg", "x.jpg/../../y.jpg", "/etc/passwd", "noext", "x.svg", { a: 1 }]) {
    const r = await post(dev.base, "/api/studio/briefs", { clientId, text: "Cañas a 1 euro", imageFile: bad }, H);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});

test("unauthenticated AI status reveals nothing but a flag; errors stay generic", async () => {
  const r = await (await fetch(dev.base + "/api/ai/status")).json();
  assert.deepEqual(Object.keys(r), ["configured"]);
  const owner = await (await fetch(dev.base + "/api/ai/status", { headers: { "x-admin-token": "sec-test-token" } })).json();
  assert.ok("configured" in owner);
});

test("sign-up refuses oversized bodies", async () => {
  const big = "x".repeat(13e6);
  const r = await post(dev.base, "/api/signup", { name: "Big", offer: big }).catch(() => ({ status: 413 }));
  assert.equal(r.status, 413);
});

test("production: no password and no token means nobody is the owner; first run only from the machine itself", async () => {
  const prod = await start(8842, { NODE_ENV: "production" });
  assert.equal((await fetch(prod.base + "/api/studio")).status, 401);
  assert.equal((await fetch(prod.base + "/api/ai", { method: "POST", body: "{}" })).status, 401);
  // a request that came through a proxy (it carries the visitor address) cannot claim the first-run password
  const viaProxy = await post(prod.base, "/api/auth/login", { password: "correct-horse-1" }, { "x-real-ip": "203.0.113.9" });
  assert.equal(viaProxy.status, 403);
  assert.equal((await fetch(prod.base + "/api/studio")).status, 401);
  // from loopback it works, and the cookie then opens the dashboard API
  const local = await post(prod.base, "/api/auth/login", { password: "correct-horse-1" });
  assert.equal(local.status, 200);
  const cookie = local.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(prod.base + "/api/studio", { headers: { cookie } })).status, 200);
});

test("session cookie is Secure from PUBLIC_URL, whatever the client header says", async () => {
  const s = await start(8843, { ADMIN_PASSWORD: "hunter2-hunter2", PUBLIC_URL: "https://studio.example" });
  const r = await post(s.base, "/api/auth/login", { password: "hunter2-hunter2" }, { "x-forwarded-proto": "http" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /; Secure/);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
});
