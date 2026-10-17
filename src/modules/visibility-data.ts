// Plan 8 (AI Visibility / CiteRank): types, tiers, scoring, the deterministic engine simulator and helpers.
import { pick } from "../core/ai";
import { LANGS } from "../core/plans";
import type { Client, Lang, Rec } from "../core/types";

export const VCOL = {
  settings: "visibility_settings",
  questions: "visibility_questions",
  checks: "visibility_checks",
  fixes: "visibility_fixes",
  walkins: "visibility_walkins",
  spot: "visibility_spotchecks",
} as const;

export type Engine = "chatgpt" | "gemini" | "perplexity" | "claude" | "aio";
export const ENGINES: { id: Engine; label: string; api: string }[] = [
  { id: "chatgpt", label: "ChatGPT", api: "OpenAI API key (search-enabled model)" },
  { id: "gemini", label: "Gemini", api: "Google Gemini API key" },
  { id: "perplexity", label: "Perplexity", api: "Perplexity API key" },
  { id: "claude", label: "Claude", api: "Live through this app when AI is on" },
  { id: "aio", label: "Google AI Overviews", api: "SERP API such as DataForSEO" },
];
export const engineLabel = (e: Engine) => ENGINES.find((x) => x.id === e)?.label ?? e;
export const RUNS = 3;

export type TierName = "Add-on" | "Check" | "Grow" | "Pro";
export interface TierSpec { price: number; questions: number; languages: number; competitors: number; cadence: "monthly" | "weekly"; fixPack: boolean; replies: boolean; schema: boolean; detail: string }
export const TIERS: Record<TierName, TierSpec> = {
  "Add-on": { price: 39, questions: 15, languages: 2, competitors: 3, cadence: "monthly", fixPack: false, replies: false, schema: false, detail: "Monthly tracking added to Maps & Reviews" },
  Check: { price: 49, questions: 15, languages: 2, competitors: 3, cadence: "monthly", fixPack: false, replies: false, schema: false, detail: "15 questions, 2 languages, monthly report against 3 competitors" },
  Grow: { price: 99, questions: 30, languages: 4, competitors: 3, cadence: "monthly", fixPack: true, replies: false, schema: false, detail: "30 questions, 4 languages, monthly fix pack: profile updates, multilingual FAQ, directory cleanup" },
  Pro: { price: 149, questions: 50, languages: 5, competitors: 5, cadence: "weekly", fixPack: true, replies: true, schema: true, detail: "50 questions, 5 languages, weekly tracking, drafted review replies, menu schema" },
};
export const ONE_OFF = 49;

export interface VisSettings extends Rec {
  clientId: string;
  tier: TierName;
  competitors: string[];
  languages: Lang[];
  aliases: string[];
  listedOn: string[]; // source domains where the client already has a listing
  menu: string; // "Section | Dish | 14.50 | description" lines, for schema
  website: string;
}

export interface Question extends Rec { clientId: string; text: string; lang: Lang; active: boolean }

export interface RunResult { named: string[]; sources: string[] }
export interface QResult { questionId: string; question: string; lang: Lang; engine: Engine; runs: RunResult[]; simulated: boolean }
export interface Check extends Rec { clientId: string; date: string; brands: string[]; results: QResult[]; live: boolean; strength?: number }

export interface FixItem { id: string; kind: "profile" | "faq" | "directory" | "review" | "schema"; title: string; detail: string; lang?: string; done: boolean }
export interface FixPack extends Rec { clientId: string; checkId?: string; summary: string; items: FixItem[]; live: boolean }

export interface WalkinLang { lang: Lang; question: string; places: { name: string; why: string }[]; mentioned: boolean; live: boolean; sim: { engine: Engine; mentioned: boolean }[] }
export interface Walkin extends Rec { venue: string; town: string; category: string; results: WalkinLang[]; live: boolean; leadClientId?: string }

export interface SpotCheck extends Rec { clientId: string; date: string; engine: Engine; question: string; lang: Lang; named: boolean; note?: string }

// ---------- tier ----------

export function tierOf(c?: Client): TierName {
  const t = c?.subs.find((s) => s.plan === "p8")?.tier;
  return t && t in TIERS ? (t as TierName) : "Check";
}

export function defaultVisSettings(c: Client): Omit<VisSettings, "id" | "createdAt"> {
  const tier = tierOf(c);
  return { clientId: c.id, tier, competitors: [], languages: c.languages.filter((l) => l !== "es").slice(0, TIERS[tier].languages) as Lang[], aliases: [], listedOn: [], menu: "", website: "" };
}

// ---------- matching and scoring ----------

const FILLER = new Set(["restaurante", "restaurant", "bar", "the", "el", "la", "los", "las", "de", "del", "cafe", "café", "tasca", "centre", "center", "centro", "school", "escuela"]);
export function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/).filter((w) => w && !FILLER.has(w)).join(" ");
}
const normFull = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Does a place name in an AI answer refer to this brand? Single generic words ("Puerto") never match on their own. */
export function matches(name: string, brand: string, aliases: string[] = []): boolean {
  const nf = normFull(name), nn = norm(name);
  if (nf.length < 4) return false;
  const words = (s: string) => s.split(" ").filter(Boolean).length;
  return [brand, ...aliases].some((b) => {
    const core = norm(b), full = normFull(b);
    if (core && (words(core) >= 2 || core.length >= 8)) {
      if (nn.includes(core) || (words(nn) >= 2 && core.includes(nn))) return true;
    }
    return !!full && (nf.includes(full) || (words(nf) >= 2 && full.includes(nf)));
  });
}

export interface Voice { brand: string; mentions: number; rate: number; share: number; isClient: boolean }
export function shareOfVoice(check: Check | undefined, client: string, competitors: string[], aliases: string[] = []): Voice[] {
  if (!check) return [];
  const brands = [client, ...competitors];
  const runs = check.results.flatMap((r) => r.runs);
  const total = runs.length || 1;
  const counts = brands.map((b, i) => runs.filter((run) => run.named.some((n) => matches(n, b, i === 0 ? aliases : []))).length);
  const sum = counts.reduce((a, b) => a + b, 0) || 1;
  return brands.map((b, i) => ({ brand: b, mentions: counts[i], rate: counts[i] / total, share: counts[i] / sum, isClient: i === 0 }));
}

export function engineRate(check: Check, engine: Engine, brand: string, aliases: string[]): { rate: number; simulated: boolean; top: string } {
  const rs = check.results.filter((r) => r.engine === engine);
  const runs = rs.flatMap((r) => r.runs);
  const hit = runs.filter((run) => run.named.some((n) => matches(n, brand, aliases))).length;
  const tally = new Map<string, number>();
  runs.forEach((run) => run.named.forEach((n) => tally.set(n, (tally.get(n) ?? 0) + 1)));
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "–";
  return { rate: runs.length ? hit / runs.length : 0, simulated: rs.every((r) => r.simulated), top };
}

export function sourceTally(check: Check | undefined): { source: string; count: number; engines: Engine[]; langs: Lang[] }[] {
  if (!check) return [];
  const m = new Map<string, { count: number; engines: Set<Engine>; langs: Set<Lang> }>();
  for (const r of check.results)
    for (const run of r.runs)
      for (const s of run.sources) {
        const k = s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
        const e = m.get(k) ?? { count: 0, engines: new Set(), langs: new Set() };
        e.count++; e.engines.add(r.engine); e.langs.add(r.lang); m.set(k, e);
      }
  return [...m.entries()].map(([source, v]) => ({ source, count: v.count, engines: [...v.engines], langs: [...v.langs] })).sort((a, b) => b.count - a.count);
}

// ---------- simulator ----------

function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed: string) {
  let a = hash(seed);
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const SOURCES: Record<string, string[]> = {
  en: ["tripadvisor.com", "google.com/maps", "reddit.com/r/tenerife", "thefork.com", "lonelyplanet.com", "webtenerife.com", "timeout.com"],
  de: ["tripadvisor.de", "holidaycheck.de", "google.com/maps", "webtenerife.com", "reisereporter.de", "thefork.de"],
  nl: ["tripadvisor.nl", "zoover.nl", "google.com/maps", "webtenerife.com", "thefork.nl"],
  it: ["tripadvisor.it", "google.com/maps", "thefork.it", "webtenerife.com"],
  es: ["tripadvisor.es", "eltenedor.es", "google.com/maps", "webtenerife.com", "guiarepsol.com"],
  fr: ["tripadvisor.fr", "google.com/maps", "petitfute.com", "thefork.fr"],
  sv: ["tripadvisor.se", "google.com/maps", "webtenerife.com"],
};

export const OTHERS: Record<string, string[]> = {
  food: ["Mesón Los Arcos", "Casa del Mar", "Taberna Atlántica", "El Faro Azul", "La Cofradía", "Pescados Playa Vista", "La Brasa del Muelle"],
  tapas: ["Bodeguita La Tapa", "Bar El Rincón", "Tasca La Abuela", "Gastrobar Lava", "El Guanche"],
  pizza: ["Pizzería Da Marco", "Trattoria Il Porto", "Pizza Napoli Tenerife", "La Piazzetta"],
  sea: ["Blue Ocean Tenerife", "Mar Abierto Excursions", "Ocean Spirit Tours", "Atlantic Divers", "Volcano Dive Centre", "Surf Point Tenerife"],
  any: ["Casa Canaria", "El Patio", "La Terraza", "Los Abuelos", "Rincón Canario"],
};
export function poolFor(category: string): string[] {
  const c = category.toLowerCase();
  if (/tapa|bar|wine|vino/.test(c)) return OTHERS.tapas;
  if (/pizz|ital/.test(c)) return OTHERS.pizza;
  if (/dive|buceo|surf|whale|ballena|boat|barco|excursion|kayak|tour/.test(c)) return OTHERS.sea;
  if (/fish|sea|marisc|pesc|restaurant|food|canar|grill/.test(c)) return OTHERS.food;
  return OTHERS.any;
}

/** Deterministic stand-in for an engine answer until API keys are added. */
export function simulateRun(seed: string, client: string, competitors: string[], others: string[], strength: number, lang: string, engine: Engine): RunResult {
  const r = rng(seed);
  const named: string[] = [];
  const engineBias: Record<Engine, number> = { chatgpt: 1, gemini: 0.9, perplexity: 1.15, claude: 0.85, aio: 1.05 };
  if (r() < strength * engineBias[engine]) named.push(client);
  competitors.forEach((c, i) => { if (r() < 0.62 - i * 0.12) named.push(c); });
  const pool = [...others].sort(() => r() - 0.5);
  while (named.length < 3 + Math.floor(r() * 3) && pool.length) named.push(pool.pop()!);
  named.sort(() => r() - 0.5);
  const srcPool = [...(SOURCES[lang] ?? SOURCES.en)];
  const sources = engine === "aio" ? ["google.com/maps", srcPool[0]] : srcPool.sort(() => r() - 0.5).slice(0, 2 + Math.floor(r() * 3));
  return { named, sources };
}

export function simulateCheck(clientId: string, client: string, competitors: string[], others: string[], questions: Question[], date: string, strength: number, engines: Engine[]): QResult[] {
  return questions.flatMap((q) => engines.map((engine) => ({
    questionId: q.id, question: q.text, lang: q.lang, engine, simulated: true,
    runs: Array.from({ length: RUNS }, (_, i) => simulateRun(`${clientId}|${q.id}|${engine}|${date}|${i}`, client, competitors, others, strength, q.lang, engine)),
  })));
}

/** Strength of the simulated signal grows slowly with fixes applied (never a promise, only a stand-in). */
export const simStrength = (fixesDone: number) => Math.min(0.55, 0.14 + fixesDone * 0.035);

// ---------- languages and templates ----------

export const langName = (l: string) => LANGS[l as Lang] ?? l.toUpperCase();

const CAT: Record<string, Partial<Record<Lang, string>>> = {
  seafood: { en: "seafood restaurant", de: "Fischrestaurant", es: "marisquería", nl: "visrestaurant", it: "ristorante di pesce", fr: "restaurant de fruits de mer", sv: "fiskrestaurang" },
  tapas: { en: "tapas bar", de: "Tapas-Bar", es: "bar de tapas", nl: "tapasbar", it: "bar di tapas", fr: "bar à tapas", sv: "tapasbar" },
  pizza: { en: "pizzeria", de: "Pizzeria", es: "pizzería", nl: "pizzeria", it: "pizzeria", fr: "pizzeria", sv: "pizzeria" },
  whale: { en: "whale watching trip", de: "Walbeobachtung", es: "excursión para ver ballenas", nl: "walvissen spotten", it: "escursione per vedere le balene", fr: "sortie d'observation des baleines", sv: "valsafari" },
  dive: { en: "dive centre", de: "Tauchschule", es: "centro de buceo", nl: "duikschool", it: "centro immersioni", fr: "club de plongée", sv: "dykcenter" },
  surf: { en: "surf school", de: "Surfschule", es: "escuela de surf", nl: "surfschool", it: "scuola di surf", fr: "école de surf", sv: "surfskola" },
  restaurant: { en: "restaurant", de: "Restaurant", es: "restaurante", nl: "restaurant", it: "ristorante", fr: "restaurant", sv: "restaurang" },
};
export function catWord(category: string, lang: Lang): string {
  const c = category.toLowerCase();
  const key = /fish|sea|marisc|pesc/.test(c) ? "seafood" : /tapa/.test(c) ? "tapas" : /pizz/.test(c) ? "pizza" : /whale|ballena|boat/.test(c) ? "whale"
    : /dive|buceo/.test(c) ? "dive" : /surf/.test(c) ? "surf" : /restaurant/.test(c) ? "restaurant" : "";
  return (key && CAT[key][lang]) || category;
}

const ASK: Record<Lang, ((cat: string, town: string) => string)[]> = {
  en: [(c, t) => `What is the best ${c} in ${t}?`, (c, t) => `Where should I go for a ${c} in ${t}?`, (c, t) => `${c} in ${t} with good reviews`, (c, t) => `family-friendly ${c} near ${t}`, (c, t) => `${c} in ${t} with a sea view`],
  de: [(c, t) => `Was ist das beste ${c} in ${t}?`, (c, t) => `Welches ${c} in ${t} könnt ihr empfehlen?`, (c, t) => `${c} ${t} Empfehlung`, (c, t) => `${c} in ${t} mit Meerblick`, (c, t) => `familienfreundlich ${c} ${t}`],
  es: [(c, t) => `¿Cuál es la mejor ${c} en ${t}?`, (c, t) => `${c} recomendada en ${t}`, (c, t) => `dónde ir a una ${c} en ${t}`, (c, t) => `${c} con vistas al mar en ${t}`],
  nl: [(c, t) => `Wat is het beste ${c} in ${t}?`, (c, t) => `Welk ${c} in ${t} raden jullie aan?`, (c, t) => `${c} ${t} tips`, (c, t) => `${c} in ${t} met uitzicht op zee`],
  it: [(c, t) => `Qual è il miglior ${c} a ${t}?`, (c, t) => `${c} consigliato a ${t}`, (c, t) => `${c} a ${t} con vista mare`],
  fr: [(c, t) => `Quel est le meilleur ${c} à ${t} ?`, (c, t) => `${c} recommandé à ${t}`, (c, t) => `${c} à ${t} avec vue sur la mer`],
  sv: [(c, t) => `Vilken är den bästa ${c} i ${t}?`, (c, t) => `${c} i ${t} tips`],
};
export function askIn(lang: Lang, category: string, town: string, i = 0): string {
  const list = ASK[lang] ?? ASK.en;
  return list[i % list.length](catWord(category, lang), town);
}

export function demoWalkinPlaces(venue: string, town: string, category: string, lang: Lang): { name: string; why: string }[] {
  const r = rng(`${venue}|${town}|${lang}`);
  const pool = [...poolFor(category)].sort(() => r() - 0.5);
  const why: Record<string, string[]> = {
    en: ["Locals rate the fresh fish highly", "Popular for its terrace and sunset views", "Consistently strong reviews for service", "Good value and a classic local menu"],
    de: ["Sehr gute Bewertungen für frischen Fisch", "Beliebt wegen der Terrasse am Meer", "Freundlicher Service, oft empfohlen", "Gutes Preis-Leistungs-Verhältnis"],
    nl: ["Goede reviews voor verse vis", "Populair om het terras aan zee", "Vriendelijke bediening, vaak aangeraden", "Goede prijs-kwaliteitverhouding"],
    es: ["Muy valorado por el pescado fresco", "Conocido por su terraza frente al mar", "Buenas reseñas por la atención", "Buena relación calidad-precio"],
    it: ["Molto apprezzato per il pesce fresco", "Famoso per la terrazza sul mare", "Servizio cordiale e recensioni ottime"],
    fr: ["Très apprécié pour le poisson frais", "Connu pour sa terrasse face à la mer", "Service souvent salué"],
    sv: ["Omtyckt för färsk fisk", "Populär terrass vid havet"],
  };
  const named = pool.slice(0, 3 + Math.floor(r() * 2));
  if (r() < 0.22 + (hash(venue) % 10) / 100) named.splice(1 + Math.floor(r() * 2), 0, venue);
  return named.slice(0, 5).map((name, i) => ({ name, why: pick(why[lang] ?? why.en, name + i) }));
}

// ---------- FAQ and schema ----------

export function demoFaq(c: Client, lang: Lang): { q: string; a: string }[] {
  const langs = c.languages.map(langName).join(", ");
  const T: Partial<Record<Lang, { q: string; a: string }[]>> = {
    en: [{ q: `Where is ${c.name}?`, a: `We are in ${c.town}, Tenerife. Search "${c.name}" on Google Maps for directions.` }, { q: "How do I book?", a: `Call or WhatsApp us on ${c.phone}.` }, { q: "Which languages do you speak?", a: `Our team speaks ${langs}.` }],
    de: [{ q: `Wo finde ich ${c.name}?`, a: `Wir sind in ${c.town}, Teneriffa. Suchen Sie „${c.name}“ in Google Maps für die Route.` }, { q: "Wie kann ich reservieren?", a: `Rufen Sie uns an oder schreiben Sie per WhatsApp an ${c.phone}.` }, { q: "Welche Sprachen sprechen Sie?", a: `Unser Team spricht ${langs}.` }],
    es: [{ q: `¿Dónde está ${c.name}?`, a: `Estamos en ${c.town}, Tenerife. Busca "${c.name}" en Google Maps para llegar.` }, { q: "¿Cómo reservo?", a: `Llámanos o escríbenos por WhatsApp al ${c.phone}.` }, { q: "¿Qué idiomas habláis?", a: `Nuestro equipo habla ${langs}.` }],
    nl: [{ q: `Waar is ${c.name}?`, a: `We zitten in ${c.town}, Tenerife. Zoek "${c.name}" op Google Maps voor de route.` }, { q: "Hoe kan ik reserveren?", a: `Bel of WhatsApp ons op ${c.phone}.` }, { q: "Welke talen spreken jullie?", a: `Ons team spreekt ${langs}.` }],
    it: [{ q: `Dove si trova ${c.name}?`, a: `Siamo a ${c.town}, Tenerife. Cercate "${c.name}" su Google Maps.` }, { q: "Come si prenota?", a: `Chiamateci o scriveteci su WhatsApp al ${c.phone}.` }, { q: "Che lingue parlate?", a: `Il nostro team parla ${langs}.` }],
    fr: [{ q: `Où se trouve ${c.name} ?`, a: `Nous sommes à ${c.town}, Tenerife. Cherchez « ${c.name} » sur Google Maps.` }, { q: "Comment réserver ?", a: `Appelez-nous ou écrivez sur WhatsApp au ${c.phone}.` }, { q: "Quelles langues parlez-vous ?", a: `Notre équipe parle ${langs}.` }],
  };
  return T[lang] ?? T.en!;
}

export interface MenuLine { section: string; name: string; price: string; description: string }
export function parseMenu(raw: string): MenuLine[] {
  return raw.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p.length >= 2 && p[1])
    .map(([section, name, price = "", description = ""]) => ({ section: section || "Carta", name, price: price.replace(",", ".").replace(/[^\d.]/g, ""), description }));
}

/** schema.org Restaurant + Menu JSON-LD built from the client's own data (no AI, nothing invented). */
export function menuSchema(c: Client, website: string, raw: string, langs: string[]): string {
  const lines = parseMenu(raw);
  const sections = [...new Set(lines.map((l) => l.section))];
  const data = {
    "@context": "https://schema.org",
    "@type": /restaurant|bar|tasca|caf/i.test(c.kind) ? "Restaurant" : "LocalBusiness",
    name: c.name,
    telephone: c.phone.replace(/\s/g, ""),
    ...(website ? { url: website } : {}),
    address: { "@type": "PostalAddress", addressLocality: c.town, addressRegion: "Santa Cruz de Tenerife", addressCountry: "ES" },
    knowsLanguage: c.languages,
    hasMenu: {
      "@type": "Menu",
      inLanguage: langs,
      hasMenuSection: sections.map((s) => ({
        "@type": "MenuSection",
        name: s,
        hasMenuItem: lines.filter((l) => l.section === s).map((l) => ({
          "@type": "MenuItem",
          name: l.name,
          ...(l.description ? { description: l.description } : {}),
          ...(l.price ? { offers: { "@type": "Offer", price: l.price, priceCurrency: "EUR" } } : {}),
        })),
      })),
    },
  };
  return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`;
}
