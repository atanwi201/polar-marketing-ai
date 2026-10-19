import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";

const root = mkdtempSync(join(tmpdir(), "tenancy-"));
process.env.DATA_DIR = join(root, "data"); process.env.SITES_DIR = join(root, "sites");
const { db } = await import("./store.mjs");
const M = await import("./menu.mjs");
const L = await import("./loyalty.mjs");
const { applyImages } = await import("./profile.mjs");

const cat = (photo) => [{ name: { es: "Cat" }, items: [{ name: { es: "Item" }, photo }] }];

test("menu: a tenant cannot reference or delete another tenant's photo", async () => {
  const a = M.ensureConfig({ id: "ta" }), b = M.ensureConfig({ id: "tb" });
  mkdirSync(M.PHOTO_DIR, { recursive: true });
  writeFileSync(join(M.PHOTO_DIR, "tb_k1.jpg"), "b");
  await M.replaceCategories(b, cat("/menu/img/tb_k1.jpg"));
  const got = await M.replaceCategories(a, cat("/menu/img/tb_k1.jpg"));
  assert.equal(got[0].items[0].photo, "", "foreign photo is stripped");
  await M.replaceCategories(a, []); await M.removeClientData("ta");
  assert.ok(existsSync(join(M.PHOTO_DIR, "tb_k1.jpg")));
  assert.equal(b.categories[0].items[0].photo, "/menu/img/tb_k1.jpg");
});

test("menu: own prefixed photos are accepted and deleted; legacy shared files are kept while another menu uses them", async () => {
  const a = M.ensureConfig({ id: "tc" }), b = M.ensureConfig({ id: "td" });
  writeFileSync(join(M.PHOTO_DIR, "tc_k2.jpg"), "x"); writeFileSync(join(M.PHOTO_DIR, "legacy.jpg"), "x");
  await M.replaceCategories(a, cat("/menu/img/tc_k2.jpg"));
  assert.equal(a.categories[0].items[0].photo, "/menu/img/tc_k2.jpg");
  await M.replaceCategories(a, []);
  assert.ok(!existsSync(join(M.PHOTO_DIR, "tc_k2.jpg")));
  a.categories = cat("/menu/img/legacy.jpg").map((c) => ({ ...c, id: "c", items: c.items.map((i) => ({ ...i, id: "i" })) }));
  b.categories = JSON.parse(JSON.stringify(a.categories));
  await M.replaceCategories(a, []);
  assert.ok(existsSync(join(M.PHOTO_DIR, "legacy.jpg")), "still referenced by td");
  assert.equal(M.photoOwnedBy("a_b_x.jpg", "a"), false);
});

test("menu and booking codes come from crypto (alphabet, length, uniqueness)", () => {
  const codes = new Set(Array.from({ length: 40 }, (_, i) => M.ensureConfig({ id: "q" + i }).code));
  assert.equal(codes.size, 40); for (const c of codes) assert.match(c, /^[a-z2-9]{8}$/);
});

test("loyalty: a design can't point at another tenant's picture; staff tokens expire and rotate", () => {
  const ca = { id: "la", name: "A" }; db.clients.push(ca, { id: "lb", name: "B" });
  const p = L.createProgram(ca, { design: { stripFile: "loy-other-strip-1.png" } });
  assert.equal(p.design.stripFile, "");
  L.updateProgram(p, { design: { stripFile: "loy-other-strip-1.png", backgroundFile: `${L.designFilePrefix(p.id)}bg-1.png` } });
  assert.equal(p.design.stripFile, ""); assert.equal(p.design.backgroundFile, `${L.designFilePrefix(p.id)}bg-1.png`);
  L.recordUpload("up-mine.png", "la");
  L.updateProgram(p, { design: { stripFile: "up-mine.png" } }); assert.equal(p.design.stripFile, "up-mine.png");
  assert.ok(p.staffTokenExpiresAt && L.staffTokenValid(p));
  p.staffTokenExpiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal(L.staffTokenValid(p), false);
  const old = p.staffToken; L.rotateStaffToken(p);
  assert.notEqual(p.staffToken, old); assert.equal(L.staffTokenValid(p), true);
  delete p.staffTokenExpiresAt; assert.equal(L.staffTokenValid(p), true); assert.ok(p.staffTokenExpiresAt);
});

test("profile: concurrent applyImages calls keep every photo", async () => {
  const c = { id: "pc", photos: [] };
  const img = "data:image/png;base64,AAAA";
  await Promise.all([applyImages(c, { photos: [img] }), applyImages(c, { photos: [img, img] }), applyImages(c, { logo: img })]);
  assert.equal(c.photos.length, 3); assert.ok(c.logoFile);
});

test("wallet /log is bounded in body size, lines and rate", async () => {
  const dir = root;
  for (const n of ["signer", "wwdr"]) execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, `${n}.key`), "-out", join(dir, `${n}.pem`), "-days", "2", "-subj", `/CN=${n}`], { stdio: "ignore" });
  const env = { APPLE_PASS_TYPE_ID: "pass.t", APPLE_TEAM_ID: "TEAM123456", PUBLIC_URL: "https://c.example.com", APPLE_PASS_CERT_PATH: join(dir, "signer.pem"), APPLE_PASS_KEY_PATH: join(dir, "signer.key"), APPLE_WWDR_PATH: join(dir, "wwdr.pem") };
  const { handleWallet, LOG_MAX_BYTES, LOG_PER_MINUTE } = await import("./wallet.mjs");
  let limit; const lines = [];
  const warn = console.warn; console.warn = (...a) => lines.push(a.join(" "));
  const ctx = { send() {}, env, ldb: () => ({ programs: [], customers: [], txns: [], devices: [], templates: [] }), clientIp: () => "9.9.9.9", readBody: (req, l) => { limit = l; return Promise.resolve({ logs: Array.from({ length: 100 }, () => "x".repeat(2000) + "\nforged") }); } };
  const codes = [];
  try {
    for (let i = 0; i < LOG_PER_MINUTE + 5; i++) {
      const req = Object.assign(new EventEmitter(), { method: "POST", headers: { host: "c.example.com" } });
      const res = { writeHead(c) { codes.push(c); }, end() {} };
      await handleWallet(req, res, new URL("https://c.example.com/wallet/v1/log"), ["wallet", "v1", "log"], ctx);
    }
  } finally { console.warn = warn; }
  assert.equal(limit, LOG_MAX_BYTES);
  assert.equal(codes.filter((c) => c === 429).length, 5);
  assert.equal(lines.length, 20 * LOG_PER_MINUTE);
  assert.ok(lines.every((l) => l.length <= 320 && !l.includes("\n")));
});
