// HTTP routes for the Google Business Profile fallback kit. Portal only: the client owns its profile,
// so the kit and its status live on their own record and nothing here is reachable with another
// business's token. No Google call is made from this file (the API is gated, see docs/gbp-api-notes.md);
// the generator is the only outbound call and it goes through the provider chain in gbp-kit.mjs.
import { save, now } from "./store.mjs";
import { limiter } from "./auth.mjs";
import { approval } from "./limits.mjs";
import { ensureGbp, gbpView, setStatus, buildKit } from "./gbp-kit.mjs";

export const limits = { read: limiter(180, 60e3), ai: limiter(6, 3600e3), write: limiter(60, 60e3) };
const hit = (lim, ip) => { if (lim.blocked(ip)) return false; lim.fail(ip); return true; };

const ES = {
  "Too many tries. Please wait a few minutes.": "Demasiados intentos. Espera unos minutos.",
  "Your account is waiting for approval. We'll let you know as soon as it's active.": "Tu cuenta está pendiente de aprobación. Te avisaremos en cuanto esté activa.",
  "Choose a valid status.": "Elige un estado válido.",
  "Notes must be text.": "Las notas deben ser texto.",
  "Something went wrong. Please try again.": "Algo ha ido mal. Inténtalo de nuevo.",
  "This link is not active.": "Este enlace no está activo.",
};

export async function handleGbp(req, res, url, seg, ctx) {
  if (!(seg[0] === "api" && seg[1] === "portal" && seg[2] && seg[3] === "gbp")) return false;
  const ip = ctx.clientIp(req);
  const say = (text) => (req.headers["x-lang"] === "es" ? ES[text] ?? text : text);
  const out = (code, body) => (ctx.send(res, code, body), true);
  const fail = (e) => {
    if (!e.status) console.error("[gbp]", e?.message ?? e);
    const msg = e.status ? e.message : "Something went wrong. Please try again.";
    return out(e.status ?? 500, { error: say(msg), ...(e.code ? { code: e.code } : {}) });
  };
  try {
    if (!hit(limits.read, ip)) return out(429, { error: say("Too many tries. Please wait a few minutes.") });
    const c = ctx.clientByToken(seg[2]);
    if (!c) return out(404, { error: "Unknown portal link" });
    // Same rule as the rest of the portal: a business that is not approved yet cannot use features.
    if (approval(c) !== "approved") return out(403, { error: say(approval(c) === "pending" ? "Your account is waiting for approval. We'll let you know as soon as it's active." : "This link is not active.") });

    const rest = seg.slice(4);
    const m = req.method;

    if (rest.length === 0 && m === "GET") return out(200, { gbp: gbpView(c) });

    if (rest.length === 0 && (m === "PATCH" || m === "PUT")) {
      if (!hit(limits.write, ip)) return out(429, { error: say("Too many tries. Please wait a few minutes.") });
      const b = await ctx.readBody(req, 50e3);
      setStatus(c, { status: b.status, notes: b.notes });
      await save();
      return out(200, { gbp: gbpView(c) });
    }

    if (rest.length === 1 && rest[0] === "kit" && m === "POST") {
      if (!hit(limits.ai, ip)) return out(429, { error: say("Too many tries. Please wait a few minutes.") });
      const b = await ctx.readBody(req, 10e3);
      const lang = b?.lang === "en" ? "en" : "es";
      const g = ensureGbp(c);
      g.kit = await buildKit(c, { lang });
      g.updatedAt = now();
      await save();
      return out(200, { gbp: gbpView(c) });
    }

    return out(404, { error: "Not found" });
  } catch (e) {
    if (res.headersSent) { res.end(); return true; }
    return fail(e);
  }
}
