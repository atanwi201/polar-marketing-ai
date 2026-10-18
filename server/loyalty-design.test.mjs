import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "loy-design-"));
const { designProgram, normalizeDesign, defaultDesign, contrast, ensureContrast, icon, keptFields, STRIP_SIZE } = await import("./loyalty-design.mjs");
const { MEDIA_DIR } = await import("./store.mjs");
import { createCanvas, loadImage } from "@napi-rs/canvas";

const client = { id: "c1", name: "Café Sol", kind: "cafe", town: "Adeje", profile: { colors: { primary: "#c0392b", accent: "#f1c40f" } } };
const prog = { id: "p1", type: "stamps", design: {} };
const jpeg = () => { const c = createCanvas(300, 120); const x = c.getContext("2d"); x.fillStyle = "#3a7"; x.fillRect(0, 0, 300, 120); return c.toBuffer("image/jpeg"); };
const fakeGen = (calls = []) => async (prompt, file, opts) => { calls.push({ prompt, opts }); writeFileSync(file, jpeg()); return { engine: "free" }; };
const ok = (json) => async () => ({ json, model: "fake/model", text: "" });

test("contrast is enforced on every text colour", () => {
  assert.ok(contrast(ensureContrast("#777777", "#808080"), "#808080") >= 4.5);
  const d = normalizeDesign({ background: "#ffffff", foreground: "#fefefe", label: "#eeeeee", accent: "#ffffff" }, client);
  assert.ok(contrast(d.foreground, d.background) >= 4.5);
  assert.ok(contrast(d.label, d.background) >= 4.5);
});

test("normalizeDesign repairs bad fields", () => {
  const d = normalizeDesign({ background: "red", fontStyle: "comic", layout: "wild", cardTitle: "x".repeat(99) + "—", stampIcon: "abc", logoFile: "../../etc/passwd", stripFile: "a.png" }, client);
  assert.match(d.background, /^#[0-9a-f]{6}$/);
  assert.equal(d.fontStyle, "modern");
  assert.equal(d.layout, "minimal"); // wild -> default, stripe/full without a picture too
  assert.ok(d.cardTitle.length <= 28 && !d.cardTitle.includes("—"));
  assert.equal(d.logoFile, "");
  assert.equal(d.stripFile, "a.png");
  assert.equal(icon("🍕🍔", "x"), "🍕");
  assert.equal(icon("", "⭐"), "⭐");
  assert.equal(normalizeDesign({ layout: "stripe", stripFile: "s.png" }, client).layout, "stripe");
});

test("offline: deterministic design from brand colours, no image calls", async () => {
  const calls = [];
  const d = await designProgram(prog, client, { prompt: "warm", deps: { aiKey: () => "", generateImage: fakeGen(calls) } });
  assert.equal(calls.length, 0);
  assert.equal(d.layout, "minimal");
  assert.equal(d.background, "#c0392b");
  assert.equal(d.generatedBy.model, "default");
  assert.equal(d.prompt, "warm");
  assert.ok(contrast(d.foreground, d.background) >= 4.5);
  assert.equal(defaultDesign({ name: "X" }).layout, "minimal");
});

test("AI answer drives the design and the strip is generated with forceFree", async () => {
  const calls = [];
  const d = await designProgram(prog, { ...client, logoFile: "logo-1.png" }, {
    prompt: "sunny beach vibe",
    deps: {
      aiKey: () => "k", generateImage: fakeGen(calls),
      complete: ok({ background: "#0a3d62", foreground: "#222222", label: "#333333", accent: "#f6b93b", fontStyle: "rounded", layout: "stripe", cardTitle: "Café Sol", tagline: "Un café, un sello", stampIcon: "☕", stampEmptyIcon: "○", imagePrompt: "latte art on a wooden table" }),
    },
  });
  assert.equal(d.layout, "stripe");
  assert.equal(d.fontStyle, "rounded");
  assert.equal(d.generatedBy.model, "fake/model");
  assert.equal(d.logoFile, "logo-1.png");
  assert.ok(contrast(d.foreground, d.background) >= 4.5, "dark foreground on dark bg repaired");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.forceFree, true);
  assert.match(calls[0].prompt, /latte art/);
  assert.match(d.stripFile, /^loy-p1-strip-.*\.png$/);
  const img = await loadImage(join(MEDIA_DIR, d.stripFile));
  assert.deepEqual([img.width, img.height], STRIP_SIZE);
  assert.ok(!existsSync(join(MEDIA_DIR, d.stripFile.replace(/\.png$/, "-raw.jpg"))));
});

test("image failure falls back to a flat card, AI failure to the default", async () => {
  const bad = async () => { throw new Error("busy"); };
  const d = await designProgram(prog, client, { prompt: "x", deps: { aiKey: () => "k", complete: ok({ layout: "full", background: "#112233" }), generateImage: bad } });
  assert.equal(d.layout, "minimal");
  assert.equal(d.backgroundFile, "");
  assert.equal(d.background, "#112233");
  const e = await designProgram(prog, client, { deps: { aiKey: () => "k", complete: bad, generateImage: fakeGen() } });
  assert.equal(e.generatedBy.model, "default");
  const g = await designProgram(prog, client, { deps: { aiKey: () => "k", complete: async () => ({ json: ["no"], model: "m" }), generateImage: fakeGen() } });
  assert.equal(g.generatedBy.model, "default");
});

test("keep preserves chosen fields and pictures", async () => {
  const old = { ...defaultDesign(client), background: "#123456", foreground: "#ffffff", label: "#dddddd", accent: "#ff9900", logoFile: "mine.png", layout: "stripe", stripFile: "loy-p1-strip-old.png" };
  const calls = [];
  const d = await designProgram({ ...prog, design: old }, client, {
    prompt: "new", keep: ["logoFile", "palette", "stripFile", "layout"],
    deps: { aiKey: () => "k", generateImage: fakeGen(calls), complete: ok({ background: "#ff0000", layout: "minimal", fontStyle: "mono", cardTitle: "Neu", imagePrompt: "p" }) },
  });
  assert.equal(d.background, "#123456");
  assert.equal(d.accent, "#ff9900");
  assert.equal(d.logoFile, "mine.png");
  assert.equal(d.layout, "stripe");
  assert.equal(d.stripFile, "loy-p1-strip-old.png");
  assert.equal(d.fontStyle, "mono");
  assert.equal(d.cardTitle, "Neu");
  assert.equal(calls.length, 0);
  assert.deepEqual([...keptFields(["palette"])].sort(), ["accent", "background", "foreground", "label"]);
});

test("full layout makes a darkened portrait background", async () => {
  const calls = [];
  const d = await designProgram(prog, client, { prompt: "p", deps: { aiKey: () => "k", generateImage: fakeGen(calls), complete: ok({ layout: "full", background: "#222244", imagePrompt: "night market" }) } });
  assert.equal(d.layout, "full");
  const img = await loadImage(join(MEDIA_DIR, d.backgroundFile));
  assert.deepEqual([img.width, img.height], [1080, 1440]);
});
