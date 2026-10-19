// Apple Wallet: PassKit Web Service (device registration, pass updates) and APNs "pass changed" pushes.
import { connect } from "node:http2";
import { timingSafeEqual } from "node:crypto";
import { db, save } from "./store.mjs";
import { buildPass, walletStatus, readPem } from "./pass.mjs";

async function getLdb(ctx) {
  if (ctx?.ldb) return ctx.ldb();
  try {
    const m = await import("./loyalty.mjs");
    if (m.ldb) return m.ldb();
  } catch { /* loyalty.mjs not there yet: fall through */ }
  return (db.loyalty ??= { programs: [], customers: [], txns: [], devices: [], templates: [] });
}

const stamp = (c) => Date.parse(c.updatedAt ?? c.lastVisitAt ?? c.createdAt ?? "") || 0;
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const origin = (req) => `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`;

export const LOG_MAX_BYTES = 8e3, LOG_MAX_LINES = 20, LOG_MAX_CHARS = 300, LOG_PER_MINUTE = 30;
const logHits = new Map();
function logAllowed(key, at = Date.now()) {
  if (logHits.size > 5000) for (const [k, v] of logHits) if (at - v.start > 60e3) logHits.delete(k);
  let h = logHits.get(key);
  if (!h || at - h.start > 60e3) { h = { start: at, n: 0 }; logHits.set(key, h); }
  return ++h.n <= LOG_PER_MINUTE;
}

/** Handles /wallet/v1/... Returns true when the request was for the wallet service. */
export async function handleWallet(req, res, url, seg, ctx) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "wallet" || parts[1] !== "v1") return false;
  const { send, readBody } = ctx;
  const env = ctx.env ?? process.env;
  const status = walletStatus(env);
  if (!status.configured) { send(res, 404, { error: "Apple Wallet is not set up" }); return true; }
  const L = await getLdb(ctx);
  const r = parts.slice(2);
  const auth = () => /^ApplePass\s+(.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  const ok = (code, headers = {}) => { res.writeHead(code, headers); res.end(); };
  const customerFor = (serial) => L.customers.find((c) => c.id === serial);
  const authorised = (c) => c && c.authToken && auth() && same(auth(), c.authToken);

  try {
    // POST /wallet/v1/log
    if (r[0] === "log" && req.method === "POST") {
      // Unauthenticated by design (Apple sends it without a token), so it is bounded: 8 KB body, 20 lines, 300 chars each, 30 posts a minute per address.
      if (!logAllowed(ctx.clientIp?.(req) ?? req.socket?.remoteAddress ?? "?")) { ok(429, { "Retry-After": "60" }); return true; }
      const body = await readBody(req, LOG_MAX_BYTES).catch(() => ({}));
      const logs = Array.isArray(body?.logs) ? body.logs.slice(0, LOG_MAX_LINES) : [];
      for (const line of logs) console.warn("[wallet]", String(line).replace(/[\x00-\x1f\x7f]+/g, " ").slice(0, LOG_MAX_CHARS));
      ok(200); return true;
    }
    // /wallet/v1/devices/:deviceId/registrations/:passTypeId[/:serial]
    if (r[0] === "devices" && r[2] === "registrations" && r[3]) {
      const [, deviceId, , passTypeId, serial] = r;
      if (passTypeId !== status.passTypeId) { send(res, 404, { error: "Unknown pass type" }); return true; }
      if (serial) {
        const c = customerFor(serial);
        if (!authorised(c)) { send(res, 401, { error: "Unauthorized" }); return true; }
        const i = L.devices.findIndex((d) => d.deviceId === deviceId && d.serial === serial && d.passTypeId === passTypeId);
        if (req.method === "POST") {
          const { pushToken } = await readBody(req);
          if (!pushToken) { send(res, 400, { error: "pushToken required" }); return true; }
          const rec = { deviceId, pushToken, serial, passTypeId, at: new Date().toISOString() };
          if (i >= 0) L.devices[i] = rec; else L.devices.push(rec);
          save(); ok(i >= 0 ? 200 : 201); return true;
        }
        if (req.method === "DELETE") {
          if (i >= 0) { L.devices.splice(i, 1); save(); }
          ok(200); return true;
        }
      } else if (req.method === "GET") {
        const since = Number(url.searchParams.get("passesUpdatedSince")) || 0;
        const serials = L.devices.filter((d) => d.deviceId === deviceId && d.passTypeId === passTypeId).map((d) => d.serial);
        const cs = serials.map(customerFor).filter(Boolean).filter((c) => stamp(c) > since);
        if (!cs.length) { ok(204); return true; }
        send(res, 200, { serialNumbers: cs.map((c) => c.id), lastUpdated: String(Math.max(...cs.map(stamp))) });
        return true;
      }
    }
    // GET /wallet/v1/passes/:passTypeId/:serial
    if (r[0] === "passes" && r[1] && r[2] && req.method === "GET") {
      if (r[1] !== status.passTypeId) { send(res, 404, { error: "Unknown pass type" }); return true; }
      const c = customerFor(r[2]);
      if (!authorised(c)) { send(res, 401, { error: "Unauthorized" }); return true; }
      const mod = Math.floor(stamp(c) / 1000) * 1000;
      const ims = Date.parse(req.headers["if-modified-since"] ?? "");
      if (ims && mod && mod <= ims) { ok(304); return true; }
      const program = L.programs.find((p) => p.id === c.programId);
      if (!program) { send(res, 404, { error: "Card not found" }); return true; }
      const client = (db.clients ?? []).find((x) => x.id === c.clientId);
      const buf = await (ctx.buildPass ?? buildPass)({ program, customer: c, client, baseUrl: ctx.baseUrl?.(req) ?? origin(req), env });
      res.writeHead(200, { "Content-Type": "application/vnd.apple.pkpass", "Last-Modified": new Date(mod || Date.now()).toUTCString(), "Content-Length": buf.length });
      res.end(buf); return true;
    }
  } catch (e) {
    send(res, e.status ?? 500, { error: e.message }); return true;
  }
  send(res, 404, { error: "Not found" }); return true;
}

/** Real APNs sender: one HTTP/2 session per call, mTLS with the Pass Type ID certificate. Resolves to [{token,status}]. */
export function apnsSender(env = process.env) {
  return (tokens, { topic }) => new Promise((resolve) => {
    const host = env.APNS_HOST || "api.push.apple.com";
    const out = [];
    let session;
    try {
      session = connect(`https://${host}`, { cert: readPem(env, "APPLE_PASS_CERT"), key: readPem(env, "APPLE_PASS_KEY"), passphrase: env.APPLE_PASS_KEY_PASSPHRASE || undefined });
    } catch { return resolve(tokens.map((token) => ({ token, status: 0 }))); }
    const finish = () => { try { session.close(); } catch { /* closed */ } resolve(out); };
    session.on("error", () => { for (const t of tokens) if (!out.find((o) => o.token === t)) out.push({ token: t, status: 0 }); finish(); });
    if (!tokens.length) return finish();
    let left = tokens.length;
    for (const token of tokens) {
      const rq = session.request({ ":method": "POST", ":path": `/3/device/${token}`, "apns-topic": topic, "apns-push-type": "background", "apns-priority": "5" });
      let status = 0;
      rq.on("response", (h) => { status = h[":status"]; });
      rq.on("error", () => {});
      rq.on("close", () => { out.push({ token, status }); if (--left === 0) finish(); });
      rq.setTimeout(10000, () => rq.close());
      rq.end("{}");
    }
  });
}

/**
 * Tell every phone holding this customer's pass to fetch the new version.
 * `sender(tokens, {topic})` is injectable and resolves to [{token,status}]. Devices answered with 410 are forgotten.
 */
export async function pushUpdate(customer, { sender, env = process.env, ldb } = {}) {
  const st = walletStatus(env);
  if (!st.pushReady) return { sent: 0, removed: 0, skipped: st.configured ? "PUBLIC_URL is not https" : "not configured" };
  const L = ldb ?? (await getLdb());
  const devs = L.devices.filter((d) => d.serial === customer.id && d.passTypeId === st.passTypeId);
  if (!devs.length) return { sent: 0, removed: 0 };
  const results = await (sender ?? apnsSender(env))([...new Set(devs.map((d) => d.pushToken))], { topic: st.passTypeId });
  const gone = new Set(results.filter((x) => x.status === 410).map((x) => x.token));
  if (gone.size) {
    L.devices = L.devices.filter((d) => !(d.serial === customer.id && gone.has(d.pushToken)));
    save();
  }
  return { sent: results.filter((x) => x.status === 200).length, removed: gone.size, failed: results.filter((x) => x.status !== 200 && x.status !== 410).length };
}
