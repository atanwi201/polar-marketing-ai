// Public digital menu page (/menu/<code>): mobile-first, rendered fully on the server (no script needed),
// in the business's own look (logo, name, colours, style). Language switcher, category jump bar, allergen icons + legend.
import { ALLERGENS } from "./menu.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v ?? "") ? v : d);
const safeFile = (f) => (f && /^[\w.\-]+$/.test(f) ? f : "");
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const onColor = (h) => (lum(h) > 0.4 ? "#111111" : "#ffffff");

const FONTS = {
  modern: { css: "'Figtree',system-ui,sans-serif", head: "'Figtree',system-ui,sans-serif", gf: "Figtree:wght@400;600;700;800" },
  warm: { css: "'Nunito',system-ui,sans-serif", head: "'Fraunces',Georgia,serif", gf: "Nunito:wght@400;600;700&family=Fraunces:wght@600;800" },
  bold: { css: "'Figtree',system-ui,sans-serif", head: "'Bricolage Grotesque','Figtree',system-ui,sans-serif", gf: "Figtree:wght@400;600;700&family=Bricolage+Grotesque:wght@700;800" },
  elegant: { css: "'Lato',system-ui,sans-serif", head: "'Playfair Display',Georgia,serif", gf: "Lato:wght@400;700&family=Playfair+Display:wght@600;700" },
  natural: { css: "'DM Sans',system-ui,sans-serif", head: "'DM Serif Display',Georgia,serif", gf: "DM+Sans:wght@400;600;700&family=DM+Serif+Display" },
};

export const ICONS = { gluten: "🌾", crustaceans: "🦐", eggs: "🥚", fish: "🐟", peanuts: "🥜", soy: "🫘", milk: "🥛", nuts: "🌰", celery: "🥬", mustard: "🟡", sesame: "⚪", sulphites: "🍷", lupin: "🌼", molluscs: "🐚" };

export const ALLERGEN_NAMES = {
  es: { gluten: "Gluten", crustaceans: "Crustáceos", eggs: "Huevos", fish: "Pescado", peanuts: "Cacahuetes", soy: "Soja", milk: "Lácteos", nuts: "Frutos secos", celery: "Apio", mustard: "Mostaza", sesame: "Sésamo", sulphites: "Sulfitos", lupin: "Altramuces", molluscs: "Moluscos" },
  en: { gluten: "Gluten", crustaceans: "Crustaceans", eggs: "Eggs", fish: "Fish", peanuts: "Peanuts", soy: "Soy", milk: "Milk", nuts: "Tree nuts", celery: "Celery", mustard: "Mustard", sesame: "Sesame", sulphites: "Sulphites", lupin: "Lupin", molluscs: "Molluscs" },
  de: { gluten: "Gluten", crustaceans: "Krebstiere", eggs: "Eier", fish: "Fisch", peanuts: "Erdnüsse", soy: "Soja", milk: "Milch", nuts: "Schalenfrüchte", celery: "Sellerie", mustard: "Senf", sesame: "Sesam", sulphites: "Sulfite", lupin: "Lupinen", molluscs: "Weichtiere" },
  fr: { gluten: "Gluten", crustaceans: "Crustacés", eggs: "Œufs", fish: "Poisson", peanuts: "Arachides", soy: "Soja", milk: "Lait", nuts: "Fruits à coque", celery: "Céleri", mustard: "Moutarde", sesame: "Sésame", sulphites: "Sulfites", lupin: "Lupin", molluscs: "Mollusques" },
};
const UI = {
  es: { menu: "Carta", allergens: "Alérgenos", legend: "Leyenda de alérgenos", note: "Si tienes alguna alergia o intolerancia, díselo a nuestro personal antes de pedir.", empty: "La carta no está disponible ahora mismo.", language: "Idioma", cats: "Categorías", by: "Carta digital con Polar Marketing", notFound: "Carta no encontrada", notFoundText: "Este enlace no es válido o la carta no está activa." },
  en: { menu: "Menu", allergens: "Allergens", legend: "Allergen key", note: "If you have an allergy or intolerance, please tell our staff before ordering.", empty: "The menu is not available right now.", language: "Language", cats: "Categories", by: "Digital menu by Polar Marketing", notFound: "Menu not found", notFoundText: "This link is not valid or the menu is not active." },
  de: { menu: "Speisekarte", allergens: "Allergene", legend: "Allergen-Legende", note: "Bei Allergien oder Unverträglichkeiten sagen Sie es bitte unserem Personal vor der Bestellung.", empty: "Die Speisekarte ist derzeit nicht verfügbar.", language: "Sprache", cats: "Kategorien", by: "Digitale Karte von Polar Marketing", notFound: "Karte nicht gefunden", notFoundText: "Dieser Link ist ungültig oder die Karte ist nicht aktiv." },
  fr: { menu: "Carte", allergens: "Allergènes", legend: "Légende des allergènes", note: "En cas d'allergie ou d'intolérance, prévenez notre équipe avant de commander.", empty: "La carte n'est pas disponible pour le moment.", language: "Langue", cats: "Catégories", by: "Carte numérique par Polar Marketing", notFound: "Carte introuvable", notFoundText: "Ce lien n'est pas valide ou la carte n'est pas active." },
};
const LANG_LABEL = { es: "Español", en: "English", de: "Deutsch", fr: "Français" };
const LOCALE = { es: "es-ES", en: "en-GB", de: "de-DE", fr: "fr-FR" };

export function money(cents, currency = "EUR", lang = "es") {
  if (cents === null || cents === undefined) return "";
  try { return new Intl.NumberFormat(LOCALE[lang] ?? "en-GB", { style: "currency", currency, minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}

const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`;

export function menuNotFoundPage(lang = "es") {
  const t = UI[lang] ?? UI.es;
  return `<!doctype html><html lang="${esc(lang)}"><head>${HEAD}<meta name="robots" content="noindex"><title>${esc(t.notFound)}</title><link rel="icon" href="/brand/logo/favicon.svg" type="image/svg+xml"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font:16px/1.5 system-ui,sans-serif;background:#fbfaf7;color:#1b1b1b;text-align:center}h1{font-size:24px;margin:0 0 8px}p{color:#555;margin:0}</style></head><body><main><h1>${esc(t.notFound)}</h1><p>${esc(t.notFoundText)}</p></main></body></html>`;
}

/** `view` is menu.publicView(...); `client` supplies colours, logo and style; `code` builds the language links. */
export function menuPage({ view, client = {}, code }) {
  const lang = view.lang, t = UI[lang] ?? UI.es, names = ALLERGEN_NAMES[lang] ?? ALLERGEN_NAMES.en;
  const colors = client.profile?.colors ?? {};
  const primary = hex(colors.primary, "#1f2a2e"), accent = hex(colors.accent, hex(colors.primary, "#c2410c"));
  const accentInk = lum(accent) > 0.55 ? "#111111" : accent; // price colour must stay readable on the light page
  const font = FONTS[client.profile?.style] ?? FONTS.modern;
  const logo = safeFile(client.logoFile);
  const name = view.business.name;
  const used = ALLERGENS.filter((a) => view.categories.some((c) => c.items.some((i) => i.allergens.includes(a))));
  const dishes = view.categories.map((c) => `
  <section class="cat" id="c-${esc(c.id)}" aria-labelledby="h-${esc(c.id)}">
    <h2 id="h-${esc(c.id)}">${esc(c.name)}</h2>
    <ul>${c.items.map((i) => `
      <li class="item${i.photo ? " has-photo" : ""}">
        ${i.photo ? `<img class="ph" src="${esc(i.photo)}" alt="${esc(i.name)}" loading="lazy" decoding="async">` : ""}
        <div class="tx">
          <div class="row"><h3>${esc(i.name)}</h3>${i.priceCents !== null ? `<span class="pr">${esc(money(i.priceCents, view.currency, lang))}</span>` : ""}</div>
          ${i.description ? `<p class="ds">${esc(i.description)}</p>` : ""}
          ${i.allergens.length ? `<div class="al" aria-label="${esc(t.allergens)}">${i.allergens.map((a) => `<span class="ai" title="${esc(names[a])}" aria-label="${esc(names[a])}">${ICONS[a]}</span>`).join("")}</div>` : ""}
        </div>
      </li>`).join("")}
    </ul>
  </section>`).join("");
  const switcher = view.languages.length > 1
    ? `<nav class="lang" aria-label="${esc(t.language)}">${view.languages.map((l) => `<a href="/menu/${esc(code)}?l=${l}"${l === lang ? ' aria-current="true"' : ""} hreflang="${l}" lang="${l}">${esc(LANG_LABEL[l])}</a>`).join("")}</nav>` : "";
  const jump = view.categories.length > 1
    ? `<nav class="jump" aria-label="${esc(t.cats)}">${view.categories.map((c) => `<a href="#c-${esc(c.id)}">${esc(c.name)}</a>`).join("")}</nav>` : "";
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
${HEAD}
<meta name="robots" content="noindex">
<meta name="theme-color" content="${primary}">
<title>${esc(`${t.menu} - ${name}`)}</title>
${logo ? `<link rel="icon" href="/media/${esc(logo)}"><link rel="apple-touch-icon" href="/media/${esc(logo)}">` : `<link rel="icon" href="/brand/logo/favicon.svg" type="image/svg+xml">`}
<style>
:root{--primary:${primary};--on-primary:${onColor(primary)};--accent:${accent};--accent-ink:${accentInk};--bg:#fbfaf7;--card:#ffffff;--ink:#1b1b1b;--ink2:#5b5b5b;--line:#e8e4dc}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:64px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 ${font.css}}
header.top{background:var(--primary);color:var(--on-primary);padding:max(20px,env(safe-area-inset-top)) 16px 18px;text-align:center}
.logo{width:64px;height:64px;border-radius:16px;object-fit:cover;display:block;margin:0 auto 10px;background:rgba(255,255,255,.15)}
.mono{display:grid;place-items:center;font:800 28px ${font.head};background:var(--accent);color:${onColor(accent)}}
header.top h1{margin:0;font:700 26px/1.15 ${font.head};overflow-wrap:anywhere}
header.top p{margin:4px 0 0;opacity:.85;font-size:15px}
.lang{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:14px}
.lang a{padding:7px 14px;border-radius:999px;border:1.5px solid currentColor;color:inherit;text-decoration:none;font-weight:600;font-size:14px;opacity:.8}
.lang a[aria-current]{background:var(--on-primary);color:var(--primary);border-color:var(--on-primary);opacity:1}
.jump{position:sticky;top:0;z-index:5;display:flex;gap:8px;overflow-x:auto;padding:10px 16px;background:var(--bg);border-bottom:1px solid var(--line);scrollbar-width:none}
.jump::-webkit-scrollbar{display:none}
.jump a{flex:none;padding:8px 14px;border-radius:999px;background:var(--card);border:1px solid var(--line);color:var(--ink);text-decoration:none;font-weight:600;font-size:14px;white-space:nowrap}
.jump a:active{background:var(--accent);color:${onColor(accent)}}
main{max-width:640px;margin:0 auto;padding:8px 16px max(40px,env(safe-area-inset-bottom))}
.cat{margin-top:26px}
.cat h2{margin:0 0 10px;font:700 22px/1.2 ${font.head};padding-bottom:8px;border-bottom:3px solid var(--accent)}
ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.item{display:flex;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px}
.ph{width:88px;height:88px;border-radius:12px;object-fit:cover;flex:none;background:var(--line)}
.tx{flex:1;min-width:0}
.row{display:flex;gap:12px;justify-content:space-between;align-items:baseline}
.item h3{margin:0;font:700 17px/1.3 ${font.css};overflow-wrap:anywhere}
.pr{flex:none;font-weight:800;color:var(--accent-ink);font-variant-numeric:tabular-nums}
.ds{margin:4px 0 0;color:var(--ink2);font-size:15px;line-height:1.4}
.al{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px}
.ai{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--bg);border:1px solid var(--line);font-size:15px;line-height:1}
.legend{margin-top:34px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.legend h2{margin:0 0 10px;font:700 18px/1.2 ${font.head}}
.legend ul{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.legend li{display:flex;align-items:center;gap:8px;font-size:14px}
.legend p{margin:12px 0 0;color:var(--ink2);font-size:14px}
.empty{margin:40px 0;text-align:center;color:var(--ink2)}
footer{max-width:640px;margin:0 auto;padding:0 16px 32px;text-align:center;color:var(--ink2);font-size:13px}
@media(prefers-color-scheme:dark){:root{--bg:#141414;--card:#1e1e1e;--ink:#f1efe9;--ink2:#a8a49b;--line:#303030}.ai{background:#2a2a2a}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style>
</head>
<body>
<header class="top">
  ${logo ? `<img class="logo" src="/media/${esc(logo)}" alt="">` : `<div class="logo mono" aria-hidden="true">${esc((name.trim()[0] || "?").toUpperCase())}</div>`}
  <h1>${esc(name)}</h1>
  <p>${esc(t.menu)}</p>
  ${switcher}
</header>
${jump}
<main>
${dishes || `<p class="empty">${esc(t.empty)}</p>`}
${used.length ? `<section class="legend" aria-labelledby="legend-h"><h2 id="legend-h">${esc(t.legend)}</h2><ul>${used.map((a) => `<li><span class="ai" aria-hidden="true">${ICONS[a]}</span>${esc(names[a])}</li>`).join("")}</ul><p>${esc(t.note)}</p></section>` : ""}
</main>
<footer>${esc(t.by)}</footer>
</body>
</html>`;
}
