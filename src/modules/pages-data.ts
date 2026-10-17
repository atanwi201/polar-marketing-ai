// Plan 3 data model, tier caps, QA checks and deterministic demo generators.
import type { Client, Lang, Rec } from "../core/types";
import { eur, LANGS } from "../core/plans";
import { pick } from "../core/ai";

export interface Activity { name: string; price: number; duration: string; facts: string }
export interface Project extends Rec {
  clientId: string;
  brand: string;
  domain: string;
  bookingUrl: string;
  whatsapp: string;
  activities: Activity[];
  locations: string[];
  localFacts: Record<string, string>; // location -> unique local detail from the client
  langs: Lang[];
  excluded: string[]; // "activity|location" combos that make no sense
  seasonal: boolean;
}
export interface Faq { q: string; a: string }
export interface PageLang { slug: string; title: string; meta: string; h1: string; body: string; faq: Faq[] }
export type PageStatus = "draft" | "flagged" | "approved" | "published";
export type IssueKind = "price" | "fact" | "duplicate" | "thin" | "length" | "missing";
export interface Issue { lang?: Lang; severity: "high" | "medium" | "low"; kind: IssueKind; text: string }
export interface SitePage extends Rec {
  projectId: string;
  clientId: string;
  activity: string;
  location: string;
  content: Partial<Record<Lang, PageLang>>;
  schema: string; // JSON-LD
  live: boolean;
  status: PageStatus;
  qa?: { issues: Issue[]; at: string; live: boolean };
  publishedAt?: string;
  refreshedAt?: string;
}
export interface RankRow { path: string; lang: Lang; clicks: number; impressions: number; position: number }
export interface RankReport extends Rec { projectId: string; clientId: string; month: string; rows: RankRow[]; prev: { clicks: number; impressions: number }; summary?: string; live?: boolean }
export interface AuditResult {
  score: number;
  missingLangs: Lang[];
  demand: { lang: Lang; keyword: string; monthly: number }[];
  quickWins: string[];
  sampleTitles: Partial<Record<Lang, string>>;
}
export interface Audit extends Rec {
  business: string; activity: string; town: string; site: string; currentLangs: Lang[];
  contact: string; channel: "email" | "whatsapp"; consentSource: string; consentAt: string;
  result?: AuditResult; live?: boolean; followUp?: string;
}

export const COL = { projects: "pages_projects", pages: "pages_pages", reports: "pages_reports", audits: "pages_audits" };
export const AUDIT_LANGS: Lang[] = ["es", "en", "de", "nl", "it"];
export const SPOTS = ["Puerto Colón", "Punta del Hidalgo", "Playa Jardín", "El Puertito", "Masca", "Teide National Park", "Montaña Roja", "Abades"];

export const TIERS: Record<string, { pages: number; langs: number; seasonal: boolean; refresh: boolean; report: boolean }> = {
  Starter: { pages: 30, langs: 3, seasonal: false, refresh: false, report: false },
  Growth: { pages: 80, langs: 5, seasonal: false, refresh: true, report: false },
  Pro: { pages: 150, langs: 7, seasonal: true, refresh: true, report: true },
};
export function tierOf(c?: Client) {
  const s = c?.subs.find((x) => x.plan === "p3");
  const name = s?.tier && TIERS[s.tier] ? s.tier : "Starter";
  return { name: s ? name : "Starter (pilot)", ...TIERS[name], paid: !!s && c?.stage === "paid" };
}

export const comboKey = (a: string, l: string) => `${a}|${l}`;
export const SEASONS = ["Winter sun", "Summer"];
export function pageCount(p: Project): { combos: number; seasonal: number; total: number } {
  const combos = p.activities.length * p.locations.length - p.excluded.filter((k) => {
    const [a, l] = k.split("|");
    return p.activities.some((x) => x.name === a) && p.locations.includes(l);
  }).length;
  const seasonal = p.seasonal ? p.activities.length * SEASONS.length : 0;
  return { combos, seasonal, total: (combos + seasonal) * p.langs.length };
}

export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
export const pagePath = (lang: Lang, slug: string) => `/${lang}/${slug}/`;

export function hreflangTags(domain: string, content: Partial<Record<Lang, PageLang>>): string {
  const ls = Object.keys(content) as Lang[];
  const lines = ls.map((l) => `<link rel="alternate" hreflang="${l}" href="https://${domain}${pagePath(l, content[l]!.slug)}" />`);
  const def = content.en ? "en" : ls[0];
  if (def) lines.push(`<link rel="alternate" hreflang="x-default" href="https://${domain}${pagePath(def, content[def]!.slug)}" />`);
  return lines.join("\n");
}

export function sitemapXml(project: Project, pages: SitePage[]): string {
  const urls = pages.flatMap((pg) => {
    const ls = Object.keys(pg.content) as Lang[];
    return ls.map((l) => {
      const alts = ls.map((a) => `    <xhtml:link rel="alternate" hreflang="${a}" href="https://${project.domain}${pagePath(a, pg.content[a]!.slug)}"/>`).join("\n");
      const mod = (pg.refreshedAt ?? pg.publishedAt ?? pg.createdAt).slice(0, 10);
      return `  <url>\n    <loc>https://${project.domain}${pagePath(l, pg.content[l]!.slug)}</loc>\n    <lastmod>${mod}</lastmod>\n${alts}\n  </url>`;
    });
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>`;
}

// --- Demo writer ------------------------------------------------------------------------------------

interface W {
  title: (a: string, l: string) => string; meta: (a: string, l: string, p: string, d: string) => string; h1: (a: string, l: string) => string;
  intro: (a: string, l: string, b: string) => string; expectH: string; expect: (d: string, f: string) => string;
  whereH: string; where: (l: string) => string; local: string; priceH: string; price: (p: string) => string; book: string;
  whyH: string; why: (b: string) => string; knowH: string; know: string;
  qPrice: (a: string) => string; aPrice: (p: string) => string; qDur: string; aDur: (d: string) => string; qBook: string; aBook: string;
}
const WR: Record<Lang, W> = {
  en: { title: (a, l) => `${a} in ${l}`, meta: (a, l, p, d) => `${a} in ${l}, Tenerife. ${d}, from ${p}. Small groups, local team. Book online or on WhatsApp.`,
    h1: (a, l) => `${a} in ${l}, Tenerife`, intro: (a, l, b) => `${b} runs ${a.toLowerCase()} in ${l}, on Tenerife. This page tells you what happens on the day, what it costs and how to book directly with the local team.`,
    expectH: "What to expect", expect: (d, f) => `The activity lasts ${d}. ${f}`, whereH: "Where it happens", where: (l) => `We meet in ${l}. Exact directions arrive with your booking confirmation.`,
    local: "Local tip", priceH: "Price and booking", price: (p) => `The price is ${p} per person.`, book: "Book online with the button on this page or send us a WhatsApp message. You pay no platform commission when you book direct.",
    whyH: "Why book with us", why: (b) => `${b} is a local, family-run team. You talk to the people who run the trip, before and after.`,
    knowH: "Good to know", know: "Bring a towel, sun cream and a bottle of water. Tell us about any medical condition when you book. Times can move with the sea and weather; if we cancel, you choose a new date or get a full refund.",
    qPrice: (a) => `How much does ${a.toLowerCase()} cost?`, aPrice: (p) => `${p} per person.`, qDur: "How long does it take?", aDur: (d) => `About ${d}.`, qBook: "How do I book?", aBook: "Use the booking button or WhatsApp. We confirm within the day." },
  es: { title: (a, l) => `${a} en ${l}`, meta: (a, l, p, d) => `${a} en ${l}, Tenerife. ${d}, desde ${p}. Grupos pequeños y equipo local. Reserva online o por WhatsApp.`,
    h1: (a, l) => `${a} en ${l}, Tenerife`, intro: (a, l, b) => `${b} organiza ${a.toLowerCase()} en ${l}, Tenerife. Aquí tienes qué se hace ese día, cuánto cuesta y cómo reservar directamente con el equipo local.`,
    expectH: "Qué esperar", expect: (d, f) => `La actividad dura ${d}. ${f}`, whereH: "Dónde es", where: (l) => `Quedamos en ${l}. Te enviamos la ubicación exacta con la confirmación.`,
    local: "Consejo local", priceH: "Precio y reserva", price: (p) => `El precio es de ${p} por persona.`, book: "Reserva con el botón de esta página o escríbenos por WhatsApp. Reservando directo no pagas comisión de plataforma.",
    whyH: "Por qué con nosotros", why: (b) => `${b} es un equipo local y familiar. Hablas con quien organiza la salida, antes y después.`,
    knowH: "Bueno saber", know: "Trae toalla, crema solar y una botella de agua. Avísanos de cualquier condición médica al reservar. Los horarios pueden cambiar según el mar y el tiempo; si cancelamos, eliges otra fecha o te devolvemos todo.",
    qPrice: (a) => `¿Cuánto cuesta ${a.toLowerCase()}?`, aPrice: (p) => `${p} por persona.`, qDur: "¿Cuánto dura?", aDur: (d) => `Unas ${d}.`, qBook: "¿Cómo reservo?", aBook: "Con el botón de reserva o por WhatsApp. Confirmamos en el día." },
  de: { title: (a, l) => `${a} in ${l}`, meta: (a, l, p, d) => `${a} in ${l}, Teneriffa. ${d}, ab ${p}. Kleine Gruppen, lokales Team. Online oder per WhatsApp buchen.`,
    h1: (a, l) => `${a} in ${l}, Teneriffa`, intro: (a, l, b) => `${b} bietet ${a} in ${l} auf Teneriffa an. Hier lesen Sie, was Sie erwartet, was es kostet und wie Sie direkt beim lokalen Team buchen.`,
    expectH: "Was Sie erwartet", expect: (d, f) => `Die Aktivität dauert ${d}. ${f}`, whereH: "Treffpunkt", where: (l) => `Wir treffen uns in ${l}. Die genaue Wegbeschreibung kommt mit Ihrer Buchungsbestätigung.`,
    local: "Lokaler Tipp", priceH: "Preis und Buchung", price: (p) => `Der Preis beträgt ${p} pro Person.`, book: "Buchen Sie über den Button auf dieser Seite oder per WhatsApp. Bei Direktbuchung zahlen Sie keine Plattformprovision.",
    whyH: "Warum bei uns", why: (b) => `${b} ist ein lokales Familienteam. Sie sprechen vorher und nachher direkt mit den Menschen, die die Tour leiten.`,
    knowH: "Gut zu wissen", know: "Bringen Sie Handtuch, Sonnencreme und eine Flasche Wasser mit. Teilen Sie uns bei der Buchung gesundheitliche Einschränkungen mit. Zeiten können sich je nach Meer und Wetter verschieben; sagen wir ab, wählen Sie einen neuen Termin oder erhalten den vollen Betrag zurück.",
    qPrice: (a) => `Was kostet ${a}?`, aPrice: (p) => `${p} pro Person.`, qDur: "Wie lange dauert es?", aDur: (d) => `Etwa ${d}.`, qBook: "Wie buche ich?", aBook: "Über den Buchungsbutton oder per WhatsApp. Wir bestätigen noch am selben Tag." },
  nl: { title: (a, l) => `${a} in ${l}`, meta: (a, l, p, d) => `${a} in ${l}, Tenerife. ${d}, vanaf ${p}. Kleine groepen, lokaal team. Boek online of via WhatsApp.`,
    h1: (a, l) => `${a} in ${l}, Tenerife`, intro: (a, l, b) => `${b} organiseert ${a} in ${l} op Tenerife. Hier lees je wat je die dag doet, wat het kost en hoe je direct bij het lokale team boekt.`,
    expectH: "Wat je kunt verwachten", expect: (d, f) => `De activiteit duurt ${d}. ${f}`, whereH: "Waar", where: (l) => `We spreken af in ${l}. De exacte route krijg je bij je boekingsbevestiging.`,
    local: "Lokale tip", priceH: "Prijs en boeken", price: (p) => `De prijs is ${p} per persoon.`, book: "Boek met de knop op deze pagina of stuur ons een WhatsApp-bericht. Direct boeken betekent geen platformcommissie.",
    whyH: "Waarom bij ons", why: (b) => `${b} is een lokaal familieteam. Je spreekt voor en na met de mensen die de tocht leiden.`,
    knowH: "Goed om te weten", know: "Neem een handdoek, zonnebrand en een fles water mee. Meld medische aandoeningen bij het boeken. Tijden kunnen verschuiven door zee en weer; als wij annuleren, kies je een nieuwe datum of krijg je je geld volledig terug.",
    qPrice: (a) => `Wat kost ${a}?`, aPrice: (p) => `${p} per persoon.`, qDur: "Hoe lang duurt het?", aDur: (d) => `Ongeveer ${d}.`, qBook: "Hoe boek ik?", aBook: "Via de boekingsknop of WhatsApp. We bevestigen dezelfde dag." },
  it: { title: (a, l) => `${a} a ${l}`, meta: (a, l, p, d) => `${a} a ${l}, Tenerife. ${d}, da ${p}. Gruppi piccoli, team locale. Prenota online o su WhatsApp.`,
    h1: (a, l) => `${a} a ${l}, Tenerife`, intro: (a, l, b) => `${b} organizza ${a} a ${l}, Tenerife. Qui trovi cosa si fa, quanto costa e come prenotare direttamente con il team locale.`,
    expectH: "Cosa aspettarsi", expect: (d, f) => `L'attività dura ${d}. ${f}`, whereH: "Dove", where: (l) => `Ci incontriamo a ${l}. Le indicazioni precise arrivano con la conferma.`,
    local: "Consiglio locale", priceH: "Prezzo e prenotazione", price: (p) => `Il prezzo è di ${p} a persona.`, book: "Prenota con il pulsante in questa pagina o scrivici su WhatsApp. Prenotando diretto non paghi commissioni.",
    whyH: "Perché con noi", why: (b) => `${b} è un team locale e familiare. Parli con chi guida l'uscita, prima e dopo.`,
    knowH: "Buono a sapersi", know: "Porta asciugamano, crema solare e una bottiglia d'acqua. Segnalaci eventuali condizioni mediche quando prenoti. Gli orari possono cambiare con mare e meteo; se annulliamo, scegli una nuova data o ricevi il rimborso completo.",
    qPrice: (a) => `Quanto costa ${a}?`, aPrice: (p) => `${p} a persona.`, qDur: "Quanto dura?", aDur: (d) => `Circa ${d}.`, qBook: "Come prenoto?", aBook: "Con il pulsante di prenotazione o WhatsApp. Confermiamo in giornata." },
  sv: { title: (a, l) => `${a} i ${l}`, meta: (a, l, p, d) => `${a} i ${l}, Teneriffa. ${d}, från ${p}. Små grupper, lokalt team. Boka online eller på WhatsApp.`,
    h1: (a, l) => `${a} i ${l}, Teneriffa`, intro: (a, l, b) => `${b} arrangerar ${a} i ${l} på Teneriffa. Här ser du vad som händer, vad det kostar och hur du bokar direkt hos det lokala teamet.`,
    expectH: "Vad du kan förvänta dig", expect: (d, f) => `Aktiviteten tar ${d}. ${f}`, whereH: "Var", where: (l) => `Vi träffas i ${l}. Exakt vägbeskrivning kommer med bokningsbekräftelsen.`,
    local: "Lokalt tips", priceH: "Pris och bokning", price: (p) => `Priset är ${p} per person.`, book: "Boka med knappen på sidan eller skicka ett WhatsApp-meddelande. Bokar du direkt betalar du ingen plattformsavgift.",
    whyH: "Varför oss", why: (b) => `${b} är ett lokalt familjeteam. Du pratar med dem som leder turen, före och efter.`,
    knowH: "Bra att veta", know: "Ta med handduk, solkräm och en flaska vatten. Berätta om eventuella medicinska besvär när du bokar. Tider kan ändras efter hav och väder; om vi ställer in väljer du ett nytt datum eller får full återbetalning.",
    qPrice: (a) => `Vad kostar ${a}?`, aPrice: (p) => `${p} per person.`, qDur: "Hur lång tid tar det?", aDur: (d) => `Cirka ${d}.`, qBook: "Hur bokar jag?", aBook: "Via bokningsknappen eller WhatsApp. Vi bekräftar samma dag." },
  fr: { title: (a, l) => `${a} à ${l}`, meta: (a, l, p, d) => `${a} à ${l}, Tenerife. ${d}, dès ${p}. Petits groupes, équipe locale. Réservez en ligne ou sur WhatsApp.`,
    h1: (a, l) => `${a} à ${l}, Tenerife`, intro: (a, l, b) => `${b} propose ${a} à ${l}, Tenerife. Voici le déroulé, le prix et comment réserver directement auprès de l'équipe locale.`,
    expectH: "Au programme", expect: (d, f) => `L'activité dure ${d}. ${f}`, whereH: "Où", where: (l) => `Rendez-vous à ${l}. L'itinéraire exact arrive avec votre confirmation.`,
    local: "Conseil local", priceH: "Prix et réservation", price: (p) => `Le prix est de ${p} par personne.`, book: "Réservez avec le bouton de cette page ou écrivez-nous sur WhatsApp. En direct, pas de commission de plateforme.",
    whyH: "Pourquoi nous", why: (b) => `${b} est une équipe locale et familiale. Vous parlez avec ceux qui encadrent la sortie, avant et après.`,
    knowH: "Bon à savoir", know: "Apportez une serviette, de la crème solaire et une bouteille d'eau. Signalez tout problème de santé à la réservation. Les horaires peuvent changer selon la mer et la météo ; si nous annulons, vous choisissez une autre date ou êtes remboursé intégralement.",
    qPrice: (a) => `Combien coûte ${a} ?`, aPrice: (p) => `${p} par personne.`, qDur: "Combien de temps ça dure ?", aDur: (d) => `Environ ${d}.`, qBook: "Comment réserver ?", aBook: "Avec le bouton de réservation ou WhatsApp. Confirmation dans la journée." },
};

export function demoPage(p: Project, a: Activity, loc: string, langs: Lang[]): { content: Partial<Record<Lang, PageLang>>; schema: string } {
  const content: Partial<Record<Lang, PageLang>> = {};
  const price = eur(a.price);
  const local = p.localFacts[loc];
  for (const l of langs) {
    const w = WR[l];
    const full = `${w.title(a.name, loc)} | ${p.brand}`;
    const title = full.length <= 60 ? full : w.title(a.name, loc);
    const body = [
      w.intro(a.name, loc, p.brand),
      `## ${w.expectH}\n${w.expect(a.duration, a.facts)}`,
      `## ${w.whereH}\n${w.where(loc)}${local ? `\n${w.local}: ${local}` : ""}`,
      `## ${w.priceH}\n${w.price(price)} ${w.book}`,
      `## ${w.knowH}\n${w.know}`,
      `## ${w.whyH}\n${w.why(p.brand)}`,
    ].join("\n\n");
    content[l] = {
      slug: slugify(w.title(a.name, loc)), title, meta: w.meta(a.name, loc, price, a.duration), h1: w.h1(a.name, loc), body,
      faq: [{ q: w.qPrice(a.name), a: w.aPrice(price) }, { q: w.qDur, a: w.aDur(a.duration) }, { q: w.qBook, a: w.aBook }],
    };
  }
  return { content, schema: schemaFor(p, a, loc, content) };
}

export function schemaFor(p: Project, a: Activity, loc: string, content: Partial<Record<Lang, PageLang>>): string {
  const first = (content.en ?? Object.values(content)[0]) as PageLang | undefined;
  const graph = [
    { "@type": "TouristTrip", name: `${a.name} · ${loc}`, description: first?.meta, touristType: ["Families", "Couples"],
      provider: { "@type": "LocalBusiness", name: p.brand, url: `https://${p.domain}`, telephone: p.whatsapp, address: { "@type": "PostalAddress", addressLocality: loc, addressRegion: "Santa Cruz de Tenerife", addressCountry: "ES" } },
      offers: { "@type": "Offer", price: a.price, priceCurrency: "EUR", url: p.bookingUrl, availability: "https://schema.org/InStock" } },
    { "@type": "FAQPage", mainEntity: (first?.faq ?? []).map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2);
}

// --- QA ------------------------------------------------------------------------------------------

export const THIN_WORDS = 160;
const words = (t: string) => t.split(/\s+/).filter(Boolean);
function shingles(t: string): Set<string> {
  const w = words(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ""));
  const s = new Set<string>();
  for (let i = 0; i + 3 <= w.length; i++) s.add(w.slice(i, i + 3).join(" "));
  return s;
}
export function similarity(a: string, b: string): number {
  const A = shingles(a), B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}
export function pricesIn(t: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|EUR|euros?)|€\s?(\d{1,4}(?:[.,]\d{1,2})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) out.push(Number((m[1] ?? m[2]).replace(",", ".")));
  return out;
}

/** Paragraphs shared by 2+ other pages are site boilerplate (booking terms, about us) and are ignored for duplicate checks. */
function uniquePart(body: string, others: string[]): string {
  const paras = body.split(/\n{2,}/);
  return paras.filter((para) => others.filter((o) => o.includes(para.trim())).length < 2).join("\n\n");
}

export function localQa(pg: SitePage, project: Project, others: SitePage[]): Issue[] {
  const issues: Issue[] = [];
  const act = project.activities.find((a) => a.name === pg.activity);
  for (const l of project.langs) if (!pg.content[l]) issues.push({ lang: l, severity: "medium", kind: "missing", text: `No ${LANGS[l]} version yet.` });
  if (!act) issues.push({ severity: "high", kind: "fact", text: `Activity "${pg.activity}" is no longer in the client data.` });
  if (!project.localFacts[pg.location]) issues.push({ severity: "medium", kind: "thin", text: `No unique local fact for ${pg.location}. Ask the client for one; it is what keeps pages from looking mass-produced.` });
  for (const [l, c] of Object.entries(pg.content) as [Lang, PageLang][]) {
    const all = `${c.body}\n${c.faq.map((f) => f.a).join("\n")}\n${c.meta}`;
    if (act) for (const n of pricesIn(all)) if (n !== act.price) issues.push({ lang: l, severity: "high", kind: "price", text: `Mentions ${eur(n)} but the client's price is ${eur(act.price)}.` });
    const wc = words(c.body).length;
    if (wc < THIN_WORDS) issues.push({ lang: l, severity: "medium", kind: "thin", text: `Body has ${wc} words (minimum ${THIN_WORDS}). Add real photos, a local detail or a customer quote.` });
    if (c.title.length > 60) issues.push({ lang: l, severity: "low", kind: "length", text: `Title is ${c.title.length} characters; Google shows about 60.` });
    if (c.meta.length > 155) issues.push({ lang: l, severity: "low", kind: "length", text: `Meta description is ${c.meta.length} characters; keep under 155.` });
    const peers = others.filter((o) => o.id !== pg.id && o.content[l]).map((o) => o.content[l]!.body);
    const mine = uniquePart(c.body, peers);
    for (const o of others) {
      const oc = o.content[l];
      if (!oc || o.id === pg.id) continue;
      const sim = similarity(mine, uniquePart(oc.body, peers.filter((b) => b !== oc.body).concat(c.body)));
      if (sim > 0.7) issues.push({ lang: l, severity: "medium", kind: "duplicate", text: `${Math.round(sim * 100)}% overlap with "${o.activity} · ${o.location}". Rewrite the intro and add location detail.` });
    }
  }
  return issues;
}

export function demoFactCheck(pg: SitePage, project: Project): Issue[] {
  const act = project.activities.find((a) => a.name === pg.activity);
  if (!act) return [];
  const out: Issue[] = [];
  for (const [l, c] of Object.entries(pg.content) as [Lang, PageLang][]) {
    const digits = act.duration.match(/\d+(?:[.,]\d+)?/)?.[0];
    if (digits && !c.body.includes(digits)) out.push({ lang: l, severity: "medium", kind: "fact", text: `Duration "${act.duration}" from the client data is not stated.` });
    if (/hotel pickup|recogida en (el )?hotel|Hotelabholung/i.test(c.body) && !/pickup|recogida/i.test(act.facts)) out.push({ lang: l, severity: "high", kind: "fact", text: "Promises hotel pickup, which is not in the client data." });
  }
  return out;
}

// --- Simulated Search Console and audit -------------------------------------------------------------

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
export function simulateRanks(pages: SitePage[], month: string): RankRow[] {
  return pages.flatMap((pg) => (Object.entries(pg.content) as [Lang, PageLang][]).map(([l, c]) => {
    const h = hash(pg.id + l + month);
    const impressions = 40 + (h % 900);
    const position = Math.round((3 + (h % 380) / 10) * 10) / 10;
    const ctr = position < 5 ? 0.09 : position < 10 ? 0.04 : position < 20 ? 0.012 : 0.003;
    return { path: pagePath(l, c.slug), lang: l, impressions, clicks: Math.round(impressions * ctr), position };
  }));
}

export function demoAudit(a: Pick<Audit, "business" | "activity" | "town" | "site" | "currentLangs">): AuditResult {
  const missingLangs = AUDIT_LANGS.filter((l) => !a.currentLangs.includes(l));
  const act = a.activity.toLowerCase();
  const kw: Record<Lang, string> = {
    es: `${act} ${a.town.toLowerCase()}`, en: `${act} ${a.town.toLowerCase()}`, de: `${act} teneriffa`, nl: `${act} tenerife`,
    it: `${act} tenerife`, sv: `${act} teneriffa`, fr: `${act} tenerife`,
  };
  const demand = AUDIT_LANGS.map((l) => ({ lang: l, keyword: kw[l], monthly: 50 + (hash(a.activity + l + a.town) % 1400) }));
  const score = Math.max(12, 85 - missingLangs.length * 14 - (a.site ? 0 : 20));
  return {
    score, missingLangs, demand,
    quickWins: [
      a.site ? `Your site ${a.site} has pages in ${a.currentLangs.map((l) => l.toUpperCase()).join(", ") || "no detected language"}.` : "No website found: guests can only book you through platforms that charge commission.",
      missingLangs.length ? `No pages in ${missingLangs.map((l) => LANGS[l]).join(", ")}. Those guests search in their own language.` : "All five main languages covered; next step is one page per location.",
      "Add a direct booking and WhatsApp button on every page so guests skip the 20 to 30% platform commission.",
      `Complete your Google Business Profile in ${a.town}: it shows up before your website in month one.`,
    ],
    sampleTitles: Object.fromEntries(AUDIT_LANGS.map((l) => [l, `${WR[l].title(a.activity, a.town)} | ${a.business}`])) as Partial<Record<Lang, string>>,
  };
}

export function demoSummary(project: Project, rows: RankRow[], prev: { clicks: number; impressions: number }): string {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impr = rows.reduce((s, r) => s + r.impressions, 0);
  const top = [...rows].sort((a, b) => b.clicks - a.clicks).slice(0, 3);
  const near = rows.filter((r) => r.position > 8 && r.position <= 15).sort((a, b) => a.position - b.position).slice(0, 3);
  const dc = prev.clicks ? Math.round(((clicks - prev.clicks) / prev.clicks) * 100) : 0;
  return [
    `${project.brand}: ${clicks} clicks from ${impr.toLocaleString("en-GB")} impressions this month (${dc >= 0 ? "+" : ""}${dc}% clicks vs last month).`,
    `Top pages: ${top.map((r) => `${r.path} (${r.clicks} clicks, pos. ${r.position})`).join("; ")}.`,
    near.length ? `Close to page one: ${near.map((r) => `${r.path} at ${r.position}`).join("; ")}. A real photo and a local detail on these is the best next step.` : "No pages sitting just below page one this month.",
    `${pick(["German", "Dutch", "English"], project.id)} pages bring the most impressions; keep that language first when adding pages.`,
    "Search positions move every week and no ranking is guaranteed. These figures come from Search Console, not from bookings.",
  ].join("\n\n");
}
