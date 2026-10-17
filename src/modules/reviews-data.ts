// Plan 1 (Maps & Reviews): record types, collection names and deterministic demo generators.
import { pick } from "../core/ai";
import { LANGS } from "../core/plans";
import type { Client, Lang, Rec } from "../core/types";

export const COL = {
  reviews: "reviews_items",
  posts: "reviews_posts",
  events: "reviews_events",
  audits: "reviews_audits",
  metrics: "reviews_metrics",
  reports: "reviews_reports",
  settings: "reviews_settings",
  menus: "reviews_menus",
} as const;

export type ReviewStatus = "new" | "auto-posted" | "awaiting-owner" | "posted" | "rejected";

export interface Review extends Rec {
  clientId: string;
  reviewer: string;
  rating: number; // 1..5
  text: string;
  date: string; // YYYY-MM-DD
  source: "google" | "pasted" | "manual";
  lang: string; // detected (heuristic on import, AI on draft)
  status: ReviewStatus;
  reply?: string;
  replyEs?: string; // Spanish translation shown to the owner
  sentiment?: "positive" | "mixed" | "negative";
  topics?: string[];
  live?: boolean;
  taskId?: string;
  sentToOwnerAt?: string;
  postedAt?: string;
  rejectReason?: string;
}

export interface Post extends Rec {
  clientId: string;
  month: string; // YYYY-MM
  date: string;
  title: string;
  photo: string;
  event?: string;
  cta: "BOOK" | "CALL" | "LEARN_MORE" | "ORDER" | "SIGN_UP";
  texts: { lang: string; text: string }[];
  status: "draft" | "approved" | "posted";
  live?: boolean;
}

export interface LocalEvent extends Rec {
  date: string;
  name: string;
  town: string;
  note?: string;
}

export interface AuditItem { id: string; label: string; weight: number; ok: boolean; note?: string }
export interface Audit extends Rec {
  venue: string;
  town: string;
  kind: string;
  clientId?: string;
  items: AuditItem[];
  unanswered: number;
  rating: number;
  reviewCount: number;
  score: number;
  sampleReview?: string;
  sampleReplyDe?: string;
  live?: boolean;
}

export interface Metrics extends Rec {
  clientId: string;
  month: string; // YYYY-MM
  searchViews: number;
  mapsViews: number;
  calls: number;
  routes: number;
  webClicks: number;
  bookings?: number;
}

export interface MonthlyReport extends Rec {
  clientId: string;
  month: string;
  summary: string;
  live?: boolean;
  sentAt?: string;
}

export interface ReviewSettings extends Rec {
  clientId: string;
  voice: string;
  signoff: string;
  ownerWhatsapp: string;
  placeId: string;
  reviewUrl: string;
  lastPhotoRefresh?: string;
}

export interface MenuKit extends Rec {
  clientId: string;
  source: string;
  langs: string[];
  out: { lang: string; text: string }[];
  live?: boolean;
}

// ---------- tiers ----------

export const POST_QUOTA: Record<string, number> = { Basic: 4, Plus: 8, Pro: 12 };

export function p1Tier(c?: Client): string | undefined {
  return c?.subs.find((s) => s.plan === "p1")?.tier;
}
export const postQuota = (c?: Client) => POST_QUOTA[p1Tier(c) ?? ""] ?? 4;
export const hasP1 = (c: Client) => c.subs.some((s) => s.plan === "p1");

// ---------- helpers ----------

export const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
export const monthOf = (iso: string) => iso.slice(0, 7);
export const monthLabel = (ym: string) =>
  new Date(ym + "-15T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
export const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 15));
  return d.toISOString().slice(0, 7);
};
export const langName = (l: string) => LANGS[l as Lang] ?? l.toUpperCase();
export const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;

export function defaultSettings(c: Client): Omit<ReviewSettings, "id" | "createdAt"> {
  return {
    clientId: c.id,
    voice: "Warm, short and personal. Family-run, proud of local produce.",
    signoff: `${firstName(c.contact)} · ${c.name}`,
    ownerWhatsapp: c.phone,
    placeId: "",
    reviewUrl: "",
  };
}

const STOP: Record<string, string[]> = {
  en: ["the", "and", "was", "very", "we", "with", "for", "but", "great", "food", "staff", "were", "it", "our", "lovely"],
  de: ["und", "der", "die", "das", "sehr", "war", "wir", "mit", "nicht", "ein", "eine", "essen", "lecker", "ist", "freundlich", "auch"],
  es: ["el", "la", "que", "muy", "con", "los", "las", "comida", "pero", "fue", "una", "por", "todo", "atención", "y"],
  it: ["il", "che", "molto", "con", "non", "era", "abbiamo", "cibo", "gentile", "una", "per", "tutto", "personale", "e", "ottimo"],
  nl: ["het", "een", "en", "zeer", "was", "wij", "we", "niet", "lekker", "eten", "heel", "met", "erg", "goed", "vriendelijk"],
  fr: ["le", "la", "et", "très", "était", "nous", "avec", "pas", "une", "pour", "bon", "les", "accueil", "personnel"],
  sv: ["och", "det", "var", "mycket", "vi", "med", "inte", "en", "mat", "bra", "trevlig", "god", "personal", "jättegod"],
};

/** Cheap stop-word language guess used on import. The AI confirms it when drafting a reply. */
export function guessLang(text: string): string {
  const words = text.toLowerCase().normalize("NFC").split(/[^\p{L}]+/u).filter(Boolean);
  let best = "en", top = 0;
  for (const [l, list] of Object.entries(STOP)) {
    const n = words.filter((w) => list.includes(w)).length;
    if (n > top) { top = n; best = l; }
  }
  return best;
}

/** Parse pasted reviews: blocks separated by blank lines. First line holds name and rating. */
export function parsePasted(raw: string): { reviewer: string; rating: number; text: string }[] {
  return raw
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      const head = lines[0] ?? "";
      const starCount = (head.match(/★/g) ?? []).length;
      const num = head.match(/([1-5])\s*(?:\/\s*5|stars?|estrellas?|sterne|stelle|sterren|★)/i) ?? head.match(/\b([1-5])\b/);
      const rating = starCount || (num ? Number(num[1]) : 5);
      const reviewer = head.replace(/[★☆]/g, "").replace(/([1-5])\s*(\/\s*5|stars?|estrellas?|sterne|stelle|sterren)?/gi, "")
        .replace(/[·|,:\-–]+\s*$/g, "").replace(/^[·|,:\-–\s]+/, "").trim() || "Google user";
      const text = lines.slice(1).join(" ").trim() || head;
      return { reviewer, rating: Math.min(5, Math.max(1, rating)), text };
    });
}

// ---------- demo generators ----------

type Topic = "food" | "service" | "view" | "wildlife" | "wait" | "price" | "noise";
const TOPIC_WORDS: Record<Topic, string[]> = {
  food: ["food", "fish", "seafood", "paella", "tapas", "dish", "essen", "fisch", "comida", "pescado", "cibo", "pesce", "eten", "vis", "mat", "plat", "poisson"],
  service: ["staff", "service", "waiter", "friendly", "personal", "bedienung", "freundlich", "camarero", "atención", "servizio", "gentile", "bediening", "personeel", "accueil"],
  view: ["view", "terrace", "sunset", "aussicht", "terrasse", "vistas", "terraza", "vista", "uitzicht", "terras", "utsikt"],
  wildlife: ["whale", "whales", "dolphin", "dolphins", "wale", "delfine", "ballenas", "delfines", "balene", "delfini", "walvissen", "dolfijnen", "valar"],
  wait: ["wait", "waited", "slow", "warten", "gewartet", "langsam", "esperar", "esperamos", "lento", "attesa", "aspettato", "lang gewacht", "wachten"],
  price: ["price", "expensive", "bill", "teuer", "preis", "rechnung", "caro", "precio", "cuenta", "caro", "conto", "duur", "rekening", "dyrt"],
  noise: ["noise", "noisy", "loud", "laut", "ruido", "rumore", "lawaai"],
};
export function detectTopics(text: string): Topic[] {
  const t = text.toLowerCase();
  return (Object.keys(TOPIC_WORDS) as Topic[]).filter((k) => TOPIC_WORDS[k].some((w) => t.includes(w)));
}

const POS: Record<string, { open: (n: string) => string; topic: Partial<Record<Topic, string>>; generic: string; back: string }> = {
  en: { open: (n) => `Thank you so much, ${n}!`, generic: "We are really glad you enjoyed your time with us.",
    topic: { food: "It means a lot that you loved the food; the fish comes in fresh from the harbour every morning.", service: "We will pass your kind words on to the team, they will be delighted.", view: "That sea view at sunset never gets old for us either.", wildlife: "Seeing the pilot whales up close is special every single time, and we are happy you got to share it." },
    back: "We hope to welcome you back on your next visit to Tenerife." },
  de: { open: (n) => `Vielen herzlichen Dank, ${n}!`, generic: "Es freut uns sehr, dass Sie sich bei uns wohlgefühlt haben.",
    topic: { food: "Schön, dass Ihnen das Essen so gut geschmeckt hat – der Fisch kommt jeden Morgen frisch aus dem Hafen.", service: "Wir geben Ihr Lob gern an das ganze Team weiter.", view: "Den Blick aufs Meer bei Sonnenuntergang genießen wir selbst jeden Tag.", wildlife: "Die Grindwale aus der Nähe zu sehen ist jedes Mal besonders – schön, dass Sie dabei waren." },
    back: "Wir freuen uns, Sie bei Ihrem nächsten Teneriffa-Urlaub wieder begrüßen zu dürfen." },
  es: { open: (n) => `¡Muchísimas gracias, ${n}!`, generic: "Nos alegra mucho que disfrutaras de tu visita.",
    topic: { food: "Nos encanta que te gustara la comida; el pescado llega fresco del puerto cada mañana.", service: "Le pasamos tus palabras al equipo, les hará mucha ilusión.", view: "Las vistas al mar al atardecer también nos siguen enamorando.", wildlife: "Ver a los calderones de cerca es especial cada vez, y nos alegra que lo vivieras con nosotros." },
    back: "¡Te esperamos en tu próxima visita!" },
  it: { open: (n) => `Grazie di cuore, ${n}!`, generic: "Siamo davvero felici che vi siate trovati bene da noi.",
    topic: { food: "Ci fa piacere che il cibo vi sia piaciuto: il pesce arriva fresco dal porto ogni mattina.", service: "Riferiremo i vostri complimenti a tutto lo staff.", view: "Anche per noi la vista sul mare al tramonto è sempre speciale.", wildlife: "Vedere le balene pilota da vicino è emozionante ogni volta, e siamo felici che l'abbiate vissuto con noi." },
    back: "Speriamo di rivedervi presto a Tenerife." },
  nl: { open: (n) => `Heel erg bedankt, ${n}!`, generic: "Fijn om te horen dat jullie het naar je zin hadden.",
    topic: { food: "Leuk dat het eten zo goed smaakte; de vis komt elke ochtend vers uit de haven.", service: "We geven jullie mooie woorden graag door aan het team.", view: "Ook wij worden nooit moe van het uitzicht op zee bij zonsondergang.", wildlife: "De grienden van dichtbij zien blijft elke keer bijzonder, mooi dat jullie erbij waren." },
    back: "Hopelijk tot een volgende keer op Tenerife!" },
  fr: { open: (n) => `Merci beaucoup, ${n} !`, generic: "Nous sommes ravis que vous ayez passé un bon moment chez nous.",
    topic: { food: "Ravis que la cuisine vous ait plu : le poisson arrive frais du port chaque matin.", service: "Nous transmettrons vos compliments à toute l'équipe.", view: "La vue sur la mer au coucher du soleil nous émerveille aussi chaque jour.", wildlife: "Voir les globicéphales de près est toujours magique, merci de l'avoir partagé avec nous." },
    back: "Au plaisir de vous revoir lors de votre prochain séjour à Tenerife." },
  sv: { open: (n) => `Tack så mycket, ${n}!`, generic: "Vad roligt att ni trivdes hos oss.",
    topic: { food: "Kul att maten smakade, fisken kommer färsk från hamnen varje morgon.", service: "Vi hälsar till hela teamet, de blir glada." },
    back: "Välkomna tillbaka nästa gång ni är på Teneriffa!" },
};

const NEG: Record<string, { open: (n: string) => string; topic: Partial<Record<Topic, string>>; generic: string; contact: (p: string) => string }> = {
  en: { open: (n) => `${n}, thank you for telling us, and we are sorry your visit fell short.`, generic: "This is not the experience we want for any guest.",
    topic: { wait: "You are right that the wait was far too long, and we are looking at exactly what went wrong that day.", price: "We understand the bill felt high, and we will make sure prices and portion sizes are clear on the menu.", food: "We are sorry the dish was not up to our usual standard, and the kitchen has been told.", service: "We have spoken with the team about how you were treated.", noise: "We hear you on the noise and are looking at the terrace layout." },
    contact: (p) => `If you are willing, please call us on ${p} so we can make it right.` },
  de: { open: (n) => `${n}, danke für Ihre offene Rückmeldung – es tut uns leid, dass Ihr Besuch nicht gut war.`, generic: "So einen Abend wünschen wir keinem Gast.",
    topic: { wait: "Sie haben recht, die Wartezeit war viel zu lang, und wir schauen uns genau an, was an diesem Tag schiefgelaufen ist.", price: "Wir verstehen, dass die Rechnung hoch wirkte, und machen Preise und Portionen in der Karte klarer.", food: "Es tut uns leid, dass das Gericht nicht unserem Standard entsprach; die Küche ist informiert.", service: "Wir haben mit dem Team über den Service gesprochen.", noise: "Den Lärm nehmen wir ernst und prüfen die Aufteilung der Terrasse." },
    contact: (p) => `Wenn Sie mögen, rufen Sie uns unter ${p} an, damit wir das wiedergutmachen können.` },
  es: { open: (n) => `${n}, gracias por contárnoslo y sentimos que la visita no estuviera a la altura.`, generic: "No es la experiencia que queremos para nadie.",
    topic: { wait: "Tienes razón, la espera fue demasiado larga y estamos revisando qué falló ese día.", price: "Entendemos que la cuenta te pareciera alta y vamos a dejar más claros precios y raciones en la carta.", food: "Sentimos que el plato no estuviera a nuestro nivel; ya lo hemos hablado en cocina.", service: "Hemos hablado con el equipo sobre el trato que recibiste.", noise: "Tomamos nota del ruido y estamos revisando la terraza." },
    contact: (p) => `Si te parece, llámanos al ${p} y lo hablamos.` },
  it: { open: (n) => `${n}, grazie per il feedback e ci dispiace che la visita non sia andata bene.`, generic: "Non è l'esperienza che vogliamo offrire.",
    topic: { wait: "Ha ragione, l'attesa è stata davvero troppo lunga e stiamo verificando cosa non ha funzionato quel giorno.", price: "Capiamo che il conto sia sembrato alto: renderemo più chiari prezzi e porzioni nel menù.", food: "Ci dispiace che il piatto non fosse al nostro livello; la cucina è stata informata.", service: "Abbiamo parlato con lo staff del servizio ricevuto.", noise: "Prendiamo nota del rumore e stiamo rivedendo la terrazza." },
    contact: (p) => `Se vuole, ci chiami al ${p} così possiamo rimediare.` },
  nl: { open: (n) => `${n}, bedankt voor je eerlijke reactie en sorry dat het bezoek tegenviel.`, generic: "Dit is niet de ervaring die we onze gasten willen geven.",
    topic: { wait: "Je hebt gelijk, het wachten duurde veel te lang en we zoeken uit wat er die dag misging.", price: "We begrijpen dat de rekening hoog voelde en maken prijzen en porties duidelijker op de kaart.", food: "Sorry dat het gerecht niet op ons gewone niveau was; de keuken weet ervan.", service: "We hebben met het team gesproken over de bediening.", noise: "We nemen het lawaai serieus en kijken naar de indeling van het terras." },
    contact: (p) => `Bel ons gerust op ${p}, dan maken we het goed.` },
  fr: { open: (n) => `${n}, merci pour votre retour, et désolés que votre visite ait déçu.`, generic: "Ce n'est pas l'expérience que nous voulons offrir.",
    topic: { wait: "Vous avez raison, l'attente était bien trop longue et nous cherchons ce qui n'a pas fonctionné ce jour-là.", price: "Nous comprenons que l'addition ait paru élevée et allons clarifier prix et portions sur la carte.", food: "Désolés que le plat n'ait pas été à la hauteur ; la cuisine est prévenue.", service: "Nous avons parlé du service avec l'équipe.", noise: "Nous prenons note du bruit et revoyons l'aménagement de la terrasse." },
    contact: (p) => `Si vous le souhaitez, appelez-nous au ${p} pour en parler.` },
  sv: { open: (n) => `${n}, tack för att du berättar, och förlåt att besöket inte blev bra.`, generic: "Det är inte den upplevelse vi vill ge.",
    topic: { wait: "Du har rätt, väntetiden var alldeles för lång och vi ser över vad som gick fel den dagen." },
    contact: (p) => `Ring oss gärna på ${p} så rättar vi till det.` },
};

const POS_ORDER: Topic[] = ["wildlife", "food", "view", "service"];
const NEG_ORDER: Topic[] = ["wait", "price", "noise", "service", "food"];

export interface ReplyDraft { lang: string; langName: string; sentiment: "positive" | "mixed" | "negative"; topics: string[]; reply: string; replyEs: string }

export function demoReply(r: Pick<Review, "reviewer" | "rating" | "text" | "lang">, c: Client | undefined, s: Pick<ReviewSettings, "signoff">): ReplyDraft {
  const lang = POS[r.lang] ? r.lang : guessLang(r.text);
  const topics = detectTopics(r.text);
  const name = firstName(r.reviewer);
  const build = (l: string) => {
    if (r.rating >= 4) {
      const t = POS[l] ?? POS.en;
      const tp = POS_ORDER.filter((k) => topics.includes(k)).map((k) => t.topic[k]).find(Boolean) ?? t.generic;
      return `${t.open(name)} ${tp} ${t.back}\n\n${s.signoff}`;
    }
    const t = NEG[l] ?? NEG.en;
    const tp = NEG_ORDER.filter((k) => topics.includes(k)).map((k) => t.topic[k]).find(Boolean) ?? t.generic;
    return `${t.open(name)} ${tp} ${t.contact(c?.phone ?? "")}\n\n${s.signoff}`;
  };
  return {
    lang, langName: langName(lang),
    sentiment: r.rating >= 4 ? "positive" : r.rating === 3 ? "mixed" : "negative",
    topics, reply: build(lang), replyEs: build("es"),
  };
}

export function replyPrompt(r: Review, c: Client | undefined, s: Pick<ReviewSettings, "voice" | "signoff">): string {
  return [
    `You manage the Google Business Profile of "${c?.name}", a ${c?.kind} in ${c?.town}, Tenerife.`,
    `Brand voice: ${s.voice}`,
    `Sign off exactly as: "${s.signoff}"`,
    c?.notes ? `Facts you may use: ${c.notes}` : "",
    `A customer left this ${r.rating}-star Google review.`,
    `Reviewer: ${r.reviewer}`,
    `Review: """${r.text}"""`,
    "",
    "1. Detect the language of the review (ISO 639-1 code).",
    "2. Write the public reply in THAT SAME language: 40 to 90 words, natural and native, specific to what they said, no emoji, no generic filler.",
    "   Never offer discounts, refunds or free items. Never argue or blame the guest. Never invent facts that are not given above.",
    `   For 1 to 3 stars: apologise once, acknowledge the specific problem, say what changes if the facts allow, and invite them to call ${c?.phone}.`,
    "3. Translate your reply into Spanish so the owner can read it.",
    'Return JSON: {"lang":"de","langName":"German","sentiment":"positive|mixed|negative","topics":["food","wait"],"reply":"...","replyEs":"..."}',
  ].filter(Boolean).join("\n");
}

// ---------- posts ----------

const CTA_BY_KIND = (kind: string): Post["cta"] => (/boat|excursion|dive|surf|tour/i.test(kind) ? "BOOK" : /restaurant|bar|tasca/i.test(kind) ? "CALL" : "LEARN_MORE");

type Pool = Record<string, string[]>;
const FOOD: Pool = {
  es: ["Pescado del día recién llegado del muelle, a la plancha con papas arrugadas y mojo.", "Atardecer en la terraza con un vino blanco de Tenerife. Quedan mesas para esta semana.", "Nuestras croquetas de cherne, hechas a mano cada mañana.", "Pulpo a la gallega y gambas al ajillo para compartir frente al mar."],
  en: ["Catch of the day straight from the harbour, grilled and served with Canarian wrinkled potatoes and mojo.", "Sunset on the terrace with a glass of Tenerife white wine. A few tables left this week.", "Our cherne croquettes, made by hand every morning.", "Octopus and garlic prawns to share, right on the seafront."],
  de: ["Fang des Tages direkt aus dem Hafen, gegrillt mit kanarischen Runzelkartoffeln und Mojo.", "Sonnenuntergang auf der Terrasse mit einem Weißwein aus Teneriffa. Diese Woche sind noch Tische frei.", "Unsere Cherne-Kroketten, jeden Morgen von Hand gemacht.", "Pulpo und Knoblauchgarnelen zum Teilen, direkt am Meer."],
  it: ["Il pescato del giorno appena arrivato dal porto, alla griglia con papas arrugadas e mojo.", "Tramonto in terrazza con un bianco di Tenerife. Restano pochi tavoli questa settimana.", "Le nostre crocchette di cernia, fatte a mano ogni mattina.", "Polpo e gamberi all'aglio da condividere, davanti al mare."],
  nl: ["Vangst van de dag, vers uit de haven, gegrild met Canarische gerimpelde aardappeltjes en mojo.", "Zonsondergang op het terras met een witte wijn uit Tenerife. Deze week nog een paar tafels vrij.", "Onze cherne-kroketten, elke ochtend met de hand gemaakt.", "Octopus en knoflookgarnalen om te delen, direct aan zee."],
  fr: ["La pêche du jour tout droit du port, grillée avec des papas arrugadas et du mojo.", "Coucher de soleil en terrasse avec un vin blanc de Tenerife. Quelques tables encore libres cette semaine.", "Nos croquettes de mérou, faites main chaque matin.", "Poulpe et crevettes à l'ail à partager, face à la mer."],
  sv: ["Dagens fångst direkt från hamnen, grillad med skrynklig potatis och mojo.", "Solnedgång på terrassen med ett vitt vin från Teneriffa.", "Våra krokettar, handgjorda varje morgon.", "Bläckfisk och vitlöksräkor att dela, vid havet."],
};
const TRIP: Pool = {
  es: ["Calderones a pocos metros esta mañana. Salidas a las 10:00 y 14:00 desde el puerto.", "Grupo de delfines mulares acompañando el barco. Recogida en hotel en el sur.", "Baño en la bahía con agua a 23 °C. Quedan plazas para el fin de semana.", "Nuestra tripulación local conoce cada rincón de la costa."],
  en: ["Pilot whales just metres away this morning. Trips at 10:00 and 14:00 from the harbour.", "A pod of bottlenose dolphins riding alongside the boat. Hotel pickup in the south.", "Swim stop in the bay with the water at 23 °C. A few seats left for the weekend.", "Our local crew knows every cove on this coast."],
  de: ["Heute Morgen Grindwale nur wenige Meter entfernt. Ausfahrten um 10:00 und 14:00 Uhr ab Hafen.", "Große Tümmler begleiten das Boot. Hotelabholung im Süden.", "Badestopp in der Bucht bei 23 °C Wassertemperatur. Fürs Wochenende sind noch Plätze frei.", "Unsere einheimische Crew kennt jede Bucht dieser Küste."],
  it: ["Balene pilota a pochi metri stamattina. Uscite alle 10:00 e alle 14:00 dal porto.", "Un gruppo di tursiopi accanto alla barca. Ritiro in hotel nel sud.", "Bagno nella baia con l'acqua a 23 °C. Ultimi posti per il fine settimana.", "Il nostro equipaggio locale conosce ogni caletta della costa."],
  nl: ["Vanochtend grienden op een paar meter afstand. Vertrek om 10:00 en 14:00 uur vanuit de haven.", "Tuimelaars zwemmen mee met de boot. Ophalen bij je hotel in het zuiden.", "Zwemstop in de baai bij 23 °C. Nog een paar plekken voor het weekend.", "Onze lokale bemanning kent elke baai langs deze kust."],
  fr: ["Des globicéphales à quelques mètres ce matin. Départs à 10h et 14h depuis le port.", "Un groupe de grands dauphins le long du bateau. Prise en charge à l'hôtel dans le sud.", "Baignade dans la baie, eau à 23 °C. Encore quelques places ce week-end.", "Notre équipage local connaît chaque crique de la côte."],
  sv: ["Grindvalar bara några meter bort i morse. Turer 10:00 och 14:00.", "Delfiner simmade bredvid båten.", "Badstopp i viken, vattnet håller 23 °C.", "Vår lokala besättning känner varje vik."],
};
const EVENT_LINE: Record<string, (e: string) => string> = {
  es: (e) => `Especial ${e}.`, en: (e) => `Join us for ${e}.`, de: (e) => `Feiern Sie mit uns: ${e}.`, it: (e) => `Festeggia con noi: ${e}.`,
  nl: (e) => `Vier met ons mee: ${e}.`, fr: (e) => `Fêtez avec nous : ${e}.`, sv: (e) => `Fira med oss: ${e}.`,
};
const isTrip = (kind: string) => /boat|excursion|dive|surf|tour|trip/i.test(kind);
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Spread n dates across a month, skipping Mondays when possible. */
export function spreadDates(month: string, n: number): string[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let d = Math.min(days, Math.max(1, Math.round(((i + 0.5) * days) / n)));
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1 && d < days) d++;
    out.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

export interface PostDraft { date: string; title: string; photo: string; event?: string; cta: Post["cta"]; texts: { lang: string; text: string }[] }

export function demoPosts(c: Client, month: string, photos: string[], events: LocalEvent[], langs: string[], n: number): PostDraft[] {
  const dates = spreadDates(month, n);
  const evs = events.filter((e) => e.date.startsWith(month));
  const pool = isTrip(c.kind) ? TRIP : FOOD;
  const used = new Set<string>();
  return dates.map((date, i) => {
    const ev = evs.find((e) => !used.has(e.id) && Math.abs(Number(e.date.slice(8)) - Number(date.slice(8))) <= 4);
    if (ev) used.add(ev.id);
    const photo = photos.length ? photos[i % photos.length] : pick(["Terrace at sunset", "Today's catch on ice", "The team at work"], c.id + i);
    const text = (l: string) => {
      const base = (pool[l] ?? pool.en)[i % 4];
      return ev ? `${(EVENT_LINE[l] ?? EVENT_LINE.en)(ev.name)} ${base}` : base;
    };
    return {
      date: ev ? ev.date : date,
      title: ev ? ev.name : cap(photo.split(/[,.;]/)[0]).slice(0, 48),
      photo,
      event: ev?.name,
      cta: CTA_BY_KIND(c.kind),
      texts: ["es", ...langs.filter((l) => l !== "es")].map((l) => ({ lang: l, text: text(l) })),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}
