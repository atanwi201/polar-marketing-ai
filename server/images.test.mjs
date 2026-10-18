import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.POLLINATIONS_GAP_MS = "0";
process.env.GOOGLE_API_KEY = "";
process.env.GEMINI_API_KEY = "";
const { generateImage, finishImage } = await import("./images.mjs");
import { createCanvas, loadImage } from "@napi-rs/canvas";

const jpeg = (w, h) => { const c = createCanvas(w, h); const x = c.getContext("2d"); x.fillStyle = "#e9b23a"; x.fillRect(0, 0, w, h); x.fillStyle = "#000"; x.fillRect(0, h - 20, w, 20); return c.toBuffer("image/jpeg"); };

test("the logo strip is cut and the image is scaled to the size asked for", async () => {
  const out = await loadImage(await finishImage(jpeg(768, 830), [1080, 1080]));
  assert.deepEqual([out.width, out.height], [1080, 1080]);
  const px = createCanvas(1080, 1080).getContext("2d");
  px.drawImage(out, 0, 0);
  const [r, g] = px.getImageData(540, 1075, 1, 1).data;
  assert.ok(r > 150 && g > 100, "bottom row is picture, not the dark logo strip");
});

test("a free-limit answer waits and tries again", async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1
    ? new Response(JSON.stringify({ error: { message: "Free limit reached" } }), { status: 402, headers: { "retry-after": "0", "content-type": "application/json" } })
    : new Response(jpeg(64, 70), { headers: { "content-type": "image/jpeg" } }));
  const file = join(mkdtempSync(join(tmpdir(), "img-")), "a.jpg");
  await generateImage("bananas", file, { size: [64, 64], fetchImpl });
  assert.equal(n, 2);
  assert.ok(readFileSync(file).length > 100);
});

const { configureImages, nearestRatio, findImageData } = await import("./images.mjs");

test("with a Google key, images come from Gemini with the right ratio and the client's photo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "img-"));
  const ref = join(dir, "ref.jpg");
  (await import("node:fs")).writeFileSync(ref, jpeg(40, 40));
  configureImages(() => ({ provider: "google", googleKey: "AIza-test", googleModel: "gemini-nano-banana-2.1" }));
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: "i1", status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/jpeg", data: jpeg(576, 1024).toString("base64") }] }] }));
  };
  const file = join(dir, "g.jpg");
  const out = await generateImage("bananas at a market", file, { size: [1080, 1920], reference: ref, fetchImpl });
  assert.equal(out.engine, "google/gemini-nano-banana-2.1");
  assert.match(seen[0].url, /\/v1beta\/interactions$/);
  assert.equal(seen[0].init.headers["x-goog-api-key"], "AIza-test");
  assert.equal(seen[0].body.response_format.aspect_ratio, "9:16");
  assert.equal(seen[0].body.input[1].type, "image");
  const img = await loadImage(readFileSync(file));
  assert.deepEqual([img.width, img.height], [1080, 1920]);
  configureImages(() => ({}));
});

test("if Google fails, the free service takes over", async () => {
  configureImages(() => ({ provider: "google", googleKey: "bad" }));
  const fetchImpl = async (url) => (String(url).includes("/v1beta/")
    ? new Response(JSON.stringify({ error: { code: 400, message: "API key not valid" } }), { status: 400 })
    : new Response(jpeg(64, 70), { headers: { "content-type": "image/jpeg" } }));
  const out = await generateImage("x", join(mkdtempSync(join(tmpdir(), "img-")), "f.jpg"), { size: [64, 64], fetchImpl });
  assert.equal(out.engine, "free");
  assert.match(out.note, /API key not valid/);
  configureImages(() => ({}));
});

test("ratios and response shapes", () => {
  assert.deepEqual([[1080, 1080], [1080, 1920], [1600, 900], [1080, 1350]].map(nearestRatio), ["1:1", "9:16", "16:9", "4:5"]);
  assert.equal(findImageData({ output_image: { data: "A" } }), "A");
  assert.equal(findImageData({ candidates: [{ content: { parts: [{ text: "hi" }, { inlineData: { data: "B" } }] } }] }), "B");
  assert.equal(findImageData({ steps: [{ type: "thought" }] }), null);
});

test("the free engine is the default, even with a Google key saved", async () => {
  configureImages(() => ({ googleKey: "AIza-saved" }));
  const urls = [];
  const fetchImpl = async (url) => { urls.push(String(url)); return String(url).endsWith("/models")
    ? new Response(JSON.stringify(["sana"]))
    : new Response(jpeg(64, 70), { headers: { "content-type": "image/jpeg" } }); };
  const out = await generateImage("x", join(mkdtempSync(join(tmpdir(), "img-")), "f.jpg"), { size: [64, 64], fetchImpl });
  assert.equal(out.engine, "free");
  assert.ok(urls.some((u) => u.includes("/prompt/") && u.includes("model=sana")), "uses the model the free service offers");
  assert.ok(!urls.some((u) => u.includes("googleapis")));
  configureImages(() => ({}));
});

test("OpenRouter images use the /images endpoint with the OpenRouter key", async () => {
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  configureImages(() => ({ provider: "openrouter", openrouterModel: "black-forest-labs/flux.2-klein-4b" }));
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ data: [{ b64_json: jpeg(576, 1024).toString("base64"), media_type: "image/jpeg" }] }));
  };
  const file = join(mkdtempSync(join(tmpdir(), "img-")), "o.jpg");
  const out = await generateImage("bananas", file, { size: [1080, 1920], fetchImpl });
  assert.equal(out.engine, "openrouter/black-forest-labs/flux.2-klein-4b");
  assert.match(seen[0].url, /\/images$/);
  assert.equal(seen[0].init.headers.Authorization, "Bearer sk-or-test");
  assert.equal(seen[0].body.aspect_ratio, "9:16");
  assert.equal(seen[0].body.model, "black-forest-labs/flux.2-klein-4b");
  const img = await loadImage(readFileSync(file));
  assert.deepEqual([img.width, img.height], [1080, 1920]);
  delete process.env.OPENROUTER_API_KEY;
  configureImages(() => ({}));
});

test("forceFree uses Pollinations even when a paid engine is chosen", async () => {
  configureImages(() => ({ provider: "google", googleKey: "AIza-test" }));
  const urls = [];
  const fetchImpl = async (url) => { urls.push(String(url)); return new Response(jpeg(64, 70), { headers: { "content-type": "image/jpeg" } }); };
  const file = join(mkdtempSync(join(tmpdir(), "img-")), "f.jpg");
  const out = await generateImage("bananas", file, { size: [64, 64], fetchImpl, forceFree: true });
  assert.equal(out.engine, "free");
  assert.ok(urls.every((u) => !u.includes("/v1beta/")));
  configureImages(() => ({}));
});
