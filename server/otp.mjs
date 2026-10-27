// One-time codes for loyalty recovery (plan A.4, tier 1). No provider is configured yet, so the
// default adapter refuses to send anything and the route offers the staff-confirmed path (tier 2).
//
// The code is never stored or logged in clear: the row keeps an HMAC of the number and the code,
// with a per-process secret, so neither the data file nor a heap dump read later can be turned
// into a live code. Six digits, ten minutes, three tries, three sends per number per hour and a
// global daily cap so a bot cannot burn money once a provider is wired. A restart forgets every
// code: that is the safe direction, and the person simply asks for another.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_TTL_MS = 10 * 60e3;
export const OTP_MAX_TRIES = 3;
export const OTP_SENDS_PER_HOUR = 3;

const SECRET = randomBytes(32);
const hash = (phone, code) => createHmac("sha256", SECRET).update(`${phone}:${code}`).digest();
const digits = (v) => String(v ?? "").replace(/\D/g, "");

/** The adapter used until ATD picks a provider: it never sends, and never pretends it did. */
export const noProvider = {
  name: "none",
  send: async () => ({ ok: false, reason: "no_provider" }),
};

/**
 * `adapter.send(phone, text)` must resolve `{ok:true}` or `{ok:false, reason}`. A fake adapter in the
 * tests captures the text instead. `dailyCap` of 0 means no global cap (no provider, no cost).
 */
export function createOtpService({
  adapter = noProvider,
  dailyCap = 0,
  ttlMs = OTP_TTL_MS,
  maxTries = OTP_MAX_TRIES,
  sendsPerHour = OTP_SENDS_PER_HOUR,
  now = () => Date.now(),
  random = randomInt,
} = {}) {
  const rows = new Map(); // phone -> { h: Buffer|null, exp: ms, tries, attempts: [ms] }
  let day = "", spentToday = 0; // counts sends that actually reached the adapter, not attempts

  const roll = (ms) => { const d = new Date(ms).toISOString().slice(0, 10); if (d !== day) { day = d; spentToday = 0; } };
  const recent = (list, ms) => (list ?? []).filter((t) => ms - t < 3600e3);

  return {
    /** True when there is a real sender behind this service. Never reveals qualities of a number. */
    get available() { return adapter !== noProvider; },

    /** Why a code cannot be sent now: "no_provider", "daily_cap", "phone_cap", or "" when it can. */
    blocked(phone) {
      const ms = now();
      roll(ms);
      if (adapter === noProvider) return "no_provider";
      if (dailyCap > 0 && spentToday >= dailyCap) return "daily_cap";
      if (recent(rows.get(phone)?.attempts, ms).length >= sendsPerHour) return "phone_cap";
      return "";
    },

    async send(phone) {
      const why = this.blocked(phone);
      if (why) return { ok: false, reason: why };
      const ms = now();
      const code = String(random(0, 1e6)).padStart(6, "0");
      const text = `Tu código de Polar: ${code}. Caduca en 10 minutos.`;
      // Count the attempt before the await: a provider that hangs under load must not allow a burst.
      const attempts = [...recent(rows.get(phone)?.attempts, ms), ms];
      rows.set(phone, { h: null, exp: 0, tries: 0, attempts });
      let out;
      try { out = await adapter.send(phone, text); } catch { out = { ok: false, reason: "send_failed" }; }
      if (!out?.ok) {
        // No usable code, but the attempt stays counted: a broken provider is not a free retry loop.
        return { ok: false, reason: out?.reason ?? "send_failed" };
      }
      rows.set(phone, { h: hash(phone, code), exp: ms + ttlMs, tries: 0, attempts });
      spentToday += 1;
      return { ok: true };
    },

    /**
     * `{ok:true}` or `{ok:false, reason:"missing"|"expired"|"locked"|"wrong", triesLeft}`.
     * The reason never says how close the guess was, and `triesLeft` only counts down the guesses
     * the owner of the phone has left, which the wrong device already knows it spent.
     */
    verify(phone, input) {
      const ms = now();
      const r = rows.get(phone);
      if (!r || !r.h) return { ok: false, reason: "missing", triesLeft: maxTries };
      if (r.exp <= ms) { rows.delete(phone); return { ok: false, reason: "expired", triesLeft: 0 }; }
      if (r.tries >= maxTries) return { ok: false, reason: "locked", triesLeft: 0 };
      const given = digits(input);
      const ok = given.length === 6 && timingSafeEqual(hash(phone, given), r.h);
      if (!ok) {
        r.tries += 1;
        return { ok: false, reason: r.tries >= maxTries ? "locked" : "wrong", triesLeft: Math.max(0, maxTries - r.tries) };
      }
      rows.delete(phone);
      return { ok: true, triesLeft: 0 };
    },

    /** For the "wrong number, start again" path: a new send replaces the old code anyway. */
    clear(phone) { rows.delete(phone); },

    /** Tests only. */
    spent: () => spentToday,
    reset() { rows.clear(); spentToday = 0; day = ""; },
  };
}

/** A test adapter that keeps the last text per number. Never used in production. */
export function captureAdapter() {
  const sent = new Map();
  return {
    name: "capture",
    sent,
    send: async (phone, text) => { sent.set(phone, text); return { ok: true }; },
  };
}

/** The real service: no provider until ATD supplies one, so its `available` is false today. */
export const otp = createOtpService({ dailyCap: Number(process.env.OTP_DAILY_CAP) || 0 });
