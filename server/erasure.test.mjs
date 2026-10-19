import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "erasure-"));
const dir = join(root, "data"), sites = join(root, "sites");
process.env.DATA_DIR = dir; process.env.SITES_DIR = sites;
const { db, MEDIA_DIR } = await import("./store.mjs");
const { eraseClient, purgeExpired } = await import("./retention.mjs");
const L = await import("./loyalty.mjs");
const B = await import("./bookings.mjs");
const X = await import("./expenses.mjs");
const M = await import("./menu.mjs");

const touch = (p) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, "x"); };
const media = (f) => join(MEDIA_DIR, f);

test("erasing a client removes its data everywhere and keeps the other client's", async () => {
  db.clients.push({ id: "ca", name: "Secret Bar", siteSlug: "bar-a", logoFile: "logo-a.png", photos: [{ file: "photo-a.jpg" }, { file: "shared.jpg" }] },
                  { id: "cb", name: "Other", siteSlug: "bar-b", logoFile: "logo-b.png", photos: [{ file: "shared.jpg" }] });
  for (const f of ["logo-a.png", "photo-a.jpg", "shared.jpg", "logo-b.png"]) touch(media(f));
  db.posts.push({ id: "p1", clientId: "ca", imageFile: "post-a.jpg" }); touch(media("post-a.jpg"));
  db.messages.push({ id: "m1", clientId: "ca", text: "hi", attachments: [{ file: "up-a.jpg", kind: "image" }] }); touch(media("up-a.jpg"));
  touch(join(sites, "bar-a", "index.html")); touch(join(sites, ".bar-a.building", "x")); touch(join(sites, "bar-b", "index.html"));
  touch(join(dir, "site-src", "bar-a", "es.html")); touch(join(dir, "site-src", "bar-b", "es.html"));
  const pa = L.createProgram(db.clients[0]), pb = L.createProgram(db.clients[1]);
  const l = L.ldb();
  l.customers.push({ id: "k1", programId: pa.id, clientId: "ca", name: "Ann", email: "ann@x.es", authToken: "t" }, { id: "k2", programId: pb.id, clientId: "cb", name: "Bob" });
  l.txns.push({ id: "t1", programId: pa.id, customerId: "k1", clientId: "ca" }, { id: "t2", programId: pb.id, customerId: "k2", clientId: "cb" });
  l.devices.push({ deviceId: "d", serial: "k1", pushToken: "tok", passTypeId: "p" }, { deviceId: "d2", serial: "k2", pushToken: "tok2", passTypeId: "p" });
  B.bdb().configs.push({ clientId: "ca" }, { clientId: "cb" }); B.bdb().items.push({ clientId: "ca", name: "Ann" }, { clientId: "cb" });
  X.edb().configs.push({ clientId: "ca" }); X.edb().items.push({ clientId: "ca" }, { clientId: "cb" });
  const cfg = M.ensureConfig(db.clients[0]); M.ensureConfig(db.clients[1]);
  mkdirSync(M.PHOTO_DIR, { recursive: true }); writeFileSync(join(M.PHOTO_DIR, "ca_abc.jpg"), "x");
  cfg.categories = [{ id: "c", name: { es: "x" }, items: [{ id: "i", name: { es: "y" }, photo: "/menu/img/ca_abc.jpg" }] }];

  const counts = await eraseClient("ca", { sitesDir: sites });
  assert.equal(counts.loyalty.customers, 1);
  assert.deepEqual(db.clients.map((c) => c.id), ["cb"]);
  assert.deepEqual(l.programs.map((p) => p.id), [pb.id]);
  assert.deepEqual(l.customers.map((c) => c.id), ["k2"]); assert.deepEqual(l.txns.map((t) => t.id), ["t2"]); assert.deepEqual(l.devices.map((d) => d.serial), ["k2"]);
  assert.equal(B.bdb().items.length, 1); assert.equal(X.edb().items.length, 1); assert.equal(db.messages.length + db.posts.length, 0);
  assert.equal(M.mdb().configs.length, 1);
  assert.ok(!existsSync(join(M.PHOTO_DIR, "ca_abc.jpg")));
  for (const f of ["logo-a.png", "photo-a.jpg", "post-a.jpg", "up-a.jpg"]) assert.ok(!existsSync(media(f)), f);
  assert.ok(existsSync(media("shared.jpg")) && existsSync(media("logo-b.png")), "other tenant's files survive");
  assert.ok(!existsSync(join(sites, "bar-a")) && !existsSync(join(sites, ".bar-a.building")) && !existsSync(join(dir, "site-src", "bar-a")));
  assert.ok(existsSync(join(sites, "bar-b", "index.html")) && existsSync(join(dir, "site-src", "bar-b", "es.html")));
  const audit = readFileSync(join(dir, "erasure-audit.log"), "utf8");
  assert.match(audit, /client_erased/); assert.ok(!/Secret|Ann|ann@/.test(audit));
});

test("a traversal-looking siteSlug never deletes outside the sites folder", async () => {
  touch(join(root, "victim", "keep.txt"));
  db.clients.push({ id: "cz", name: "Z", siteSlug: "../victim" });
  await eraseClient("cz", { sitesDir: sites });
  assert.ok(existsSync(join(root, "victim", "keep.txt")));
});

test("retention purge is off by default and honours dry runs", async () => {
  const old = new Date(Date.now() - 400 * 864e5).toISOString();
  db.clients.push({ id: "cd", name: "D", approval: { status: "declined", at: old } });
  const l = L.ldb(); l.customers.push({ id: "k9", programId: "x", clientId: "cx", lastVisitAt: old });
  B.bdb().items.push({ clientId: "cx", date: "2020-01-01" });
  assert.deepEqual(await purgeExpired({}), { clients: 0, bookings: 0, loyaltyCustomers: 0 });
  assert.ok(db.clients.some((c) => c.id === "cd"));
  const dry = await purgeExpired({ declinedDays: 30, bookingDays: 30, loyaltyInactiveDays: 30, dryRun: true });
  assert.deepEqual(dry, { clients: 1, bookings: 1, loyaltyCustomers: 1 });
  assert.ok(db.clients.some((c) => c.id === "cd"));
  await purgeExpired({ declinedDays: 30, bookingDays: 30, loyaltyInactiveDays: 30, sitesDir: sites });
  assert.ok(!db.clients.some((c) => c.id === "cd"));
  assert.ok(!l.customers.some((c) => c.id === "k9")); assert.ok(!B.bdb().items.some((b) => b.date === "2020-01-01"));
});
