// HTTP routes for loyalty cards: public (join, card, staff), owner (/api/studio/loyalty) and client portal (/api/portal/<token>/loyalty).
// handleLoyalty(req, res, url, seg, ctx) returns true when it answered the request.
import { db, save, id, token, now } from "./store.mjs";
import { limiter } from "./auth.mjs";
import { approval } from "./limits.mjs";
import { normalisePhone } from "./phone.mjs";
import { otp as otpService } from "./otp.mjs";
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

// Join limits, one hour (plan A.8). The IP cap alone was too tight for a shop's shared wifi and too
// loose for one person scripting numbers; the number and the programme caps bound it from the other
// two sides. Tests pin the numbers.
export const JOIN_LIMITS = { ip: 60, phone: 5, program: 300 };

// Per-IP limits (count every request; limiter's `fail` is just a hit counter).
export const limits = {
  join: limiter(JOIN_LIMITS.ip, 3600e3), joinPhone: limiter(JOIN_LIMITS.phone, 3600e3), joinProgram: limiter(JOIN_LIMITS.program, 3600e3),
  card: limiter(240, 60e3), staff: limiter(180, 5 * 60e3), badStaff: limiter(20, 15 * 60e3), badCard: limiter(30, 15 * 60e3),
  recoveryCode: limiter(10, 3600e3), recoveryPhone: limiter(5, 3600e3), recoveryVerify: limiter(30, 15 * 60e3), recoveryWait: limiter(900, 60e3),
  claimCode: limiter(10, 3600e3), claimPhone: limiter(5, 3600e3), claimVerify: limiter(30, 15 * 60e3),
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

const byToken = (t) => { const p = typeof t === "string" ? L.ldb().programs.find((x) => x.staffToken === t) : undefined; return p && L.staffTokenValid(p) ? p : undefined; };
const byJoin = (c) => (typeof c === "string" ? L.ldb().programs.find((p) => p.joinCode === c) : undefined);

async function walletInfo(ctx) {
  try { return (await ctx.wallet?.status?.()) ?? { configured: false, missing: [], passTypeId: "", pushReady: false, publicUrlHttps: false }; }
  catch { return { configured: false, missing: [], passTypeId: "", pushReady: false, publicUrlHttps: false }; }
}

export async function handleLoyalty(req, res, url, seg, ctx) {
  const m = req.method;
  try {
    // ---- public pages ----
    if (m === "GET" && seg[0] === "join" && seg.length === 2) return await joinPageRoute(req, res, seg[1], ctx, url);
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
/** A business that is not approved yet must not issue cards or take stamps (see docs/routes-and-auth.md).
 *  Declined businesses never reach here (declinedClientFor in index.mjs); this covers "pending". */
const canIssue = (program) => approval(L.clientOf(program) ?? {}) === "approved";

async function joinPageRoute(req, res, joinCode, ctx, url) {
  const program = byJoin(joinCode);
  if (!program) return notFoundPage(res), true;
  if (!canIssue(program)) return notFoundPage(res), true;
  const client = L.clientOf(program) ?? {};
  const P = await pages();
  // A device that already has a member skips the form entirely: its card for this shop if it has
  // one, otherwise one button that creates it. Nothing about the member is put in the HTML.
  const member = L.memberByToken(cookies(req)[MEMBER_COOKIE]);
  const card = member ? L.ldb().customers.find((c) => c.memberId === member.id && c.programId === program.id) : undefined;
  const lang = typeof P.joinLang === "function" ? P.joinLang(url, req) : "es";
  html(res, 200, P.joinPage({
    program: publicProgram(program), client: { name: client.name, logoFile: client.logoFile }, baseUrl: ctx.baseUrl(req),
    lang, knownCardUrl: card ? `/card/${card.cardToken}` : "", deviceKnown: !!member,
  }));
  return true;
}
const STAFF_ACTIONS = ["lookup", "record", "find", "enrol", "waiting", "confirm"];

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
  if (seg.length === 2) {
    const v = view();
    // Only old cards that have no number yet can be claimed, and only when a code can actually be
    // sent: with no SMS provider the prompt would be a dead end, so it is not rendered at all.
    const claim = recoveryOtp(ctx).available && !customer.memberId && canIssue(program);
    await save();
    html(res, 200, P.cardPage({ view: v, baseUrl: base, claim }));
    return true;
  }
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
  if (!canIssue(program)) return notFoundPage(res), true;
  const client = L.clientOf(program) ?? {};
  html(res, 200, (await pages()).staffPage({ program: { id: program.id, name: program.name, type: program.type, status: program.status, design: program.design }, client: { name: client.name, logoFile: client.logoFile }, baseUrl: ctx.baseUrl(req) }));
  return true;
}

// ---------- public API ----------

// The device token lives in an HttpOnly cookie, so a page cannot read it and a script on another
// site cannot send it. `memberToken` in the body is the fallback for a page that stored it itself.
const MEMBER_COOKIE = "lc_member";
const MEMBER_COOKIE_DAYS = 730;
const RECOVERY_COOKIE = "lc_recovery";
const RECOVERY_COOKIE_SECONDS = 15 * 60;
const cookies = (req) => Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).filter((p) => p.length === 2));
/** `Set-Cookie` can hold several values; the second cookie on one response must not erase the first. */
const pushCookie = (res, value) => {
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", prev ? [].concat(prev, value) : value);
};
const cookieFlags = (req) => {
  const pub = process.env.PUBLIC_URL ?? "";
  const secure = (pub ? /^https:/i.test(pub) : req.headers["x-forwarded-proto"] === "https") ? "; Secure" : "";
  return `HttpOnly; SameSite=Lax; Path=/${secure}`;
};
const setMemberCookie = (req, res, token) => pushCookie(res, `${MEMBER_COOKIE}=${token}; Max-Age=${MEMBER_COOKIE_DAYS * 86400}; ${cookieFlags(req)}`);
const setRecoveryCookie = (req, res, secret) => pushCookie(res, `${RECOVERY_COOKIE}=${secret}; Max-Age=${RECOVERY_COOKIE_SECONDS}; ${cookieFlags(req)}`);

/**
 * Two shapes of join body, on purpose:
 *   {phone, name?}          the new page. The card is keyed by the number and bound to this device.
 *   {name, email, ...}      a page cached from before the update. Untouched: one card per submit.
 *
 * The phone path returns three answers:
 *   201 card        a new number, or a known device getting its card for another shop
 *   200 card        a known device asking again for a shop it already has
 *   202 recovery    the number belongs to someone else's device. Nothing about that person is
 *                   returned, not even their name, and no card is created. Proving the number
 *                   (L5) is the only way through.
 *
 * The last one is a deliberate difference between "new" and "already registered": a zero-friction
 * join and a protected balance cannot both be silent about which case you are in. It leaks one bit
 * (this number has a card somewhere) and nothing else. Documented in docs/routes-and-auth.md.
 */
async function joinRoute(req, res, program, raw, ctx) {
  const b = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const rawPhone = typeof b.phone === "string" ? b.phone.trim() : "";
  const held = (typeof b.memberToken === "string" && b.memberToken) || cookies(req)[MEMBER_COOKIE] || "";
  const device = L.memberByToken(held);

  // No phone: either a device that already proved its number, or a page cached before this change.
  // A body carrying a name or an email is always the old shape, even on a device that has a cookie,
  // so an old page keeps doing exactly what it did.
  if (!rawPhone) {
    if (device && b.name == null && b.email == null) {
      const { customer, created } = L.cardForMember(device, program);
      await save();
      setMemberCookie(req, res, device.memberToken);
      return ctx.send(res, created ? 201 : 200, { cardUrl: `/card/${customer.cardToken}` }), true;
    }
    if (!hit(limits.joinProgram, program.id)) return tooMany(ctx, res), true;
    const c = L.joinCustomer(program, b);
    await save();
    return ctx.send(res, 201, { cardUrl: `/card/${c.cardToken}` }), true;
  }

  const phone = normalisePhone(rawPhone);
  if (!phone) return ctx.send(res, 400, { error: "That phone number does not look right." }), true;
  // Both caps count the attempt: a script has to spend valid numbers to burn either budget.
  if (!hit(limits.joinProgram, program.id) || !hit(limits.joinPhone, `phone:${phone.e164}`)) return tooMany(ctx, res), true;

  if (device) {
    if (device.phone !== phone.e164) return ctx.send(res, 409, { error: "This device is already set up for a different number." }), true;
    const { customer, created } = L.cardForMember(device, program);
    await save();
    setMemberCookie(req, res, device.memberToken);
    return ctx.send(res, created ? 201 : 200, { cardUrl: `/card/${customer.cardToken}` }), true;
  }

  // A number that is already known is never handed over on the strength of typing it: anyone who
  // knows the number could read the name on the card. No write happens on this path either.
  if (L.memberByPhone(phone.e164)) return ctx.send(res, 202, { recovery: "verify" }), true;

  const { member } = L.findOrCreateMember({ phone: phone.e164, name: b.name, locale: b.locale });
  const { customer } = L.cardForMember(member, program);
  await save();
  setMemberCookie(req, res, member.memberToken);
  return ctx.send(res, 201, { cardUrl: `/card/${customer.cardToken}` }), true;
}

// ---------- recovery (plan A.4) ----------
// Tier 1 sends a code to the number; tier 2 asks the staff to recognise the person at the till.
// Both end the same way: the requesting device gets the member cookie and the card URL, and the
// card is created on demand if the person did not have one at this shop yet.
const RECOVERY_ACTIONS = ["code", "verify", "wait"];
const recoveryOtp = (ctx) => ctx?.otp ?? otpService;

const recoveryError = (reason) => ({
  missing: "Ask for a new code.",
  expired: "That code has expired. Ask for a new one.",
  locked: "Too many wrong codes. Ask for a new one, or confirm it at the till.",
  wrong: "That code is not right.",
}[reason] ?? "That code is not right.");

async function finishRecovery(req, res, row, ctx) {
  const member = L.memberById(row.memberId);
  const customer = L.cardForRecovery(row);
  if (!member || !customer) return ctx.send(res, 410, { error: "This card is not available any more. Ask the staff." }), true;
  await save();
  setMemberCookie(req, res, member.memberToken);
  return ctx.send(res, 200, { state: "confirmed", cardUrl: `/card/${customer.cardToken}` }), true;
}

async function recoveryRoutes(req, res, seg, ctx, ip) {
  const m = req.method, action = seg[4];
  const program = byJoin(seg[3]);
  if (!program || !canIssue(program)) return ctx.send(res, 404, { error: "This link is not valid." }), true;

  // POST .../code {phone}: start a recovery and, when a provider exists, send the code.
  if (action === "code") {
    if (m !== "POST") return false;
    if (!hit(limits.recoveryCode, ip)) return tooMany(ctx, res), true;
    const b = await ctx.readBody(req, 5e3);
    const phone = normalisePhone(typeof b?.phone === "string" ? b.phone : "");
    if (!phone) return ctx.send(res, 400, { error: "That phone number does not look right." }), true;
    if (!hit(limits.recoveryPhone, `phone:${phone.e164}`)) return tooMany(ctx, res), true;

    const svc = recoveryOtp(ctx);
    const made = L.newRecovery({ program, phone: phone.e164 });
    // Same answer whether or not that number has a card. What it does say is whether this shop can
    // send an SMS at all, which is configuration, not personal data.
    if (!made) return ctx.send(res, 202, { recovery: svc.available ? "sms" : "staff", sent: false }), true;
    const sent = svc.available ? (await svc.send(phone.e164)).ok : false;
    // `method` is what the request is waiting on. With no provider (or a failed send) a code can
    // never arrive, so the staff queue is the honest answer; the page still offers the till either way.
    made.row.method = sent ? "sms" : "staff";
    await save();
    setRecoveryCookie(req, res, made.secret);
    return ctx.send(res, 202, { recovery: svc.available ? "sms" : "staff", sent }), true;
  }

  // POST .../verify {code}: the code the phone received, if a provider sent one.
  if (action === "verify") {
    if (m !== "POST") return false;
    if (!hit(limits.recoveryVerify, ip)) return tooMany(ctx, res), true;
    const row = L.recoveryBySecret(cookies(req)[RECOVERY_COOKIE]);
    if (!row || row.programId !== program.id) return ctx.send(res, 404, { error: "This recovery has expired. Start again." }), true;
    if (row.state === "expired") return ctx.send(res, 410, { error: "This recovery has expired. Start again." }), true;
    if (row.state === "confirmed") return await finishRecovery(req, res, row, ctx);
    const b = await ctx.readBody(req, 5e3);
    const r = recoveryOtp(ctx).verify(row.phone, b?.code);
    if (!r.ok) {
      const code = r.reason === "locked" ? 423 : r.reason === "expired" ? 410 : 401;
      return ctx.send(res, code, { error: recoveryError(r.reason), triesLeft: r.triesLeft }), true;
    }
    L.confirmRecovery(row, { by: "sms" });
    const member = L.memberById(row.memberId);
    if (member) member.phoneVerifiedAt = now();
    return await finishRecovery(req, res, row, ctx);
  }

  // GET .../wait: the page polls this while the staff find the person at the till.
  if (action === "wait") {
    if (m !== "GET") return false;
    if (!hit(limits.recoveryWait, ip)) return tooMany(ctx, res), true;
    const row = L.recoveryBySecret(cookies(req)[RECOVERY_COOKIE]);
    if (!row) return ctx.send(res, 200, { state: "missing" }), true;
    if (row.state === "expired") return ctx.send(res, 200, { state: "expired" }), true;
    if (row.state !== "confirmed") return ctx.send(res, 200, { state: "pending" }), true;
    return await finishRecovery(req, res, row, ctx);
  }

  return false;
}

// ---------- claiming an old email card (plan A.6, step 3) ----------
// The person already holds the card's secret URL, so the card is not in question: what the code
// proves is that the number they are adding is theirs. Two routes, mirroring recovery: send a code,
// then verify it. With no SMS provider the form is not shown at all (the card page asks the shop).
const CLAIM_ERROR = {
  missing: "Ask for a new code.",
  expired: "That code has expired. Ask for a new one.",
  locked: "Too many wrong codes. Ask for a new one.",
  wrong: "That code is not right.",
};

async function claimRoutes(req, res, seg, ctx, ip) {
  const verifyStep = seg.length === 6 && seg[5] === "verify";
  const customer = L.findByToken(seg[3]);
  const program = customer && L.findProgram(customer.programId);
  if (!customer || !program) return ctx.send(res, 404, { error: "This card link is not valid." }), true;
  if (!canIssue(program)) return ctx.send(res, 403, { error: "This card is not active yet. Ask the owner." }), true;
  if (customer.memberId) return ctx.send(res, 409, { error: "This card already has a phone number." }), true;

  if (!verifyStep) {
    if (!hit(limits.claimCode, ip)) return tooMany(ctx, res), true;
    const b = await ctx.readBody(req, 5e3);
    const phone = normalisePhone(typeof b?.phone === "string" ? b.phone : "");
    if (!phone) return ctx.send(res, 400, { error: "That phone number does not look right." }), true;
    if (!hit(limits.claimPhone, `phone:${phone.e164}`)) return tooMany(ctx, res), true;
    const svc = recoveryOtp(ctx);
    if (!svc.available) return ctx.send(res, 503, { error: "Text messages are not set up. Ask the staff to add your number." }), true;
    const sent = await svc.send(phone.e164);
    if (!sent.ok) {
      const code = sent.reason === "phone_cap" || sent.reason === "daily_cap" ? 429 : 502;
      return ctx.send(res, code, { error: "We could not send the code. Try again in a few minutes." }), true;
    }
    return ctx.send(res, 202, { sent: true }), true;
  }

  if (!hit(limits.claimVerify, ip)) return tooMany(ctx, res), true;
  const b = await ctx.readBody(req, 5e3);
  const phone = normalisePhone(typeof b?.phone === "string" ? b.phone : "");
  if (!phone) return ctx.send(res, 400, { error: "That phone number does not look right." }), true;
  const r = recoveryOtp(ctx).verify(phone.e164, b?.code);
  if (!r.ok) {
    const code = r.reason === "locked" ? 423 : r.reason === "expired" ? 410 : 401;
    return ctx.send(res, code, { error: CLAIM_ERROR[r.reason] ?? "That code is not right.", triesLeft: r.triesLeft }), true;
  }
  // An existing member keeps their name; a new one takes the card's. The link itself refuses a
  // second card for the same number at this shop, which is the owner's merge to make, not ours.
  const member = L.memberByPhone(phone.e164) ?? L.findOrCreateMember({ phone: phone.e164, name: customer.name, locale: b?.locale }).member;
  try {
    L.linkCardToMember(customer, member);
  } catch (e) {
    return ctx.send(res, e.status ?? 400, { error: e.message }), true;
  }
  if (!member.phoneVerifiedAt) member.phoneVerifiedAt = now();
  await save();
  setMemberCookie(req, res, member.memberToken);
  return ctx.send(res, 200, { ok: true, cardUrl: `/card/${customer.cardToken}` }), true;
}

async function publicApi(req, res, seg, ctx) {
  const ip = ctx.clientIp(req);
  const m = req.method;
  // POST /api/loyalty/join/<joinCode>
  if (m === "POST" && seg[2] === "join" && seg.length === 4) {
    if (!hit(limits.join, ip)) return tooMany(ctx, res), true;
    const program = byJoin(seg[3]);
    if (!program) return ctx.send(res, 404, { error: "This link is not valid." }), true;
    if (!canIssue(program)) return ctx.send(res, 404, { error: "This link is not valid." }), true;
    const b = await ctx.readBody(req, 20e3);
    return await joinRoute(req, res, program, b, ctx);
  }
  // POST/GET /api/loyalty/join/<joinCode>/(code|verify|wait)
  if (seg[2] === "join" && seg.length === 5 && RECOVERY_ACTIONS.includes(seg[4])) return await recoveryRoutes(req, res, seg, ctx, ip);
  // POST /api/loyalty/card/<cardToken>/claim  and  .../claim/verify
  if (m === "POST" && seg[2] === "card" && seg[4] === "claim" && (seg.length === 5 || (seg.length === 6 && seg[5] === "verify"))) return await claimRoutes(req, res, seg, ctx, ip);
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
  // POST /api/loyalty/staff/<staffToken>/(lookup|record|find|enrol)
  if (m === "POST" && seg[2] === "staff" && seg.length === 5 && STAFF_ACTIONS.includes(seg[4])) {
    if (limits.badStaff.blocked(ip) || !hit(limits.staff, ip)) return tooMany(ctx, res), true;
    const program = byToken(seg[3]);
    if (!program) { limits.badStaff.fail(ip); return ctx.send(res, 404, { error: "This staff link is not valid." }), true; }
    if (!canIssue(program)) return ctx.send(res, 403, { error: "This card is not active yet. Ask the owner." }), true;
    const b = await ctx.readBody(req, 10e3);
    const progInfo = { name: program.name, type: program.type, status: program.status, stamps: { goal: program.stamps.goal }, rewards: program.rewards.filter((r) => r.active !== false).map((r) => ({ id: r.id, name: r.name, cost: r.cost, kind: r.kind })) };
    // Phone lookup: the last digits the customer reads out. Only cards of this programme, five at
    // most, first name only, number masked. Finding nothing is not a failed guess, so it does not
    // count toward badStaff; the staff limit still bounds how many searches a till can make.
    if (seg[4] === "find") {
      if (String(b.phone ?? "").replace(/\D/g, "").length < 3) return ctx.send(res, 400, { error: "Type at least 3 digits of the phone number." }), true;
      const hits = L.findCardsByPhone(program, b.phone);
      ctx.send(res, 200, { matches: hits.map((h) => L.staffMatch(h.customer, program, h.phone)) });
      return true;
    }
    // Enrol at the till (plan A.5): the person is standing there, so no proof of the number is
    // needed — but that is also why no marketing consent is recorded. Only the customer, on their
    // own phone, can tick that box (Part C).
    if (seg[4] === "enrol") {
      const n = normalisePhone(b.phone);
      if (!n) return ctx.send(res, 400, { error: "That phone number does not look right." }), true;
      const { member } = L.findOrCreateMember({ phone: n.e164, name: b.name });
      const { customer, created } = L.cardForMember(member, program, { by: "staff" });
      await save();
      ctx.send(res, created ? 201 : 200, { customer: L.staffCustomer(customer, program), cardUrl: `/card/${customer.cardToken}`, created });
      return true;
    }
    // Recovery at the till (plan A.4, tier 2). The staff member sees a first name and a masked
    // number, recognises the person in front of them and confirms. The card goes to the device that
    // asked, never to the till, and the request expires on its own in fifteen minutes.
    if (seg[4] === "waiting") {
      ctx.send(res, 200, { requests: L.waitingRecoveries(program).map(L.recoveryView) });
      return true;
    }
    if (seg[4] === "confirm") {
      const row = L.recoveries().find((r) => r.id === b.id && r.programId === program.id);
      if (!row) return ctx.send(res, 404, { error: "That request is gone. Ask them to try again." }), true;
      if (!L.confirmRecovery(row, { by: "staff" })) return ctx.send(res, 410, { error: "That request has expired. Ask them to try again." }), true;
      await save();
      ctx.send(res, 200, { ok: true });
      return true;
    }
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
    const file = await ctx.saveUpload(b?.image);
    L.recordUpload(file, owner ? "" : scope.clientId);
    return out(200, { file });
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
    L.rotateStaffToken(p);
    await save();
    return out(200, { staffToken: p.staffToken, staffTokenExpiresAt: p.staffTokenExpiresAt, staffUrl: L.staffUrl(p, base) });
  }

  // POST /programs/:id/merge {keepId, mergeId, confirm:true}: fold a duplicate card into another.
  // The owner sees the duplicate report and chooses which balance survives; nothing is automatic.
  if (act === "merge" && rest.length === 3 && m === "POST") {
    const b = await ctx.readBody(req, 5e3);
    if (b.confirm !== true) return out(400, { error: "Confirm the merge first." });
    try {
      const r = L.mergeCards(p, b.keepId, b.mergeId, { by });
      await save();
      pushAll(p);
      return out(200, { ok: true, card: L.customerRow(r.keep), mergedId: r.gone.id });
    } catch (e) {
      return out(e.status ?? 400, { error: e.message });
    }
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
