// HTTP routes for the expense tracker: owner (/api/studio/expenses) and client portal (/api/portal/<token>/expenses).
// handleExpenses(...) returns true when it answered. A declined business never reaches here (blocked earlier in index.mjs).
import { db, save } from "./store.mjs";
import { limiter } from "./auth.mjs";
import * as X from "./expenses.mjs";
import { toCsv, toOds } from "./expenses-export.mjs";

export const limits = { manage: limiter(600, 60e3), scan: limiter(30, 3600e3) };
const hit = (lim, ip) => { if (lim.blocked(ip)) return false; lim.fail(ip); return true; };
const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const ES = {
  "Choose a valid date.": "Elige una fecha válida.", "Enter the total amount.": "Escribe el importe total.", "Choose a valid location.": "Elige un local válido.",
  "Add at least one location.": "Añade al menos un local.", "A location with expenses cannot be removed. Rename it instead.": "No se puede quitar un local con gastos. Cámbiale el nombre.",
  "Send a JPEG, PNG or WebP photo.": "Envía una foto JPEG, PNG o WebP.", "That photo is too large. Try a smaller one.": "Esa foto es demasiado grande. Prueba con una más pequeña.",
  "The receipt reader is not available right now. Enter the expense by hand.": "El lector de tickets no está disponible ahora. Escribe el gasto a mano.",
  "We could not read that receipt. Try a sharper photo or enter it by hand.": "No hemos podido leer ese ticket. Prueba con una foto más nítida o escríbelo a mano.",
  "Expenses are not turned on for this business.": "Los gastos no están activados para este negocio.", "Expense not found": "Gasto no encontrado", "Choose a business first.": "Elige un negocio primero.",
  "Sign in first": "Inicia sesión primero.", "Too many tries. Please wait a few minutes.": "Demasiados intentos. Espera unos minutos.", "Something went wrong. Please try again.": "Algo ha ido mal. Inténtalo de nuevo.",
  "Choose a valid month.": "Elige un mes válido.", "Request too large": "La foto es demasiado grande.",
};
const fail = (e, ctx, res, req) => {
  const msg = e.status ? e.message : "Something went wrong. Please try again.";
  if (!e.status) console.error("expenses:", e);
  ctx.send(res, e.status ?? 500, { error: req?.headers["x-lang"] === "es" ? ES[msg] ?? msg : msg, ...(e.code ? { code: e.code } : {}) });
};

export async function handleExpenses(req, res, url, seg, ctx) {
  try {
    if (seg[0] === "api" && seg[1] === "studio" && seg[2] === "expenses") {
      if (!ctx.isAdmin(req)) return ctx.send(res, 401, { error: "Sign in first" }), true;
      return await manage(req, res, url, seg.slice(3), null, ctx);
    }
    if (seg[0] === "api" && seg[1] === "portal" && seg[2] && seg[3] === "expenses") {
      const c = ctx.clientByToken(seg[2]);
      if (!c) return ctx.send(res, 404, { error: "Unknown portal link" }), true;
      return await manage(req, res, url, seg.slice(4), c.id, ctx);
    }
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

  // Owner overview: which businesses have expenses on.
  if (owner && !c && rest.length === 0 && m === "GET") {
    return out(200, { businesses: db.clients.map((x) => { const cfg = X.findConfig(x.id); return { id: x.id, name: x.name, enabled: !!cfg?.enabled, count: X.list(x.id).length }; }) });
  }
  if (!c) return out(owner ? 400 : 404, { error: "Choose a business first." });
  const cfg = X.ensureConfig(c);
  // The portal sees nothing but "off" until the owner turns the feature on.
  if (!owner && !cfg.enabled) {
    if (rest.length === 0 && m === "GET") return out(200, { config: { enabled: false } });
    return out(403, { error: "Expenses are not turned on for this business.", code: "disabled" });
  }
  const month = q.get("month") ? str(q.get("month"), 7) : "", locationId = str(q.get("locationId"), 40);
  if (month && !X.validMonth(month)) return out(400, { error: "Choose a valid month." });

  if (rest.length === 0 && m === "GET") {
    const items = X.list(c.id, { month, locationId });
    await save();
    return out(200, { config: X.configView(cfg), expenses: items.map(X.expenseView), summary: X.summarize(items, cfg), months: X.months(c.id), month, locationId });
  }
  if (rest[0] === "config" && rest.length === 1 && (m === "PUT" || m === "PATCH")) {
    X.updateConfig(cfg, await ctx.readBody(req, 50e3), { owner });
    await save();
    return out(200, X.configView(cfg));
  }
  if (rest[0] === "scan" && rest.length === 1 && m === "POST") {
    if (!cfg.enabled) return out(409, { error: "Expenses are not turned on for this business.", code: "disabled" });
    if (!hit(limits.scan, ip)) return out(429, { error: "Too many tries. Please wait a few minutes." });
    const b = await ctx.readBody(req, 10e6);
    return out(200, { draft: await X.scan(c, cfg, b.image) });
  }
  if (rest[0] === "export" && rest.length === 1 && m === "GET") {
    const items = X.list(c.id, { month, locationId });
    const lang = req.headers["x-lang"] === "en" || q.get("lang") === "en" ? "en" : "es";
    const slug = String(c.name ?? "negocio").normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "negocio";
    const name = `gastos-${slug}-${month || "todo"}`;
    if (q.get("format") === "csv") {
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="${name}.csv"` });
      return res.end(toCsv(items, cfg, lang)), true;
    }
    res.writeHead(200, { "Content-Type": "application/vnd.oasis.opendocument.spreadsheet", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="${name}.ods"` });
    return res.end(toOds(items, cfg, lang, month)), true;
  }
  if (rest[0] === "items" && rest.length === 1 && m === "POST") {
    const x = X.addExpense(cfg, await ctx.readBody(req, 50e3));
    await save();
    return out(201, X.expenseView(x));
  }
  if (rest[0] === "items" && rest.length === 2) {
    const x = X.findExpense(rest[1]);
    if (!x || x.clientId !== c.id) return out(404, { error: "Expense not found" });
    if (m === "PATCH" || m === "PUT") { X.editExpense(cfg, x, await ctx.readBody(req, 50e3)); await save(); return out(200, X.expenseView(x)); }
    if (m === "DELETE") { X.removeExpense(x); await save(); return out(200, { ok: true }); }
  }
  return false;
}
