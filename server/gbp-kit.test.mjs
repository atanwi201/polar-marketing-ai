import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "gbp-kit-"));
process.env.DATA_DIR = join(root, "data"); process.env.SITES_DIR = join(root, "sites");
const K = await import("./gbp-kit.mjs");

const client = () => ({
  id: "casa-mar", name: "Casa Mar", kind: "Restaurante", town: "Los Cristianos", phone: "+34 922 000 111",
  websiteUrl: "https://casamar.es", hours: "Lun-Sáb 13:00-23:00",
  profile: {
    tagline: "Cocina canaria frente al mar",
    story: "Abrimos en 2019 con pescado del día y recetas de la abuela. Terraza sobre la playa, menú del día a mediodía.",
    services: ["Menú del día", "Pescado fresco", "Terraza"],
  },
  photos: [{ file: "casa-1.jpg" }, { file: "casa-2.jpg" }, { file: "casa-3.jpg" }],
});

test("the kit is complete enough to paste with no AI and no network", () => {
  const kit = K.baseKit(client(), "es");
  assert.equal(kit.identity.name, "Casa Mar");
  assert.equal(kit.identity.town, "Los Cristianos");
  assert.equal(kit.identity.website, "https://casamar.es");
  assert.ok(kit.description.length > 0 && kit.description.length <= K.DESC_MAX);
  assert.match(kit.description, /Casa Mar/);
  assert.equal(kit.categoryHints[0], "Restaurante");
  assert.equal(kit.services.length, 3);
  assert.equal(kit.photos.length, 3);
  assert.match(kit.photos[0].alt, /Casa Mar · Restaurante · Los Cristianos/);
  assert.equal(kit.source, "profile");
  assert.equal(kit.posts.length, 0, "posts need the AI; the profile draft stays honest about it");
});

test("the description never exceeds Google's 750 characters and never cuts a word in half", () => {
  const c = client();
  c.profile.story = "palabra ".repeat(400);
  const kit = K.baseKit(c, "es");
  assert.ok(kit.description.length <= K.DESC_MAX);
  assert.ok(kit.description.length > K.DESC_MAX - 10, "it should use the space it has");
  assert.doesNotMatch(kit.description, /palab$/);
  assert.equal(K.clamp("  hola   mundo  ", 100), "hola mundo");
});

test("phone numbers are stripped from post text, prices and years are not", () => {
  assert.equal(K.redactPhones("Llama al +34 612 345 678 para reservar").includes("612"), false);
  assert.match(K.redactPhones("Menú del día 12,50 € desde 2019"), /12,50 € desde 2019/);
  assert.match(K.redactPhones("Abrimos a las 13:00"), /13:00/);
});

test("AI output is clamped, de-phoned and capped at ten posts", async () => {
  const posts = Array.from({ length: 14 }, (_, i) => ({ type: "update", text: `Post ${i} +34 612 345 678` }));
  const kit = await K.draftKit(client(), {
    lang: "es",
    complete: async () => ({ json: { description: "x".repeat(2000), categoryHints: ["Restaurante", "Tapas bar"], posts }, text: "" }),
  });
  assert.ok(kit.description.length <= K.DESC_MAX);
  assert.equal(kit.posts.length, 10);
  assert.ok(kit.posts.every((p) => !p.text.includes("612")));
  assert.deepEqual(kit.categoryHints, ["Restaurante", "Tapas bar"]);
  assert.equal(kit.source, "ai");
});

test("a provider outage falls back to the profile draft instead of failing the shop", async () => {
  const kit = await K.draftKit(client(), { lang: "es", complete: async () => { throw new Error("429 no models"); } });
  assert.equal(kit.source, "profile");
  assert.ok(kit.description.length > 0);
});

test("an empty AI answer never blanks the kit", async () => {
  const kit = await K.draftKit(client(), { lang: "es", complete: async () => ({ json: null, text: "not json" }) });
  assert.ok(kit.description.length > 0);
  assert.equal(kit.source, "profile");
});

test("status is additive, validated, and never loses an existing kit", () => {
  const c = client();
  const first = K.ensureGbp(c);
  first.kit = { description: "kept" };
  K.ensureGbp(c);
  assert.deepEqual(c.gbp.kit, { description: "kept" }, "re-entering must not wipe generated copy");
  assert.equal(K.setStatus(c, { status: "verification_pending", notes: "Postcard sent 2 Nov" }).status, "verification_pending");
  assert.throws(() => K.setStatus(c, { status: "almost" }), (e) => e.status === 400);
  assert.equal(K.gbpView(c).status, "verification_pending");
  assert.equal(K.gbpView(c).kit.description, "kept");
});
