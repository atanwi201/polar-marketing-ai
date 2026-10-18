import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bkl-"));
process.env.PUBLIC_URL = "https://crier.example/";
const { db } = await import("./store.mjs");
const B = await import("./bookings.mjs");
const K = await import("./bookings-links.mjs");
const { cardPage } = await import("./loyalty-pages.mjs");

const client = { id: "c1", name: "Casa Mar", kind: "restaurante", siteSlug: "casa-mar", domain: "casamar.es", site: { kind: "ai", status: "ready", languages: ["es", "en"] } };
db.clients.push(client);
const html = `<!doctype html><html lang="es"><body><h1>Hola</h1></body></html>`;

test("no config or disabled: nothing is added", () => {
  assert.equal(K.bookingFor(client), null);
  const cfg = B.ensureConfig(client);
  assert.equal(K.bookingFor(client), null);
  assert.equal(K.siteCta(html, client, "es"), html);
  assert.equal(cfg.enabled, false);
});

test("enabled: absolute link to the Crier server, kind and language aware, idempotent", () => {
  const cfg = B.ensureConfig(client);
  B.updateConfig(cfg, { enabled: true });
  const es = K.siteCta(html, client, "es");
  assert.ok(es.includes(`href="https://crier.example/book/${cfg.code}?src=website"`));
  assert.match(es, />Reservar mesa</);
  assert.match(K.siteCta(html, client, "en"), />Reserve a table</);
  assert.equal(K.siteCta(es, client, "es"), es);
  assert.equal((K.siteCta(es, client, "es").match(/data-crier-booking/g) ?? []).length, 1);
  B.updateConfig(cfg, { kind: "room" });
  const room = K.siteCta(es, client, "en");
  assert.match(room, />Book a room</);
  assert.equal((room.match(/data-crier-booking/g) ?? []).length, 1);
  B.updateConfig(cfg, { enabled: false });
  assert.equal(K.siteCta(room, client, "en"), html);
  B.updateConfig(cfg, { enabled: true, kind: "table" });
});

test("syncSiteBooking updates built pages in place and removes them when disabled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bkl-sites-"));
  mkdirSync(join(dir, "casa-mar", "en"), { recursive: true });
  writeFileSync(join(dir, "casa-mar", "index.html"), html);
  writeFileSync(join(dir, "casa-mar", "en", "index.html"), html.replace('lang="es"', 'lang="en"'));
  const cfg = B.findConfig(client.id);
  assert.equal((await K.syncSiteBooking(client, dir)).length, 2);
  assert.match(readFileSync(join(dir, "casa-mar", "index.html"), "utf8"), /Reservar mesa/);
  assert.match(readFileSync(join(dir, "casa-mar", "en", "index.html"), "utf8"), /Reserve a table/);
  assert.equal((await K.syncSiteBooking(client, dir)).length, 0);
  B.updateConfig(cfg, { enabled: false });
  assert.equal((await K.syncSiteBooking(client, dir)).length, 2);
  assert.equal(readFileSync(join(dir, "casa-mar", "index.html"), "utf8"), html);
  B.updateConfig(cfg, { enabled: true });
});

test("designPrompt mentions the button only when bookings are on", async () => {
  const { designPrompt } = await import("./aisite.mjs");
  const args = { lang: "es", langs: ["es"], assets: { list: [], plan: { gallery: [], services: [] } }, design: "" };
  assert.match(designPrompt(client, args), /Online booking is open/);
  B.updateConfig(B.findConfig(client.id), { enabled: false });
  assert.doesNotMatch(designPrompt(client, args), /Online booking is open/);
});

test("loyalty card: button only with booking info", () => {
  const view = { program: { name: "Club", design: {}, status: "live", rewards: [] }, business: { name: "Casa Mar" }, customer: { name: "Ana", stamps: 0, points: 0 }, code: "ABC123", installUrl: "http://x/card/tok", rewards: [], history: [], wallet: {} };
  const off = cardPage({ view });
  assert.doesNotMatch(off, /id="bk"/);
  const on = cardPage({ view: { ...view, booking: { url: "/book/xyz?src=loyalty", kind: "table" } } });
  assert.match(on, /<a class="bk" id="bk" href="\/book\/xyz\?src=loyalty"[^>]*>Book a table</);
  assert.match(on, /data-es="Reservar mesa"/);
  assert.match(cardPage({ view: { ...view, booking: { url: "/book/xyz?src=loyalty", kind: "room" } } }), />Book a room</);
});
