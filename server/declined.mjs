// A declined business is closed out of the whole app: portal, client login, public booking,
// loyalty and website pages. They see one screen (in their language) telling them to write to the owner.
import { db } from "./store.mjs";
import { approval } from "./limits.mjs";
import * as bookings from "./bookings.mjs";
import * as loyalty from "./loyalty.mjs";

export const OWNER_EMAIL = "atanwi85@gmail.com";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const langOf = (c, want) => (["es", "en"].includes(want) ? want : (c?.languages?.[0] ?? "es") === "en" ? "en" : "es");

const TEXT = {
  es: { title: "Cuenta no aprobada", h: "Tu negocio no ha sido aprobado", p: "Hemos revisado tu solicitud y, por ahora, no podemos activar tu cuenta. Si crees que es un error o quieres más información, escribe al responsable:", cta: "Escribir al responsable", subject: "Mi cuenta de Polar Marketing", ariaMail: "Escribir un correo a" },
  en: { title: "Account not approved", h: "Your business was declined", p: "We reviewed your request and can't activate your account for now. If you think this is a mistake or want to know more, contact the owner:", cta: "Email the owner", subject: "My Polar Marketing account", ariaMail: "Email" },
};

/** The message for JSON API answers. */
export const declinedMessage = (lang) => `${TEXT[lang].h}. ${lang === "es" ? "Contacta con" : "Contact"} ${OWNER_EMAIL}.`;

export function declinedBody(c, want) {
  const lang = langOf(c, want);
  return { status: 403, code: "declined", error: declinedMessage(lang), contact: OWNER_EMAIL, lang, declinedUrl: `/declined?l=${lang}` };
}

export function declinedPage(c, want) {
  const lang = langOf(c, want), t = TEXT[lang], other = lang === "es" ? "en" : "es";
  const mail = `mailto:${OWNER_EMAIL}?subject=${encodeURIComponent(t.subject)}`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#d7ff64">
<title>${esc(t.title)} · Polar Marketing</title>
<script src="/brand/theme.js"></script>
<link rel="icon" href="/brand/logo/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/brand/tokens.css">
<link rel="stylesheet" href="/brand/components.css">
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font-family:var(--font-sans)}
main{width:100%;max-width:460px;background:var(--surface);border-radius:var(--radius-lg,24px);padding:32px 28px;box-shadow:var(--shadow-card);text-align:center}
.pm-logo img{display:block}
h1{margin:20px 0 10px;font:700 26px/32px var(--font-display,var(--font-sans))}
p{margin:0 0 24px;color:var(--ink-2)}
.mail{display:block;margin-top:14px;font-weight:600;color:var(--ink);word-break:break-all}
.lang{margin-top:22px;font-size:14px}
.lang a{color:var(--ink-2)}
</style>
</head>
<body class="cr-root">
<main role="main">
  <span class="pm-logo"><img src="/brand/logo/polar-mark.png" alt="Polar Marketing" width="44" height="44"></span>
  <span class="cr-badge cr-badge--bad" style="margin-top:18px">${esc(t.title)}</span>
  <h1>${esc(t.h)}</h1>
  <p>${esc(t.p)}</p>
  <a class="cr-btn cr-btn--primary cr-btn--lg cr-btn--block" href="${esc(mail)}" aria-label="${esc(t.ariaMail)} ${OWNER_EMAIL}">${esc(t.cta)}</a>
  <a class="mail" href="${esc(mail)}">${OWNER_EMAIL}</a>
  <div class="lang"><a href="?l=${other}" hreflang="${other}">${other === "es" ? "Español" : "English"}</a></div>
</main>
</body>
</html>`;
}

/** The business a request path belongs to, if it is declined (else null). Covers every client-facing route. */
export function declinedClientFor(seg, siteSlugOf = (c) => c.siteSlug) {
  const clientById = (id) => db.clients.find((c) => c.id === id);
  let c;
  const s = seg;
  if (s[0] === "api") {
    if (s[1] === "portal" && s[2]) c = db.clients.find((x) => x.token === s[2]);
    else if (s[1] === "book" && s[2]) c = clientById(bookings.findByCode(s[2])?.clientId);
    else if (s[1] === "booking" && s[2]) c = clientById(bookings.findByManageToken(s[2])?.clientId);
    else if (s[1] === "loyalty" && s[2] && s[3]) {
      if (s[2] === "join") c = clientById(loyalty.ldb().programs.find((p) => p.joinCode === s[3])?.clientId);
      else if (s[2] === "staff") c = clientById(loyalty.ldb().programs.find((p) => p.staffToken === s[3])?.clientId);
      else if (s[2] === "card") c = clientById(loyalty.findProgram(loyalty.findByToken(s[3])?.programId)?.clientId);
    }
  } else if (s[1]) {
    if (s[0] === "portal") c = db.clients.find((x) => x.token === s[1]);
    else if (s[0] === "book") c = clientById(bookings.findByCode(s[1])?.clientId);
    else if (s[0] === "booking") c = clientById(bookings.findByManageToken(s[1])?.clientId);
    else if (s[0] === "join") c = clientById(loyalty.ldb().programs.find((p) => p.joinCode === s[1])?.clientId);
    else if (s[0] === "staff") c = clientById(loyalty.ldb().programs.find((p) => p.staffToken === s[1])?.clientId);
    else if (s[0] === "card") c = clientById(loyalty.findProgram(loyalty.findByToken(s[1])?.programId)?.clientId);
    else if (s[0] === "loyalty" && s[1] === "logo" && s[2]) c = clientById(loyalty.ldb().programs.find((p) => `${p.id}.png` === s[2])?.clientId);
    else if (s[0] === "sites") c = db.clients.find((x) => siteSlugOf(x) === s[1]);
    else if (s[0] === "p") {
      const item = db.posts.find((x) => x.shareKey === s[1]) ?? db.videos.find((x) => x.shareKey === s[1]);
      c = clientById(item?.clientId);
    }
  }
  return c && approval(c) === "declined" ? c : null;
}
