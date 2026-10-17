// Plan 4 data model, portal limits and deterministic demo generators.
import type { Client, Lang, Rec } from "../core/types";
import { eur, LANGS } from "../core/plans";
import { pick } from "../core/ai";
import { today } from "../core/store";

export type Kind = "sale" | "holiday";
export type PortalId = "idealista" | "fotocasa" | "kyero" | "airbnb" | "booking";
export type KitStatus = "draft" | "qa" | "signoff" | "delivered";
export type LangText = Partial<Record<Lang, string>>;
export type Copy = Partial<Record<PortalId, LangText>>;

export interface Photo { name: string; thumb?: string }
export interface Extraction { features: string[]; photoOrder: string[]; highlights: string; missing: string[]; live: boolean; at: string }
export interface Scene { seconds: number; photo: string; caption: LangText }
export interface Reel { scenes: Scene[]; music: string; template: "clean" | "branded"; render: "none" | "rendering" | "rendered"; renderedAt?: string; live: boolean }
export interface SocialPost { platform: "Instagram" | "Facebook"; text: LangText; hashtags: string[]; scheduled?: string }

export interface Kit extends Rec {
  clientId: string;
  ref: string;
  kind: Kind;
  type: string;
  town: string;
  price: number; // sale: total; holiday: per night
  beds: number;
  baths: number;
  m2: number;
  features: string[];
  photos: Photo[];
  transcript: string;
  energyRating?: string;
  energyCertNo?: string;
  vvNumber?: string;
  langs: Lang[];
  portals: PortalId[];
  extraction?: Extraction;
  copy?: Copy;
  copyLive?: boolean;
  reel?: Reel;
  posts?: SocialPost[];
  postsLive?: boolean;
  status: KitStatus;
  qa: string[];
  sentForSignoff?: string;
  signedOffAt?: string;
  deliveredAt?: string;
  month: string; // YYYY-MM counted against the quota
}

export const COL = "listings_kits";
export const KIT_LANGS: Lang[] = ["es", "en", "de", "nl", "sv", "it", "fr"];
export const DEFAULT_LANGS: Lang[] = ["es", "en", "de", "nl", "sv"];
export const TYPES = ["Apartment", "Penthouse", "Villa", "Townhouse", "Studio", "Finca"];
export const ENERGY = ["A", "B", "C", "D", "E", "F", "G"];
export const MUSIC = ["Warm acoustic", "Chill house", "Soft piano", "Upbeat Latin"];

export interface Portal { id: PortalId; name: string; limit: number; kinds: Kind[]; style: string }
/** Working character limits for the description field. Check portal rules each season. */
export const PORTALS: Portal[] = [
  { id: "idealista", name: "Idealista", limit: 4000, kinds: ["sale", "holiday"], style: "full description, facts first, Spanish market tone" },
  { id: "fotocasa", name: "Fotocasa", limit: 3000, kinds: ["sale"], style: "full description, short paragraphs" },
  { id: "kyero", name: "Kyero", limit: 3000, kinds: ["sale"], style: "for foreign buyers, lifestyle plus facts" },
  { id: "airbnb", name: "Airbnb", limit: 500, kinds: ["holiday"], style: "listing description for guests, warm and short" },
  { id: "booking", name: "Booking.com", limit: 2000, kinds: ["holiday"], style: "property description for guests, clear and factual" },
];
export const portalById = (id: PortalId) => PORTALS.find((p) => p.id === id)!;
export const portalsFor = (k: Kind) => PORTALS.filter((p) => p.kinds.includes(k)).map((p) => p.id);

export const KIT_CAP: Record<string, number> = { Rental: 3, Agent: 8, Agency: 25 };
export function tierOf(c?: Client): { tier: string; cap: number; reels: boolean; branded: boolean } {
  const s = c?.subs.find((x) => x.plan === "p4");
  if (s) return { tier: s.tier, cap: KIT_CAP[s.tier] ?? 0, reels: s.tier !== "Rental", branded: s.tier === "Agency" };
  if (c && (c.stage === "pilot" || c.stage === "lead")) return { tier: "Free pilot", cap: 3, reels: true, branded: false };
  return { tier: "No Listing Kits plan", cap: 0, reels: false, branded: false };
}
export const thisMonth = () => today().slice(0, 7);

export const VV_RE = /^VV-38-[1-5]-\d{7}$/;

// --- Language material for demo output ---------------------------------------------------------

const FEAT: Record<string, LangText> = {
  "sea view": { es: "vistas al mar", de: "Meerblick", nl: "zeezicht", sv: "havsutsikt", it: "vista mare", fr: "vue mer" },
  "terrace": { es: "terraza", de: "Terrasse", nl: "terras", sv: "terrass", it: "terrazza", fr: "terrasse" },
  "communal pool": { es: "piscina comunitaria", de: "Gemeinschaftspool", nl: "gemeenschappelijk zwembad", sv: "gemensam pool", it: "piscina condominiale", fr: "piscine commune" },
  "private pool": { es: "piscina privada", de: "privater Pool", nl: "privézwembad", sv: "egen pool", it: "piscina privata", fr: "piscine privée" },
  "parking": { es: "plaza de garaje", de: "Stellplatz", nl: "parkeerplaats", sv: "parkeringsplats", it: "posto auto", fr: "place de parking" },
  "air conditioning": { es: "aire acondicionado", de: "Klimaanlage", nl: "airconditioning", sv: "luftkonditionering", it: "aria condizionata", fr: "climatisation" },
  "lift": { es: "ascensor", de: "Aufzug", nl: "lift", sv: "hiss", it: "ascensore", fr: "ascenseur" },
  "furnished": { es: "amueblado", de: "möbliert", nl: "gemeubileerd", sv: "möblerad", it: "arredato", fr: "meublé" },
  "garden": { es: "jardín", de: "Garten", nl: "tuin", sv: "trädgård", it: "giardino", fr: "jardin" },
  "storage room": { es: "trastero", de: "Abstellraum", nl: "berging", sv: "förråd", it: "ripostiglio", fr: "cellier" },
  "fibre wifi": { es: "wifi de fibra", de: "Glasfaser-WLAN", nl: "glasvezel-wifi", sv: "fiber-wifi", it: "wifi in fibra", fr: "wifi fibre" },
  "walk to beach": { es: "playa a pie", de: "Strand zu Fuß", nl: "strand op loopafstand", sv: "gångavstånd till stranden", it: "spiaggia a piedi", fr: "plage à pied" },
  "solarium": { es: "solárium", de: "Sonnendeck", nl: "zonneterras", sv: "solterrass", it: "solarium", fr: "solarium" },
  "renovated": { es: "reformado", de: "renoviert", nl: "gerenoveerd", sv: "renoverad", it: "ristrutturato", fr: "rénové" },
};
export const KNOWN_FEATURES = Object.keys(FEAT);

const TYPE_I18N: Record<string, LangText> = {
  Apartment: { es: "Apartamento", de: "Wohnung", nl: "Appartement", sv: "Lägenhet", it: "Appartamento", fr: "Appartement" },
  Penthouse: { es: "Ático", de: "Penthouse", nl: "Penthouse", sv: "Takvåning", it: "Attico", fr: "Penthouse" },
  Villa: { es: "Villa", de: "Villa", nl: "Villa", sv: "Villa", it: "Villa", fr: "Villa" },
  Townhouse: { es: "Adosado", de: "Reihenhaus", nl: "Rijtjeshuis", sv: "Radhus", it: "Villetta a schiera", fr: "Maison mitoyenne" },
  Studio: { es: "Estudio", de: "Studio", nl: "Studio", sv: "Studio", it: "Monolocale", fr: "Studio" },
  Finca: { es: "Finca", de: "Finca", nl: "Finca", sv: "Finca", it: "Finca", fr: "Finca" },
};

interface Phr {
  sale: (t: string, town: string) => string; holiday: (t: string, town: string) => string;
  rooms: (b: number, ba: number, m2: number) => string; feats: (l: string) => string; region: (town: string, north: boolean) => string;
  price: (p: string) => string; night: (p: string) => string; energy: (r: string) => string; vv: (n: string) => string;
  cta: string; ctaGuest: string; just: string; and: string; tags: string[];
}
const PHR: Record<Lang, Phr> = {
  es: { sale: (t, w) => `${t} en venta en ${w}.`, holiday: (t, w) => `${t} vacacional en ${w}, listo para tus días de sol.`,
    rooms: (b, ba, m) => `${b} ${b === 1 ? "dormitorio" : "dormitorios"}, ${ba} ${ba === 1 ? "baño" : "baños"} y ${m} m² construidos.`, feats: (l) => `Destaca por: ${l}.`,
    region: (w, n) => `Situado en ${w}, en el ${n ? "norte" : "sur"} de Tenerife.`, price: (p) => `Precio: ${p}.`, night: (p) => `Desde ${p} por noche.`,
    energy: (r) => `Certificado energético: ${r}.`, vv: (n) => `Registro de vivienda vacacional: ${n}.`,
    cta: "Contacte con nosotros para concertar una visita.", ctaGuest: "Reserva tus fechas y disfruta de Tenerife.", just: "Novedad", and: "y", tags: ["#inmobiliaria", "#tenerife"] },
  en: { sale: (t, w) => `${t} for sale in ${w}.`, holiday: (t, w) => `Holiday ${t.toLowerCase()} in ${w}, ready for your days in the sun.`,
    rooms: (b, ba, m) => `${b} ${b === 1 ? "bedroom" : "bedrooms"}, ${ba} ${ba === 1 ? "bathroom" : "bathrooms"} and ${m} m² built.`, feats: (l) => `Highlights: ${l}.`,
    region: (w, n) => `Located in ${w}, in the ${n ? "north" : "south"} of Tenerife.`, price: (p) => `Price: ${p}.`, night: (p) => `From ${p} per night.`,
    energy: (r) => `Energy rating: ${r}.`, vv: (n) => `Holiday rental registration: ${n}.`,
    cta: "Contact us to arrange a viewing.", ctaGuest: "Book your dates and enjoy Tenerife.", just: "Just listed", and: "and", tags: ["#tenerifeproperty", "#tenerife"] },
  de: { sale: (t, w) => `${t} zu verkaufen in ${w}.`, holiday: (t, w) => `Ferien-${t} in ${w}, bereit für Ihre Sonnentage.`,
    rooms: (b, ba, m) => `${b} Schlafzimmer, ${ba} ${ba === 1 ? "Bad" : "Bäder"} und ${m} m² Wohnfläche.`, feats: (l) => `Highlights: ${l}.`,
    region: (w, n) => `Gelegen in ${w}, im ${n ? "Norden" : "Süden"} Teneriffas.`, price: (p) => `Preis: ${p}.`, night: (p) => `Ab ${p} pro Nacht.`,
    energy: (r) => `Energieausweis: Klasse ${r}.`, vv: (n) => `Registrierungsnummer Ferienvermietung: ${n}.`,
    cta: "Kontaktieren Sie uns für eine Besichtigung.", ctaGuest: "Jetzt Termine buchen und Teneriffa genießen.", just: "Neu im Angebot", and: "und", tags: ["#immobilienteneriffa", "#teneriffa"] },
  nl: { sale: (t, w) => `${t} te koop in ${w}.`, holiday: (t, w) => `Vakantie-${t.toLowerCase()} in ${w}, klaar voor zonnige dagen.`,
    rooms: (b, ba, m) => `${b} ${b === 1 ? "slaapkamer" : "slaapkamers"}, ${ba} ${ba === 1 ? "badkamer" : "badkamers"} en ${m} m² woonoppervlak.`, feats: (l) => `Pluspunten: ${l}.`,
    region: (w, n) => `Gelegen in ${w}, in het ${n ? "noorden" : "zuiden"} van Tenerife.`, price: (p) => `Prijs: ${p}.`, night: (p) => `Vanaf ${p} per nacht.`,
    energy: (r) => `Energielabel: ${r}.`, vv: (n) => `Registratienummer vakantieverhuur: ${n}.`,
    cta: "Neem contact op voor een bezichtiging.", ctaGuest: "Boek je data en geniet van Tenerife.", just: "Nieuw in de verkoop", and: "en", tags: ["#vastgoedtenerife", "#tenerife"] },
  sv: { sale: (t, w) => `${t} till salu i ${w}.`, holiday: (t, w) => `Semester${t.toLowerCase()} i ${w}, redo för soliga dagar.`,
    rooms: (b, ba, m) => `${b} sovrum, ${ba} badrum och ${m} m² boyta.`, feats: (l) => `Höjdpunkter: ${l}.`,
    region: (w, n) => `Belägen i ${w}, på ${n ? "norra" : "södra"} Teneriffa.`, price: (p) => `Pris: ${p}.`, night: (p) => `Från ${p} per natt.`,
    energy: (r) => `Energiklass: ${r}.`, vv: (n) => `Registreringsnummer för semesteruthyrning: ${n}.`,
    cta: "Kontakta oss för att boka en visning.", ctaGuest: "Boka dina datum och njut av Teneriffa.", just: "Nytt objekt", and: "och", tags: ["#bostadteneriffa", "#teneriffa"] },
  it: { sale: (t, w) => `${t} in vendita a ${w}.`, holiday: (t, w) => `${t} per vacanze a ${w}, pronto per le tue giornate di sole.`,
    rooms: (b, ba, m) => `${b} ${b === 1 ? "camera" : "camere"}, ${ba} ${ba === 1 ? "bagno" : "bagni"} e ${m} m² costruiti.`, feats: (l) => `Punti di forza: ${l}.`,
    region: (w, n) => `Si trova a ${w}, nel ${n ? "nord" : "sud"} di Tenerife.`, price: (p) => `Prezzo: ${p}.`, night: (p) => `Da ${p} a notte.`,
    energy: (r) => `Classe energetica: ${r}.`, vv: (n) => `Registro casa vacanze: ${n}.`,
    cta: "Contattaci per fissare una visita.", ctaGuest: "Prenota le tue date e goditi Tenerife.", just: "Nuovo annuncio", and: "e", tags: ["#casetenerife", "#tenerife"] },
  fr: { sale: (t, w) => `${t} à vendre à ${w}.`, holiday: (t, w) => `${t} de vacances à ${w}, prêt pour vos journées au soleil.`,
    rooms: (b, ba, m) => `${b} ${b === 1 ? "chambre" : "chambres"}, ${ba} ${ba === 1 ? "salle de bain" : "salles de bain"} et ${m} m² construits.`, feats: (l) => `Points forts : ${l}.`,
    region: (w, n) => `Situé à ${w}, dans le ${n ? "nord" : "sud"} de Tenerife.`, price: (p) => `Prix : ${p}.`, night: (p) => `À partir de ${p} la nuit.`,
    energy: (r) => `Classe énergétique : ${r}.`, vv: (n) => `Numéro d'enregistrement location de vacances : ${n}.`,
    cta: "Contactez-nous pour organiser une visite.", ctaGuest: "Réservez vos dates et profitez de Tenerife.", just: "Nouveauté", and: "et", tags: ["#immobiliertenerife", "#tenerife"] },
};

const NORTH = ["Puerto de la Cruz", "La Laguna", "Santa Cruz", "La Orotava", "Tacoronte", "Icod de los Vinos"];
export const trFeat = (f: string, l: Lang) => (l === "en" ? f : FEAT[f.toLowerCase()]?.[l] ?? f);
const trType = (t: string, l: Lang) => (l === "en" ? t : TYPE_I18N[t]?.[l] ?? t);
const joinList = (xs: string[], and: string) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);

export function demoText(k: Kit, portal: PortalId, l: Lang): string {
  const p = PHR[l];
  const t = trType(k.type, l);
  const feats = k.features.map((f) => trFeat(f, l));
  const parts: string[] = [];
  if (k.kind === "sale") parts.push(p.sale(t, k.town)); else parts.push(p.holiday(t, k.town));
  parts.push(p.rooms(k.beds, k.baths, k.m2));
  if (feats.length) parts.push(p.feats(joinList(portal === "airbnb" ? feats.slice(0, 5) : feats, p.and)));
  if (portal !== "airbnb") parts.push(p.region(k.town, NORTH.includes(k.town)));
  parts.push(k.kind === "sale" ? p.price(eur(k.price)) : p.night(eur(k.price)));
  if (k.kind === "sale" && k.energyRating) parts.push(p.energy(k.energyRating));
  if (k.kind === "holiday" && k.vvNumber) parts.push(p.vv(k.vvNumber));
  parts.push(k.kind === "sale" ? p.cta : p.ctaGuest);
  return parts.join(portal === "airbnb" ? " " : portal === "kyero" ? "\n\n" : "\n");
}

export function demoCopy(k: Kit, portals: PortalId[], langs: Lang[]): Copy {
  const out: Copy = {};
  for (const po of portals) {
    const m: LangText = {};
    for (const l of langs) m[l] = demoText(k, po, l);
    out[po] = m;
  }
  return out;
}

export function demoShorten(text: string, limit: number, mustKeep?: string): string {
  const sentences = text.replace(/\n+/g, " ").split(/(?<=\.)\s+/);
  let out = "";
  for (const s of sentences) {
    if ((out + " " + s).length > limit * 0.88) break;
    out = out ? out + " " + s : s;
  }
  if (mustKeep && !out.includes(mustKeep)) out = (out + " " + mustKeep).trim();
  return out;
}

const KEYWORDS: [RegExp, string][] = [
  [/sea ?view|vistas? al mar|vista mar|ocean/i, "sea view"], [/terra(ce|za)|balc/i, "terrace"],
  [/private pool|piscina privada/i, "private pool"], [/pool|piscina/i, "communal pool"], [/parking|garaje|garage/i, "parking"],
  [/air ?con|a\/c|aire acondicionado/i, "air conditioning"], [/\blift\b|ascensor|elevator/i, "lift"],
  [/furnish|amueblad/i, "furnished"], [/garden|jard[ií]n/i, "garden"], [/storage|trastero/i, "storage room"],
  [/fib(re|er|ra)|wifi/i, "fibre wifi"], [/beach|playa/i, "walk to beach"], [/solarium|sol[aá]rium|roof terrace/i, "solarium"],
  [/renovat|reformad/i, "renovated"],
];
const ROOM_ORDER: [RegExp, number][] = [
  [/view|vista|exterior|fachada|facade|terrace|terraza|pool|piscina/i, 0], [/living|salon|sal[oó]n|lounge/i, 1],
  [/kitchen|cocina/i, 2], [/bed|dormitorio|habitaci/i, 3], [/bath|ba[nñ]o/i, 4],
];
export function demoExtraction(k: Kit): Omit<Extraction, "live" | "at"> {
  const src = `${k.transcript} ${k.photos.map((p) => p.name).join(" ")}`;
  const found = new Set<string>();
  for (const [re, f] of KEYWORDS) if (re.test(src)) found.add(f);
  if (found.has("private pool")) found.delete("communal pool");
  const score = (n: string) => ROOM_ORDER.find(([re]) => re.test(n))?.[1] ?? 5;
  const photoOrder = [...k.photos].sort((a, b) => score(a.name) - score(b.name)).map((p) => p.name);
  const missing: string[] = [];
  if (k.kind === "sale" && !k.energyCertNo) missing.push("Energy certificate number and rating");
  if (k.kind === "holiday" && !k.vvNumber) missing.push("Holiday-rental registration number (VV-38-...)");
  if (!/planta|floor|piso/i.test(k.transcript) && k.type !== "Villa") missing.push("Floor level");
  if (!/orient|south|sur|west|oeste/i.test(k.transcript)) missing.push("Orientation (south/west facing?)");
  if (k.photos.length < 8) missing.push(`More photos: ${k.photos.length} received, portals rank listings with 15+ higher`);
  const top = [...found].slice(0, 3);
  return {
    features: [...found],
    photoOrder,
    highlights: top.length ? `Lead with ${top.join(", ")}. Open the reel on the best view.` : "No standout feature found in the notes. Ask the agent what buyers liked at viewings.",
    missing,
  };
}

export function demoReel(k: Kit, template: Reel["template"]): Reel {
  const order = k.extraction?.photoOrder?.length ? k.extraction.photoOrder : k.photos.map((p) => p.name);
  const shots = (order.length ? order : ["cover.jpg"]).slice(0, 6);
  const scenes: Scene[] = shots.map((photo, i) => {
    const caption: LangText = {};
    for (const l of k.langs) {
      const p = PHR[l];
      if (i === 0) caption[l] = `${trType(k.type, l)} · ${k.town}`;
      else if (i === shots.length - 1) caption[l] = k.kind === "sale" ? p.price(eur(k.price)).replace(/\.$/, "") : p.night(eur(k.price)).replace(/\.$/, "");
      else if (k.features[i - 1]) caption[l] = trFeat(k.features[i - 1], l);
      else caption[l] = p.rooms(k.beds, k.baths, k.m2).replace(/\.$/, "");
    }
    return { seconds: i === 0 ? 3 : 2.5, photo, caption };
  });
  return { scenes, music: pick(MUSIC, k.ref), template, render: "none", live: false };
}

export function demoPosts(k: Kit): SocialPost[] {
  const mk = (platform: SocialPost["platform"]): SocialPost => {
    const text: LangText = {};
    for (const l of k.langs) {
      const p = PHR[l];
      const feats = k.features.slice(0, 3).map((f) => trFeat(f, l));
      const lines = [
        platform === "Instagram" ? `${p.just}: ${trType(k.type, l)} · ${k.town}` : `${trType(k.type, l)} · ${k.town}`,
        p.rooms(k.beds, k.baths, k.m2),
        feats.length ? p.feats(joinList(feats, p.and)) : "",
        k.kind === "sale" ? p.price(eur(k.price)) : p.night(eur(k.price)),
        k.kind === "holiday" && k.vvNumber ? p.vv(k.vvNumber) : "",
        platform === "Facebook" ? (k.kind === "sale" ? p.cta : p.ctaGuest) : "",
      ];
      text[l] = lines.filter(Boolean).join("\n");
    }
    const tags = ["#Tenerife", "#" + k.town.replace(/\s+/g, ""), ...k.langs.flatMap((l) => PHR[l].tags.slice(0, 1))];
    return { platform, text, hashtags: [...new Set(tags)] };
  };
  return [mk("Instagram"), mk("Facebook")];
}

export function kitFacts(k: Kit): string {
  return JSON.stringify({
    listing: k.kind === "sale" ? "property for sale" : "holiday rental (vivienda vacacional, Canary Islands)",
    type: k.type, town: k.town, island: "Tenerife",
    price: k.price, priceUnit: k.kind === "sale" ? "EUR total" : "EUR per night",
    bedrooms: k.beds, bathrooms: k.baths, builtM2: k.m2, features: k.features,
    energyRating: k.energyRating || null, energyCertificateNo: k.energyCertNo || null,
    holidayRentalRegistration: k.vvNumber || null,
    agentVoiceNote: k.transcript,
  });
}

export const langNames = (ls: Lang[]) => ls.map((l) => `${LANGS[l]} (${l})`).join(", ");

// --- Compliance ----------------------------------------------------------------------------------

export interface Check { id: string; label: string; ok: boolean; blocking: boolean; detail?: string }
export function compliance(k: Kit, reelsIncluded: boolean): Check[] {
  const checks: Check[] = [];
  if (k.kind === "sale") {
    checks.push({ id: "energy", label: "Energy certificate on file", ok: !!k.energyCertNo && !!k.energyRating, blocking: true,
      detail: k.energyCertNo ? `${k.energyRating} · ${k.energyCertNo}` : "Spanish law requires the energy rating in every sale advert." });
  } else {
    const valid = !!k.vvNumber && VV_RE.test(k.vvNumber);
    checks.push({ id: "vv", label: "Holiday-rental registration number", ok: valid, blocking: true,
      detail: k.vvNumber ? (valid ? k.vvNumber : `${k.vvNumber} does not match VV-38-n-nnnnnnn`) : "Canary law requires the VV number on every holiday-rental advert." });
    const texts = Object.values(k.copy ?? {}).flatMap((m) => Object.values(m ?? {}));
    const missing = k.vvNumber ? texts.filter((t) => !t?.includes(k.vvNumber!)).length : texts.length;
    checks.push({ id: "vv-in-copy", label: "VV number shown in every description", ok: texts.length > 0 && missing === 0, blocking: true,
      detail: texts.length ? (missing ? `${missing} description(s) without it` : "All descriptions show it") : "No descriptions yet" });
  }
  const over: string[] = [];
  let count = 0;
  for (const po of k.portals) for (const l of k.langs) {
    const t = k.copy?.[po]?.[l];
    if (t) { count++; if (t.length > portalById(po).limit) over.push(`${portalById(po).name} ${l.toUpperCase()}`); }
  }
  const need = k.portals.length * k.langs.length;
  checks.push({ id: "copy", label: "Description for every portal and language", ok: need > 0 && count >= need, blocking: true, detail: `${count} of ${need}` });
  checks.push({ id: "limits", label: "Every text within portal character limit", ok: count > 0 && over.length === 0, blocking: true, detail: over.length ? `Over limit: ${over.join(", ")}` : undefined });
  if (reelsIncluded) checks.push({ id: "reel", label: "Reel rendered", ok: k.reel?.render === "rendered", blocking: false, detail: "Included in this tier" });
  checks.push({ id: "posts", label: "2 social posts written", ok: (k.posts?.length ?? 0) >= 2, blocking: false });
  checks.push({ id: "signoff", label: "Client signed off the facts", ok: !!k.signedOffAt, blocking: true });
  return checks;
}

export const QA_ITEMS = [
  { id: "facts", label: "Price, beds, baths and m² match the agent's sheet" },
  { id: "features", label: "No feature claimed that is not in the photos or notes" },
  { id: "langs", label: "Spot-checked each language for tone and errors" },
  { id: "photos", label: "Photo order and cover image make sense" },
  { id: "reel", label: "Reel captions readable and correct" },
];
