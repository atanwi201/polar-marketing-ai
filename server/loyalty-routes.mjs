// HTTP routes for loyalty cards: public (join, card, staff), owner (/api/studio/loyalty) and client portal (/api/portal/<token>/loyalty).
// handleLoyalty(req, res, url, seg, ctx) returns true when it answered the request.
import { db, save, id, token, now } from "./store.mjs";
import { limiter } from "./auth.mjs";
import { qrSvg, qrPng } from "./qr.mjs";
import * as L from "./loyalty.mjs";
import { bookingFor } from "./bookings-links.mjs";
import { menuFor } from "./menu-links.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const JSQR = () => readFileSync(join(import.meta.dirname, "vendor", "jsqr.cjs"));

// Pages come from loyalty-pages.mjs (another module); a plain fallback keeps things working without it.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const shell = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="icon" href="/brand/logo/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/brand/tokens.css"><link rel="stylesheet" href="/brand/components.css"></head><body style="font-family:var(--font-body,system-ui);max-width:480px;margin:0 auto;padding:24px">${body}</body></html>`;
const fallbackPages = {
  joinPage: ({ program }) => shell(program.name, `<h1>${esc(program.name)}</h1><p>Join from the page this link was made for.</p>`),
  cardPage: ({ view }) => shell(view.program.name, `<h1>${esc(view.business.name)}</h1><p>${esc(view.customer.name)}: ${view.customer.stamps} stamps, ${view.customer.points} points</p><img alt="Your code" width="220" src="${esc(view.installUrl)}/qr.svg">`),
  staffPage: ({ program }) => shell("Staff", `<h1>${esc(program.name)}</h1><p>Staff scanner.</p>`),
  manifest: (view) => ({ name: view.program.name, short_name: view.program.name.slice(0, 12), start_url: view.installUrl, display: "standalone", background_color: view.program.design.background, theme_color: view.program.design.background }),
};
let pagesP;
const pages = async () => (pagesP ??= import("./loyalty-pages.mjs").then((m) => ({ ...fallbackPages, ...m }), () => fallbackPages));

// Per-IP limits (count every request; limiter's `fail` is just a hit counter).
export const limits = {
  join: limiter(10, 3600e3), card: limiter(240, 60e3), staff: limiter(180, 5 * 60e3), badStaff: limiter(20, 15 * 60e3), badCard: limiter(30, 15 * 60e3),
  design: limiter(6, 10 * 60e3), manage: limiter(600, 60e3),
};
const hit = (lim, ip) => { if (lim.blocked(ip)) return false; lim.fail(ip); return true; };
export const resetLimits = () => { for (const l of Object.values(limits)) { /* limiter has no reset-all; tests use distinct IPs */ void l; } };

const htmlHeaders = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const html = (res, code, body) => { res.writeHead(code, htmlHeaders); res.end(body); };
const notFoundPage = (res, msg = "This link is not valid.") => html(res, 404, shell("Not found", `<h1>Link not valid</h1><p>${esc(msg)}</p>`));
const bin = (res, type, buf, extra = {}) => { res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", ...extra }); res.end(buf); };
const tooMany = (ctx, res) => ctx.send(res, 429, { error: "Too many tries. Please wait a few minutes." });
const fail = (e, ctx, res) => ctx.send(res, e.status ?? 500, { error: e.status ? e.message : "Something went wrong. Please try again." });

const byToken = (t) => (typeof t === "string" ? L.ldb().programs.find((p) => p.staffToken === t) : undefined);
const byJoin = (c) => (typeof c === "string" ? L.ldb().programs.find((p) => p.joinCode === c) : undefined);

async function walletInfo(ctx) {
  try { return (await ctx.wallet?.status?.()) ?? { configured: false, missing: [], passTypeId: "", pushReady: false, publicUrlHttps: false }; }
  catch { return { configured: false, missing: [], passTypeId: "", pushReady: false, publicUrlHttps: false }; }
}

export async function handleLoyalty(req, res, url, seg, ctx) {
  const m = req.method;
  try {
    // ---- public pages ----
    if (m === "GET" && seg[0] === "join" && seg.length === 2) return await joinPageRoute(req, res, seg[1], ctx);
    if (m === "GET" && seg[0] === "assets" && seg[1] === "jsqr.js" && seg.length === 2) {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=604800" });
      return res.end(JSQR()), true;
    }
    if (m === "GET" && seg[0] === "loyalty" && seg[1] === "logo" && seg.length === 3 && ctx.wallet?.google?.logo) {
      const prog = L.ldb().programs.find((x) => `${x.id}.png` === seg[2]);
      if (!prog) return ctx.send(res, 404, { error: "not found" }), true;
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      return res.end(ctx.wallet.google.logo(prog)), true;
    }
    if (seg[0] === "card" && seg[1]) return await cardRoutes(req, res, seg, ctx);
    if (m === "GET" && seg[0] === "staff" && seg.length === 2) return await staffPageRoute(req, res, seg[1], ctx);
    // ---- public API ----
    if (seg[0] === "api" && seg[1] === "loyalty") return await publicApi(req, res, seg, ctx);
    // ---- management API ----
    if (seg[0] === "api" && seg[1] === "studio" && seg[2] === "loyalty") {
      if (!ctx.isAdmin(req)) return ctx.send(res, 401, { error: "Sign in first" }), true;
      return await manage(req, res, url, seg.slice(3), { clientId: null }, ctx);
    }
    if (seg[0] === "api" && seg[1] === "portal" && seg[2] && seg[3] === "loyalty") {
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

// ---------- public pages ----------
async function joinPageRoute(req, res, joinCode, ctx) {
  const program = byJoin(joinCode);
  if (!program) return notFoundPage(res), true;
  const client = L.clientOf(program) ?? {};
  html(res, 200, (await pages()).joinPage({ program: publicProgram(program), client: { name: client.name, logoFile: client.logoFile }, baseUrl: ctx.baseUrl(req) }));
  return true;
}
/** What the public join page may see: no staff token. */
const publicProgram = ({ staffToken, ...p }) => p;

async function cardRoutes(req, res, seg, ctx) {
  const ip = ctx.clientIp(req);
  if (req.method !== "GET") return false;
  if (!hit(limits.card, ip) || limits.badCard.blocked(ip)) return notFoundPage(res, "Too many tries. Please wait a few minutes."), true;
  const customer = L.findByToken(seg[1]);
  const program = customer && L.findProgram(customer.programId);
  if (!customer || !program) { limits.badCard.fail(ip); return notFoundPage(res), true; }
  const base = ctx.baseUrl(req);
  const wallet = await walletInfo(ctx);
  const view = () => {
    const v = L.cardView(customer, program, { baseUrl: base, walletConfigured: wallet.configured, googleConfigured: !!wallet.google?.configured });
    const biz = db.clients.find((c) => c.id === program.clientId), bk = bookingFor(biz, { src: "loyalty", base: "" }), mn = menuFor(biz, { src: "loyalty", base: "" });
    return bk || mn ? { ...v, ...(bk ? { booking: bk } : {}), ...(mn ? { menu: mn } : {}) } : v;
  };
  const P = await pages();
  if (seg.length === 2) { const v = view(); await save(); html(res, 200, P.cardPage({ view: v, baseUrl: base })); return true; }
  if (seg.length === 3 && seg[2] === "qr.svg") return bin(res, "image/svg+xml", await qrSvg(L.codeOf(customer))), true;
  if (seg.length === 3 && seg[2] === "manifest.webmanifest") {
    const man = P.manifest(view());
    return bin(res, "application/manifest+json", typeof man === "string" ? man : JSON.stringify(man)), true;
  }
  if (seg.length === 3 && seg[2] === "pass.pkpass") {
    if (!wallet.configured || !ctx.wallet?.buildPass) return ctx.send(res, 404, { error: "Apple Wallet is not set up yet. Use the web card." }), true;
    const buf = await ctx.wallet.buildPass(customer);
    return bin(res, "application/vnd.apple.pkpass", buf, { "Content-Disposition": `attachment; filename="card.pkpass"` }), true;
  }
  if (seg.length === 3 && seg[2] === "google-wallet") {
    if (!wallet.google?.configured || !ctx.wallet?.google?.saveUrl) return ctx.send(res, 404, { error: "Google Wallet is not set up yet. Use the web card." }), true;
    res.writeHead(302, { Location: ctx.wallet.google.saveUrl(customer, base), "Cache-Control": "no-store" });
    return res.end(), true;
  }
  return false;
}

async function staffPageRoute(req, res, staffToken, ctx) {
  const ip = ctx.clientIp(req);
  if (limits.badStaff.blocked(ip)) return notFoundPage(res, "Too many tries. Please wait a few minutes."), true;
  const program = byToken(staffToken);
  if (!program) { limits.badStaff.fail(ip); return notFoundPage(res), true; }
  const client = L.clientOf(program) ?? {};
  html(res, 200, (await pages()).staffPage({ program: { id: program.id, name: program.name, type: program.type, status: program.status, design: program.design }, client: { name: client.name, logoFile: client.logoFile }, baseUrl: ctx.baseUrl(req) }));
  return true;
}

// ---------- public API ----------
async function publicApi(req, res, seg, ctx) {
  const ip = ctx.clientIp(req);
  const m = req.method;
  // POST /api/loyalty/join/<joinCode>
  if (m === "POST" && seg[2] === "join" && seg.length === 4) {
    if (!hit(limits.join, ip)) return tooMany(ctx, res), true;
    const program = byJoin(seg[3]);
    if (!program) return ctx.send(res, 404, { error: "This link is not valid." }), true;
    const b = await ctx.readBody(req, 20e3);
    const c = L.joinCustomer(program, b);
    await save();
    ctx.send(res, 201, { cardUrl: `/card/${c.cardToken}` });
    return true;
  }
  // GET /api/loyalty/card/<cardToken>
  if (m === "GET" && seg[2] === "card" && seg.length === 4) {
    if (!hit(limits.card, ip) || limits.badCard.blocked(ip)) return tooMany(ctx, res), true;
    const customer = L.findByToken(seg[3]);
    const program = customer && L.findProgram(customer.programId);
    if (!customer || !program) { limits.badCard.fail(ip); return ctx.send(res, 404, { error: "This card link is not valid." }), true; }
    const wallet = await walletInfo(ctx);
    const v = L.cardView(customer, program, { baseUrl: ctx.baseUrl(req), walletConfigured: wallet.configured });
    await save();
    ctx.send(res, 200, v);
    return true;
  }
  // POST /api/loyalty/staff/<staffToken>/(lookup|record)
  if (m === "POST" && seg[2] === "staff" && seg.length === 5 && (seg[4] === "lookup" || seg[4] === "record")) {
    if (limits.badStaff.blocked(ip) || !hit(limits.staff, ip)) return tooMany(ctx, res), true;
    const program = byToken(seg[3]);
    if (!program) { limits.badStaff.fail(ip); return ctx.send(res, 404, { error: "This staff link is not valid." }), true; }
    const b = await ctx.readBody(req, 10e3);
    const progInfo = { name: program.name, type: program.type, status: program.status, stamps: { goal: program.stamps.goal }, rewards: program.rewards.filter((r) => r.active !== false).map((r) => ({ id: r.id, name: r.name, cost: r.cost, kind: r.kind })) };
    if (seg[4] === "lookup") {
      const f = L.lookupByCode(b.code);
      if (!f || f.program.id !== program.id) return ctx.send(res, 404, { error: "Card not found. Check the code or scan again." }), true;
      L.expirePoints(f.customer, program);
      ctx.send(res, 200, { customer: L.staffCustomer(f.customer, program), program: progInfo });
      return true;
    }
    const f = L.lookupByCode(b.customerId);
    if (!f || f.program.id !== program.id) return ctx.send(res, 404, { error: "Card not found. Check the code or scan again." }), true;
    const amt = b.amountEur == null || b.amountEur === "" ? undefined : Number(b.amountEur);
    if (amt !== undefined && !Number.isFinite(amt)) return ctx.send(res, 400, { error: "Enter the amount spent as a number." }), true;
    const r = L.record(f.customer, program, { kind: b.kind, amountEur: amt, rewardId: typeof b.rewardId === "string" ? b.rewardId : undefined, by: "staff" });
    await save();
    ctx.send(res, 200, { customer: L.staffCustomer(r.customer, program), txn: txnView(r.txn), message: r.message });
    return true;
  }
  return false;
}
const txnView = ({ id, at, type, stamps, points, amountEur, note, by, rewardId, customerId }) => ({ id, at, customerId, type, stamps, points, amountEur, note, by, rewardId });

// ---------- management (owner + portal) ----------
async function manage(req, res, url, rest, scope, ctx) {
  const m = req.method, ip = ctx.clientIp(req);
  if (!hit(limits.manage, ip)) return tooMany(ctx, res), true;
  const owner = scope.clientId === null;
  const by = owner ? "owner" : "portal";
  const base = ctx.baseUrl(req);
  const view = (p) => L.programView(p, { baseUrl: base });
  /** A programme the caller may touch: portal only sees its own business. */
  const mine = (pid) => { const p = L.findProgram(pid); return p && (owner || p.clientId === scope.clientId) ? p : undefined; };
  const clientFor = (b) => {
    const cid = owner ? str(b?.clientId) : scope.clientId;
    return db.clients.find((c) => c.id === cid);
  };
  const noProg = () => (ctx.send(res, 404, { error: "Programme not found" }), true);
  const out = (code, body) => (ctx.send(res, code, body), true);
  const pushAll = (p) => { for (const c of L.ldb().customers) if (c.programId === p.id && L.ldb().devices.some((d) => d.serial === c.id)) L.notify(c); };

  // GET /
  if (rest.length === 0 && m === "GET") {
    const l = L.ldb();
    const cid = owner ? str(url.searchParams.get("clientId")) : scope.clientId;
    const progs = l.programs.filter((p) => (owner ? !cid || p.clientId === cid : p.clientId === scope.clientId));
    const body = {
      programs: progs.map(view),
      templates: l.templates.filter((t) => (owner ? !cid || t.clientId === cid || t.clientId === "" : t.clientId === scope.clientId || t.clientId === "")),
      wallet: await walletInfo(ctx), publicUrl: process.env.PUBLIC_URL?.replace(/\/$/, "") ?? "", baseUrl: base,
    };
    if (owner) body.clients = db.clients.map((c) => ({ id: c.id, name: c.name }));
    return out(200, body);
  }
  // POST /upload {image: dataUrl} -> {file}: a logo, banner or background for a card design
  if (rest[0] === "upload" && rest.length === 1 && m === "POST") {
    const b = await ctx.readBody(req, 9e6);
    return out(200, { file: await ctx.saveUpload(b?.image) });
  }
  if (rest[0] !== "programs") return false;

  // POST /programs  and  POST /programs/from-template
  if (rest.length === 1 && m === "POST") {
    const b = await ctx.readBody(req, 100e3);
    const client = clientFor(b);
    if (!client) return out(400, { error: "Choose a business first." });
    const p = L.createProgram(client, b);
    let designError;
    if (str(b.prompt)) designError = await generateDesign(p, client, { prompt: str(b.prompt, 600) }, ctx, ip, true);
    await save();
    return out(201, { ...view(p), ...(designError ? { designError } : {}) });
  }
  if (rest[1] === "from-template" && rest.length === 2 && m === "POST") {
    const b = await ctx.readBody(req, 20e3);
    const t = L.ldb().templates.find((x) => x.id === b.templateId && (owner || x.clientId === scope.clientId || x.clientId === ""));
    const client = clientFor(b);
    if (!t) return out(404, { error: "Template not found" });
    if (!client) return out(400, { error: "Choose a business first." });
    const p = L.createProgram(client, { name: str(b.name, 60) || t.name, design: structuredClone(t.design) });
    await save();
    return out(201, view(p));
  }

  const p = rest[1] ? mine(rest[1]) : undefined;
  if (!rest[1]) return false;
  if (!p) return noProg();

  // /programs/:id
  if (rest.length === 2) {
    if (m === "GET") {
      const cs = L.ldb().customers.filter((c) => c.programId === p.id).map(L.customerRow);
      return out(200, { ...view(p), customers: cs, txns: L.ldb().txns.filter((t) => t.programId === p.id).slice(-100).reverse().map(txnView) });
    }
    if (m === "PATCH") {
      const b = await ctx.readBody(req, 100e3);
      const { changed } = L.updateProgram(p, b);
      await save();
      if (changed) pushAll(p);
      return out(200, view(p));
    }
    if (m === "DELETE") {
      const b = await ctx.readBody(req, 2e3);
      if (p.status === "live") return out(409, { error: "Pause the programme before deleting it." });
      if (b.confirm !== true) return out(400, { error: "Confirm the deletion first." });
      L.removeProgram(p);
      await save();
      return out(200, { ok: true });
    }
    return false;
  }
  const act = rest[2];

  if (act === "design" && rest.length === 3 && m === "POST") {
    const b = await ctx.readBody(req, 20e3);
    const prompt = str(b.prompt, 600);
    if (prompt.length < 3) return out(400, { error: "Describe the card you want." });
    const keep = (Array.isArray(b.keep) ? b.keep : []).filter((k) => typeof k === "string").slice(0, 20);
    const client = L.clientOf(p) ?? {};
    const err = await generateDesign(p, client, { prompt, keep }, ctx, ip, false);
    await save();
    if (err) return out(502, { error: err });
    pushAll(p);
    return out(200, view(p));
  }
  if (act === "duplicate" && rest.length === 3 && m === "POST") {
    const c = L.duplicateProgram(p);
    await save();
    return out(201, view(c));
  }
  if (act === "save-template" && rest.length === 3 && m === "POST") {
    const b = await ctx.readBody(req, 5e3);
    const name = str(b.name, 60);
    if (!name) return out(400, { error: "Give the template a name." });
    const t = { id: id(), clientId: p.clientId, name, design: structuredClone(p.design), createdAt: now() };
    L.ldb().templates.push(t);
    await save();
    return out(201, t);
  }
  if (act === "qr.png" && rest.length === 3 && m === "GET") return bin(res, "image/png", await qrPng(L.joinUrl(p, base)), { "Content-Disposition": `inline; filename="join-${p.joinCode}.png"` }), true;
  if (act === "qr" && rest.length === 3 && m === "GET") { const u = L.joinUrl(p, base); return out(200, { url: u, svg: await qrSvg(u) }); }
  if (act === "regenerate-staff-token" && rest.length === 3 && m === "POST") {
    p.staffToken = token();
    p.updatedAt = now();
    await save();
    return out(200, { staffToken: p.staffToken, staffUrl: L.staffUrl(p, base) });
  }

  if (act === "customers") {
    const cs = L.ldb().customers.filter((c) => c.programId === p.id);
    if (rest.length === 3 && m === "GET") return out(200, cs.map(L.customerRow));
    const c = rest[3] ? cs.find((x) => x.id === rest[3]) : undefined;
    if (rest[3] && !c) return out(404, { error: "Customer not found" });
    if (rest.length === 4 && m === "GET") {
      L.expirePoints(c, p);
      return out(200, { ...L.customerRow(c), marketingConsent: c.marketingConsent, redemptions: c.redemptions, cardUrl: `${base}/card/${c.cardToken}`, txns: L.txnsOf(c).slice(-100).reverse().map(txnView) });
    }
    if (rest.length === 5 && rest[4] === "adjust" && m === "POST") {
      const b = await ctx.readBody(req, 5e3);
      for (const k of ["stamps", "points"]) if (b[k] != null && b[k] !== "" && !Number.isFinite(Number(b[k]))) return out(400, { error: `${k} must be a number.` });
      L.expirePoints(c, p);
      L.adjust(c, p, { stamps: b.stamps, points: b.points, note: b.note, by });
      await save();
      return out(200, { ...L.customerRow(c), redemptions: c.redemptions });
    }
  }
  return false;
}

const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Ask the designer for a new design and apply it. Returns an error message, or "" when it worked. */
async function generateDesign(p, client, { prompt, keep = [] }, ctx, ip, soft) {
  if (!hit(limits.design, `${ip}|${p.clientId}`)) { if (soft) return "Too many designs just now. Try again in a few minutes."; throw Object.assign(new Error("Too many designs just now. Try again in a few minutes."), { status: 429 }); }
  try {
    const old = p.design;
    const gen = (await ctx.designProgram?.(p, { prompt, keep })) ?? {};
    const design = L.sanitizeDesign({ ...gen, prompt }, old);
    for (const k of keep) if (k in old && k in design) design[k] = old[k];
    if (!design.generatedBy?.at) design.generatedBy = { model: design.generatedBy?.model ?? "", at: now() };
    p.design = design;
    p.updatedAt = now();
    return "";
  } catch (e) {
    return `The designer could not make a card just now (${String(e.message).slice(0, 120)}). Your current design is unchanged.`;
  }
}
