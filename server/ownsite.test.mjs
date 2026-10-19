import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Isolate from real data: set before the store module is first imported.
const tmp = mkdtempSync(join(tmpdir(), "isla-unit-"));
process.env.DATA_DIR = tmp;
process.env.SITES_DIR = join(tmp, "sites");
const { normalizeWebsiteUrl, ownWebsite, ownSiteInfo } = await import("./ownsite.mjs");
const { buildSite } = await import("./sitebuilder.mjs");

test("normalizeWebsiteUrl accepts domains and urls, rejects junk", () => {
  assert.equal(normalizeWebsiteUrl("tuweb.com"), "https://tuweb.com/");
  assert.equal(normalizeWebsiteUrl(" http://x.es/carta#a "), "http://x.es/carta");
  assert.equal(normalizeWebsiteUrl("javascript:alert(1)"), "");
  assert.equal(normalizeWebsiteUrl("not a url"), "");
  assert.equal(normalizeWebsiteUrl(""), "");
});

test("ownWebsite only applies in own mode with a valid url", () => {
  assert.equal(ownWebsite({ websiteMode: "own", websiteUrl: "bar.es" }), "https://bar.es/");
  assert.equal(ownWebsite({ websiteMode: "ai", websiteUrl: "bar.es" }), "");
  assert.equal(ownWebsite({ websiteMode: "own", websiteUrl: "" }), "");
  assert.equal(ownSiteInfo({ websiteMode: "ai", websiteUrl: "bar.es" }), null);
  assert.equal(ownSiteInfo({ id: "none", websiteMode: "own", websiteUrl: "bar.es" }).url, "https://bar.es/");
});

test("buildSite does nothing for a business with its own website", async () => {
  const c = { id: "own1", name: "Bar", websiteMode: "own", websiteUrl: "bar.es" };
  await buildSite(c);
  assert.equal(c.site, undefined);
});
