import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHtml, pageProblem, sanitize, assemble, readMeta } from "./webpage.mjs";

const PAGE = (body) => `<!doctype html><html lang="xx"><head><!-- design: warm sand, Fraunces + Inter --><title>Tasca · Seafood</title><meta name="description" content="Fresh fish"><meta property="og:title" content="old"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="stylesheet" href="https://evil.example/x.css"><style>@import url("https://evil.example/a.css"); .hero{background:url(images/hero.jpg)} .x{background:url(https://evil.example/t.png)}</style></head><body><header><nav class="langs" data-lang-switch></nav></header>${body}</body></html>`;

test("extracts HTML from fenced or chatty replies", () => {
  assert.equal(extractHtml("Here you go:\n```html\n<!doctype html><html><body><h1>x</h1></body></html>\n```\nEnjoy"), "<!doctype html><html><body><h1>x</h1></body></html>");
  assert.match(extractHtml("Sure! <!DOCTYPE html><html><body></body></html> thanks"), /^<!DOCTYPE html>.*<\/html>$/);
  assert.equal(extractHtml("no html here"), null);
  assert.equal(pageProblem("<!doctype html><html><body><h1>x</h1>"), "the page was cut off");
});

test("removes scripts, handlers, outside images and iframes but keeps maps and fonts", () => {
  const dirty = PAGE(`<h1 onclick="alert(1)">Tasca</h1><script>alert(1)</script><script src="https://evil.example/a.js"></script>
    <img src="images/hero.jpg" alt="hero" onerror="x()"><img src="https://evil.example/p.jpg" alt="ext"><img src="images/nope.jpg">
    <a href="javascript:alert(1)">bad</a><a href="https://wa.me/34600">WhatsApp</a>
    <iframe src="https://evil.example/frame"></iframe><iframe src="https://maps.google.com/maps?q=Los%20Cristianos&output=embed" title="Map"></iframe>
    <form action="https://evil.example"><input name="x"><button>Send</button></form><svg><foreignObject><div>x</div></foreignObject></svg>`);
  const s = sanitize(dirty, { images: ["images/hero.jpg", "images/logo.png"], fallbackImage: "images/hero.jpg" });
  assert.doesNotMatch(s, /<script|onclick|onerror|javascript:|evil\.example\/(a\.js|frame|x\.css|a\.css|t\.png)|<form|<input|foreignObject/i);
  assert.match(s, /fonts\.googleapis\.com\/css2\?family=Inter/);
  assert.match(s, /maps\.google\.com\/maps\?q=Los%20Cristianos&output=embed/);
  assert.match(s, /url\(images\/hero\.jpg\)/);
  assert.equal((s.match(/src="images\/hero\.jpg"/g) ?? []).length, 3, "outside and unknown pictures become the hero");
  assert.match(s, /href="https:\/\/wa\.me\/34600"/);
});

test("assembles the SEO head, language switcher and sub-folder image paths", () => {
  const clean = sanitize(PAGE(`<h1>Tasca</h1><img src="images/hero.jpg" alt="">`), { images: ["images/hero.jpg"] });
  const meta = readMeta(clean);
  assert.equal(meta.title, "Tasca · Seafood");
  assert.equal(meta.design, "warm sand, Fraunces + Inter");
  const urls = { es: "https://t.es/", en: "https://t.es/en/" };
  const ld = [{ "@context": "https://schema.org", "@type": "Restaurant", name: "Tasca </script>" }];
  const en = assemble(clean, { lang: "en", langs: ["es", "en"], urls, title: meta.title, description: meta.description, ogImage: "https://t.es/images/hero.jpg", ld, rel: "../" });
  assert.match(en, /^<!doctype html>/);
  assert.match(en, /<html lang="en">/);
  assert.match(en, /<link rel="canonical" href="https:\/\/t\.es\/en\/">/);
  assert.match(en, /hreflang="x-default" href="https:\/\/t\.es\/"/);
  assert.match(en, /Content-Security-Policy/);
  assert.equal((en.match(/og:title/g) ?? []).length, 1, "the model's own og tags are replaced");
  assert.match(en, /src="\.\.\/images\/hero\.jpg"/);
  assert.match(en, /url\(\.\.\/images\/hero\.jpg\)/);
  assert.match(en, /data-lang-switch><a href="\.\.\/" hreflang="es"/);
  assert.match(en, /\\u003c\/script>/, "JSON-LD can't close its own script tag");
  assert.equal((en.match(/<script/g) ?? []).length, 1, "only the JSON-LD script");
});

test("a broken <title> or unclosed <style> can't blank the page", () => {
  const broken = `<!doctype html><html><head><title>Frutería – Fruta fresca</meta><style>body{color:red}</style></head><body><h1>Hola</h1><textarea>x</body></html>`;
  const clean = sanitize(broken, {});
  assert.match(clean, /<title>Frutería – Fruta fresca<\/title>/);
  assert.doesNotMatch(clean, /<\/meta>|<textarea/);
  assert.equal(readMeta(clean).title, "Frutería – Fruta fresca");
  const page = assemble(clean, { lang: "es", langs: ["es"], urls: { es: "https://x.es/" }, title: "T", description: "D" });
  assert.equal((page.match(/<title>/g) ?? []).length, 1);
  assert.match(page, /<h1>Hola<\/h1>/);
  assert.equal(pageProblem(`<!doctype html><html><head><style>body{}</head><body><h1>x</h1>${"y".repeat(4000)}</body></html>`), "a <style> is not closed");
});
