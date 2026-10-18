import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { cleanLogo, analysePhoto, planImages, cropTo, fixPageImages } from "./siteimages.mjs";
import { parseEdits, applyEdits } from "./siteedit.mjs";

const dir = mkdtempSync(join(tmpdir(), "siteimg-"));
const png = (w, h, draw) => { const cv = createCanvas(w, h); draw(cv.getContext("2d")); const f = join(dir, `${Math.random()}.png`); writeFileSync(f, cv.toBuffer("image/png")); return f; };

test("a logo on a plain square loses the background and the margins", async () => {
  const src = png(400, 400, (c) => { c.fillStyle = "#fed563"; c.fillRect(0, 0, 400, 400); c.fillStyle = "#e01010"; c.beginPath(); c.arc(200, 200, 120, 0, Math.PI * 2); c.fill(); c.fillStyle = "#fed563"; c.fillRect(185, 185, 30, 30); });
  const out = join(dir, "logo.png");
  const info = await cleanLogo(src, out);
  assert.equal(info.transparent, true);
  assert.equal(info.removedBackground, "#fed563");
  assert.ok(info.w < 270 && info.w > 240, `trimmed to the circle (${info.w})`);
  const ctx = createCanvas(info.w, info.h).getContext("2d");
  ctx.drawImage(await loadImage(out), 0, 0);
  assert.equal(ctx.getImageData(2, 2, 1, 1).data[3], 0, "corner is transparent");
  assert.equal(ctx.getImageData(info.w / 2, info.h / 2, 1, 1).data[3], 255, "the yellow square inside the mark stays");
});

test("photos are cropped around their subject, each used once, products get their own picture", async () => {
  const src = png(1600, 900, (c) => { c.fillStyle = "#777"; c.fillRect(0, 0, 1600, 900); for (let i = 0; i < 40; i++) { c.fillStyle = i % 2 ? "#fff" : "#000"; c.fillRect(1150 + i * 8, 300, 4, 300); } });
  const a = await analysePhoto(src);
  assert.ok(a.focus.x > 0.6, `subject found on the right (${a.focus.x})`);
  const sq = await cropTo(src, join(dir, "sq.jpg"), "square", a.focus);
  assert.deepEqual([sq.w, sq.h], [900, 900]);
  const pics = [
    { id: "photo-1", kind: "photo", w: 1600, h: 900, brightness: 0.5 }, { id: "photo-2", kind: "photo", w: 900, h: 1200, brightness: 0.5 },
    { id: "stock-1", kind: "stock", w: 1400, h: 900, brightness: 0.5, service: "Plátano rojo" }, { id: "stock-2", kind: "stock", w: 1400, h: 900, brightness: 0.5 },
  ];
  const plan = planImages(pics, [{ name: "Platano Rojo" }, { name: "Coco" }]);
  assert.equal(plan.hero.pic.id, "photo-1");
  assert.equal(plan.about.pic.id, "photo-2");
  assert.deepEqual(plan.services.map((s) => s.pic.id), ["stock-1"]);
  assert.deepEqual(plan.gallery.map((g) => g.pic.id), ["stock-2"]);
});

test("a picture the model shows twice is swapped for an unused one, with its true size", () => {
  const slots = [
    { file: "images/a-wide.jpg", frame: "wide", w: 1600, h: 900, position: "50% 50%", role: "hero" },
    { file: "images/b-square.jpg", frame: "square", w: 900, h: 900, position: "40% 50%", role: "gallery" },
    { file: "images/c-square.jpg", frame: "square", w: 900, h: 900, position: "60% 50%", role: "gallery" },
  ];
  const html = `<img src="images/a-wide.jpg" width="10" height="10"><img src="images/b-square.jpg" style="object-position:40% 50%"><img src="images/b-square.jpg" style="object-position:40% 50%"><img src="images/logo.png"><img src="images/logo.png">`;
  const out = fixPageImages(html, slots);
  assert.match(out, /src="images\/a-wide.jpg" width="1600" height="900"/);
  assert.equal((out.match(/b-square/g) ?? []).length, 1);
  assert.match(out, /c-square.jpg[^>]*object-position:60% 50%/);
  assert.equal((out.match(/logo.png/g) ?? []).length, 2, "the logo may appear twice");
});

test("website chat edits: blocks are parsed and applied exactly or ignoring spacing", () => {
  const page = `<h1 class="t">Fruta fresca</h1>\n<p>Hola</p>\n<style>a{}</style>`;
  const { summary, blocks } = parseEdits(`SUMMARY: Título cambiado\n<<<<<<< FIND\n<h1 class="t">Fruta fresca</h1>\n=======\n<h1 class="t">La mejor fruta</h1>\n>>>>>>> END\n<<<<<<< FIND\n<p>Hola</p>   \n<style>a{}</style>\n=======\n<p>Hola</p>\n<style>a{} h1{color:red}</style>\n>>>>>>> END\n<<<<<<< FIND\nnot on the page\n=======\nx\n>>>>>>> END`);
  assert.equal(summary, "Título cambiado");
  assert.equal(blocks.length, 3);
  const r = applyEdits(page, blocks);
  assert.equal(r.applied, 2);
  assert.equal(r.failed.length, 1);
  assert.match(r.html, /La mejor fruta/);
  assert.match(r.html, /h1\{color:red\}/);
});
