// AI copy drafting for retention messages in ES/EN/DE, in the client's tone.
import { aiJson, aiText, pick } from "../core/ai";
import { eur } from "../core/plans";
import type { Client } from "../core/types";
import type { Channel, MsgLang, RetSetup, MonthStats } from "./retention-logic";

export type GoalKey = "birthday" | "winback" | "review" | "reminder" | "cart" | "postpurchase" | "vip" | "promo" | "event";
export const GOALS: { value: GoalKey; label: string }[] = [
  { value: "promo", label: "Offer or new service" },
  { value: "event", label: "Event or news" },
  { value: "winback", label: "Win-back" },
  { value: "birthday", label: "Birthday" },
  { value: "review", label: "Review request" },
  { value: "reminder", label: "Booking reminder" },
  { value: "vip", label: "VIP early access" },
  { value: "cart", label: "Abandoned cart" },
  { value: "postpurchase", label: "Post-purchase" },
];

export const OPT_OUT: Record<MsgLang, string> = {
  es: "Responde BAJA para no recibir más mensajes.",
  en: "Reply STOP to opt out.",
  de: "Antworte STOP, um dich abzumelden.",
};
const EMAIL_OUT: Record<MsgLang, string> = {
  es: "Darse de baja: enlace al pie de este email.",
  en: "Unsubscribe: link at the bottom of this email.",
  de: "Abmelden: Link am Ende dieser E-Mail.",
};

export interface Draft { title: string; es: string; en: string; de: string }

/** Make sure every message carries the opt-out line for its channel. */
export function withOptOut(d: Draft, ch: Channel): Draft {
  const add = (t: string, l: MsgLang) => {
    const line = ch === "whatsapp" ? OPT_OUT[l] : EMAIL_OUT[l];
    return t.includes(line) || /\b(BAJA|STOP)\b/.test(t) ? t : `${t.trim()}\n\n${line}`;
  };
  return { title: d.title, es: add(d.es, "es"), en: add(d.en, "en"), de: add(d.de, "de") };
}

export async function draftCopy(args: { client: Client; setup: RetSetup; goal: GoalKey; audience: string; channel: Channel; brief: string }) {
  const { client, setup, goal, audience, channel, brief } = args;
  const label = GOALS.find((g) => g.value === goal)?.label ?? goal;
  const res = await aiJson<Draft>(
    `Draft a ${channel === "whatsapp" ? "WhatsApp marketing message (max 400 characters each, 1 emoji at most, no links except if given)" : "short marketing email body (max 120 words each)"} for ${client.name}, a ${client.kind.toLowerCase()} in ${client.town}, Tenerife.
Goal: ${label}. Audience: ${audience} customers who opted in. Brief: ${brief || "none"}.
Standing offer the business approved: ES "${setup.offer.es}", EN "${setup.offer.en}", DE "${setup.offer.de}". Only use this offer or what the brief says; never invent discounts, prices or dates.
Tone: ${setup.tone}. Write natively, not as translations: Spanish (Canary Islands, use the tone above), English, German (du form).
Start with the first name placeholder: {nombre} in Spanish, {name} in English, {vorname} in German.
End every message with the opt-out line: ES "${OPT_OUT.es}" EN "${OPT_OUT.en}" DE "${OPT_OUT.de}".
Return JSON: {"title":"short internal campaign name in English","es":"...","en":"...","de":"..."}`,
    () => templateDraft(client.name, client.town, setup.offer, goal, brief),
  );
  return { ...res, data: withOptOut(res.data, channel) };
}

/** Deterministic copy used in demo mode and for default flows. */
export function templateDraft(b: string, town: string, offer: Record<MsgLang, string>, goal: GoalKey, brief: string): Draft {
  const o = offer.es, oe = offer.en, od = offer.de;
  const extra = brief ? ` ${brief.trim().replace(/\.$/, "")}.` : "";
  const v = pick([0, 1], b + goal);
  const T: Record<GoalKey, Draft> = {
    winback: {
      title: "Win-back: we miss you",
      es: v ? `¡Hola {nombre}! Hace tiempo que no te vemos por ${b} y te echamos de menos. Para tu próxima visita tienes ${o}.${extra} Reserva respondiendo a este mensaje.` : `{nombre}, ¿cuánto tiempo! En ${b} te guardamos ${o} para que vuelvas cuando quieras.${extra} Escríbenos y te buscamos hueco.`,
      en: `Hi {name}! It has been a while since your last visit to ${b}. Come back and enjoy ${oe}.${extra} Just reply here to book.`,
      de: `Hallo {vorname}! Wir haben dich bei ${b} schon länger nicht gesehen. Bei deinem nächsten Besuch bekommst du ${od}.${extra} Antworte einfach hier, um zu buchen.`,
    },
    birthday: {
      title: "Birthday treat",
      es: `¡Feliz cumpleaños, {nombre}! En ${b} queremos celebrarlo contigo: este mes tienes ${o}.${extra} Responde y te reservamos.`,
      en: `Happy birthday, {name}! ${b} would love to celebrate with you: ${oe} all month.${extra} Reply to book.`,
      de: `Alles Gute zum Geburtstag, {vorname}! ${b} feiert mit dir: diesen Monat gibt es ${od}.${extra} Antworte zum Buchen.`,
    },
    review: {
      title: "Review request",
      es: `Gracias por venir a ${b}, {nombre}. ¿Nos dejas tu opinión en Google? Nos ayuda muchísimo a seguir creciendo en ${town}.`,
      en: `Thanks for visiting ${b}, {name}. Would you leave us a quick Google review? It helps a small business in ${town} a lot.`,
      de: `Danke für deinen Besuch bei ${b}, {vorname}. Hinterlässt du uns eine kurze Google-Bewertung? Das hilft uns in ${town} sehr.`,
    },
    reminder: {
      title: "Appointment reminder",
      es: `Hola {nombre}, te recordamos tu cita en ${b} mañana. Si necesitas cambiarla, responde a este mensaje.`,
      en: `Hi {name}, a reminder of your appointment at ${b} tomorrow. Reply here if you need to change it.`,
      de: `Hallo {vorname}, wir erinnern dich an deinen Termin bei ${b} morgen. Antworte hier, falls du ihn ändern musst.`,
    },
    cart: {
      title: "Cart reminder",
      es: `{nombre}, te dejaste algo en el carrito de ${b}. Lo guardamos 48 horas para ti.${extra}`,
      en: `{name}, you left something in your ${b} cart. We are holding it for 48 hours.${extra}`,
      de: `{vorname}, in deinem Warenkorb bei ${b} liegt noch etwas. Wir halten es 48 Stunden für dich bereit.${extra}`,
    },
    postpurchase: {
      title: "Thank you and care tips",
      es: `¡Gracias por tu compra, {nombre}! Si tienes cualquier duda sobre tu pedido de ${b}, responde aquí.`,
      en: `Thanks for your order, {name}! Any questions about your ${b} order, just reply here.`,
      de: `Danke für deine Bestellung, {vorname}! Bei Fragen zu deiner Bestellung bei ${b} antworte einfach hier.`,
    },
    vip: {
      title: "VIP early access",
      es: `{nombre}, eres de nuestras clientas de siempre y queremos que seas la primera en saberlo:${extra || " novedades en " + b + "."} Para ti, ${o}.`,
      en: `{name}, as one of our regulars you hear it first:${extra || " news at " + b + "."} For you, ${oe}.`,
      de: `{vorname}, als Stammkundin erfährst du es zuerst:${extra || " Neues bei " + b + "."} Für dich: ${od}.`,
    },
    promo: {
      title: brief ? `Offer: ${brief.slice(0, 40)}` : "Monthly offer",
      es: `¡Hola {nombre}! Novedad en ${b}:${extra || " este mes tenemos " + o + "."} ¿Te reservamos hueco? Responde a este mensaje.`,
      en: `Hi {name}! New at ${b}:${extra || " this month we have " + oe + "."} Shall we save you a slot? Reply here.`,
      de: `Hallo {vorname}! Neu bei ${b}:${extra || " diesen Monat gibt es " + od + "."} Sollen wir dir einen Termin freihalten? Antworte hier.`,
    },
    event: {
      title: brief ? `Event: ${brief.slice(0, 40)}` : "Event invite",
      es: `{nombre}, te invitamos:${extra || " pronto tenemos una jornada especial en " + b + "."} Plazas limitadas, responde para apuntarte.`,
      en: `{name}, you are invited:${extra || " a special day at " + b + " is coming up."} Limited places, reply to join.`,
      de: `{vorname}, du bist eingeladen:${extra || " bald gibt es einen besonderen Tag bei " + b + "."} Begrenzte Plätze, antworte zum Anmelden.`,
    },
  };
  return T[goal];
}

export async function writeMonthReport(client: Client, s: MonthStats, prev: MonthStats | undefined, onText: (t: string) => void) {
  const facts = `Month: ${s.month}. Revenue logged: ${eur(s.revenue)}. From returning customers: ${eur(s.returningRevenue)} (${s.returningCustomers} customers). New customers: ${s.newCustomers}. Visits within 7 days of a message: ${s.attributedVisits}, worth ${eur(s.attributed)}. Messages sent: ${s.messages}, WhatsApp cost ${eur(s.cost)}. Previous month returning revenue: ${prev ? eur(prev.returningRevenue) : "n/a"}. By campaign or flow: ${s.byRef.map((r) => `${r.label}: ${r.sent} sent, ${r.visits} visits, ${eur(r.revenue)}`).join("; ") || "none"}.`;
  return aiText(
    `Write the monthly retention report for ${client.name} (${client.kind}, ${client.town}) in Spanish, plain text, max 150 words. Lead with revenue from returning customers, say what each campaign or flow brought back, compare with last month, and finish with 2 concrete tests for next month. Call message-attributed revenue an estimate (visits within 7 days of a message). Use only these facts:\n${facts}`,
    () => demoMonth(client, s, prev),
    { onText },
  );
}

function demoMonth(client: Client, s: MonthStats, prev?: MonthStats) {
  const diff = prev ? s.returningRevenue - prev.returningRevenue : 0;
  const best = s.byRef[0];
  return `Informe de ${client.name}, ${s.month}

Clientes que repiten: ${s.returningCustomers}, con ${eur(s.returningRevenue)} de facturación${prev ? ` (${diff >= 0 ? "+" : ""}${eur(diff)} frente al mes anterior)` : ""}.
Visitas en los 7 días siguientes a un mensaje: ${s.attributedVisits}, unos ${eur(s.attributed)} (estimación).
${best ? `Lo que mejor funcionó: ${best.label}, ${best.sent} envíos y ${best.visits} visitas.` : "Este mes no hubo envíos."}
Mensajes enviados: ${s.messages}. Coste de WhatsApp: ${eur(s.cost)}, que se factura al coste.

Pruebas para el mes que viene:
1. ${pick(["Enviar el win-back a los 45 días en vez de a los 60.", "Probar el recordatorio de cita 24 h antes en vez de 48 h.", "Poner el QR también en el espejo de cada puesto."], client.id + s.month)}
2. ${pick(["Comparar una oferta del 10% con un regalo pequeño en la versión en inglés.", "Pedir reseña solo a clientas con 3 visitas o más.", "Mandar la campaña del jueves a las 11:00 en vez de por la tarde."], s.month + client.name)}`;
}
