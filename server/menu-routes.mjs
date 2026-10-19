// HTTP routes for the digital menu: owner (/api/studio/menu), client portal (/api/portal/<token>/menu)
// and public (/menu/<code>, /api/menu/<code>, QR codes, photos). handleMenu(...) returns true when it answered.
// A declined business never reaches here (blocked earlier in index.mjs).
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { db, save } from "./store.mjs";
import { limiter } from "./auth.mjs";
import { qrSvg, qrPng } from "./qr.mjs";
import * as M from "./menu.mjs";
import { menuPage, menuNotFoundPage } from "./menu-pages.mjs";

export const limits = { manage: limiter(600, 60e3), ai: limiter(30, 3600e3), photo: limiter(120, 3600e3), read: limiter(300, 60e3) };
const hit = (lim, ip) => { if (lim.blocked(ip)) return false; lim.fail(ip); return true; };
const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const ES = {
  "Send a JPEG, PNG or WebP photo.": "Envía una foto JPEG, PNG o WebP.", "That photo is too large. Try a smaller one.": "Esa foto es demasiado grande. Prueba con una más pequeña.",
  "We could not read that photo. Try another one.": "No hemos podido leer esa foto. Prueba con otra.",
  "PDF files cannot be read yet. Send a photo or screenshot of the menu instead.": "Todavía no se pueden leer archivos PDF. Envía una foto o captura de la carta.",
  "The menu reader is not available right now. Add the dishes by hand.": "El lector de cartas no está disponible ahora. Añade los platos a mano.",
  "We could not read that menu. Try a sharper photo or add the dishes by hand.": "No hemos podido leer esa carta. Prueba con una foto más nítida o añade los platos a mano.",
  "We could not find any dishes in that photo. Try a sharper one.": "No hemos encontrado platos en esa foto. Prueba con una más nítida.",
  "Choose the language to translate from.": "Elige el idioma desde el que traducir.", "Choose at least one language to translate into.": "Elige al menos un idioma al que traducir.",
  "The translator is not available right now. Write the other languages by hand.": "El traductor no está disponible ahora. Escribe los otros idiomas a mano.",
  "We could not translate the menu right now. Try again in a moment.": "No hemos podido traducir la carta ahora. Inténtalo de nuevo en un momento.",
  "The menu is not turned on for this business.": "La carta digital no está activada para este negocio.", "Choose a business first.": "Elige un negocio primero.",
  "Sign in first": "Inicia sesión primero.", "Too many tries. Please wait a few minutes.": "Demasiados intentos. Espera unos minutos.", "Something went wrong. Please try again.": "Algo ha ido mal. Inténtalo de nuevo.",
  "Request too large": "La petición es demasiado grande.", "Menu not found": "Carta no encontrada",
};
const fail = (e, ctx, res, req) => {
  const msg = e.status ? e.message : "Something went wrong. Please try again.";
  if (!e.status) console.error("menu:", e);
  ctx.send(res, e.status ?? 500, { error: req?.headers["x-lang"] === "es" ? ES[msg] ?? msg : msg, ...(e.code ? { code: e.code } : {}) });
};
const baseOf = (req, ctx) => (ctx.baseUrl ? ctx.baseUrl(req) : `http://${req.headers.host ?? "localhost"}`).replace(/\/$/, "");
const htmlHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function handleMenu(req, res, url, seg, ctx) {
  try {
    if (seg[0] === "api" && seg[1] === "studio" && seg[2] === "menu") {
      if (!ctx.isAdmin(req)) return ctx.send(res, 401, { error: "Sign in first" }), true;
      return await manage(req, res, url, seg.slice(3), null, ctx);
    }
    if (seg[0] === "api" && seg[1] === "portal" && seg[2] && seg[3] === "menu") {
      const c = ctx.clientByToken(seg[2]);
      if (!c) return ctx.send(res, 404, { error: "Unknown portal link" }), true;
      return await manage(req, res, url, seg.slice(4), c.id, ctx);
    }
    if ((seg[0] === "menu" && seg[1]) || (seg[0] === "api" && seg[1] === "menu" && seg[2])) return await pub(req, res, url, seg, ctx);
  } catch (e) {
    if (res.headersSent) { res.end(); return true; }
    fail(e, ctx, res, req);
    return true;
  }
  return false;
}

async function manage(req, res, url, rest, scopeClient, ctx) {
  const m = req.method, ip = ctx.clientIp(req), owner = scopeClient === null;
  if (!hit(limits.manage, ip)) return ctx.send(res, 429, { error: "Too many tries. Please wait a few minutes." }), true;
  const out = (code, body) => (ctx.send(res, code, body), true);
  const q = url.searchParams;
  const c = owner ? db.clients.find((x) => x.id === str(q.get("clientId"))) : db.clients.find((x) => x.id === scopeClient);

  if (owner && rest[0] === "overview" && rest.length === 1 && m === "GET" || (owner && !c && rest.length === 0 && m === "GET")) {
    return out(200, { businesses: db.clients.map((x) => ({ id: x.id, name: x.name, enabled: !!M.findConfig(x.id)?.enabled })) });
  }
  if (!c) return out(owner ? 400 : 404, { error: "Choose a business first." });
  const cfg = M.ensureConfig(c);
  const base = baseOf(req, ctx);
  // The portal sees nothing but "off" until the owner turns the feature on.
  if (!owner && !cfg.enabled) {
    if (rest.length === 0 && m === "GET") return out(200, { config: { enabled: false } });
    return out(403, { error: "The menu is not turned on for this business.", code: "disabled" });
  }

  if (rest.length === 0 && m === "GET") {
    await save();
    return out(200, { config: M.configView(cfg, base), categories: cfg.categories });
  }
  if (rest.length === 0 && m === "PUT") {
    const b = await ctx.readBody(req, 2e6);
    if (!Array.isArray(b.categories)) return out(400, { error: "Send the categories to save." });
    const categories = await M.replaceCategories(cfg, b.categories);
    await save();
    return out(200, { categories });
  }
  if (rest[0] === "config" && rest.length === 1 && (m === "PUT" || m === "PATCH")) {
    M.updateConfig(cfg, await ctx.readBody(req, 50e3), { owner });
    await save();
    return out(200, M.configView(cfg, base));
  }
  if (rest[0] === "photo" && rest.length === 1 && m === "POST") {
    if (!hit(limits.photo, ip)) return out(429, { error: "Too many tries. Please wait a few minutes." });
    const b = await ctx.readBody(req, 14e6);
    return out(200, { url: await M.savePhoto(b.image) });
  }
  if (rest[0] === "import" && rest.length === 1 && m === "POST") {
    if (!hit(limits.ai, ip)) return out(429, { error: "Too many tries. Please wait a few minutes." });
    const b = await ctx.readBody(req, 10e6);
    const lang = M.LANGS.includes(b.lang) ? b.lang : M.LANGS.includes(req.headers["x-lang"]) && cfg.languages.includes(req.headers["x-lang"]) ? req.headers["x-lang"] : cfg.languages[0];
    const r = await M.importFromImage(c, cfg, b.image, lang);
    return out(200, { draft: { categories: r.categories } });
  }
  if (rest[0] === "translate" && rest.length === 1 && m === "POST") {
    if (!hit(limits.ai, ip)) return out(429, { error: "Too many tries. Please wait a few minutes." });
    const b = await ctx.readBody(req, 2e6);
    return out(200, await M.translate(c, cfg, b.categories, b.from, b.to));
  }
  return false;
}

async function pub(req, res, url, seg, ctx) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const ip = ctx.clientIp(req);
  const json = seg[0] === "api";
  const page = (code, body) => { res.writeHead(code, htmlHeaders); res.end(body); return true; };
  if (!hit(limits.read, ip)) return json ? (ctx.send(res, 429, { error: "Too many tries. Please wait a few minutes." }), true) : page(429, menuNotFoundPage());

  // Photos
  if (!json && seg[1] === "img" && seg.length === 3) {
    const f = seg[2];
    const file = /^[\w.-]+$/.test(f) ? join(M.PHOTO_DIR, f) : "";
    if (!file || !existsSync(file)) return ctx.send(res, 404, { error: "not found" }), true;
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": statSync(file).size, "Cache-Control": "public, max-age=31536000, immutable" });
    if (req.method === "HEAD") return res.end(), true;
    createReadStream(file).pipe(res);
    return true;
  }

  const code = json ? seg[2] : seg[1];
  const cfg = M.findByCode(code), client = cfg && M.clientOf(cfg);
  const want = str(url.searchParams.get("l"), 5);
  if (!cfg?.enabled || !client) {
    return json ? (ctx.send(res, 404, { error: "Menu not found" }), true) : page(404, menuNotFoundPage(M.LANGS.includes(want) ? want : "es"));
  }
  const rest = seg.slice(json ? 3 : 2);
  const target = M.menuUrl(cfg, baseOf(req, ctx));

  if (rest.length === 0) {
    const view = M.publicView(cfg, client, want);
    if (json) return ctx.send(res, 200, view), true;
    res.writeHead(200, htmlHeaders);
    res.end(req.method === "HEAD" ? undefined : menuPage({ view, client, code }));
    return true;
  }
  if (!json && rest.length === 1 && rest[0] === "qr.svg") {
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", ...(url.searchParams.has("download") ? { "Content-Disposition": `attachment; filename="menu-qr.svg"` } : {}) });
    res.end(await qrSvg(target));
    return true;
  }
  if (!json && rest.length === 1 && rest[0] === "qr.png") {
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store", ...(url.searchParams.has("download") ? { "Content-Disposition": `attachment; filename="menu-qr.png"` } : {}) });
    res.end(await qrPng(target));
    return true;
  }
  return json ? (ctx.send(res, 404, { error: "Menu not found" }), true) : page(404, menuNotFoundPage());
}
