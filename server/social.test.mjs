import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Isolate from real data: set before the store module is first imported.
const tmp = mkdtempSync(join(tmpdir(), "isla-unit-"));
process.env.DATA_DIR = tmp;
process.env.SITES_DIR = join(tmp, "sites");
const { oauth1, textFor, youtubeTitle, maskAccounts, mergeAccounts, connections } = await import("./social.mjs");

test("OAuth 1.0a signature matches X's documented example", () => {
  // https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature
  const h = oauth1("POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true", {
    key: "xvz1evFS4wEEPTGEFPHBog", secret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  }, { form: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" }, nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: "1318622958" });
  assert.match(h, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test("X text fits 280 characters and keeps some hashtags", () => {
  const item = { captions: { es: "x".repeat(900) }, short: { es: "Plátanos baratos hoy en el Mercado de África. " + "y".repeat(300) }, hashtags: ["tenerife", "frutas", "mercado", "canarias"] };
  const t = textFor(item, "x", "es");
  assert.ok(t.length <= 280, `${t.length} chars`);
  const short = textFor({ ...item, short: { es: "Plátanos baratos hoy" } }, "x", "es");
  assert.equal(short, "Plátanos baratos hoy\n\n#tenerife #frutas #mercado");
  assert.equal(textFor({ captions: { es: "Hola" }, hashtags: ["a"] }, "instagram", "es"), "Hola\n\n#a");
});

test("YouTube titles stay under 100 characters with #Shorts", () => {
  const t = youtubeTitle({ title: { es: "<b>" + "z".repeat(150) } }, "es");
  assert.ok(t.length <= 100 && t.endsWith("#Shorts") && !/[<>]/.test(t));
});

test("tokens are masked for the studio and kept when the mask comes back", () => {
  const stored = { facebook: { pageId: "123", token: "EAAB-secret-9876" } };
  const masked = maskAccounts(stored);
  assert.equal(masked.facebook.token, "••••9876");
  assert.equal(masked.facebook.pageId, "123");
  const merged = mergeAccounts(stored, { facebook: { pageId: "456", token: masked.facebook.token }, x: { token: "t", secret: "s" } });
  assert.equal(merged.facebook.token, "EAAB-secret-9876");
  assert.equal(merged.facebook.pageId, "456");
  assert.equal(merged.x.secret, "s");
  delete process.env.X_API_KEY;
  const c = connections({ accounts: merged });
  assert.equal(c.facebook.ready, true);
  assert.equal(c.instagram.ready, false);
  assert.match(c.x.missing, /X_API_KEY/);
});
