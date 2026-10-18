// Join, then find the customer the way staff do: the scanned QR payload, any case, bare id, spaces. And the QR must decode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createCanvas, loadImage } from "@napi-rs/canvas";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "loy-scan-"));
const L = await import("./loyalty.mjs");
const { db } = await import("./store.mjs");
const { qrPng } = await import("./qr.mjs");
const jsQR = createRequire(import.meta.url)("./vendor/jsqr.cjs");

db.clients.push({ id: "c1", name: "Cafe Uno", token: "tok1" });
const p = L.createProgram(db.clients[0], { type: "stamps" });
L.updateProgram(p, { status: "live" });

test("full flow: join, scan the card's QR, type the code, record a visit", async () => {
  const c = L.joinCustomer(p, { name: "Ana", email: "ana@example.com" });
  const view = L.cardView(c, p, { baseUrl: "https://x.test" });
  assert.equal(view.code, `LC1-${c.id}`);

  // what the QR on the card really holds: render it and decode it with the same decoder the scanner page loads
  const png = await qrPng(view.code, 400);
  const img = await loadImage(png), cv = createCanvas(img.width, img.height), g = cv.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height);
  assert.equal(jsQR(d.data, d.width, d.height)?.data, view.code);

  for (const typed of [view.code, view.code.toUpperCase(), view.code.toLowerCase(), c.id, c.id.toUpperCase(), `  ${view.code}  `, `lc1 ${c.id}`, `code: ${view.code}\n`]) {
    const f = L.lookupByCode(typed);
    assert.equal(f?.customer.id, c.id, `lookup "${typed}"`);
  }
  assert.equal(L.lookupByCode("LC1-nope"), null);
  assert.equal(L.lookupByCode(""), null);

  const r = L.record(L.lookupByCode(view.code.toUpperCase()).customer, p, { kind: "visit", by: "staff" });
  assert.equal(r.customer.stamps, 1);
});

test("the scanner page loads a JS decoder where BarcodeDetector is missing", async () => {
  const { staffPage } = await import("./loyalty-pages.mjs");
  const html = staffPage({ program: { ...p, status: "live" }, client: { name: "Cafe Uno" }, baseUrl: "https://x.test" });
  assert.match(html, /\/assets\/jsqr\.js/);
  assert.match(html, /playsinline/);
  assert.ok(readFileSync(new URL("./vendor/jsqr.cjs", import.meta.url), "utf8").length > 1e5);
  assert.doesNotMatch(html, /toUpperCase\(\);\s*if\(!code/);
});
