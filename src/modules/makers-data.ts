// Plan 9 data model, channel rules, compliance gate, customs data and deterministic demo generators.
import type { Client, Lang, Rec } from "../core/types";
import { eur, LANGS } from "../core/plans";

export type Channel = "etsy" | "shopify" | "amazon";
export type Category = "wine" | "liqueur" | "cheese" | "mojo" | "gofio" | "honey" | "cosmetic" | "craft";
export interface ListingText { title: string; description: string; keywords: string[] }
export type Listings = Partial<Record<Channel, Partial<Record<Lang, ListingText>>>>;

export interface Product extends Rec {
  clientId: string;
  name: string;
  category: Category;
  brief: string; // one Spanish brief from the maker
  netQty: string; // "750 ml", "250 g"
  weightKg: number; // gross shipping weight per unit
  abv?: number;
  stock: number;
  lowStock: number;
  prices: Partial<Record<Channel, number>>; // EUR, consumer price
  channels: Channel[];
  langs: Lang[];
  listings?: Listings;
  listingsLive?: boolean;
  listed?: Partial<Record<Channel, string>>;
  sanitaryReg?: string; // RGSEAA
  exciseCae?: string; // excise establishment code (CAE)
  cpnp?: string; // EU cosmetics notification + responsible person
  label: string[]; // checked label items
  stockChangedAt?: string;
  lastSync?: string;
}

export interface AdRow { channel: "Amazon Ads" | "Google Shopping"; keyword: string; clicks: number; spend: number; sales: number; bid: number }
export interface Suggestion { id: string; channel: AdRow["channel"]; action: "raise bid" | "lower bid" | "add keyword" | "add negative" | "pause"; target: string; current?: number; proposed?: number; reason: string; status: "pending" | "approved" | "rejected" }
export interface AdsWeek extends Rec { clientId: string; week: string; rows: AdRow[]; suggestions: Suggestion[]; live: boolean }

export interface ShipLine { productId: string; qty: number; unit?: number } // unit: invoice value per unit, EUR
export interface HsLine { productId: string; code: string; description: string; confidence: "high" | "medium" | "low" }
export interface Shipment extends Rec {
  clientId: string;
  ref: string;
  destination: "mainland" | "eu";
  country: string;
  consignee: string;
  address: string;
  incoterm: "DAP" | "DDP" | "EXW";
  consolidated: boolean;
  packages: number;
  lines: ShipLine[];
  hs?: HsLine[];
  notes?: string[];
  live?: boolean;
  status: "draft" | "ready" | "sent";
  sentAt?: string;
}
export interface SalesReport extends Rec {
  clientId: string; month: string;
  rows: { productId: string; name: string; channel: Channel; units: number; revenue: number }[];
  adSpend: number; summary?: string; live?: boolean;
}

export const COL = { products: "makers_products", ads: "makers_ads", ships: "makers_shipments", reports: "makers_reports" };
export const MAKER_LANGS: Lang[] = ["es", "en", "de", "it", "fr"];
export const CHANNELS: { id: Channel; name: string; titleMax: number; descMax: number; kwMax: number; kwLen: number; note: string }[] = [
  { id: "etsy", name: "Etsy", titleMax: 140, descMax: 2000, kwMax: 13, kwLen: 20, note: "13 tags, 20 characters each. No alcohol." },
  { id: "shopify", name: "Shopify", titleMax: 70, descMax: 2000, kwMax: 10, kwLen: 40, note: "SEO title 70, own shop" },
  { id: "amazon", name: "Amazon.es", titleMax: 200, descMax: 2000, kwMax: 10, kwLen: 50, note: "Title 200, backend keywords. Alcohol and food need category approval." },
];
export const channelById = (c: Channel) => CHANNELS.find((x) => x.id === c)!;

export const CATEGORIES: { id: Category; label: string; kind: "alcohol" | "food" | "cosmetic" | "craft"; hs: string; hsDesc: string }[] = [
  { id: "wine", label: "Wine", kind: "alcohol", hs: "2204.21", hsDesc: "Wine of fresh grapes, in containers of 2 l or less" },
  { id: "liqueur", label: "Liqueur / rum", kind: "alcohol", hs: "2208.70", hsDesc: "Liqueurs and cordials" },
  { id: "cheese", label: "Cheese", kind: "food", hs: "0406.90", hsDesc: "Other cheese" },
  { id: "mojo", label: "Mojo sauce", kind: "food", hs: "2103.90", hsDesc: "Sauces and preparations therefor" },
  { id: "gofio", label: "Gofio", kind: "food", hs: "1904.10", hsDesc: "Prepared foods obtained by roasting cereals" },
  { id: "honey", label: "Honey", kind: "food", hs: "0409.00", hsDesc: "Natural honey" },
  { id: "cosmetic", label: "Aloe / cosmetics", kind: "cosmetic", hs: "3304.99", hsDesc: "Beauty or skin-care preparations" },
  { id: "craft", label: "Craft", kind: "craft", hs: "6913.90", hsDesc: "Ornamental ceramic articles (confirm by material)" },
];
export const catById = (c: Category) => CATEGORIES.find((x) => x.id === c)!;

export const LABEL_ITEMS: Record<"alcohol" | "food" | "cosmetic" | "craft", { id: string; label: string }[]> = {
  alcohol: [
    { id: "abv", label: "Alcohol % vol on the label" }, { id: "allergen", label: "Allergens (contains sulphites)" },
    { id: "lot", label: "Lot number" }, { id: "net", label: "Net volume" }, { id: "operator", label: "Bottler name and address" }, { id: "pregnancy", label: "Pregnancy pictogram" },
  ],
  food: [
    { id: "ingredients", label: "Ingredients list in Spanish" }, { id: "allergen", label: "Allergens highlighted" },
    { id: "nutrition", label: "Nutrition table" }, { id: "date", label: "Best-before date and lot" }, { id: "net", label: "Net quantity" }, { id: "operator", label: "Producer name and address" },
  ],
  cosmetic: [
    { id: "inci", label: "INCI ingredient list" }, { id: "pao", label: "PAO or expiry date" }, { id: "batch", label: "Batch number" },
    { id: "rp", label: "Responsible person name and address" }, { id: "function", label: "Function and warnings in the sale language" },
  ],
  craft: [{ id: "material", label: "Materials stated" }, { id: "origin", label: "Made in Tenerife claim is true" }],
};

export interface GateItem { id: string; label: string; ok: boolean }
export function gate(p: Product): GateItem[] {
  const kind = catById(p.category).kind;
  const items: GateItem[] = [];
  if (kind === "food" || kind === "alcohol") items.push({ id: "rgseaa", label: "Sanitary registration (RGSEAA)", ok: !!p.sanitaryReg?.trim() });
  if (kind === "alcohol") {
    items.push({ id: "cae", label: "Excise registration (CAE) for alcohol", ok: !!p.exciseCae?.trim() });
    items.push({ id: "abv", label: "Alcohol strength recorded", ok: !!p.abv });
    items.push({ id: "etsy", label: "Not listed on Etsy (alcohol not allowed)", ok: !p.channels.includes("etsy") });
  }
  if (kind === "cosmetic") items.push({ id: "cpnp", label: "CPNP notification and EU responsible person", ok: !!p.cpnp?.trim() });
  for (const l of LABEL_ITEMS[kind]) items.push({ id: "label-" + l.id, label: `Label: ${l.label}`, ok: p.label.includes(l.id) });
  return items;
}
export const gateOk = (p: Product) => gate(p).every((g) => g.ok);

export const TIER_RULES: Record<string, { channels: number; ads: boolean; customs: boolean }> = {
  Starter: { channels: 1, ads: false, customs: false },
  Growth: { channels: 2, ads: true, customs: false },
  Pro: { channels: 2, ads: true, customs: true },
};
export function tierOf(c?: Client) {
  const s = c?.subs.find((x) => x.plan === "p9");
  if (s && TIER_RULES[s.tier]) return { name: s.tier, ...TIER_RULES[s.tier], pilot: false };
  return { name: "Free 60-day pilot", channels: 2, ads: true, customs: false, pilot: true };
}

// --- Demo listing writer ------------------------------------------------------------------------------

const CAT_I18N: Record<Category, Record<Lang, string>> = {
  wine: { es: "Vino", en: "Wine", de: "Wein", it: "Vino", fr: "Vin", nl: "Wijn", sv: "Vin" },
  liqueur: { es: "Licor", en: "Liqueur", de: "Likör", it: "Liquore", fr: "Liqueur", nl: "Likeur", sv: "Likör" },
  cheese: { es: "Queso", en: "Cheese", de: "Käse", it: "Formaggio", fr: "Fromage", nl: "Kaas", sv: "Ost" },
  mojo: { es: "Mojo canario", en: "Canarian mojo sauce", de: "Kanarische Mojo-Sauce", it: "Salsa mojo canaria", fr: "Sauce mojo canarienne", nl: "Canarische mojosaus", sv: "Kanarisk mojosås" },
  gofio: { es: "Gofio", en: "Gofio toasted flour", de: "Gofio Röstmehl", it: "Farina tostata gofio", fr: "Farine grillée gofio", nl: "Gofio geroosterd meel", sv: "Gofio rostat mjöl" },
  honey: { es: "Miel", en: "Honey", de: "Honig", it: "Miele", fr: "Miel", nl: "Honing", sv: "Honung" },
  cosmetic: { es: "Cosmética de aloe vera", en: "Aloe vera skincare", de: "Aloe-vera-Pflege", it: "Cosmetica all'aloe vera", fr: "Soin à l'aloe vera", nl: "Aloë vera verzorging", sv: "Aloe vera hudvård" },
  craft: { es: "Artesanía", en: "Handmade craft", de: "Kunsthandwerk", it: "Artigianato", fr: "Artisanat", nl: "Handwerk", sv: "Hantverk" },
};
const FROM: Record<Lang, string> = { es: "de Tenerife", en: "from Tenerife", de: "aus Teneriffa", it: "di Tenerife", fr: "de Tenerife", nl: "uit Tenerife", sv: "från Teneriffa" };
const GIFT: Record<Lang, string> = { es: "regalo", en: "gift", de: "geschenk", it: "regalo", fr: "cadeau", nl: "cadeau", sv: "present" };
const ISL: Record<Lang, string> = { es: "canarias", en: "canary islands", de: "kanaren", it: "canarie", fr: "canaries", nl: "canarische eilanden", sv: "kanarieöarna" };
const BODY: Record<Lang, (name: string, cat: string, maker: string, town: string, net: string) => string> = {
  es: (n, c, m, t, q) => `${n}: ${c.toLowerCase()} elaborado por ${m} en ${t}, Tenerife. Formato ${q}.`,
  en: (n, c, m, t, q) => `${n} is a ${c.toLowerCase()} made by ${m} in ${t}, Tenerife. Size: ${q}.`,
  de: (n, c, m, t, q) => `${n}: ${c} von ${m} aus ${t} auf Teneriffa. Inhalt: ${q}.`,
  it: (n, c, m, t, q) => `${n}: ${c.toLowerCase()} prodotto da ${m} a ${t}, Tenerife. Formato ${q}.`,
  fr: (n, c, m, t, q) => `${n} : ${c.toLowerCase()} élaboré par ${m} à ${t}, Tenerife. Format ${q}.`,
  nl: (n, c, m, t, q) => `${n}: ${c.toLowerCase()} gemaakt door ${m} in ${t}, Tenerife. Inhoud: ${q}.`,
  sv: (n, c, m, t, q) => `${n}: ${c.toLowerCase()} från ${m} i ${t}, Teneriffa. Storlek: ${q}.`,
};
const SHIP: Record<Lang, string> = {
  es: "Enviamos desde Canarias a la península y a la UE con la documentación de aduana incluida.",
  en: "Ships from the Canary Islands to mainland Spain and the EU, customs paperwork handled.",
  de: "Versand von den Kanaren aufs spanische Festland und in die EU, Zollpapiere inklusive.",
  it: "Spedizione dalle Canarie alla Spagna peninsulare e nell'UE, pratiche doganali incluse.",
  fr: "Expédié des Canaries vers l'Espagne continentale et l'UE, formalités douanières incluses.",
  nl: "Verzonden vanaf de Canarische Eilanden naar het Spaanse vasteland en de EU, douanepapieren geregeld.",
  sv: "Skickas från Kanarieöarna till spanska fastlandet och EU, tullpapper ordnade.",
};

export function demoListings(p: Product, maker: Client | undefined, channels: Channel[]): Listings {
  const out: Listings = {};
  for (const ch of channels) {
    const rule = channelById(ch);
    const m: Partial<Record<Lang, ListingText>> = {};
    for (const l of p.langs) {
      const cat = CAT_I18N[p.category][l];
      const base = ch === "amazon"
        ? `${maker?.name ?? ""} ${p.name} – ${cat} ${FROM[l]} – ${p.netQty}${p.abv ? ` – ${p.abv}% vol` : ""}`
        : ch === "etsy" ? `${p.name} | ${cat} ${FROM[l]} | ${p.netQty} | ${GIFT[l]}` : `${p.name} · ${cat} ${FROM[l]}`;
      const title = base.trim().slice(0, rule.titleMax);
      const description = [BODY[l](p.name, cat, maker?.name ?? "a local maker", maker?.town ?? "Tenerife", p.netQty), l === "es" ? p.brief : "", SHIP[l]].filter(Boolean).join("\n\n");
      const kw = [cat.toLowerCase(), `${cat.toLowerCase()} ${FROM[l].split(" ").pop()}`, "tenerife", ISL[l], GIFT[l], `${GIFT[l]} ${ISL[l]}`, p.name.toLowerCase()]
        .map((k) => k.slice(0, rule.kwLen)).filter((k, i, a) => a.indexOf(k) === i).slice(0, rule.kwMax);
      m[l] = { title, description, keywords: kw };
    }
    out[ch] = m;
  }
  return out;
}

// --- Ads ---------------------------------------------------------------------------------------------

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
export function simulateAds(products: Product[], week: string): AdRow[] {
  return products.filter((p) => p.channels.includes("amazon") || p.channels.includes("shopify")).flatMap((p) => {
    const kws = [p.name.toLowerCase(), `${CAT_I18N[p.category].es.toLowerCase()} canario`, `${CAT_I18N[p.category].en.toLowerCase()} tenerife`];
    return kws.map((k, i): AdRow => {
      const h = hash(k + week);
      const clicks = 8 + (h % 120);
      const bid = Math.round((0.25 + (h % 60) / 100) * 100) / 100;
      const spend = Math.round(clicks * bid * 100) / 100;
      const convRate = [0, 0.02, 0.05, 0.09][h % 4];
      const price = p.prices.amazon ?? p.prices.shopify ?? 15;
      return { channel: p.channels.includes("amazon") && i < 2 ? "Amazon Ads" : "Google Shopping", keyword: k, clicks, bid, spend, sales: Math.round(clicks * convRate * price * 100) / 100 };
    });
  });
}
export const acos = (r: { spend: number; sales: number }) => (r.sales ? r.spend / r.sales : Infinity);
export function demoSuggestions(rows: AdRow[]): Suggestion[] {
  const out: Suggestion[] = [];
  rows.forEach((r, i) => {
    const a = acos(r);
    if (r.sales === 0 && r.spend > 10) out.push({ id: `s${i}`, channel: r.channel, action: "add negative", target: r.keyword, reason: `${eur(r.spend)} spent, ${r.clicks} clicks, no sales this week.`, status: "pending" });
    else if (a > 0.45) out.push({ id: `s${i}`, channel: r.channel, action: "lower bid", target: r.keyword, current: r.bid, proposed: Math.round(r.bid * 0.75 * 100) / 100, reason: `ACoS ${Math.round(a * 100)}% is above the 35% target.`, status: "pending" });
    else if (a < 0.18 && r.clicks > 30) out.push({ id: `s${i}`, channel: r.channel, action: "raise bid", target: r.keyword, current: r.bid, proposed: Math.round(r.bid * 1.2 * 100) / 100, reason: `ACoS ${Math.round(a * 100)}% with ${r.clicks} clicks: room to win more impressions.`, status: "pending" });
  });
  out.push({ id: "s-new", channel: "Amazon Ads", action: "add keyword", target: "regalo canario gourmet", reason: "Search term from the auto campaign with 2 sales at low cost.", status: "pending" });
  return out.slice(0, 6);
}

// --- Customs -----------------------------------------------------------------------------------------

export const AGENT_FEE = { single: 75, consolidatedShare: 30 }; // EUR, estimates per DUA
export function shipmentTotals(s: Shipment, products: Product[]) {
  const lines = s.lines.map((l) => {
    const p = products.find((x) => x.id === l.productId);
    const unit = l.unit ?? (p ? p.prices.shopify ?? p.prices.amazon ?? p.prices.etsy ?? 0 : 0);
    const gross = p ? p.weightKg * l.qty : 0;
    return { ...l, product: p, unit, value: unit * l.qty, gross, net: Math.round(gross * 0.8 * 100) / 100 };
  });
  const value = lines.reduce((x, l) => x + l.value, 0);
  const gross = lines.reduce((x, l) => x + l.gross, 0);
  const net = lines.reduce((x, l) => x + l.net, 0);
  const fee = s.consolidated ? AGENT_FEE.consolidatedShare : AGENT_FEE.single;
  const alcohol = lines.some((l) => l.product && catById(l.product.category).kind === "alcohol");
  return { lines, value, gross, net, fee, feeShare: value ? fee / value : 1, alcohol };
}

export function demoCustomsNotes(s: Shipment, products: Product[]): { hs: HsLine[]; notes: string[] } {
  const t = shipmentTotals(s, products);
  const hs = t.lines.filter((l) => l.product).map((l) => {
    const c = catById(l.product!.category);
    return { productId: l.productId, code: c.hs, description: c.hsDesc, confidence: (c.kind === "craft" ? "low" : c.id === "gofio" ? "medium" : "high") as HsLine["confidence"] };
  });
  const notes = [
    "Sale from the Canary Islands: the invoice carries no IGIC (export of goods is exempt). Mark it 'Exento de IGIC, exportación'.",
    s.destination === "mainland"
      ? "Destination is mainland Spain: export DUA in Tenerife and import DUA on arrival. Spanish IVA is due on import at each product's rate (21% for wine and cosmetics, reduced rates for most food); the agent confirms."
      : `Destination ${s.country}: export DUA in Tenerife; import VAT of ${s.country} is due on entry into the EU VAT area.`,
    `Incoterm ${s.incoterm}: ${s.incoterm === "DDP" ? "the seller pays import VAT and duties, so add them to the price." : s.incoterm === "DAP" ? "the buyer pays import VAT on delivery; tell them before shipping." : "the buyer arranges transport and customs."}`,
  ];
  if (t.alcohol) notes.push("Contains alcohol: the agent needs the excise code (CAE) and an electronic excise document; excise duty applies at destination.");
  if (s.consolidated) notes.push("Consolidated pallet: one DUA covers all lines; agree pickup date with the partner agent in Santa Cruz.");
  if (t.feeShare > 0.15) notes.push(`Customs fee of about ${eur(t.fee)} is ${Math.round(t.feeShare * 100)}% of the goods value. Add more units or join the next consolidated pallet.`);
  return { hs, notes };
}

export function simulateSales(products: Product[], month: string) {
  return products.flatMap((p) => p.channels.map((ch) => {
    const units = 2 + (hash(p.id + ch + month) % 28);
    const price = p.prices[ch] ?? 0;
    return { productId: p.id, name: p.name, channel: ch, units, revenue: Math.round(units * price * 100) / 100 };
  }));
}

export function demoReport(maker: Client | undefined, r: Pick<SalesReport, "rows" | "adSpend" | "month">, lowStock: string[]): string {
  const rev = r.rows.reduce((s, x) => s + x.revenue, 0);
  const units = r.rows.reduce((s, x) => s + x.units, 0);
  const top = [...r.rows].sort((a, b) => b.revenue - a.revenue)[0];
  const byCh = new Map<Channel, number>();
  r.rows.forEach((x) => byCh.set(x.channel, (byCh.get(x.channel) ?? 0) + x.revenue));
  return [
    `${maker?.name ?? "Maker"} · ${r.month}: ${units} units sold, ${eur(rev)} in sales, ${eur(r.adSpend)} ad spend${rev ? ` (${Math.round((r.adSpend / rev) * 100)}% of sales)` : ""}.`,
    `By channel: ${[...byCh].map(([c, v]) => `${channelById(c).name} ${eur(v)}`).join(", ")}.`,
    top ? `Best seller: ${top.name} on ${channelById(top.channel).name} (${top.units} units).` : "",
    "Next actions:",
    `1. ${lowStock.length ? `Restock ${lowStock.join(", ")} before listings go out of stock.` : "Stock is healthy; plan the Christmas gift bundle now."}`,
    "2. Approve this week's ad changes and move budget to the best seller.",
    "3. Ask the last 10 buyers for a review (only those who opted in at checkout).",
  ].filter(Boolean).join("\n");
}

export const langList = (ls: Lang[]) => ls.map((l) => `${LANGS[l]} (${l})`).join(", ");
