// "Menu" / "Carta" button on AI-built websites: a floating pill stacked above the booking pill (never overlapping it).
// Plain <a>, inline styles only, wrapped in markers so doing it again replaces the previous one.
import { findConfig, menuUrl, hasLiveMenu } from "./menu.mjs";

const base = () => (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, "");

/** {url} when the client has a live menu (enabled, at least one available item), else null. */
export function menuFor(client, { src, base: b = base() } = {}) {
  const cfg = client && findConfig(client.id);
  if (!hasLiveMenu(cfg)) return null;
  return { url: `${menuUrl(cfg, b)}${src ? `?src=${src}` : ""}`, label: menuLabel("en") };
}

const LABELS = { es: "Carta", en: "Menu", de: "Speisekarte", fr: "Carte" };
export const menuLabel = (lang) => LABELS[lang] ?? LABELS.en;

const MARK = /<!--crier-menu-->[\s\S]*?<!--\/crier-menu-->\s*/g;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Add (or, with no menu, remove) the floating menu button. `booking` says whether the booking pill sits at the bottom. */
export function injectMenuCta(html, { menu, booking = false, lang = "en" } = {}) {
  const h = html.replace(MARK, "");
  if (!menu?.url) return h;
  const bottom = booking ? 76 : 16; // booking pill is ~50px tall at bottom:16px
  const a = `<!--crier-menu--><a data-crier-menu href="${esc(menu.url)}" rel="noopener" style="position:fixed;left:50%;bottom:${bottom}px;transform:translateX(-50%);z-index:97;display:inline-block;padding:12px 24px;border-radius:999px;background:#ffffff;color:#111111;font:700 16px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;text-decoration:none;white-space:nowrap;box-shadow:0 6px 22px rgba(0,0,0,.28);border:2px solid #111111">${esc(menuLabel(lang))}</a><!--/crier-menu-->\n`;
  return /<\/body>/i.test(h) ? h.replace(/<\/body>/i, () => `${a}</body>`) : h + a;
}
