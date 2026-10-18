// Where customers can start a booking from: the business's website (a call-to-action added to the
// finished pages) and the loyalty web card. Read-only on the booking data; nothing here edits bookings.mjs.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "./store.mjs";
import { findConfig, bookingUrl } from "./bookings.mjs";

/** The public address of this server (a client's own-domain site must link to it absolutely). */
export const serverBase = () => (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, "");

/** {url, kind} when the client takes online bookings, else null. `src` says where the click came from. */
export function bookingFor(client, { src, base = serverBase() } = {}) {
  const cfg = client && findConfig(client.id);
  if (!cfg?.enabled || !cfg.code) return null;
  return { url: `${bookingUrl(cfg, base)}${src ? `?src=${src}` : ""}`, kind: cfg.kind === "room" ? "room" : "table" };
}

const LABELS = { es: { table: "Reservar mesa", room: "Reservar habitación" }, en: { table: "Reserve a table", room: "Book a room" } };
export const bookingLabel = (kind, lang) => (LABELS[lang] ?? LABELS.en)[kind === "room" ? "room" : "table"];

const MARK = /<!--crier-booking-->[\s\S]*?<!--\/crier-booking-->\s*/g;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c : d);
const darkish = (h) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 150; };

/**
 * Add (or, with no booking, remove) the floating booking button. Plain <a>, inline styles only,
 * wrapped in markers so doing it again replaces the previous one.
 */
export function injectBookingCta(html, { booking, lang = "en", color = "#111111" } = {}) {
  const h = html.replace(MARK, "");
  if (!booking?.url) return h;
  const bg = hex(color, "#111111");
  const fg = darkish(bg) ? "#ffffff" : "#111111";
  const a = `<!--crier-booking--><a data-crier-booking href="${esc(booking.url)}" rel="noopener" style="position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:98;display:inline-block;padding:14px 26px;border-radius:999px;background:${bg};color:${fg};font:700 16px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;text-decoration:none;white-space:nowrap;box-shadow:0 6px 22px rgba(0,0,0,.28);border:2px solid rgba(255,255,255,.55)">${esc(bookingLabel(booking.kind, lang))}</a><!--/crier-booking-->\n`;
  return /<\/body>/i.test(h) ? h.replace(/<\/body>/i, () => `${a}</body>`) : h + a;
}

const accentOf = (client) => hex(client.profile?.colors?.accent, hex(client.profile?.colors?.primary, "#111111"));

/** Page-building hook: the CTA for one language of a client's site. */
export const siteCta = (html, client, lang) => injectBookingCta(html, { booking: bookingFor(client, { src: "website" }), lang, color: accentOf(client) });

/**
 * Cheap path for sites already built: add/remove the button in the live files without rebuilding.
 * Returns the files changed.
 */
export async function syncSiteBooking(client, sitesDir) {
  if (client.site?.kind !== "ai" || client.site?.status === "building" || !client.siteSlug) return [];
  const dir = join(sitesDir, client.siteSlug);
  const langs = client.site.languages?.length ? client.site.languages : [];
  const files = [join(dir, "index.html"), ...langs.slice(1).map((l) => join(dir, l, "index.html"))];
  const changed = [];
  for (const f of files) {
    try {
      const html = await readFile(f, "utf8");
      const lang = /<html\b[^>]*\blang=["']([a-z]{2})/i.exec(html)?.[1] ?? "en";
      const next = siteCta(html, client, lang);
      if (next !== html) { await writeFile(f, next); changed.push(f); }
    } catch { /* page not there */ }
  }
  return changed;
}
export const syncAllSites = (sitesDir) => Promise.all(db.clients.map((c) => syncSiteBooking(c, sitesDir).catch(() => [])));
