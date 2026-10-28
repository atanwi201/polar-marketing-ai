// HTTP routes for the Google Business Profile fallback kit. Portal only: the client owns its profile,
// so the kit and its status live on their own record and nothing here is reachable with another
// business's token. No Google call is made from this file (the API is gated, see docs/gbp-api-notes.md);
// the generator is the only outbound call and it goes through the provider chain in gbp-kit.mjs.
import { save, now } from "./store.mjs";
import { limiter } from "./auth.mjs";
import { approval } from "./limits.mjs";
import { ensureGbp, gbpView, setStatus, buildKit } from "./gbp-kit.mjs";
import { connectUrl, finishConnect, disconnect, pendingClient, gbpAuthView, redirectUri } from "./gbp-auth.mjs";
import { friendly, GbpApiError } from "./gbp.mjs";
import {
  googleView, apiFor, requireApi, listAccounts, listLocations, linkLocation, lookup, preview, create,
  categories, verificationOptions, startVerification, completeVerification, refreshVerification,
} from "./gbp-google.mjs";
import { readProfile, saveProfile, listPhotos, uploadPhoto } from "./gbp-info.mjs";

export const limits = {
  read: limiter(180, 60e3),
  ai: limiter(6, 3600e3),
  write: limiter(60, 60e3),
  connect: limiter(20, 15 * 60e3),
  callback: limiter(60, 15 * 60e3),
  // The wizard calls Google; 300 searches and 300 creates per day are project-wide, so this is tight.
  googleRead: limiter(120, 60e3),
  googleWrite: limiter(30, 60e3),
};
const hit = (lim, ip) => { if (lim.blocked(ip)) return false; lim.fail(ip); return true; };

const ES = {
  "Too many tries. Please wait a few minutes.": "Demasiados intentos. Espera unos minutos.",
  "Your account is waiting for approval. We'll let you know as soon as it's active.": "Tu cuenta está pendiente de aprobación. Te avisaremos en cuanto esté activa.",
  "Choose a valid status.": "Elige un estado válido.",
  "Notes must be text.": "Las notas deben ser texto.",
  "Something went wrong. Please try again.": "Algo ha ido mal. Inténtalo de nuevo.",
  "This link is not active.": "Este enlace no está activo.",
  "Google access is not configured yet.": "El acceso a Google todavía no está configurado.",
  "This connection link has expired. Start again.": "Este enlace de conexión ha caducado. Empieza de nuevo.",
  "Google did not accept the connection. Try again.": "Google no ha aceptado la conexión. Inténtalo de nuevo.",
  "Could not reach Google. Try again.": "No se pudo conectar con Google. Inténtalo de nuevo.",
  "Google did not send an authorisation code.": "Google no ha enviado el código de autorización.",
  "This business no longer exists.": "Este negocio ya no existe.",
  "Google API access is not switched on yet.": "El acceso a la API de Google todavía no está activado.",
  "Connect your Google profile first.": "Conecta primero tu ficha de Google.",
  "Connect your Google profile again.": "Vuelve a conectar tu ficha de Google.",
  "Choose an account.": "Elige una cuenta.",
  "Choose a location.": "Elige una ficha.",
  "That location is not in that account.": "Esa ficha no está en esa cuenta.",
  "Give the business a name.": "Ponle un nombre al negocio.",
  "That phone number does not look right.": "Ese teléfono no parece correcto.",
  "Add a street address and a town.": "Añade la dirección y el municipio.",
  "Choose a category.": "Elige una categoría.",
  "The website must start with https://.": "La web debe empezar por https://.",
  "This business is already on Google. Claim it instead of creating a new one.": "Este negocio ya está en Google. Reclama esa ficha en vez de crear otra.",
  "Link or create a profile first.": "Primero vincula o crea una ficha.",
  "Choose a verification method.": "Elige un método de verificación.",
  "Add the email address Google should write to.": "Añade el correo al que Google debe escribir.",
  "Start the verification first.": "Primero empieza la verificación.",
  "That code should be 6 digits.": "El código debe tener 6 dígitos.",
  "Check the opening hours: use 09:00 for nine in the morning.": "Revisa el horario: escribe 09:00 para las nueve de la mañana.",
  "Choose one of your photos.": "Elige una de tus fotos.",
  "That photo is no longer there.": "Esa foto ya no está.",
  "That photo is empty.": "Esa foto está vacía.",
  "That photo is over 5 MB. Google will not take it.": "Esa foto pesa más de 5 MB. Google no la acepta.",
  "Google only takes JPEG or PNG photos.": "Google solo acepta fotos JPEG o PNG.",
  "Link the profile again to manage its photos.": "Vuelve a vincular la ficha para gestionar sus fotos.",
  "Choose a photo type.": "Elige un tipo de foto.",
};

/** The state cookie is only valid for the callback path, and only sent on a top-level GET from Google. */
const COOKIE_PATH = "Path=/api/gbp";
const secure = () => redirectUri().startsWith("https:");
const stateCookie = (state) => `gbp_oauth=${state}; ${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=600${secure() ? "; Secure" : ""}`;
const clearCookie = () => `gbp_oauth=; ${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${secure() ? "; Secure" : ""}`;
const cookie = (header, name) => String(header ?? "").split(/;\s*/).map((p) => p.split("=")).find(([k]) => k === name)?.[1] ?? "";

/** Everything a portal response may carry: the manual kit, the connection state and the wizard. */
const view = (c) => ({ ...gbpView(c), api: gbpAuthView(c), google: googleView(c) });

export async function handleGbp(req, res, url, seg, ctx) {
  const ip = ctx.clientIp(req);
  const say = (text) => (req.headers["x-lang"] === "es" ? ES[text] ?? text : text);
  const out = (code, body) => (ctx.send(res, code, body), true);
  const fail = (e) => {
    if (!e.status) console.error("[gbp]", e?.message ?? e);
    const msg = e instanceof GbpApiError ? friendly(e, req.headers["x-lang"] === "en" ? "en" : "es") : e.status ? e.message : "Something went wrong. Please try again.";
    return out(e.status ?? 500, { error: say(msg), ...(e.code ? { code: e.code } : {}), ...(e.candidates ? { candidates: e.candidates } : {}) });
  };

  // The OAuth callback has no portal token: the single-use state plus its cookie are the proof, and the
  // state remembers which business started it. Errors here never redirect, since we cannot trust the URL.
  if (seg[0] === "api" && seg[1] === "gbp" && seg[2] === "callback" && seg.length === 3 && req.method === "GET") {
    if (!hit(limits.callback, ip)) return out(429, { error: say("Too many tries. Please wait a few minutes.") });
    const state = url.searchParams.get("state") ?? "";
    const jar = cookie(req.headers.cookie, "gbp_oauth");
    try {
      if (url.searchParams.get("error")) {                    // the owner pressed cancel on Google's screen
        const c = pendingClient(state, jar);
        if (!c) return out(400, { error: say("This connection link has expired. Start again.") });
        res.writeHead(302, { Location: `/portal/${c.token}#/gbp`, "Set-Cookie": clearCookie(), "Cache-Control": "no-store" });
        res.end();
        return true;
      }
      const c = await finishConnect({ state, code: url.searchParams.get("code") ?? "", cookieState: jar });
      res.writeHead(302, { Location: `/portal/${c.token}#/gbp`, "Set-Cookie": clearCookie(), "Cache-Control": "no-store" });
      res.end();
      return true;
    } catch (e) {
      return fail(e);
    }
  }

  if (!(seg[0] === "api" && seg[1] === "portal" && seg[2] && seg[3] === "gbp")) return false;
  try {
    if (!hit(limits.read, ip)) return out(429, { error: say("Too many tries. Please wait a few minutes.") });
    const c = ctx.clientByToken(seg[2]);
    if (!c) return out(404, { error: "Unknown portal link" });
    // Same rule as the rest of the portal: a business that is not approved yet cannot use features.
    if (approval(c) !== "approved") return out(403, { error: say(approval(c) === "pending" ? "Your account is waiting for approval. We'll let you know as soon as it's active." : "This link is not active.") });

    const rest = seg.slice(4);
    const m = req.method;

    if (rest.length === 0 && m === "GET") return out(200, { gbp: view(c) });

    // Start the Google flow. A browser link, so it redirects; the state also goes into an HttpOnly cookie.
    if (rest.length === 1 && rest[0] === "connect" && m === "GET") {
      if (!hit(limits.connect, ip)) return out(429, { error: say("Too many tries. Please wait a few minutes.") });
      const { url: target, state } = connectUrl(c);
      res.writeHead(302, { Location: target, "Set-Cookie": stateCookie(state), "Cache-Control": "no-store" });
      res.end();
      return true;
    }

    if (rest.length === 1 && rest[0] === "disconnect" && m === "POST") {
      if (!hit(limits.write, ip)) return out(429, { error: say("Too many tries. Please wait a few minutes.") });
      await disconnect(c);
      return out(200, { gbp: view(c) });
    }

    // --- G6: create/claim wizard and verification -----------------------------------------------
    if (rest[0] === "google") {
      const sub = rest.slice(1);
      const isGet = m === "GET";
      if (!hit(isGet ? limits.googleRead : limits.googleWrite, ip)) return out(429, { error: say("Too many tries. Please wait a few minutes.") });
      // apiFor() is what enforces "flag on + token connected": every route below answers 403/409
      // before a single Google call leaves the server.
      requireApi(c);
      const api = ctx.gbpApiFor ? await ctx.gbpApiFor(c) : await apiFor(c);
      const b = isGet ? {} : await ctx.readBody(req, 30e3);

      if (sub.length === 0 && isGet) return out(200, { google: googleView(c) });

      if (sub.length === 1 && sub[0] === "accounts" && isGet) {
        return out(200, { accounts: await listAccounts(c, api) });
      }

      if (sub.length === 1 && sub[0] === "locations" && isGet) {
        return out(200, { locations: await listLocations(c, api, url.searchParams.get("account") ?? "") });
      }

      if (sub.length === 1 && sub[0] === "categories" && isGet) {
        return out(200, { categories: await categories(c, api, { q: url.searchParams.get("q") ?? "", lang: req.headers["x-lang"] === "en" ? "en" : "es" }) });
      }

      if (sub.length === 1 && sub[0] === "link" && m === "POST") {
        await linkLocation(c, api, { account: b?.account, location: b?.location });
        await save();
        return out(200, { google: googleView(c) });
      }

      if (sub.length === 1 && sub[0] === "lookup" && m === "POST") {
        return out(200, { candidates: await lookup(c, api, b ?? {}) });
      }

      if (sub.length === 1 && sub[0] === "preview" && m === "POST") {
        return out(200, await preview(c, api, b ?? {}));
      }

      if (sub.length === 1 && sub[0] === "create" && m === "POST") {
        const rid = /^[A-Za-z0-9-]{8,50}$/.test(String(b?.requestId ?? "")) ? String(b.requestId) : undefined;
        const done = await create(c, api, b ?? {}, { requestId: rid });
        await save();
        return out(200, { google: googleView(c), candidates: done.candidates });
      }

      if (sub.length === 1 && sub[0] === "refresh" && m === "POST") {
        await refreshVerification(c, api);
        await save();
        return out(200, { google: googleView(c) });
      }

      if (sub.length === 1 && sub[0] === "verification" && isGet) {
        return out(200, { verification: await verificationOptions(c, api), google: googleView(c) });
      }

      if (sub.length === 1 && sub[0] === "verification" && m === "POST") {
        await startVerification(c, api, b ?? {});
        await save();
        return out(200, { google: googleView(c) });
      }

      if (sub.length === 2 && sub[0] === "verification" && sub[1] === "complete" && m === "POST") {
        await completeVerification(c, api, b ?? {});
        await save();
        return out(200, { google: googleView(c) });
      }

      // --- G7: info, hours and photos ------------------------------------------------------------
      const ownPhotos = () => (c.photos ?? []).map((p) => p.file);

      if (sub.length === 1 && sub[0] === "info" && isGet) {
        return out(200, { profile: await readProfile(c, api), photos: await listPhotos(c, api), ownPhotos: ownPhotos() });
      }

      if (sub.length === 2 && sub[0] === "info" && sub[1] === "preview" && m === "POST") {
        const r = await saveProfile(c, api, b ?? {}, { apply: false });
        return out(200, { changes: r.changes, profile: r.profile });
      }

      if (sub.length === 1 && sub[0] === "info" && m === "POST") {
        const r = await saveProfile(c, api, b ?? {}, { apply: true });
        if (r.applied) await save();
        return out(200, { changes: r.changes, applied: r.applied, profile: r.profile, google: googleView(c) });
      }

      if (sub.length === 1 && sub[0] === "photos" && isGet) {
        return out(200, { photos: await listPhotos(c, api), ownPhotos: ownPhotos() });
      }

      if (sub.length === 1 && sub[0] === "photos" && m === "POST") {
        const photo = await uploadPhoto(c, api, { file: b?.file, category: b?.category });
        return out(200, { photo, google: googleView(c) });
      }

      return out(404, { error: "Not found" });
    }

    if (rest.length === 0 && (m === "PATCH" || m === "PUT")) {
      if (!hit(limits.write, ip)) return out(429, { error: say("Too many tries. Please wait a few minutes.") });
      const b = await ctx.readBody(req, 50e3);
      setStatus(c, { status: b.status, notes: b.notes });
      await save();
      return out(200, { gbp: view(c) });
    }

    if (rest.length === 1 && rest[0] === "kit" && m === "POST") {
      if (!hit(limits.ai, ip)) return out(429, { error: say("Too many tries. Please wait a few minutes.") });
      const b = await ctx.readBody(req, 10e3);
      const lang = b?.lang === "en" ? "en" : "es";
      const g = ensureGbp(c);
      g.kit = await buildKit(c, { lang });
      g.updatedAt = now();
      await save();
      return out(200, { gbp: view(c) });
    }

    return out(404, { error: "Not found" });
  } catch (e) {
    if (res.headersSent) { res.end(); return true; }
    return fail(e);
  }
}
