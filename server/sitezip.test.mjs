import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { readSiteZip } from "./sitezip.mjs";
import { isPrivateAddress, summarise, safeGet, referenceBlock } from "./reference.mjs";

const zip = (files) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)]))));

test("an uploaded site zip is checked, unwrapped and cleaned", () => {
  const ok = readSiteZip(zip({ "my-site/index.html": "<h1>x</h1>", "my-site/css/a.css": "a{}", "my-site/.DS_Store": "x", "__MACOSX/x": "y" }));
  assert.deepEqual(Object.keys(ok).sort(), ["css/a.css", "index.html"]);
  assert.throws(() => readSiteZip(zip({ "index.html": "x", "run.sh": "rm -rf /" })), /not allowed/);
  assert.throws(() => readSiteZip(zip({ "../evil.html": "x", "index.html": "x" })), /Unsafe/);
  assert.throws(() => readSiteZip(zip({ "page.html": "x" })), /index\.html/);
  assert.throws(() => readSiteZip(Buffer.from("not a zip")), /not a readable zip/);
});

test("example sites: private addresses are refused, pages are summarised", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "169.254.169.254", "172.20.1.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
  assert.ok(!isPrivateAddress("93.184.216.34"));
  const pub = async () => [{ address: "93.184.216.34" }];
  const priv = async () => [{ address: "10.0.0.7" }];
  await assert.rejects(safeGet("http://localhost/", { lookupImpl: pub, fetchImpl: async () => new Response("x") }), /private/);
  await assert.rejects(safeGet("https://intranet.example/", { lookupImpl: priv, fetchImpl: async () => new Response("x") }), /private/);
  await assert.rejects(safeGet("https://ok.example/", { lookupImpl: pub, fetchImpl: async () => new Response("", { status: 302, headers: { location: "http://169.254.169.254/" } }) }), /private/);
  const html = `<html><head><title>Casa Mar</title><meta name="description" content="Seafood"><link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400&display=swap" rel="stylesheet"><style>:root{--brand:#c0392b} a{color:#c0392b}</style></head><body><nav><a>Menu</a><a>Visit</a></nav><header class="hero"><h1>Fresh fish</h1></header><section id="menu"><h2>Our menu</h2></section></body></html>`;
  const s = summarise(html);
  assert.equal(s.title, "Casa Mar");
  assert.deepEqual(s.nav, ["Menu", "Visit"]);
  assert.ok(s.fonts.includes("Fraunces") && s.colours.includes("#c0392b") && s.sections.some((x) => x.startsWith("section#menu")));
  const client = { exampleUrls: ["https://ok.example/"], profile: { examples: ["https://ok.example/"] } };
  const text = await referenceBlock(client, { lookupImpl: pub, fetchImpl: async () => new Response(html, { headers: { "content-type": "text/html" } }) });
  assert.match(text, /Example websites the business likes/);
  assert.match(text, /Casa Mar/);
  assert.equal((text.match(/Reference website:/g) ?? []).length, 1); // the same link from both sides is read once
});
