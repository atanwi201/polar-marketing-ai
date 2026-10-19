// A business can keep its own website instead of the AI-built one. In that mode nothing is built, rebuilt
// or quality-checked; the QR code, shared links and the portal point to their URL, and since we can't
// edit an external site the portal shows plain links and a paste-in snippet for the Menu / Booking buttons.
import { bookingFor, bookingLabel, injectBookingCta, serverBase } from "./bookings-links.mjs";
import { menuFor, menuLabel, injectMenuCta } from "./menu-links.mjs";

/** A clean https URL from what someone typed ("tuweb.com", "http://x.es/menu"), or "" when it isn't one. */
export function normalizeWebsiteUrl(v) {
  const s = typeof v === "string" ? v.trim().slice(0, 300) : "";
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return "";
    u.hash = "";
    return u.href;
  } catch { return ""; }
}

/** Their own URL when this business uses its own website (and gave a valid address), else "". */
export const ownWebsite = (client) => (client?.websiteMode === "own" ? normalizeWebsiteUrl(client.websiteUrl) : "");

/** What the portal needs in own mode: the site, plain Menu / Booking links and the paste-in snippet. */
export function ownSiteInfo(client, base = serverBase()) {
  const url = ownWebsite(client);
  if (!url) return null;
  const booking = bookingFor(client, { src: "website", base });
  const menu = menuFor(client, { src: "website", base });
  let snippet = "";
  if (booking || menu) {
    const lang = client.languages?.[0] ?? "en";
    let html = injectBookingCta("", { booking, lang });
    html = injectMenuCta(html, { menu, booking: !!booking, lang });
    snippet = html.trim();
  }
  return { url, menuUrl: menu?.url ?? "", bookingUrl: booking?.url ?? "", menuLabel: menuLabel(client.languages?.[0] ?? "en"), bookingLabel: booking ? bookingLabel(booking.kind, client.languages?.[0] ?? "en") : "", snippet };
}
