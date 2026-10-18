// Transactional booking emails (LSSI: only to the person who booked, about their own booking; never marketing).
// Sent through Resend's HTTP API when RESEND_API_KEY is set; otherwise nothing is sent and booking.mail records "not-configured".
import { findConfig, clientOf, manageUrl } from "./bookings.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DAYS = { es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"], en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] };
const MONTHS = { es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"], en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] };
export const prettyDate = (d, lang) => { const t = new Date(d + "T00:00:00Z"); const l = lang === "en" ? "en" : "es"; return l === "en" ? `${DAYS.en[t.getUTCDay()]}, ${t.getUTCDate()} ${MONTHS.en[t.getUTCMonth()]} ${t.getUTCFullYear()}` : `${DAYS.es[t.getUTCDay()]}, ${t.getUTCDate()} de ${MONTHS.es[t.getUTCMonth()]} de ${t.getUTCFullYear()}`; };

const T = {
  es: {
    created: (biz) => `Hemos recibido tu reserva en ${biz}`, confirmed: (biz) => `Reserva confirmada en ${biz}`, cancelled: (biz) => `Reserva cancelada en ${biz}`,
    hi: (n) => `Hola ${n},`,
    created_p: "Hemos recibido tu solicitud. El negocio la revisará y te escribiremos cuando esté confirmada.",
    confirmed_p: "Tu reserva está confirmada. ¡Te esperamos!", cancelled_p: "Tu reserva ha sido cancelada.",
    table: (b) => `${b.party} ${b.party === 1 ? "persona" : "personas"}, ${prettyDate(b.date, "es")} a las ${b.time}`,
    room: (b) => `${b.roomName}, ${b.guests} ${b.guests === 1 ? "huésped" : "huéspedes"}, del ${prettyDate(b.checkIn, "es")} al ${prettyDate(b.checkOut, "es")} (${b.nights} ${b.nights === 1 ? "noche" : "noches"})`,
    manage: "Ver o cancelar tu reserva", phone: "Si necesitas cambiarla, llama al", foot: (biz) => `Este es un mensaje de servicio sobre tu reserva en ${biz}. No es publicidad y no te enviaremos más correos sobre ella salvo cambios.`,
    ownerSubject: (n) => `Nueva reserva de ${n}`,
  },
  en: {
    created: (biz) => `We received your booking at ${biz}`, confirmed: (biz) => `Booking confirmed at ${biz}`, cancelled: (biz) => `Booking cancelled at ${biz}`,
    hi: (n) => `Hi ${n},`,
    created_p: "We received your request. The business will review it and we will email you once it is confirmed.",
    confirmed_p: "Your booking is confirmed. See you soon!", cancelled_p: "Your booking has been cancelled.",
    table: (b) => `${b.party} ${b.party === 1 ? "person" : "people"}, ${prettyDate(b.date, "en")} at ${b.time}`,
    room: (b) => `${b.roomName}, ${b.guests} ${b.guests === 1 ? "guest" : "guests"}, ${prettyDate(b.checkIn, "en")} to ${prettyDate(b.checkOut, "en")} (${b.nights} ${b.nights === 1 ? "night" : "nights"})`,
    manage: "View or cancel your booking", phone: "To change it, call", foot: (biz) => `This is a service message about your booking at ${biz}. It is not advertising, and we will only write again if your booking changes.`,
    ownerSubject: (n) => `New booking from ${n}`,
  },
};

/** Subject + text + html for a customer email. Pure, so it is easy to test. */
export function renderEmail(b, event, { baseUrl, biz, phone }) {
  const t = T[b.lang === "en" ? "en" : "es"];
  const key = event === "created" && b.status === "confirmed" ? "confirmed" : event === "created" ? "created" : event;
  if (!["created", "confirmed", "cancelled"].includes(key)) return null;
  const detail = b.kind === "table" ? t.table(b) : t.room(b);
  const link = manageUrl(b, baseUrl);
  const subject = t[key](biz);
  const para = t[`${key}_p`];
  const text = [t.hi(b.name), "", para, "", `${biz}`, detail, "", `${t.manage}: ${link}`, phone ? `${t.phone} ${phone}.` : "", "", t.foot(biz)].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#1c1917"><p>${esc(t.hi(b.name))}</p><p>${esc(para)}</p><p style="padding:12px 14px;background:#f5f5f4;border-radius:10px"><strong>${esc(biz)}</strong><br>${esc(detail)}</p><p><a href="${esc(link)}">${esc(t.manage)}</a></p>${phone ? `<p>${esc(t.phone)} ${esc(phone)}.</p>` : ""}<p style="color:#78716c;font-size:12px">${esc(t.foot(biz))}</p></div>`;
  return { subject, text, html };
}

export function mailConfigured() { return !!process.env.RESEND_API_KEY; }

async function deliver({ to, subject, text, html, replyTo }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.BOOKING_FROM_EMAIL || "Reservas <onboarding@resend.dev>", to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    signal: AbortSignal.timeout(15e3),
  });
  if (!r.ok) throw new Error(`mail provider answered ${r.status}`);
}

/** Wire as setOnBookingChange handler. `sender` is injectable for tests. */
export function bookingMailer({ baseUrl, save, sender = deliver } = {}) {
  return async (b, event) => {
    const cfg = findConfig(b.clientId), client = clientOf(cfg) ?? {};
    const mail = renderEmail(b, event, { baseUrl: baseUrl(), biz: client.name || "", phone: client.phone });
    if (!mail) return;
    const rec = { at: new Date().toISOString(), event, to: b.email, state: "" };
    (b.mail ??= []).push(rec);
    if (!mailConfigured() && sender === deliver) rec.state = "not-configured";
    else {
      try { await sender({ to: b.email, ...mail, replyTo: client.email || undefined }); rec.state = "sent"; }
      catch (e) { rec.state = "failed"; console.warn("[booking mail]", e.message); }
    }
    // The business itself hears about new requests (it is their own booking data, not marketing).
    if (event === "created" && client.email && (mailConfigured() || sender !== deliver)) {
      try { await sender({ to: client.email, subject: `${T[b.lang === "en" ? "en" : "es"].ownerSubject(b.name)} (${b.kind === "table" ? `${b.date} ${b.time}` : `${b.checkIn}`})`, text: `${b.name} <${b.email}> ${b.phone || ""}\n${b.kind === "table" ? `${b.party}p ${b.date} ${b.time}` : `${b.roomName} ${b.checkIn} -> ${b.checkOut}`}\n${b.notes || ""}`, html: `<p>${esc(b.name)} (${esc(b.email)})</p>` }); } catch (e) { console.warn("[booking owner mail]", e.message); }
    }
    await save?.();
  };
}
