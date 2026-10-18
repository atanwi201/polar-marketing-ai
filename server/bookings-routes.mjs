// HTTP routes for reservations: public (/book/<code>, /booking/<manageToken>, /api/book/...),
// owner (/api/studio/bookings) and client portal (/api/portal/<token>/bookings). handleBookings(...) returns true when it answered.
import { db, save } from "./store.mjs";
import { limiter } from "./auth.mjs";
import * as B from "./bookings.mjs";
import { qrSvg, qrPng } from "./qr.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const shell = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="icon" href="/brand/logo/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/brand/tokens.css"><link rel="stylesheet" href="/brand/components.css"></head><body style="font-family:var(--font-body,system-ui);max-width:480px;margin:0 auto;padding:24px">${body}</body></html>`;
const fallbackPages = {
  bookPage: ({ info }) => shell(info.business.name, `<h1>${esc(info.business.name)}</h1><p>Booking page.</p>`),
  managePage: ({ booking, info }) => shell(info.business.name, `<h1>${esc(info.business.name)}</h1><p>${esc(booking.status)}</p>`),
};
let pagesP;
const pages = async () => (pagesP ??= import("./bookings-pages.mjs").then((m) => ({ ...fallbackPages, ...m }), () => fallbackPages));

export const limits = { read: limiter(240, 60e3), create: limiter(12, 3600e3), cancel: limiter(20, 3600e3), badToken: limiter(30, 15 * 60e3), manage: limiter(600, 60e3) };
const hit = (lim, ip) => { if (lim.blocked(ip)) return false; lim.fail(ip); return true; };
const htmlHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const html = (res, code, body) => { res.writeHead(code, htmlHeaders); res.end(body); };
const notFoundPage = (res) => html(res, 404, shell("Not found", `<h1>Link not valid / Enlace no válido</h1>`));
const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const tooMany = (ctx, res) => (ctx.send(res, 429, { error: "Too many tries. Please wait a few minutes." }), true);
const fail = (e, ctx, res) => ctx.send(res, e.status ?? 500, { error: e.status ? e.message : "Something went wrong. Please try again.", ...(e.code ? { code: e.code } : {}) });

export async function handleBookings(req, res, url, seg, ctx) {
  const m = req.method;
  try {
    if (m === "GET" && seg[0] === "book" && seg.length === 2) {
      const cfg = B.findByCode(seg[1]);
      if (!cfg) return notFoundPage(res), true;
      html(res, 200, (await pages()).bookPage({ info: B.publicInfo(cfg), baseUrl: ctx.baseUrl(req), lang: url.searchParams.get("lang") ?? "", source: url.searchParams.get("src") ?? "link" }));
      return true;
    }
    if (m === "GET" && seg[0] === "booking" && seg.length === 2) {
      const ip = ctx.clientIp(req);
      if (limits.badToken.blocked(ip)) return notFoundPage(res), true;
      const b = B.findByManageToken(seg[1]);
      if (!b) { limits.badToken.fail(ip); return notFoundPage(res), true; }
      const cfg = B.findConfig(b.clientId);
      html(res, 200, (await pages()).managePage({ booking: B.bookingView(b), info: B.publicInfo(cfg), baseUrl: ctx.baseUrl(req), cancellable: B.ACTIVE.includes(b.status) && B.startsAt(b) > Date.now() }));
      return true;
    }
    if (seg[0] === "api" && seg[1] === "book") return await publicApi(req, res, url, seg, ctx);
    if (seg[0] === "api" && seg[1] === "booking" && seg.length === 4 && seg[3] === "cancel" && m === "POST") return await customerCancel(req, res, seg[2], ctx);
    if (seg[0] === "api" && seg[1] === "studio" && seg[2] === "bookings") {
      if (!ctx.isAdmin(req)) return ctx.send(res, 401, { error: "Sign in first" }), true;
      return await manage(req, res, url, seg.slice(3), { clientId: null }, ctx);
    }
    if (seg[0] === "api" && seg[1] === "portal" && seg[2] && seg[3] === "bookings") {
      const c = ctx.clientByToken(seg[2]);
      if (!c) return ctx.send(res, 404, { error: "Unknown portal link" }), true;
      return await manage(req, res, url, seg.slice(4), { clientId: c.id }, ctx);
    }
  } catch (e) {
    if (res.headersSent) { res.end(); return true; }
    fail(e, ctx, res);
    return true;
  }
  return false;
}

async function publicApi(req, res, url, seg, ctx) {
  const ip = ctx.clientIp(req), m = req.method;
  const cfg = B.findByCode(seg[2]);
  if (!cfg) return ctx.send(res, 404, { error: "This link is not valid." }), true;
  // GET /api/book/<code>/info
  if (m === "GET" && seg[3] === "info" && seg.length === 4) return hit(limits.read, ip) ? (ctx.send(res, 200, B.publicInfo(cfg)), true) : tooMany(ctx, res);
  // GET /api/book/<code>/availability?date=&party=   |   ?checkIn=&checkOut=&guests=
  if (m === "GET" && seg[3] === "availability" && seg.length === 4) {
    if (!hit(limits.read, ip)) return tooMany(ctx, res);
    const q = url.searchParams;
    if (!cfg.enabled) return ctx.send(res, 409, { error: "Online bookings are not open for this business right now.", code: "closed" }), true;
    if (cfg.kind === "table") return ctx.send(res, 200, { slots: B.tableSlots(cfg, q.get("date"), q.get("party")) }), true;
    return ctx.send(res, 200, { rooms: B.roomAvailability(cfg, q.get("checkIn"), q.get("checkOut"), q.get("guests")) }), true;
  }
  // POST /api/book/<code>
  if (m === "POST" && seg.length === 3) {
    if (!hit(limits.create, ip)) return tooMany(ctx, res);
    const b = await ctx.readBody(req, 20e3);
    const booking = B.createBooking(cfg, b, { source: ["link", "website", "loyalty"].includes(b.source) ? b.source : "link" });
    await save();
    return ctx.send(res, 201, { booking: B.bookingView(booking), manageUrl: `/booking/${booking.manageToken}` }), true;
  }
  return false;
}

async function customerCancel(req, res, tok, ctx) {
  const ip = ctx.clientIp(req);
  if (limits.badToken.blocked(ip) || !hit(limits.cancel, ip)) return tooMany(ctx, res);
  const b = B.findByManageToken(tok);
  if (!b) { limits.badToken.fail(ip); return ctx.send(res, 404, { error: "This link is not valid." }), true; }
  B.setStatus(b, "cancelled", { by: "customer" });
  await save();
  return ctx.send(res, 200, { booking: B.bookingView(b) }), true;
}

// ---------- management (owner + portal) ----------
async function manage(req, res, url, rest, scope, ctx) {
  const m = req.method, ip = ctx.clientIp(req);
  if (!hit(limits.manage, ip)) return tooMany(ctx, res);
  const owner = scope.clientId === null;
  const by = owner ? "owner" : "portal";
  const base = ctx.baseUrl(req);
  const out = (code, body) => (ctx.send(res, code, body), true);
  const clientFor = () => (owner ? db.clients.find((c) => c.id === str(url.searchParams.get("clientId"))) : db.clients.find((c) => c.id === scope.clientId));
  const mineBooking = (bid) => { const b = B.findBooking(bid); return b && (owner || b.clientId === scope.clientId) ? b : undefined; };

  // GET /  (owner without clientId: overview of all businesses)
  if (rest.length === 0 && m === "GET") {
    const c = clientFor();
    if (!c) {
      if (!owner) return out(404, { error: "Business not found" });
      return out(200, { businesses: db.clients.map((x) => { const cfg = B.findConfig(x.id); return { id: x.id, name: x.name, enabled: !!cfg?.enabled, kind: cfg?.kind ?? B.guessKind(x), stats: cfg ? B.stats(cfg) : null }; }) });
    }
    const cfg = B.ensureConfig(c);
    await save();
    const items = B.bdb().items.filter((x) => x.clientId === c.id).sort((a, b) => ((a.date ?? a.checkIn) + (a.time ?? "")).localeCompare((b.date ?? b.checkIn) + (b.time ?? ""))).map(B.ownerView);
    return out(200, { config: B.configView(cfg, base), bookings: items });
  }
  const c = clientFor();
  if (!c) return out(owner ? 400 : 404, { error: "Choose a business first." });
  const cfg = B.ensureConfig(c);
  // GET /qr -> {url, svg}   GET /qr.png -> print-ready PNG of the public booking link
  if (rest[0] === "qr" && rest.length === 1 && m === "GET") { const u = B.bookingUrl(cfg, base); return out(200, { url: u, svg: await qrSvg(u) }); }
  if (rest[0] === "qr.png" && rest.length === 1 && m === "GET") {
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store", "Content-Disposition": `inline; filename="book-${cfg.code}.png"` });
    return res.end(await qrPng(B.bookingUrl(cfg, base))), true;
  }
  // PUT /config
  if (rest[0] === "config" && rest.length === 1 && (m === "PUT" || m === "PATCH")) {
    const b = await ctx.readBody(req, 100e3);
    B.updateConfig(cfg, b);
    await save();
    return out(200, B.configView(cfg, base));
  }
  // POST /bookings  (staff adds a booking by hand; not blocked by "online bookings off")
  if (rest[0] === "bookings" && rest.length === 1 && m === "POST") {
    const b = await ctx.readBody(req, 20e3);
    const booking = B.createBooking(cfg, b, { source: "owner", by: "owner", allowClosed: true });
    await save();
    return out(201, B.ownerView(booking));
  }
  // PATCH /bookings/:id {status}
  if (rest[0] === "bookings" && rest.length === 2 && m === "PATCH") {
    const bk = mineBooking(rest[1]);
    if (!bk || bk.clientId !== c.id) return out(404, { error: "Booking not found" });
    const b = await ctx.readBody(req, 5e3);
    B.setStatus(bk, str(b.status, 20), { by });
    await save();
    return out(200, B.ownerView(bk));
  }
  return false;
}
