// Sign-in for the landing page: the owner's admin password (hashed with scrypt, sessions in an
// HttpOnly cookie) and short access codes for each business.
import { scryptSync, randomBytes, randomInt, createHash, timingSafeEqual } from "node:crypto";

const COOKIE = "isla_admin";
const SESSION_DAYS = 30;
const sha = (s) => createHash("sha256").update(s).digest("hex");

export function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString("hex")}`;
}
export function verifyPassword(pw, stored = "") {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const got = scryptSync(String(pw), salt, 32);
  const want = Buffer.from(hash, "hex");
  return want.length === got.length && timingSafeEqual(got, want);
}
const sameText = (a, b) => { const x = Buffer.from(sha(String(a))), y = Buffer.from(sha(String(b))); return timingSafeEqual(x, y); };

export function createAuth(db, save) {
  const state = () => (db.settings.admin ??= { sessions: [] });
  const envPassword = () => process.env.ADMIN_PASSWORD ?? "";
  const envToken = () => process.env.ADMIN_TOKEN ?? "";
  const hasPassword = () => !!(envPassword() || state().hash);

  const cookies = (req) => Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).filter((p) => p.length === 2));
  function sessionOk(req) {
    const t = cookies(req)[COOKIE];
    if (!t) return false;
    const h = sha(t);
    return state().sessions.some((s) => s.h === h && s.exp > Date.now());
  }

  /** May this request use the owner's dashboard and API? Open only until a password is set. */
  function isAdmin(req) {
    if (envToken() && req.headers["x-admin-token"] && sameText(req.headers["x-admin-token"], envToken())) return true;
    if (sessionOk(req)) return true;
    return !hasPassword() && !envToken();
  }

  function checkPassword(pw) {
    if (envPassword()) return sameText(pw, envPassword());
    return verifyPassword(pw, state().hash);
  }

  async function startSession(req, res) {
    const t = randomBytes(32).toString("base64url");
    const s = state();
    s.sessions = [...s.sessions.filter((x) => x.exp > Date.now()).slice(-19), { h: sha(t), exp: Date.now() + SESSION_DAYS * 864e5 }];
    await save();
    const secure = req.headers["x-forwarded-proto"] === "https" || /^https:/.test(process.env.PUBLIC_URL ?? "") ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${COOKIE}=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  }

  async function endSession(req, res) {
    const t = cookies(req)[COOKIE];
    if (t) { const h = sha(t); state().sessions = state().sessions.filter((s) => s.h !== h); await save(); }
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }

  async function setPassword(pw) {
    state().hash = hashPassword(pw);
    state().sessions = []; // everyone signs in again with the new password
    await save();
  }

  return { isAdmin, hasPassword, checkPassword, startSession, endSession, setPassword, fromEnv: () => !!envPassword() };
}

// ---------- Business access codes ----------

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I, easy to read out
export const normCode = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** A new code like "K7P-M3Q" that no other business has. */
export function newCode(clients) {
  const taken = new Set(clients.map((c) => normCode(c.code)));
  for (;;) {
    const raw = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    if (!taken.has(raw)) return `${raw.slice(0, 3)}-${raw.slice(3)}`;
  }
}
export const findByCode = (clients, code) => {
  const n = normCode(code);
  return n.length === 6 ? clients.find((c) => c.code && normCode(c.code) === n) : undefined;
};

/** Simple per-IP limiter: allow `max` failed tries per `windowMs`. */
export function limiter(max, windowMs) {
  const hits = new Map();
  return {
    blocked: (ip) => (hits.get(ip) ?? []).filter((t) => Date.now() - t < windowMs).length >= max,
    fail: (ip) => hits.set(ip, [...(hits.get(ip) ?? []).filter((t) => Date.now() - t < windowMs), Date.now()]),
    clear: (ip) => hits.delete(ip),
  };
}
