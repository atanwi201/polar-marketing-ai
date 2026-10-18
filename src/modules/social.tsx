// Plan 5 · White-label social content for agencies.
import { useState } from "react";
import { BRAND } from "../core/brand";
import {
  Page, Card, Button, Field, Input, TextArea, Select, Form, Tabs, Badge, Stat, Stats, Table, Empty,
  CopyButton, LangPicker, LangTag, ClientPicker, Modal, ConfirmButton, toast, fmtDate, type Tone,
} from "../core/ui";
import { useCollection, create, put, remove, today, now } from "../core/store";
import { aiJson, pick } from "../core/ai";
import { eur, LANGS } from "../core/plans";
import { EX, example, dayOffset } from "../core/seed";
import type { Client, Lang, Rec, Task } from "../core/types";

// ---------- Types ----------

type Tier = "Base" | "Standard" | "Premium";
const TIERS: Record<Tier, { posts: number; reels: number; langs: number; price: number; extra: string }> = {
  Base: { posts: 12, reels: 0, langs: 2, price: 250, extra: "ES + EN captions, monthly calendar" },
  Standard: { posts: 20, reels: 4, langs: 3, price: 400, extra: "4 reels from client footage" },
  Premium: { posts: 30, reels: 8, langs: 5, price: 600, extra: "Stories, monthly performance note" },
};
type LangText = Partial<Record<Lang, string>>;
type LangTags = Partial<Record<Lang, string[]>>;

interface Brand extends Rec {
  agencyId: string; name: string; kind: string; town: string; voice: string; offers: string; facts: string;
  rules: string; bannedWords: string[]; languages: Lang[]; tier: Tier; pilot: boolean;
}
type Format = "Post" | "Carousel" | "Reel" | "Story";
type Tool = "Canva" | "Flux" | "Ideogram";
interface Graphic { template: string; prompt: string; tool: Tool; live: boolean }
type IssueKind = "banned" | "rule" | "grammar" | "fact" | "language";
interface QaIssue { kind: IssueKind; lang?: Lang; text: string }
type PostStatus = "draft" | "approved" | "changes";
interface SPost extends Rec {
  brandId: string; month: string; date: string; format: Format; pillar: string; idea: string;
  captions: LangText; hashtags: LangTags; live: boolean; graphic?: Graphic;
  qa?: { issues: QaIssue[]; checkedAt: string; live: boolean }; status: PostStatus;
}
type ReelStatus = "footage" | "editing" | "ready" | "approved";
interface Reel extends Rec {
  brandId: string; month: string; footage: string; seconds: number; tool: "Submagic" | "CapCut";
  hook?: string; cut?: string[]; subtitleLangs: Lang[]; live?: boolean; status: ReelStatus;
}

const COL = { brands: "social_brands", posts: "social_posts", reels: "social_reels" } as const;
const thisMonth = () => today().slice(0, 7);
const ISSUE_LABEL: Record<IssueKind, string> = { banned: "Banned word", rule: "Brand rule", grammar: "Grammar", fact: "Local fact", language: "Language" };
const ISSUE_TONE: Record<IssueKind, Tone> = { banned: "bad", rule: "warn", grammar: "info", fact: "bad", language: "warn" };
const STATUS_TONE: Record<PostStatus, Tone> = { draft: "neutral", approved: "good", changes: "warn" };
const REEL_NEXT: Record<ReelStatus, ReelStatus> = { footage: "editing", editing: "ready", ready: "approved", approved: "approved" };
const MAX_HASHTAGS = 8;
const CONCENTRATION_CAP = 0.4;

const monthLabel = (m: string) => new Date(m + "-15T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const daysIn = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- QA (local checks always run; AI adds grammar and local facts) ----------

const FACT_RULES: { re: RegExp; text: string }[] = [
  { re: /las palmas/i, text: "Las Palmas is on Gran Canaria, not Tenerife." },
  { re: /teide[^.]*\b(europe|europa)\b/i, text: "Teide is the highest peak in Spain, not in Europe." },
  { re: /\b3[.,]?7(0\d|1[0-46-9]|[2-9]\d)\s?m\b/i, text: "Teide is 3,715 m high. Check the height." },
  { re: /loro parque[^.]*(adeje|cristianos|américas|americas)/i, text: "Loro Parque is in Puerto de la Cruz, in the north." },
  { re: /siam park[^.]*(puerto de la cruz|la laguna)/i, text: "Siam Park is in Costa Adeje, in the south." },
  { re: /capital (of|de) (the )?canar/i, text: "The Canaries have two capitals: Santa Cruz de Tenerife and Las Palmas. Check the claim." },
];

function localQa(p: SPost, b: Brand): QaIssue[] {
  const issues: QaIssue[] = [];
  for (const l of b.languages) {
    const cap = p.captions[l];
    if (!cap?.trim()) { issues.push({ kind: "language", lang: l, text: `Caption missing in ${LANGS[l]}.` }); continue; }
    for (const w of b.bannedWords) {
      if (w && new RegExp(`(^|[^\\p{L}])${escapeRe(w)}([^\\p{L}]|$)`, "iu").test(cap)) issues.push({ kind: "banned", lang: l, text: `Uses banned word "${w}".` });
    }
    const tags = p.hashtags[l] ?? [];
    if (tags.length > MAX_HASHTAGS) issues.push({ kind: "rule", lang: l, text: `${tags.length} hashtags. Keep it to ${MAX_HASHTAGS} or fewer.` });
    if (p.format === "Story" && cap.length > 120) issues.push({ kind: "rule", lang: l, text: "Story text over 120 characters." });
    if (cap.length > 2200) issues.push({ kind: "rule", lang: l, text: "Over Instagram's 2,200 character limit." });
    const prices = cap.match(/\d+[.,]?\d*\s?€|€\s?\d+/g) ?? [];
    for (const pr of prices) {
      const n = pr.replace(/[^\d.,]/g, "");
      if (!b.offers.includes(n)) issues.push({ kind: "fact", lang: l, text: `Price ${pr} is not in the brand's offers.` });
    }
    if (/no exclamation/i.test(b.rules) && cap.includes("!")) issues.push({ kind: "rule", lang: l, text: "Brand rules say no exclamation marks." });
    if (/no emoji/i.test(b.rules) && /\p{Extended_Pictographic}/u.test(cap)) issues.push({ kind: "rule", lang: l, text: "Brand rules say no emoji." });
  }
  return issues;
}

/** Demo stand-in for the AI grammar and local-facts pass. */
function demoAiQa(p: SPost, b: Brand): QaIssue[] {
  const issues: QaIssue[] = [];
  for (const l of b.languages) {
    const cap = p.captions[l] ?? "";
    for (const f of FACT_RULES) if (f.re.test(cap)) issues.push({ kind: "fact", lang: l, text: f.text });
    if (/ {2,}/.test(cap)) issues.push({ kind: "grammar", lang: l, text: "Double space." });
    if (/!!|\?\?/.test(cap)) issues.push({ kind: "grammar", lang: l, text: "Repeated punctuation." });
    if (l === "es" && /\?/.test(cap) && !/¿/.test(cap)) issues.push({ kind: "grammar", lang: l, text: "Spanish question without opening ¿." });
    if (l === "es" && /!/.test(cap) && !/¡/.test(cap)) issues.push({ kind: "grammar", lang: l, text: "Spanish exclamation without opening ¡." });
    if (/^[a-zà-ÿ]/.test(cap.trim())) issues.push({ kind: "grammar", lang: l, text: "Caption starts with a lowercase letter." });
  }
  return issues;
}

async function runQa(p: SPost, b: Brand): Promise<SPost> {
  const local = localQa(p, b);
  const r = await aiJson<{ issues: QaIssue[] }>(
    `You are the QA agent for a social media post written for a Tenerife business. Check ONLY grammar/spelling and local facts about Tenerife and the Canary Islands.
Brand: ${b.name} (${b.kind}) in ${b.town}. Known facts: ${b.facts}. Offers: ${b.offers}. Voice: ${b.voice}. Rules: ${b.rules}
Captions by language: ${JSON.stringify(p.captions)}
Flag wrong place names, wrong locations of landmarks, invented facts not in the known facts, and grammar errors (incl. Spanish ¿ ¡). Do not flag style choices.
JSON shape: {"issues":[{"kind":"grammar"|"fact","lang":"es","text":"short explanation and fix"}]}. Empty list if all good.`,
    () => ({ issues: demoAiQa(p, b) }),
    { tier: "quick" },
  );
  const ai = (r.data.issues ?? []).filter((i) => i.kind === "grammar" || i.kind === "fact");
  return { ...p, qa: { issues: [...local, ...ai], checkedAt: now(), live: r.live } };
}

// ---------- Demo content ----------

const PILLARS: { pillar: string; idea: string; text: Record<string, string> }[] = [
  { pillar: "Behind the scenes", idea: "Morning prep at {name}", text: {
    es: "Así empieza el día en {name}: {town} todavía dormido y nosotros preparándolo todo para ti.",
    en: "This is how a day starts at {name}: {town} still asleep and us getting everything ready for you.",
    de: "So beginnt ein Tag bei {name}: {town} schläft noch und wir bereiten alles für dich vor.",
    it: "Ecco come inizia la giornata da {name}: {town} dorme ancora e noi prepariamo tutto per te.",
    nl: "Zo begint een dag bij {name}: {town} slaapt nog en wij maken alles klaar voor jou.",
    fr: "Voici comment commence une journée chez {name} : {town} dort encore et nous préparons tout pour vous.",
    sv: "Så börjar en dag hos {name}: {town} sover fortfarande och vi gör allt klart för dig." } },
  { pillar: "Offer", idea: "This month's offer", text: {
    es: "Este mes en {name}: pregúntanos por la oferta del mes. Escríbenos y te lo reservamos.",
    en: "This month at {name}: ask us about the offer of the month. Send us a message and we'll save you a spot.",
    de: "Diesen Monat bei {name}: Frag uns nach dem Angebot des Monats. Schreib uns und wir reservieren für dich.",
    it: "Questo mese da {name}: chiedici l'offerta del mese. Scrivici e ti teniamo il posto.",
    nl: "Deze maand bij {name}: vraag ons naar de aanbieding van de maand. Stuur een bericht en we houden een plek vrij.",
    fr: "Ce mois-ci chez {name} : demandez-nous l'offre du mois. Écrivez-nous et on vous garde une place.",
    sv: "Den här månaden hos {name}: fråga oss om månadens erbjudande. Skicka ett meddelande så håller vi en plats." } },
  { pillar: "Local tip", idea: "Local tip near {town}", text: {
    es: "Consejo local: después de visitarnos, acércate al mirador más cercano al atardecer. {town} se ve distinto desde arriba.",
    en: "Local tip: after your visit, head to the nearest viewpoint at sunset. {town} looks different from up there.",
    de: "Tipp von Einheimischen: Geh nach deinem Besuch zum nächsten Aussichtspunkt zum Sonnenuntergang. {town} sieht von oben anders aus.",
    it: "Consiglio locale: dopo la visita, sali al belvedere più vicino al tramonto. {town} da lassù è un'altra cosa.",
    nl: "Lokale tip: ga na je bezoek bij zonsondergang naar het dichtstbijzijnde uitkijkpunt. {town} ziet er van boven anders uit.",
    fr: "Conseil local : après votre visite, montez au mirador le plus proche au coucher du soleil. {town} est différent vu d'en haut.",
    sv: "Lokalt tips: efter besöket, gå till närmaste utsiktsplats vid solnedgången. {town} ser annorlunda ut uppifrån." } },
  { pillar: "Customer moment", idea: "Guest photo of the week", text: {
    es: "La foto de la semana nos la mandó una familia de visita en {town}. Gracias por compartirla con nosotros.",
    en: "Photo of the week, sent by a family visiting {town}. Thank you for sharing it with us.",
    de: "Foto der Woche, geschickt von einer Familie zu Besuch in {town}. Danke fürs Teilen.",
    it: "La foto della settimana ce l'ha mandata una famiglia in visita a {town}. Grazie per averla condivisa.",
    nl: "Foto van de week, gestuurd door een gezin op bezoek in {town}. Bedankt voor het delen.",
    fr: "La photo de la semaine, envoyée par une famille en visite à {town}. Merci de l'avoir partagée.",
    sv: "Veckans bild, skickad av en familj på besök i {town}. Tack för att ni delade den." } },
  { pillar: "Team", idea: "Meet the team", text: {
    es: "Te presentamos al equipo de {name}. Gente de aquí que conoce {town} como nadie.",
    en: "Meet the team at {name}. Locals who know {town} better than anyone.",
    de: "Das ist das Team von {name}. Einheimische, die {town} wie ihre Westentasche kennen.",
    it: "Ecco il team di {name}. Gente del posto che conosce {town} come nessun altro.",
    nl: "Maak kennis met het team van {name}. Locals die {town} kennen als geen ander.",
    fr: "Voici l'équipe de {name}. Des gens d'ici qui connaissent {town} mieux que personne.",
    sv: "Möt teamet på {name}. Lokalbor som känner {town} bättre än någon annan." } },
  { pillar: "Question", idea: "Ask the audience", text: {
    es: "¿Mañana o tarde? Cuéntanos cuándo prefieres venir a {name}.",
    en: "Morning or afternoon? Tell us when you'd rather visit {name}.",
    de: "Morgens oder nachmittags? Sag uns, wann du lieber zu {name} kommst.",
    it: "Mattina o pomeriggio? Dicci quando preferisci venire da {name}.",
    nl: "Ochtend of middag? Laat ons weten wanneer je het liefst naar {name} komt.",
    fr: "Matin ou après-midi ? Dites-nous quand vous préférez venir chez {name}.",
    sv: "Förmiddag eller eftermiddag? Berätta när du helst besöker {name}." } },
];
const LANG_TAG: Record<string, string> = { es: "#VisitaTenerife", en: "#TenerifeHoliday", de: "#TeneriffaUrlaub", it: "#TenerifeVacanze", nl: "#TenerifeVakantie", fr: "#TenerifeVacances", sv: "#Teneriffa" };
const tagify = (s: string) => "#" + s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "");

interface DraftPost { day: number; format: Format; pillar: string; idea: string; captions: LangText; hashtags: LangTags }
function demoCalendar(b: Brand, month: string): DraftPost[] {
  const n = TIERS[b.tier].posts;
  const days = daysIn(month);
  const formats: Format[] = b.tier === "Base" ? ["Post", "Carousel", "Post"] : b.tier === "Standard" ? ["Post", "Carousel", "Reel", "Post"] : ["Post", "Story", "Carousel", "Reel", "Story"];
  return Array.from({ length: n }, (_, i) => {
    const p = PILLARS[(i + b.name.length) % PILLARS.length];
    const fill = (s: string) => s.replace(/\{name\}/g, b.name).replace(/\{town\}/g, b.town);
    return {
      day: Math.min(days, 1 + Math.floor((i * days) / n)),
      format: formats[i % formats.length],
      pillar: p.pillar,
      idea: fill(p.idea),
      captions: Object.fromEntries(b.languages.map((l) => [l, fill(p.text[l] ?? p.text.en)])) as LangText,
      hashtags: Object.fromEntries(b.languages.map((l) => [l, ["#Tenerife", tagify(b.town), tagify(b.kind), LANG_TAG[l] ?? "#Tenerife"]])) as LangTags,
    };
  });
}

const TEMPLATES = ["Photo + bottom caption bar", "Quote card on brand colour", "Carousel: cover + 4 tips", "Before/after split", "Story: question sticker frame", "Reel cover with big hook text"];
function demoGraphic(p: SPost, b: Brand): Graphic {
  const template = p.format === "Carousel" ? TEMPLATES[2] : p.format === "Story" ? TEMPLATES[4] : p.format === "Reel" ? TEMPLATES[5] : pick([TEMPLATES[0], TEMPLATES[1], TEMPLATES[3]], p.id);
  const tool: Tool = p.pillar === "Customer moment" || p.pillar === "Team" ? "Canva" : pick<Tool>(["Flux", "Ideogram", "Canva"], p.id);
  const prompt = tool === "Canva"
    ? `Use the client's real photo from the shared folder (${p.pillar.toLowerCase()}). Template "${template}", brand colours, headline: "${p.idea}". Keep faces natural, no filters.`
    : `Vertical 4:5 photo-style image, ${b.kind.toLowerCase()} in ${b.town}, Tenerife, soft late-afternoon light, volcanic landscape and Atlantic in the background, natural colours, no text, no logos, no people's faces in close-up. Theme: ${p.idea}.`;
  return { template, prompt, tool, live: false };
}

// ---------- Screen ----------

type TabId = "overview" | "brands" | "calendar" | "reels" | "qa" | "approval";

export default function Screen() {
  const [tab, setTab] = useState<TabId>("overview");
  const clients = useCollection<Client>("clients");
  const brands = useCollection<Brand>(COL.brands);
  const posts = useCollection<SPost>(COL.posts);
  const reels = useCollection<Reel>(COL.reels);
  const [brandId, setBrandId] = useState("");
  const [month, setMonth] = useState(thisMonth());
  const brand = brands.find((b) => b.id === brandId) ?? brands[0];
  const ctx: Ctx = { clients, brands, posts, reels, brand, month, setBrandId, setMonth };
  const flagged = posts.filter((p) => p.qa?.issues.length && p.status !== "approved").length;

  return (
    <Page plan="Plan 5 · White-label social" title="Agency Social"
      intro="Done-for-you multilingual posts that agencies resell under their own name. AI drafts and checks; you do the final pass.">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "overview", label: "Agencies & MRR" },
        { id: "brands", label: "Brand profiles", count: brands.length },
        { id: "calendar", label: "Calendar" },
        { id: "reels", label: "Reels", count: reels.filter((r) => r.status !== "approved").length },
        { id: "qa", label: "QA", count: flagged },
        { id: "approval", label: "Approval view" },
      ]} />
      {tab === "overview" && <Overview {...ctx} />}
      {tab === "brands" && <Brands {...ctx} />}
      {tab !== "overview" && tab !== "brands" && (brands.length
        ? <>
            <BrandBar {...ctx} />
            {tab === "calendar" && brand && <Calendar {...ctx} brand={brand} />}
            {tab === "reels" && brand && <Reels {...ctx} brand={brand} />}
            {tab === "qa" && brand && <Qa {...ctx} brand={brand} />}
            {tab === "approval" && brand && <Approval {...ctx} brand={brand} />}
          </>
        : <Empty action={<Button kind="primary" onClick={() => setTab("brands")}>Add a brand</Button>}>Add a brand profile first. Everything else is per brand and month.</Empty>)}
    </Page>
  );
}

interface Ctx {
  clients: Client[]; brands: Brand[]; posts: SPost[]; reels: Reel[]; brand?: Brand; month: string;
  setBrandId: (id: string) => void; setMonth: (m: string) => void;
}
const nameOf = (clients: Client[], id: string) => clients.find((c) => c.id === id)?.name ?? "No agency";

function BrandBar({ brands, brand, month, setBrandId, setMonth, clients }: Ctx) {
  return (
    <div className="row wrap">
      <Field label="Brand"><Select id="sb-brand" value={brand?.id ?? ""} onChange={setBrandId} options={brands.map((b) => ({ value: b.id, label: `${b.name} · ${nameOf(clients, b.agencyId)}` }))} /></Field>
      <Field label="Month"><Input id="sb-month" type="month" value={month} onChange={(m) => m && setMonth(m)} /></Field>
    </div>
  );
}

// ---------- Overview: agencies & concentration ----------

function Overview({ clients, brands, posts }: Ctx) {
  const payers = clients.map((c) => ({ c, mrr: c.subs.filter((s) => s.plan === "p5").reduce((n, s) => n + s.price, 0) })).filter((x) => x.mrr > 0 || brands.some((b) => b.agencyId === x.c.id));
  const total = payers.reduce((n, x) => n + x.mrr, 0);
  const rows = payers.map((x) => {
    const bs = brands.filter((b) => b.agencyId === x.c.id);
    const implied = bs.filter((b) => !b.pilot).reduce((n, b) => n + TIERS[b.tier].price, 0);
    return { ...x, brands: bs, implied, share: total ? x.mrr / total : 0 };
  }).sort((a, b) => b.mrr - a.mrr);
  const over = rows.filter((r) => r.share > CONCENTRATION_CAP);
  const month = thisMonth();

  return (
    <div className="stack">
      {over.map((r) => (
        <div key={r.c.id} className="banner" style={{ background: "var(--warn-soft)" }}>
          <span><span className="strong">Revenue concentration:</span> {r.c.name} is {Math.round(r.share * 100)}% of Agency Social MRR. The plan caps any one agency at 40%. Add direct brands or another agency before taking more brands from them.</span>
        </div>
      ))}
      <Stats>
        <Stat label="Agency Social MRR" value={eur(total)} sub={`${eur(total * 1.07)} with 7% IGIC (Canarian clients)`} tone="accent" />
        <Stat label="Brands" value={brands.length} sub={`${brands.filter((b) => b.pilot).length} on a free pilot month`} />
        <Stat label="Posts this month" value={posts.filter((p) => p.month === month).length} sub={`${posts.filter((p) => p.month === month && p.status === "approved").length} approved`} />
        <Stat label="Largest agency share" value={rows[0] ? Math.round(rows[0].share * 100) + "%" : "0%"} sub="Cap: 40%" tone={over.length ? "bad" : "good"} />
      </Stats>
      <Card title="Revenue by agency" aside={<span className="small faint">From client subscriptions (Plan 5)</span>}>
        <Table rows={rows} rowKey={(r) => r.c.id} empty="No agency subscriptions yet. Add a Plan 5 subscription on the client page."
          cols={[
            { label: "Agency", render: (r) => <div className="stack-sm"><span className="strong">{r.c.name}</span><span className="small faint">{r.c.town} · {r.c.stage}</span></div> },
            { label: "Brands", render: (r) => <span className="small">{r.brands.map((b) => b.name + (b.pilot ? " (pilot)" : "")).join(", ") || "None yet"}</span> },
            { label: "MRR", num: true, render: (r) => eur(r.mrr) },
            { label: "Share", render: (r) => (
              <div className="stack-sm" style={{ minWidth: 140 }}>
                <span className="small" style={{ color: r.share > CONCENTRATION_CAP ? "var(--bad)" : undefined }}>{Math.round(r.share * 100)}%</span>
                <div className="bar"><span style={{ width: `${r.share * 100}%`, background: r.share > CONCENTRATION_CAP ? "var(--bad)" : undefined }} /></div>
              </div>
            ) },
            { label: "Check", render: (r) => r.implied !== r.mrr
              ? <span className="small" style={{ color: "var(--warn)" }}>Paid brands imply {eur(r.implied)}. Update billing.</span>
              : <span className="small faint">Matches brands</span> },
          ]} />
      </Card>
      <Card title="Tiers per brand">
        <div className="grid-3">
          {(Object.keys(TIERS) as Tier[]).map((t) => (
            <div key={t} className="box stack-sm">
              <span className="row between"><span className="strong">{t}</span><span>{eur(TIERS[t].price)}/mo</span></span>
              <span className="small muted">{TIERS[t].posts} posts · {TIERS[t].reels} reels · {TIERS[t].langs} languages</span>
              <span className="small faint">{TIERS[t].extra}</span>
            </div>
          ))}
        </div>
        <p className="small faint">Mainland Spanish agencies: B2B invoices are likely reverse-charge. Confirm with the gestoría before invoicing. Offer one free brand month and a written quality guarantee.</p>
      </Card>
    </div>
  );
}

// ---------- Brand profiles ----------

const BLANK_BRAND = { agencyId: "", name: "", kind: "", town: "", voice: "", offers: "", facts: "", rules: "No exclamation marks. Max 8 hashtags.", banned: "", languages: ["es", "en"] as Lang[], tier: "Base" as Tier, pilot: false };

function Brands({ clients, brands, posts }: Ctx) {
  const [form, setForm] = useState(BLANK_BRAND);
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const set = (p: Partial<typeof form>) => setForm({ ...form, ...p });
  const cap = TIERS[form.tier].langs;

  function edit(b: Brand) {
    setForm({ agencyId: b.agencyId, name: b.name, kind: b.kind, town: b.town, voice: b.voice, offers: b.offers, facts: b.facts, rules: b.rules, banned: b.bannedWords.join(", "), languages: b.languages, tier: b.tier, pilot: b.pilot });
    setEditId(b.id); setOpen(true);
  }
  async function save() {
    if (!form.name.trim() || !form.agencyId) return toast("Name the brand and pick who pays for it.");
    if (form.languages.length > cap) return toast(`${form.tier} covers ${cap} languages.`);
    const { banned, ...rest } = form;
    const data = { ...rest, bannedWords: banned.split(",").map((w) => w.trim()).filter(Boolean) };
    const existing = brands.find((b) => b.id === editId);
    if (existing) await put<Brand>(COL.brands, { ...existing, ...data });
    else await create<Brand>(COL.brands, data);
    setOpen(false); setEditId(null); setForm(BLANK_BRAND); toast("Brand profile saved");
  }

  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="small muted">The intake form an agency fills per brand. The AI agents read this before every draft.</p>
        <Button kind="primary" onClick={() => { setForm(BLANK_BRAND); setEditId(null); setOpen(true); }}>New brand</Button>
      </div>
      {!brands.length && <Empty>No brand profiles yet. Start with a demo pack for a fictional Costa Adeje surf school.</Empty>}
      <div className="grid-2">
        {brands.map((b) => (
          <Card key={b.id} title={b.name} aside={<><Badge tone="accent">{b.tier}</Badge>{b.pilot && <Badge tone="warn">Free pilot</Badge>}</>}>
            <div className="stack-sm small">
              <span className="muted">{b.kind} · {b.town} · for <span className="strong">{nameOf(clients, b.agencyId)}</span></span>
              <span><span className="faint">Voice:</span> {b.voice || "Not set"}</span>
              <span><span className="faint">Offers:</span> {b.offers || "Not set"}</span>
              <span><span className="faint">Facts:</span> {b.facts || "Not set"}</span>
              <span><span className="faint">Rules:</span> {b.rules || "None"}</span>
              <span className="row wrap"><span className="faint">Banned:</span>{b.bannedWords.length ? b.bannedWords.map((w) => <Badge key={w} tone="bad">{w}</Badge>) : <span className="faint">None</span>}</span>
              <span className="row wrap"><span className="faint">Languages:</span>{b.languages.map((l) => <LangTag key={l} lang={l} />)}</span>
              <span className="faint">{posts.filter((p) => p.brandId === b.id).length} posts drafted so far</span>
            </div>
            <div className="row"><Button small onClick={() => edit(b)}>Edit</Button><ConfirmButton label="Delete" confirm="Delete brand" onConfirm={() => remove(COL.brands, b.id)} /></div>
          </Card>
        ))}
      </div>
      <Modal open={open} title={editId ? "Edit brand" : "New brand"} onClose={() => setOpen(false)} footer={<Button kind="primary" onClick={save}>Save</Button>}>
        <Form onSubmit={save}>
          <Field label="Name"><Input id="br-name" value={form.name} onChange={(v) => set({ name: v })} /></Field>
          <Field label="Agency (who pays)"><ClientPicker id="br-agency" clients={clients} value={form.agencyId} onChange={(v) => set({ agencyId: v })} allowNone="Choose" /></Field>
          <Field label="Kind"><Input id="br-kind" value={form.kind} onChange={(v) => set({ kind: v })} placeholder="Ice-cream shop" /></Field>
          <Field label="Town"><Input id="br-town" value={form.town} onChange={(v) => set({ town: v })} placeholder="Santa Cruz" /></Field>
          <Field label="Tier"><Select id="br-tier" value={form.tier} onChange={(t) => set({ tier: t, languages: form.languages.slice(0, TIERS[t].langs) })} options={Object.keys(TIERS) as Tier[]} /></Field>
          <Field label={`Languages (${form.languages.length}/${cap})`}><LangPicker value={form.languages} onChange={(l) => set({ languages: l })} /></Field>
          <Field label="Voice" wide><Input id="br-voice" value={form.voice} onChange={(v) => set({ voice: v })} placeholder="Warm, local, a bit playful. Uses tú." /></Field>
          <Field label="Offers" wide><TextArea id="br-offers" rows={2} value={form.offers} onChange={(v) => set({ offers: v })} placeholder="Exact offers and prices the posts may mention" /></Field>
          <Field label="Facts" wide><TextArea id="br-facts" rows={2} value={form.facts} onChange={(v) => set({ facts: v })} placeholder="Opening hours, address, what makes them different" /></Field>
          <Field label="Brand rules" wide><Input id="br-rules" value={form.rules} onChange={(v) => set({ rules: v })} /></Field>
          <Field label="Banned words" hint="Comma separated, any language" wide><Input id="br-banned" value={form.banned} onChange={(v) => set({ banned: v })} placeholder="barato, cheap, el mejor" /></Field>
          <label className="row small"><input type="checkbox" checked={form.pilot} onChange={(e) => set({ pilot: e.target.checked })} /> Free first month (pilot)</label>
        </Form>
      </Modal>
    </div>
  );
}

// ---------- Calendar ----------

function Calendar({ posts, brand, month }: Ctx & { brand: Brand }) {
  const [busy, setBusy] = useState(false);
  const [gfxBusy, setGfxBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [openId, setOpenId] = useState<string | null>(null);
  const list = posts.filter((p) => p.brandId === brand.id && p.month === month).sort((a, b) => a.date.localeCompare(b.date));
  const quota = TIERS[brand.tier].posts;

  async function generate() {
    setBusy(true);
    const r = await aiJson<{ posts: DraftPost[] }>(
      `Plan a social media content calendar for ${monthLabel(month)} for a Tenerife business. It will be resold white-label by an agency, so never mention any studio or agency.
Brand: ${brand.name} (${brand.kind}) in ${brand.town}. Voice: ${brand.voice}. Offers (only mention these, exact prices): ${brand.offers}. Facts: ${brand.facts}. Rules: ${brand.rules}. Never use these words: ${brand.bannedWords.join(", ") || "none"}.
Write exactly ${quota} posts spread over the month. Formats allowed: ${brand.tier === "Base" ? "Post, Carousel" : brand.tier === "Standard" ? "Post, Carousel, Reel" : "Post, Carousel, Reel, Story"}.
Mix pillars: behind the scenes, offer, local tip, customer moment, team, question. Captions native in each language: ${brand.languages.map((l) => LANGS[l]).join(", ")}; up to ${MAX_HASHTAGS} hashtags per language, local and language specific.
JSON shape: {"posts":[{"day":3,"format":"Post","pillar":"Local tip","idea":"short internal title","captions":{"${brand.languages.join('":"...","')}":"..."},"hashtags":{"${brand.languages[0]}":["#Tenerife"]}}]}`,
      () => ({ posts: demoCalendar(brand, month) }),
      { tier: "complex" },
    );
    setErr(r.error);
    for (const p of list.filter((x) => x.status !== "approved")) await remove(COL.posts, p.id);
    const days = daysIn(month);
    const room = Math.max(0, quota - list.filter((x) => x.status === "approved").length);
    for (const d of r.data.posts.slice(0, room)) {
      await create<SPost>(COL.posts, {
        brandId: brand.id, month, date: `${month}-${String(Math.min(days, Math.max(1, d.day))).padStart(2, "0")}`, format: d.format, pillar: d.pillar, idea: d.idea,
        captions: d.captions, hashtags: d.hashtags, live: r.live, status: "draft",
      });
    }
    setBusy(false);
    toast(`${Math.min(room, r.data.posts.length)} posts drafted for ${monthLabel(month)}`);
  }

  async function briefAll() {
    const missing = list.filter((p) => !p.graphic);
    if (!missing.length) return toast("Every post already has a graphic brief.");
    setGfxBusy(true);
    const r = await aiJson<{ briefs: { id: string; template: string; prompt: string; tool: Tool }[] }>(
      `Write graphic briefs for these social posts for ${brand.name} (${brand.kind}, ${brand.town}, Tenerife). Prefer the client's real photos via Canva templates; use Flux or Ideogram only for backgrounds with no people and no text.
Templates available: ${TEMPLATES.join("; ")}.
Posts: ${JSON.stringify(missing.map((p) => ({ id: p.id, format: p.format, pillar: p.pillar, idea: p.idea })))}
JSON shape: {"briefs":[{"id":"post id","template":"one of the templates","prompt":"image prompt or Canva instructions","tool":"Canva"|"Flux"|"Ideogram"}]}`,
      () => ({ briefs: missing.map((p) => ({ id: p.id, ...demoGraphic(p, brand) })) }),
    );
    for (const g of r.data.briefs) {
      const p = missing.find((x) => x.id === g.id);
      if (p) await put<SPost>(COL.posts, { ...p, graphic: { template: g.template, prompt: g.prompt, tool: g.tool, live: r.live } });
    }
    setGfxBusy(false);
    toast("Graphic briefs ready (Canva and Flux not connected, copy the prompts)");
  }

  const open = list.find((p) => p.id === openId) ?? null;
  return (
    <div className="stack">
      <Card title={`${brand.name} · ${monthLabel(month)}`} aside={<>
        <span className="small muted">{list.length} of {quota} posts</span>
        <Button small onClick={briefAll} busy={gfxBusy} disabled={!list.length}>Graphic briefs</Button>
        <Button small kind="primary" onClick={generate} busy={busy}>{list.length ? "Redo drafts" : "Generate month"}</Button>
      </>}>
        {err && <p className="small" style={{ color: "var(--warn)" }}>{err}</p>}
        {list.length > 0 && list.some((p) => p.status === "approved") && <p className="small faint">Redo keeps approved posts and replaces the rest.</p>}
        <Table rows={list} rowKey={(p) => p.id} onRow={(p) => setOpenId(p.id)}
          empty={`No posts for ${monthLabel(month)}. Generate the month to draft ${quota} posts with captions and hashtags in ${brand.languages.map((l) => l.toUpperCase()).join(", ")}.`}
          cols={[
            { label: "Date", render: (p) => <span className="small">{fmtDate(p.date)}</span> },
            { label: "Format", render: (p) => <Badge tone="info">{p.format}</Badge> },
            { label: "Post", render: (p) => <div className="stack-sm"><span>{p.idea}</span><span className="small faint">{(p.captions[brand.languages[0]] ?? "").slice(0, 80)}...</span></div> },
            { label: "Graphic", render: (p) => p.graphic ? <Badge tone="good">{p.graphic.tool}</Badge> : <span className="small faint">None</span> },
            { label: "QA", render: (p) => !p.qa ? <span className="small faint">Not run</span> : p.qa.issues.length ? <Badge tone="bad">{p.qa.issues.length} issues</Badge> : <Badge tone="good">Clean</Badge> },
            { label: "Status", render: (p) => <Badge tone={STATUS_TONE[p.status]}>{p.status === "changes" ? "Changes" : p.status === "approved" ? "Approved" : "Draft"}</Badge> },
          ]} />
      </Card>
      <PostEditor post={open} brand={brand} onClose={() => setOpenId(null)} />
    </div>
  );
}

function PostEditor({ post, brand, onClose }: { post: SPost | null; brand: Brand; onClose: () => void }) {
  const [busy, setBusy] = useState<"" | "qa" | "gfx">("");
  if (!post) return null;
  const save = (p: Partial<SPost>) => put<SPost>(COL.posts, { ...post, ...p });

  async function gfx() {
    if (!post) return;
    setBusy("gfx");
    const r = await aiJson<Graphic>(
      `Write one graphic brief for a ${post.format} for ${brand.name} (${brand.kind}, ${brand.town}, Tenerife). Idea: ${post.idea}. Pillar: ${post.pillar}.
Templates: ${TEMPLATES.join("; ")}. Prefer real client photos in Canva; Flux or Ideogram only for backgrounds without people or text.
JSON shape: {"template":"...","prompt":"...","tool":"Canva"|"Flux"|"Ideogram"}`,
      () => demoGraphic(post, brand),
    );
    await save({ graphic: { ...r.data, live: r.live } });
    setBusy("");
  }
  async function qa() {
    if (!post) return;
    setBusy("qa");
    await put<SPost>(COL.posts, await runQa(post, brand));
    setBusy("");
  }

  return (
    <Modal open title={`${post.format} · ${fmtDate(post.date)}`} onClose={onClose} footer={<>
      <Button onClick={() => save({ status: "changes" })}>Needs changes</Button>
      <Button kind="primary" disabled={!!post.qa?.issues.length} title={post.qa?.issues.length ? "Fix QA issues first" : ""} onClick={() => save({ status: "approved" }).then(() => { toast("Approved"); onClose(); })}>Approve</Button>
    </>}>
      <div className="row wrap"><Badge tone={post.live ? "accent" : "neutral"}>{post.live ? "AI draft" : "Demo draft"}</Badge><span className="small muted">{post.pillar} · {post.idea}</span></div>
      <Field label="Date"><Input id="pe-date" type="date" value={post.date} onChange={(d) => save({ date: d })} /></Field>
      {brand.languages.map((l) => (
        <div key={l} className="stack-sm">
          <Field label={`Caption · ${LANGS[l]}`}><TextArea id={`pe-cap-${l}`} rows={3} value={post.captions[l] ?? ""} onChange={(v) => save({ captions: { ...post.captions, [l]: v } })} /></Field>
          <Field label="Hashtags"><Input id={`pe-tag-${l}`} value={(post.hashtags[l] ?? []).join(" ")} onChange={(v) => save({ hashtags: { ...post.hashtags, [l]: v.split(/\s+/).filter(Boolean) } })} /></Field>
        </div>
      ))}
      <hr className="divider" />
      <div className="row between wrap"><span className="strong">Graphic brief</span><Button small busy={busy === "gfx"} onClick={gfx}>{post.graphic ? "Redo" : "Write brief"}</Button></div>
      {post.graphic ? (
        <div className="box stack-sm small">
          <span className="row wrap"><Badge tone="info">{post.graphic.tool}</Badge><span className="strong">{post.graphic.template}</span><Badge tone={post.graphic.live ? "accent" : "neutral"}>{post.graphic.live ? "AI draft" : "Demo draft"}</Badge></span>
          <span className="muted">{post.graphic.prompt}</span>
          <span><CopyButton text={post.graphic.prompt} label="Copy prompt" /></span>
        </div>
      ) : <p className="small faint">No graphic brief yet.</p>}
      <hr className="divider" />
      <div className="row between wrap"><span className="strong">QA agent</span><Button small busy={busy === "qa"} onClick={qa}>{post.qa ? "Check again" : "Run QA"}</Button></div>
      <IssueList issues={post.qa?.issues} />
    </Modal>
  );
}

function IssueList({ issues }: { issues?: QaIssue[] }) {
  if (!issues) return <p className="small faint">Not checked yet.</p>;
  if (!issues.length) return <p className="small" style={{ color: "var(--good)" }}>No issues found.</p>;
  return (
    <ul className="stack-sm small" style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
      {issues.map((i, n) => <li key={n} className="row wrap"><Badge tone={ISSUE_TONE[i.kind]}>{ISSUE_LABEL[i.kind]}</Badge>{i.lang && <LangTag lang={i.lang} />}<span>{i.text}</span></li>)}
    </ul>
  );
}

// ---------- Reels ----------

function Reels({ reels, brand, month }: Ctx & { brand: Brand }) {
  const [form, setForm] = useState({ footage: "", seconds: "45", tool: "Submagic" as Reel["tool"] });
  const [busyId, setBusyId] = useState("");
  const list = reels.filter((r) => r.brandId === brand.id && r.month === month);
  const quota = TIERS[brand.tier].reels;

  async function add() {
    if (!form.footage.trim()) return toast("Add the footage file name.");
    if (list.length >= quota) return toast(quota ? `${brand.tier} includes ${quota} reels a month.` : "Base has no reels. Upgrade to Standard.");
    await create<Reel>(COL.reels, { brandId: brand.id, month, footage: form.footage.trim(), seconds: Number(form.seconds) || 0, tool: form.tool, subtitleLangs: brand.languages, status: "footage" });
    setForm({ ...form, footage: "" });
  }
  async function plan(r: Reel) {
    setBusyId(r.id);
    const res = await aiJson<{ hook: string; cut: string[] }>(
      `Plan a 15 to 30 second subtitled vertical reel cut from client footage "${r.footage}" (${r.seconds} s) for ${brand.name} (${brand.kind}, ${brand.town}, Tenerife). Voice: ${brand.voice}. No banned words: ${brand.bannedWords.join(", ")}.
JSON shape: {"hook":"on-screen hook in ${LANGS[brand.languages[0]]}, max 8 words","cut":["00:00-00:03 hook over best moment","..."]}`,
      () => ({
        hook: pick([`Un día normal en ${brand.town}`, `Lo que no ves de ${brand.name}`, `3 segundos de ${brand.town}`], r.id),
        cut: ["00:00-00:03 Hook text over the most striking frame", `00:03-00:10 Best action from ${r.footage}, natural sound`, "00:10-00:18 Two close-ups, captions in each language", "00:18-00:22 Logo-free end card with the agency's CTA"],
      }),
    );
    await put<Reel>(COL.reels, { ...r, hook: res.data.hook, cut: res.data.cut, live: res.live, status: r.status === "footage" ? "editing" : r.status });
    setBusyId("");
  }

  return (
    <div className="split">
      <Card title="Add client footage">
        <p className="small muted">{brand.tier}: {quota} reels a month. Reels are cut from the client's own footage with {"Submagic or CapCut"} templates (not connected, steps are simulated).</p>
        <Form onSubmit={add}>
          <Field label="Footage file" wide><Input id="rl-file" value={form.footage} onChange={(v) => setForm({ ...form, footage: v })} placeholder="VID_20261012_terrace.mp4" /></Field>
          <Field label="Seconds"><Input id="rl-sec" type="number" min={1} value={form.seconds} onChange={(v) => setForm({ ...form, seconds: v })} /></Field>
          <Field label="Tool"><Select id="rl-tool" value={form.tool} onChange={(v) => setForm({ ...form, tool: v })} options={["Submagic", "CapCut"]} /></Field>
          <div className="row"><Button type="submit" kind="primary" disabled={list.length >= quota}>Add reel</Button></div>
        </Form>
      </Card>
      <Card title={`Reels · ${list.length} of ${quota}`}>
        {!list.length && <Empty>{quota ? "No reels this month. Add the footage the client sent." : "Base tier has no reels. Standard includes 4, Premium 8."}</Empty>}
        {list.map((r) => (
          <div key={r.id} className="box stack-sm">
            <div className="row between wrap">
              <span className="mono">{r.footage}</span>
              <span className="row"><Badge tone={r.status === "approved" ? "good" : r.status === "ready" ? "accent" : "neutral"}>{r.status}</Badge><Badge>{r.tool}</Badge></span>
            </div>
            <span className="small faint">{r.seconds} s raw · subtitles {r.subtitleLangs.map((l) => l.toUpperCase()).join(" ")}</span>
            {r.hook && <span className="small"><span className="faint">Hook:</span> {r.hook} <Badge tone={r.live ? "accent" : "neutral"}>{r.live ? "AI draft" : "Demo draft"}</Badge></span>}
            {r.cut && <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.cut.map((c, i) => <li key={i}>{c}</li>)}</ol>}
            <div className="row wrap">
              <Button small busy={busyId === r.id} onClick={() => plan(r)}>{r.cut ? "Re-plan cut" : "Plan cut"}</Button>
              {r.status !== "approved" && <Button small onClick={() => put<Reel>(COL.reels, { ...r, status: REEL_NEXT[r.status] })}>Move to {REEL_NEXT[r.status]}</Button>}
              <ConfirmButton label="Remove" confirm="Remove" onConfirm={() => remove(COL.reels, r.id)} />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ---------- QA board ----------

function Qa({ posts, brand, month }: Ctx & { brand: Brand }) {
  const [busy, setBusy] = useState(false);
  const list = posts.filter((p) => p.brandId === brand.id && p.month === month).sort((a, b) => a.date.localeCompare(b.date));
  const flagged = list.filter((p) => p.qa?.issues.length);
  const counts = flagged.flatMap((p) => p.qa!.issues).reduce<Record<string, number>>((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }), {});

  async function checkAll() {
    setBusy(true);
    let issues = 0;
    for (const p of list) {
      const next = await runQa(p, brand);
      issues += next.qa!.issues.length;
      await put<SPost>(COL.posts, next);
    }
    setBusy(false);
    if (issues) {
      await create<Task>("tasks", { title: `Fix ${issues} QA issues in ${brand.name} ${monthLabel(month)} posts`, module: "social", clientId: brand.agencyId, due: dayOffset(1), done: false });
      toast(`${issues} issues found. Added a task to Today.`);
    } else toast("All posts passed QA");
  }

  return (
    <div className="stack">
      <Stats>
        <Stat label="Checked" value={`${list.filter((p) => p.qa).length}/${list.length}`} />
        <Stat label="Posts flagged" value={flagged.length} tone={flagged.length ? "bad" : "good"} />
        <Stat label="Banned words" value={counts.banned ?? 0} />
        <Stat label="Local facts" value={counts.fact ?? 0} />
      </Stats>
      <Card title="QA agent" aside={<Button small kind="primary" busy={busy} disabled={!list.length} onClick={checkAll}>Check whole month</Button>}>
        <p className="small muted">Checks banned words, brand rules (hashtag count, story length, punctuation), missing languages and unknown prices locally, then asks the AI for grammar and Tenerife facts.</p>
        {!list.length && <Empty>No posts this month yet. Generate the calendar first.</Empty>}
        {list.length > 0 && !flagged.length && list.every((p) => p.qa) && <Empty>Every post passed. Open the approval view to share with the agency.</Empty>}
        {flagged.map((p) => (
          <div key={p.id} className="box stack-sm">
            <div className="row between wrap"><span className="strong">{fmtDate(p.date)} · {p.idea}</span><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></div>
            <IssueList issues={p.qa?.issues} />
            {p.qa?.issues.filter((i) => i.lang).slice(0, 1).map((i, n) => <div key={n} className="small faint">{LANGS[i.lang!]}: "{p.captions[i.lang!]}"</div>)}
          </div>
        ))}
      </Card>
    </div>
  );
}

// ---------- White-label approval view ----------

function Approval({ posts, reels, brand, month }: Ctx & { brand: Brand }) {
  const [clean, setClean] = useState(false);
  const list = posts.filter((p) => p.brandId === brand.id && p.month === month && p.status !== "changes").sort((a, b) => a.date.localeCompare(b.date));
  const rl = reels.filter((r) => r.brandId === brand.id && r.month === month && (r.status === "ready" || r.status === "approved"));
  const unchecked = list.filter((p) => !p.qa || p.qa.issues.length).length;
  const token = (brand.id + month).split("").reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(36);
  const link = `https://approve.example/${token}`;

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); } catch { /* clipboard blocked */ }
    toast("Link copied. Sharing is simulated: no approval page is hosted yet.");
  }

  return (
    <div className="stack">
      <div className="banner">
        <span className="small">This is what the agency's client sees: their brand only, no {BRAND} name or logo, read-only.</span>
        <span className="row wrap"><Button small onClick={() => setClean(true)} disabled={!list.length}>Open clean view</Button><Button small kind="primary" onClick={copyLink} disabled={!list.length}>Copy approval link</Button></span>
      </div>
      {unchecked > 0 && <p className="small" style={{ color: "var(--warn)" }}>{unchecked} post{unchecked === 1 ? "" : "s"} not QA-clean yet. Fix them before sending.</p>}
      {list.length ? <WhiteLabel brand={brand} month={month} posts={list} reels={rl} /> : <Empty>Nothing to preview for {monthLabel(month)}. Generate and check posts first.</Empty>}
      <Modal open={clean} title={`${brand.name} · ${monthLabel(month)}`} onClose={() => setClean(false)}>
        <WhiteLabel brand={brand} month={month} posts={list} reels={rl} />
      </Modal>
    </div>
  );
}

function WhiteLabel({ brand, month, posts, reels }: { brand: Brand; month: string; posts: SPost[]; reels: Reel[] }) {
  return (
    <div className="stack">
      <div className="stack-sm">
        <h2>{brand.name}</h2>
        <span className="muted small">Content plan for {monthLabel(month)} · {posts.length} posts{reels.length ? ` · ${reels.length} reels` : ""}</span>
      </div>
      {posts.map((p) => (
        <Card key={p.id} title={<span className="row wrap">{fmtDate(p.date)} <Badge tone="info">{p.format}</Badge></span>} aside={p.status === "approved" ? <Badge tone="good">Ready</Badge> : <Badge>For review</Badge>}>
          {p.graphic && <div className="box small muted">Visual: {p.graphic.template}</div>}
          {brand.languages.map((l) => (
            <div key={l} className="stack-sm">
              <span className="row"><LangTag lang={l} /></span>
              <p className="pre">{p.captions[l]}</p>
              <span className="small" style={{ color: "var(--accent)" }}>{(p.hashtags[l] ?? []).join(" ")}</span>
            </div>
          ))}
        </Card>
      ))}
      {reels.map((r) => (
        <Card key={r.id} title={<span className="row">Reel <Badge tone="info">{r.seconds} s source</Badge></span>}>
          <p>{r.hook ?? "Reel from your footage"}</p>
          <span className="small muted">Subtitles: {r.subtitleLangs.map((l) => LANGS[l]).join(", ")}</span>
        </Card>
      ))}
    </div>
  );
}

// ---------- Seed ----------

export async function seed(): Promise<void> {
  const month = thisMonth();
  const surf: Brand = example("ex-social-brand-surf", {
    agencyId: EX.agency, name: "Adeje Surf Lab", kind: "Surf school", town: "Costa Adeje",
    voice: "Relaxed, encouraging, uses tú. Short sentences.", offers: "Beginner lesson 2 h 45 €. 5-lesson pack 199 €.",
    facts: "Lessons at Playa del Duque and La Izquierda. Boards and wetsuits included. Groups of max 6.",
    rules: "No exclamation marks. Max 8 hashtags. Never promise waves.", bannedWords: ["cheap", "barato", "baratas", "guaranteed"],
    languages: ["es", "en"] as Lang[], tier: "Base" as Tier, pilot: false,
  });
  const helados: Brand = example("ex-social-brand-helados", {
    agencyId: EX.agency, name: "Heladería La Recova", kind: "Ice-cream shop", town: "Santa Cruz",
    voice: "Warm and local, proud of Canarian ingredients.", offers: "Cone 3,50 €. Gofio and banana flavour all year.",
    facts: "Next to Mercado de Nuestra Señora de África. Open 11:00 to 22:00, closed Mondays.",
    rules: "No emoji. Max 8 hashtags.", bannedWords: ["el mejor", "best in the world", "artificial"],
    languages: ["es", "en", "de"] as Lang[], tier: "Standard" as Tier, pilot: true,
  });
  for (const b of [surf, helados]) await put(COL.brands, b);

  for (const b of [surf, helados]) {
    const drafts = demoCalendar(b, month);
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      const id = `ex-social-post-${b.id.slice(16)}-${i + 1}`;
      let captions = d.captions;
      if (b === surf && i === 1) captions = { ...captions, es: "Clases de surf baratas en Costa Adeje, ¡ven a probar!", en: "Cheap surf lessons in Costa Adeje, come and try!" };
      if (b === helados && i === 2) captions = { ...captions, en: "Local tip: after your ice cream, walk to the Las Palmas seafront for the sunset." };
      const rec: SPost = example(id, {
        brandId: b.id, month, date: `${month}-${String(d.day).padStart(2, "0")}`, format: d.format, pillar: d.pillar, idea: d.idea,
        captions, hashtags: d.hashtags, live: false, status: (i < 4 ? "approved" : "draft") as PostStatus,
      });
      rec.graphic = i < 6 ? demoGraphic(rec, b) : undefined;
      if (i < 6) {
        const issues = [...localQa(rec, b), ...demoAiQa(rec, b)];
        rec.qa = { issues, checkedAt: now(), live: false };
        if (issues.length) rec.status = "changes";
      }
      await put(COL.posts, rec);
    }
  }

  await put(COL.reels, example("ex-social-reel-1", {
    brandId: helados.id, month, footage: "VID_20261009_mostrador.mp4", seconds: 52, tool: "Submagic" as const,
    hook: "Gofio con plátano, todo el año", cut: ["00:00-00:03 Scoop of gofio ice cream close-up", "00:03-00:12 Counter and market crowd", "00:12-00:20 Cone handed to a customer, captions ES EN"],
    subtitleLangs: ["es", "en", "de"] as Lang[], live: false, status: "ready" as ReelStatus,
  }));

  await put<Task>("tasks", example("ex-social-task-1", {
    title: "Fix banned word and Las Palmas fact before sending Nordeste the approval link", module: "social", clientId: EX.agency, due: dayOffset(1), done: false,
  }));
}
