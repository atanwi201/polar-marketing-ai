import { test } from "node:test";
import assert from "node:assert/strict";
import { joinPage, joinLang, cardPage, staffPage, manifest, cardStyles, qrInline, unsubPage } from "./loyalty-pages.mjs";

const design = (o = {}) => ({ prompt: "", background: "#3b1d0e", foreground: "#fff4e0", label: "#e0b98a", accent: "#f2a33a", fontStyle: "serif", layout: "stripe", cardTitle: "Coffee Club", tagline: "Every 8th coffee on us", stampIcon: "X", stampEmptyIcon: "o", logoFile: "logo.png", stripFile: "strip.jpg", backgroundFile: "bg.jpg", ...o });
const program = (o = {}) => ({ id: "p1", name: "Coffee Club", type: "stamps", status: "live", joinCode: "abc123", design: design(), stamps: { goal: 8, perVisit: 1, minSpendEur: 0 }, tiers: [], terms: "No cash value.", welcomeBonus: { stamps: 1, points: 0 }, rewards: [{ id: "r1", name: "Free coffee", description: "Any size", kind: "stamps", cost: 8, expiresDays: 30, minTier: "", active: true }], ...o });
const faceOf = (html) => html.slice(html.indexOf('<div id="face">'), html.indexOf('<button class="wc-qr"'));
const view = (o = {}) => ({
  business: { name: "Cafe Marron" }, program: program(),
  customer: { id: "u1", name: "Ana", stamps: 5, points: 0, lifetimePoints: 0, tier: "", nextTier: null, visits: 3 },
  code: "LC1-u1", rewards: [{ id: "r1", name: "Free coffee", cost: 8, kind: "stamps", available: false, remaining: 3 }],
  history: [{ at: "2026-10-12T09:00:00Z", type: "visit", stamps: 1, points: 0, note: "" }],
  wallet: { available: false, url: "" }, installUrl: "/card/tok123", ...o,
});

test("card page renders the design, stamps, QR and rewards", () => {
  const html = cardPage({ view: view() });
  assert.match(html, /--bg:#3b1d0e/);
  assert.match(html, /--ac:#f2a33a/);
  assert.match(html, /Fraunces/);
  assert.match(html, /class="wc stripe has-img"/);
  assert.match(html, /url\(\/media\/strip\.jpg\)/);
  assert.match(html, /src="\/media\/logo\.png"/);
  assert.equal((faceOf(html).match(/wc-st on/g) || []).length, 5);
  assert.equal((faceOf(html).match(/wc-st off/g) || []).length, 3);
  assert.match(html, /<svg class="qr"/);
  assert.match(html, /LC1-u1/);
  assert.match(html, /3 more stamps/);
  assert.match(html, /rel="manifest" id="mf" href="\/card\/tok123\/manifest\.webmanifest"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /name="theme-color" content="#3b1d0e"/);
  assert.match(html, /apple-touch-icon" href="\/media\/logo\.png"/);
  assert.match(html, /\/api\/loyalty\/card\//);
  assert.doesNotMatch(html, /Add to Apple Wallet/);
  assert.match(html, /Add to Home Screen/);
  assert.match(html, /No cash value\./);
});

test("wallet button only when wallet is available", () => {
  const html = cardPage({ view: view({ wallet: { available: true, url: "/card/tok123/pass.pkpass" } }) });
  assert.match(html, /href="\/card\/tok123\/pass\.pkpass"/);
  assert.match(html, /Add to Apple Wallet/);
  assert.doesNotMatch(html, /id="hint"/);
});

test("points and custom layouts, full and minimal", () => {
  const pv = view({
    program: program({ type: "points", tiers: [{ name: "Bronze", minPoints: 0 }, { name: "Silver", minPoints: 200 }], design: design({ layout: "full" }) }),
    customer: { id: "u1", name: "Ana", stamps: 0, points: 120, lifetimePoints: 120, tier: "Bronze", nextTier: { name: "Silver", pointsToGo: 80 }, visits: 2 },
    rewards: [{ id: "r1", name: "Mug", cost: 100, kind: "points", available: true, remaining: 0 }],
  });
  const html = cardPage({ view: pv });
  assert.match(html, /class="wc full has-img"/);
  assert.match(html, /url\(\/media\/bg\.jpg\)/);
  assert.match(faceOf(html), /wc-pts">120</);
  assert.match(html, /80 points to Silver/);
  assert.match(html, /Ready to claim/);
  assert.doesNotMatch(faceOf(html), /wc-strip/);
  const cv = view({ program: program({ type: "custom", design: design({ layout: "minimal" }) }) });
  const c = cardPage({ view: cv });
  assert.match(c, /class="wc minimal"/);
  assert.match(faceOf(c), /wc-pts/);
  assert.equal((faceOf(c).match(/wc-st on/g) || []).length, 5);
});

test("escapes customer and business data and rejects bad colours/files", () => {
  const evil = '<script>alert(1)</script>"\'';
  const v = view({
    business: { name: evil },
    customer: { id: "u1", name: evil, stamps: 1, points: 0, lifetimePoints: 0, tier: "", nextTier: null, visits: 1 },
    program: program({ name: evil, terms: evil, design: design({ cardTitle: evil, tagline: evil, background: "red;}</style><script>x", logoFile: "../x\"onerror=1", stripFile: "a b.png" }) }),
    history: [{ at: "2026-10-12T09:00:00Z", type: "visit", stamps: 1, points: 0, note: evil }],
  });
  const html = cardPage({ view: v });
  assert.doesNotMatch(html, /<script>alert\(1\)/);
  assert.doesNotMatch(html, /<\/style><script>x/);
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, "");
  assert.doesNotMatch(markup, /onerror=1/);
  assert.doesNotMatch(markup, /\/media\/\.\./);
  assert.match(html, /&lt;script&gt;alert\(1\)/);
  assert.match(html, /--bg:#14232b/); // fell back to the safe default
  // JSON embedded in the script cannot close the tag
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  const j = joinPage({ program: program({ name: evil, terms: evil }), client: { name: evil } });
  assert.doesNotMatch(j, /<script>alert\(1\)/);
  const s = staffPage({ program: program({ name: evil }), client: { name: evil } });
  assert.doesNotMatch(s, /<script>alert\(1\)/);
});

test("join page: phone only, one button, preview, closed state", () => {
  const html = joinPage({ program: program(), client: { name: "Cafe Marron" } });
  assert.match(html, /<html lang="es">/);
  assert.match(html, /Únete a Coffee Club/);
  assert.match(html, /\/api\/loyalty\/join\//);
  assert.match(html, /"abc123"/);
  assert.match(html, /id="phone"/);
  assert.match(html, /autocomplete="tel"/);
  assert.match(html, /inputmode="tel"/);
  assert.match(html, /name="name"/);
  assert.doesNotMatch(html, /name="email"/, "no email field any more");
  assert.doesNotMatch(html, /marketingConsent/, "consent is its own task (C3)");
  assert.match(html, /1 sello gratis/);
  assert.match(html, /Free coffee/);
  assert.match(html, /Quiero mi tarjeta/);
  assert.match(html, /<span class="wc-st on">X<\/span>/);
  const draft = joinPage({ program: program({ status: "draft" }), client: { name: "Cafe Marron" } });
  assert.match(draft, /Todavía no está abierta/);
  assert.doesNotMatch(draft, /<form/);
  assert.doesNotMatch(draft, /\/api\/loyalty\/join/);
});

test("join page: English on request, Spanish by default", () => {
  const en = joinPage({ program: program(), client: { name: "Cafe Marron" }, lang: "en" });
  assert.match(en, /<html lang="en">/);
  assert.match(en, /Join Coffee Club/);
  assert.match(en, /1 free stamp/);
  assert.match(en, /What you can earn/);
  assert.match(en, /Get my card/);
  assert.doesNotMatch(en, /marketingConsent/);
  const other = joinPage({ program: program(), client: { name: "Cafe Marron" }, lang: "fr" });
  assert.match(other, /<html lang="es">/, "anything we do not translate falls back to Spanish");
});

test("join page: a known device is not asked for its number again", () => {
  const known = joinPage({ program: program(), client: { name: "Cafe Marron" }, knownCardUrl: "/card/tok99", deviceKnown: true });
  assert.match(known, /Ya tienes tu tarjeta/);
  assert.match(known, /href="\/card\/tok99"/);
  assert.doesNotMatch(known, /<form/, "nothing to submit");
  assert.doesNotMatch(known, /id="phone"/);

  const device = joinPage({ program: program(), client: { name: "Cafe Marron" }, deviceKnown: true });
  assert.match(device, /Añadir esta tarjeta/);
  assert.match(device, /ya está apuntado/);
  assert.doesNotMatch(device, /id="phone"/, "no typing for a device that already has a member");
  assert.doesNotMatch(device, /id="name"/);
  assert.match(device, /\/api\/loyalty\/join\//, "the one button still posts to the join route");
});

test("the page language follows the link, then the browser, and Spanish wins by default", () => {
  const u = (q) => new URL("http://x/join/abc" + q);
  assert.equal(joinLang(u("")), "es");
  assert.equal(joinLang(u(""), { headers: { "accept-language": "en-GB,en;q=0.9,es;q=0.8" } }), "en");
  assert.equal(joinLang(u(""), { headers: { "accept-language": "es-ES,es;q=0.9" } }), "es");
  assert.equal(joinLang(u(""), { headers: { "accept-language": "de-DE,de;q=0.9" } }), "es", "a German tourist gets the shop's language");
  assert.equal(joinLang(u("?l=en"), { headers: { "accept-language": "es" } }), "en");
  assert.equal(joinLang(u("?l=es"), { headers: { "accept-language": "en-GB" } }), "es", "the link beats the phone");
});

test("staff page: scanner, actions, keypad, fallback", () => {
  const html = staffPage({ program: program(), client: { name: "Cafe Marron" } });
  assert.match(html, /BarcodeDetector/);
  assert.match(html, /\/api\/loyalty\/staff\//);
  assert.match(html, /\/lookup/);
  assert.match(html, /\/record/);
  assert.match(html, /Camera scanning isn't available/);
  assert.match(html, /Redeem reward/);
  assert.match(html, /Purchase amount/);
  const paused = staffPage({ program: program({ status: "paused" }), client: { name: "X" } });
  assert.match(paused, /Not live yet/);
  assert.doesNotMatch(paused, /BarcodeDetector/);
});

test("the consent panel is two unticked boxes and its script parses", () => {
  const state = (o = {}) => ({ whatsapp: false, email: false, decided: false, ...o });
  const consent = (o = {}) => ({
    lang: "es", state: state(), title: "Ofertas y novedades", benefit: "Te avisamos de recompensas.",
    channels: [{ key: "whatsapp", label: "WhatsApp", text: "Quiero recibir ofertas por WhatsApp." }, { key: "email", label: "Email", text: "Quiero recibir ofertas por email." }],
    save: "Guardar", decline: "No gracias, solo la tarjeta", saved: "Guardado.", ...o,
  });
  const html = cardPage({ view: view(), consent: consent() });
  assert.match(html, /id="consent"/);
  assert.match(html, /<section class="panel cr-card consent" id="consent" lang="es">/);
  assert.match(html, /id="c-whatsapp"/);
  assert.match(html, /id="c-email"/);
  assert.equal(/id="c-whatsapp"[^>]*checked/.test(html), false);
  assert.match(html, /No gracias, solo la tarjeta/);
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));

  const answered = cardPage({ view: view(), consent: consent({ lang: "en", state: state({ email: true, decided: true }) }) });
  assert.match(answered, /id="c-email"[^>]*checked/);
  assert.equal(answered.includes('id="consentNo"'), false);
  assert.match(answered, /lang="en"/);

  const plain = cardPage({ view: view() });
  assert.equal(plain.includes('id="c-whatsapp"'), false, "a card without a number has nothing to ask");
  const claim = cardPage({ view: view(), claim: true });
  for (const m of claim.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
});

test("unsubscribe page: one button, no personal data, every state in both languages", () => {
  const copy = {
    unsubTitle: "Darte de baja", unsubBtn: "Darme de baja", unsubDone: "Hecho.", unsubAgain: "Ya estabas dado de baja.",
    unsubInvalid: "Este enlace no es válido.", unsubBody: (biz) => `Dejaremos de enviarte ofertas de ${biz}.`,
  };
  const valid = unsubPage({ lang: "es", valid: true, business: "Casa Uno", copy });
  assert.match(valid, /<html lang="es">/);
  assert.match(valid, /Dejaremos de enviarte ofertas de Casa Uno\./);
  assert.match(valid, /<form method="post"><button/);
  assert.match(valid, /Darme de baja/);

  const done = unsubPage({ lang: "es", valid: true, done: true, copy });
  assert.match(done, /Hecho\./);
  assert.equal(done.includes("<form"), false);

  const again = unsubPage({ lang: "es", valid: true, done: true, again: true, copy });
  assert.match(again, /Ya estabas dado de baja\./);

  const bad = unsubPage({ lang: "es", valid: false, copy });
  assert.match(bad, /Este enlace no es válido\./);
  assert.equal(bad.includes("<form"), false);

  const evil = unsubPage({ lang: "es", valid: true, business: '<script>alert(1)</script>', copy });
  assert.doesNotMatch(evil, /<script>alert\(1\)/);
  assert.match(evil, /&lt;script&gt;/);
});

test("scripts in every page parse", () => {
  const pages = [cardPage({ view: view() }), joinPage({ program: program(), client: { name: "X" } }), staffPage({ program: program(), client: { name: "X" } })];
  for (const html of pages) {
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
  }
});

test("manifest uses the design", () => {
  const m = manifest(view());
  assert.equal(m.display, "standalone");
  assert.equal(m.theme_color, "#3b1d0e");
  assert.equal(m.start_url, "/card/tok123");
  assert.equal(m.icons[0].src, "/media/logo.png");
  assert.equal(m.icons[0].type, "image/png");
  const none = manifest(view({ program: program({ design: design({ logoFile: "" }) }) }));
  assert.equal(none.icons, undefined);
  JSON.stringify(m);
});

test("cardStyles and qrInline", () => {
  assert.match(cardStyles, /\.wc-st\.on/);
  const svg = qrInline("LC1-abc");
  assert.match(svg, /^<svg/);
  assert.match(svg, /<path d="M/);
});

test("join page: the recovery panel offers a code and the till, in both languages", () => {
  const es = joinPage({ program: program(), client: { name: "Cafe Marron" } });
  assert.match(es, /Mandarme un código/);
  assert.match(es, /Código de 6 dígitos/);
  assert.match(es, /recCall\("code"/);
  assert.match(es, /recCall\("verify"/);
  assert.match(es, /"\/wait"/);
  assert.match(es, /recPollStart/);

  const en = joinPage({ program: program(), client: { name: "Cafe Marron" }, lang: "en" });
  assert.match(en, /Send me a code/);
  assert.match(en, /6-digit code/);
  assert.match(en, /Ask at the till to confirm it is you/);
});

test("staff page: the till can see and confirm a waiting recovery", () => {
  const html = staffPage({ program: program(), client: { name: "Cafe Marron" } });
  assert.match(html, /Waiting at the till/);
  assert.match(html, /id="recqList"/);
  assert.match(html, /post\("\/waiting"/);
  assert.match(html, /post\("\/confirm"/);
  assert.match(html, /This is them/);
});
