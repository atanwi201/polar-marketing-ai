// Plan 2 · UGC Ad Factory: multilingual short videos built on real footage.
import { useMemo, useState } from "react";
import {
  Page, Card, Button, Field, Input, TextArea, Select, Form, Tabs, Badge, Stat, Stats, Table, Empty,
  CopyButton, LangPicker, LangTag, ClientPicker, Modal, ConfirmButton, toast, fmtDate, type Tone,
} from "../core/ui";
import { useCollection, create, put, remove, today, now } from "../core/store";
import { aiJson, pick } from "../core/ai";
import { eur, LANGS } from "../core/plans";
import { EX, EXAMPLE_CLIENTS, example, dayOffset } from "../core/seed";
import type { Client, Lang, Rec, Task } from "../core/types";

// ---------- Types ----------

type Tier = "Starter" | "Growth" | "Pro";
const TIERS: Record<Tier, { videos: number; langs: number; price: number; extra: string }> = {
  Starter: { videos: 4, langs: 2, price: 199, extra: "Captions and hooks" },
  Growth: { videos: 8, langs: 4, price: 399, extra: "Monthly half-day shoot" },
  Pro: { videos: 12, langs: 4, price: 599, extra: "Meta ad variants and testing" },
};
const VIDEO_LANGS: Lang[] = ["es", "en", "de", "it"];
type LangText = Partial<Record<Lang, string>>;
type LangLines = Partial<Record<Lang, string[]>>;

interface Shot { shot: string; how: string; seconds: number }
interface Brief extends Rec {
  clientId: string; title: string; offer: string; audience: string; goal: string; tone: string;
  location: string; languages: Lang[]; tier: Tier; notes: string;
  shots?: Shot[]; shotsLang?: "es" | "en"; shotsLive?: boolean;
}
type ClipSource = "WhatsApp" | "Google Drive";
type ClipStatus = "new" | "tagged" | "used" | "rejected";
interface RawClip extends Rec {
  clientId: string; fileName: string; source: ClipSource; tags: string[]; seconds: number; receivedAt: string; status: ClipStatus; note?: string;
}
interface Hook { angle: string; text: LangText }
interface Script { hooks: Hook[]; beats: string[]; captions: LangLines; voiceover: LangLines; cta: LangText }
type Voice = "none" | "client" | "synthetic";
type RenderStep = "draft" | "queued" | "voiceover" | "rendering" | "ready" | "failed";
interface Video extends Rec {
  clientId: string; briefId: string; title: string; month: string; languages: Lang[]; clipIds: string[];
  script?: Script; scriptLive?: boolean; voice: Voice; avatar: boolean; aiLabel: boolean;
  render: Partial<Record<Lang, RenderStep>>; approved: boolean;
}
type Placement = "Instagram Reel" | "Facebook Reel" | "Instagram Story";
interface Post extends Rec {
  videoId: string; clientId: string; hook: number; lang: Lang; date: string; time: string; placement: Placement;
  status: "scheduled" | "posted"; views: number; clicks: number;
}

const COL = { briefs: "video_briefs", clips: "video_clips", videos: "video_videos", posts: "video_posts" } as const;
const HOOK_LETTERS = ["A", "B", "C"];
const thisMonth = () => today().slice(0, 7);

// ---------- Helpers ----------

function clientTier(c: Client | undefined, briefs: Brief[]): { tier: Tier; paid: boolean } {
  const sub = c?.subs.find((s) => s.plan === "p2");
  if (sub && sub.tier in TIERS) return { tier: sub.tier as Tier, paid: true };
  const b = briefs.filter((x) => x.clientId === c?.id).sort((a, z) => z.createdAt.localeCompare(a.createdAt))[0];
  return { tier: b?.tier ?? "Starter", paid: false };
}

/** EU AI Act art. 50: synthetic voice or avatar must be disclosed. */
const labelForced = (v: Pick<Video, "voice" | "avatar">) => v.voice === "synthetic" || v.avatar;

const LABEL_TEXT: Record<string, Record<"voice" | "avatar" | "both" | "edit", string>> = {
  es: { voice: "Voz generada con IA", avatar: "Avatar generado con IA", both: "Voz y avatar generados con IA", edit: "Editado con ayuda de IA" },
  en: { voice: "AI-generated voice", avatar: "AI-generated avatar", both: "AI-generated voice and avatar", edit: "Edited with AI assistance" },
  de: { voice: "KI-generierte Stimme", avatar: "KI-generierter Avatar", both: "KI-generierte Stimme und Avatar", edit: "Mit KI-Unterstützung bearbeitet" },
  it: { voice: "Voce generata con IA", avatar: "Avatar generato con IA", both: "Voce e avatar generati con IA", edit: "Montato con l'aiuto dell'IA" },
};
function labelText(v: Pick<Video, "voice" | "avatar">, lang: Lang): string {
  const t = LABEL_TEXT[lang] ?? LABEL_TEXT.en;
  if (v.voice === "synthetic" && v.avatar) return t.both;
  if (v.voice === "synthetic") return t.voice;
  if (v.avatar) return t.avatar;
  return t.edit;
}

const STEP_TONE: Record<RenderStep, Tone> = { draft: "neutral", queued: "info", voiceover: "accent", rendering: "accent", ready: "good", failed: "bad" };
const STEP_LABEL: Record<RenderStep, string> = {
  draft: "Not queued", queued: "Queued", voiceover: "ElevenLabs voiceover", rendering: "Creatomate render", ready: "Ready", failed: "Failed",
};
function nextStep(s: RenderStep, voice: Voice): RenderStep {
  if (s === "queued") return voice === "synthetic" ? "voiceover" : "rendering";
  if (s === "voiceover") return "rendering";
  if (s === "rendering") return "ready";
  if (s === "failed") return "queued";
  return s;
}

const ctr = (clicks: number, views: number) => (views ? clicks / views : 0);
const pct = (x: number) => (x * 100).toFixed(1) + "%";

// ---------- Demo content ----------

type Kind = "surf" | "boat" | "dive" | "food";
function kindOf(c?: Client): Kind {
  const k = (c?.kind ?? "").toLowerCase();
  if (k.includes("surf")) return "surf";
  if (k.includes("boat") || k.includes("whale") || k.includes("excursion")) return "boat";
  if (k.includes("dive")) return "dive";
  return "food";
}

const HOOK_BANK: { angle: string; text: Record<string, string> }[] = [
  { angle: "Curiosity", text: { es: "Esto no te lo cuentan de {town}...", en: "Nobody tells you this about {town}...", de: "Das verrät dir keiner über {town}...", it: "Nessuno ti dice questo su {town}..." } },
  { angle: "POV", text: { es: "POV: tu primera mañana en {town}", en: "POV: your first morning in {town}", de: "POV: dein erster Morgen in {town}", it: "POV: la tua prima mattina a {town}" } },
  { angle: "One free day", text: { es: "¿Solo tienes un día libre en Tenerife?", en: "Only one free day in Tenerife?", de: "Nur einen freien Tag auf Teneriffa?", it: "Solo un giorno libero a Tenerife?" } },
  { angle: "Reaction", text: { es: "Su cara cuando pasó esto", en: "Their face when this happened", de: "Ihr Gesicht, als das passierte", it: "La loro faccia quando è successo" } },
  { angle: "3 reasons", text: { es: "3 razones para no irte de Tenerife sin esto", en: "3 reasons not to leave Tenerife without this", de: "3 Gründe, Teneriffa nicht ohne das zu verlassen", it: "3 motivi per non lasciare Tenerife senza questo" } },
];

const LINES: Record<Kind, { captions: Record<string, string[]>; vo: Record<string, string[]>; subject: Record<"es" | "en", string> }> = {
  surf: {
    subject: { es: "la tabla y las olas", en: "the board and the waves" },
    captions: {
      es: ["Primera ola en 2 horas", "Tabla y neopreno incluidos", "Grupos pequeños"],
      en: ["First wave in 2 hours", "Board and wetsuit included", "Small groups"],
      de: ["Erste Welle in 2 Stunden", "Brett und Neoprenanzug inklusive", "Kleine Gruppen"],
      it: ["Prima onda in 2 ore", "Tavola e muta incluse", "Gruppi piccoli"],
    },
    vo: {
      es: ["Nunca te habías subido a una tabla.", "Dos horas después, estás de pie sobre tu primera ola en El Médano.", "Escríbenos por WhatsApp y reserva tu clase."],
      en: ["You've never stood on a board.", "Two hours later you're riding your first wave in El Médano.", "Message us on WhatsApp to book your lesson."],
      de: ["Du standest noch nie auf einem Brett.", "Zwei Stunden später reitest du deine erste Welle in El Médano.", "Schreib uns auf WhatsApp und buch deinen Kurs."],
      it: ["Non sei mai salito su una tavola.", "Due ore dopo cavalchi la tua prima onda a El Médano.", "Scrivici su WhatsApp e prenota la tua lezione."],
    },
  },
  boat: {
    subject: { es: "el barco y el mar", en: "the boat and the sea" },
    captions: {
      es: ["Calderones a pocos metros", "Salidas a las 10:00 y 14:00", "Recogida en hoteles del sur"],
      en: ["Pilot whales metres away", "Trips at 10:00 and 14:00", "Hotel pickup in the south"],
      de: ["Grindwale zum Greifen nah", "Abfahrten 10:00 und 14:00", "Hotelabholung im Süden"],
      it: ["Globicefali a pochi metri", "Partenze alle 10:00 e 14:00", "Ritiro in hotel al sud"],
    },
    vo: {
      es: ["Salimos del puerto de Los Cristianos.", "Y a los veinte minutos, los calderones aparecen junto al barco.", "Reserva tu plaza por WhatsApp."],
      en: ["We leave Los Cristianos harbour.", "Twenty minutes later, pilot whales surface right next to the boat.", "Book your seat on WhatsApp."],
      de: ["Wir legen im Hafen von Los Cristianos ab.", "Zwanzig Minuten später tauchen Grindwale direkt neben dem Boot auf.", "Reserviere deinen Platz per WhatsApp."],
      it: ["Partiamo dal porto di Los Cristianos.", "Venti minuti dopo, i globicefali emergono accanto alla barca.", "Prenota il tuo posto su WhatsApp."],
    },
  },
  dive: {
    subject: { es: "el equipo y el fondo marino", en: "the gear and the reef" },
    captions: {
      es: ["Tu primera inmersión", "Instructores certificados", "Agua a 22 °C"],
      en: ["Your first dive", "Certified instructors", "22 °C water"],
      de: ["Dein erster Tauchgang", "Zertifizierte Tauchlehrer", "22 °C Wasser"],
      it: ["La tua prima immersione", "Istruttori certificati", "Acqua a 22 °C"],
    },
    vo: {
      es: ["Respiras bajo el agua por primera vez.", "Tortugas, rayas y roca volcánica en Puerto de la Cruz.", "Pregúntanos por WhatsApp."],
      en: ["You breathe underwater for the first time.", "Turtles, rays and volcanic rock off Puerto de la Cruz.", "Ask us on WhatsApp."],
      de: ["Du atmest zum ersten Mal unter Wasser.", "Schildkröten, Rochen und Vulkangestein vor Puerto de la Cruz.", "Frag uns auf WhatsApp."],
      it: ["Respiri sott'acqua per la prima volta.", "Tartarughe, razze e roccia vulcanica a Puerto de la Cruz.", "Chiedici su WhatsApp."],
    },
  },
  food: {
    subject: { es: "el producto y las manos", en: "the product and your hands" },
    captions: {
      es: ["Hecho en Tenerife", "Receta de la familia", "Pruébalo esta semana"],
      en: ["Made in Tenerife", "Family recipe", "Try it this week"],
      de: ["Hergestellt auf Teneriffa", "Familienrezept", "Probier es diese Woche"],
      it: ["Prodotto a Tenerife", "Ricetta di famiglia", "Provalo questa settimana"],
    },
    vo: {
      es: ["Así se hace, igual que hace cuarenta años.", "Ingredientes de la isla y mucha paciencia.", "Encuéntranos en el mercado o escríbenos."],
      en: ["This is how it's made, just like forty years ago.", "Island ingredients and a lot of patience.", "Find us at the market or message us."],
      de: ["So wird es gemacht, wie vor vierzig Jahren.", "Zutaten von der Insel und viel Geduld.", "Finde uns auf dem Markt oder schreib uns."],
      it: ["Si fa così, come quarant'anni fa.", "Ingredienti dell'isola e tanta pazienza.", "Trovaci al mercato o scrivici."],
    },
  },
};
const CTA: Record<string, string> = { es: "Reserva por WhatsApp · enlace en la bio", en: "Book on WhatsApp · link in bio", de: "Buchung per WhatsApp · Link in der Bio", it: "Prenota su WhatsApp · link in bio" };

function demoScript(c: Client | undefined, b: Brief | undefined, langs: Lang[], seed: string): Script {
  const k = kindOf(c);
  const town = b?.location || c?.town || "Tenerife";
  const start = Math.abs([...seed].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7)) % HOOK_BANK.length;
  const hooks = [0, 1, 2].map((i) => HOOK_BANK[(start + i * 2) % HOOK_BANK.length]).map((h) => ({
    angle: h.angle,
    text: Object.fromEntries(langs.map((l) => [l, (h.text[l] ?? h.text.en).replace("{town}", town)])) as LangText,
  }));
  const pickLang = <T,>(src: Record<string, T>) => Object.fromEntries(langs.map((l) => [l, src[l] ?? src.en]));
  return {
    hooks,
    beats: [
      "0-3 s: Hook on screen over the strongest real clip, no logo yet",
      `3-10 s: ${pick(["Close-up", "Hand-held walk-in", "Wide establishing shot"], seed)} from the raw footage, natural sound`,
      "10-18 s: Two quick cuts showing the offer: " + (b?.offer || "the main experience"),
      "18-24 s: Happy customer moment, caption 3",
      "24-28 s: CTA card with WhatsApp button and brand colours",
    ],
    captions: pickLang(LINES[k].captions) as LangLines,
    voiceover: pickLang(LINES[k].vo) as LangLines,
    cta: pickLang(CTA) as LangText,
  };
}

const SHOT_TEMPLATES: Record<"es" | "en", { shot: string; how: string; seconds: number }[]> = {
  en: [
    { shot: "Arrival wide shot", how: "Hold the phone upright (9:16), stand still for 5 seconds, show the place and the sea.", seconds: 5 },
    { shot: "Close-up of {subject}", how: "Get 30 cm close, tap to focus, no zoom.", seconds: 4 },
    { shot: "Customer reaction", how: "Ask permission first. Film a smile or a high five, side light, no sunglasses if possible.", seconds: 3 },
    { shot: "Action moment", how: "Lock exposure on the brightest area, follow the action slowly.", seconds: 8 },
    { shot: "Team at work", how: "Film hands preparing or explaining, from the side.", seconds: 4 },
    { shot: "Owner to camera", how: "One sentence: what makes you different. Quiet spot, phone at eye level.", seconds: 6 },
    { shot: "Ending shot", how: "Slow pan away from the group towards the horizon.", seconds: 5 },
  ],
  es: [
    { shot: "Plano general de llegada", how: "Móvil en vertical (9:16), quieto 5 segundos, que se vea el sitio y el mar.", seconds: 5 },
    { shot: "Primer plano de {subject}", how: "Acércate a 30 cm, toca para enfocar, sin zoom.", seconds: 4 },
    { shot: "Reacción del cliente", how: "Pide permiso antes. Graba una sonrisa o un choque de manos, con luz lateral.", seconds: 3 },
    { shot: "Momento de acción", how: "Bloquea la exposición en la zona más clara y sigue la acción despacio.", seconds: 8 },
    { shot: "Equipo trabajando", how: "Graba las manos preparando o explicando, desde un lado.", seconds: 4 },
    { shot: "Dueño a cámara", how: "Una frase: qué os hace diferentes. Sitio tranquilo, móvil a la altura de los ojos.", seconds: 6 },
    { shot: "Plano final", how: "Paneo lento desde el grupo hacia el horizonte.", seconds: 5 },
  ],
};
function demoShots(c: Client | undefined, lang: "es" | "en"): Shot[] {
  const subject = LINES[kindOf(c)].subject[lang];
  return SHOT_TEMPLATES[lang].map((s) => ({ ...s, shot: s.shot.replace("{subject}", subject) }));
}

const AUTO_TAGS: Record<Kind, string[]> = {
  surf: ["surf", "waves", "lesson", "beach", "wetsuit", "sunset"],
  boat: ["boat", "whales", "dolphins", "harbour", "guests", "sea"],
  dive: ["dive", "underwater", "turtle", "briefing", "gear", "boat"],
  food: ["product", "kitchen", "hands", "market", "close-up", "family"],
};

// ---------- Screen ----------

type TabId = "overview" | "briefs" | "clips" | "videos" | "queue" | "posts";

export default function Screen() {
  const [tab, setTab] = useState<TabId>("overview");
  const clients = useCollection<Client>("clients");
  const briefs = useCollection<Brief>(COL.briefs);
  const clips = useCollection<RawClip>(COL.clips);
  const videos = useCollection<Video>(COL.videos);
  const posts = useCollection<Post>(COL.posts);
  const [openVideo, setOpenVideo] = useState<string>("");
  const ctx: Ctx = { clients, briefs, clips, videos, posts, openVideo: (id) => { setOpenVideo(id); setTab("videos"); } };
  const inQueue = videos.reduce((n, v) => n + Object.values(v.render).filter((s) => s === "queued" || s === "voiceover" || s === "rendering").length, 0);

  return (
    <Page plan="Plan 2 · UGC Ad Factory" title="Video Ads"
      intro="Short multilingual Reels built on real footage. AI writes hooks, scripts and voiceovers; you film, check and polish.">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "overview", label: "Quota" },
        { id: "briefs", label: "Briefs", count: briefs.length },
        { id: "clips", label: "Clip intake", count: clips.filter((c) => c.status === "new").length },
        { id: "videos", label: "Scripts", count: videos.length },
        { id: "queue", label: "Render queue", count: inQueue },
        { id: "posts", label: "Schedule & results", count: posts.length },
      ]} />
      {tab === "overview" && <Overview {...ctx} />}
      {tab === "briefs" && <Briefs {...ctx} />}
      {tab === "clips" && <Clips {...ctx} />}
      {tab === "videos" && <Videos {...ctx} selected={openVideo} onSelect={setOpenVideo} />}
      {tab === "queue" && <Queue {...ctx} />}
      {tab === "posts" && <Posts {...ctx} />}
    </Page>
  );
}

interface Ctx { clients: Client[]; briefs: Brief[]; clips: RawClip[]; videos: Video[]; posts: Post[]; openVideo: (id: string) => void }
const nameOf = (clients: Client[], id: string) => clients.find((c) => c.id === id)?.name ?? "Unknown client";

// ---------- Overview / quota ----------

function Overview({ clients, briefs, videos, posts }: Ctx) {
  const month = thisMonth();
  const ids = new Set([...clients.filter((c) => c.subs.some((s) => s.plan === "p2")).map((c) => c.id), ...briefs.map((b) => b.clientId)]);
  const rows = clients.filter((c) => ids.has(c.id)).map((c) => {
    const { tier, paid } = clientTier(c, briefs);
    const used = videos.filter((v) => v.clientId === c.id && v.month === month).length;
    return { c, tier, paid, used, quota: TIERS[tier].videos };
  });
  const posted = posts.filter((p) => p.status === "posted");
  const views = posted.reduce((n, p) => n + p.views, 0);
  const clicks = posted.reduce((n, p) => n + p.clicks, 0);
  const mrr = rows.filter((r) => r.paid).reduce((n, r) => n + TIERS[r.tier].price, 0);

  return (
    <div className="stack">
      <Stats>
        <Stat label="Videos this month" value={videos.filter((v) => v.month === month).length} sub={`of ${rows.reduce((n, r) => n + r.quota, 0)} in quotas`} />
        <Stat label="Video Ads MRR" value={eur(mrr)} sub="Paid tiers, excl. 7% IGIC" tone="accent" />
        <Stat label="Views logged" value={views.toLocaleString("en-GB")} sub={`${posted.length} posts`} />
        <Stat label="Click rate" value={pct(ctr(clicks, views))} sub={`${clicks} clicks`} tone="good" />
      </Stats>
      <Card title="Monthly quota by client" aside={<span className="small muted">Starter 4 · Growth 8 · Pro 12 videos</span>}>
        <Table rows={rows} rowKey={(r) => r.c.id}
          empty="No video clients yet. Add a brief to start a pilot."
          cols={[
            { label: "Client", render: (r) => <div className="stack-sm"><span className="strong">{r.c.name}</span><span className="small faint">{r.c.town}</span></div> },
            { label: "Tier", render: (r) => <span className="row wrap"><Badge tone="accent">{r.tier}</Badge>{!r.paid && <Badge tone="warn">Pilot</Badge>}</span> },
            { label: "Used", render: (r) => (
              <div className="stack-sm" style={{ minWidth: 140 }}>
                <span className="small">{r.used} of {r.quota}{r.used >= r.quota ? " · quota reached" : ""}</span>
                <div className="bar"><span style={{ width: `${Math.min(100, (r.used / r.quota) * 100)}%` }} /></div>
              </div>
            ) },
            { label: "Languages", render: (r) => <span className="small">{TIERS[r.tier].langs} ({r.tier === "Starter" ? "pick 2" : "ES EN DE IT"})</span> },
            { label: "Price", num: true, render: (r) => <span className="stack-sm"><span>{eur(TIERS[r.tier].price)}</span><span className="small faint">{eur(TIERS[r.tier].price * 1.07)} with IGIC</span></span> },
          ]} />
      </Card>
      <Card title="Ground rules">
        <ul className="stack-sm small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Every video starts from real footage. AI handles editing, voice and languages, never fake scenes.</li>
          <li>Synthetic voice or avatar means the AI label is on. The app forces it.</li>
          <li>Product brands: aim ads at residents, tourists and existing mainland distributors (shipping off the islands is hard).</li>
          <li>Clients film with the shot list so filming hours stay low.</li>
        </ul>
      </Card>
    </div>
  );
}

// ---------- Briefs + shot lists ----------

const BLANK_BRIEF = { clientId: "", title: "", offer: "", audience: "", goal: "", tone: "Warm, energetic, real", location: "", languages: ["es", "en"] as Lang[], tier: "Starter" as Tier, notes: "" };

function Briefs({ clients, briefs, videos, openVideo }: Ctx) {
  const [form, setForm] = useState(BLANK_BRIEF);
  const [adding, setAdding] = useState(false);
  const set = (p: Partial<typeof form>) => setForm({ ...form, ...p });
  const langCap = TIERS[form.tier].langs;

  async function save() {
    if (!form.clientId || !form.title.trim()) return toast("Pick a client and give the brief a title.");
    if (form.languages.length > langCap) return toast(`${form.tier} includes ${langCap} languages.`);
    await create<Brief>(COL.briefs, { ...form, location: form.location || clients.find((c) => c.id === form.clientId)?.town || "" });
    setForm(BLANK_BRIEF); setAdding(false); toast("Brief saved");
  }

  async function newVideo(b: Brief) {
    const c = clients.find((x) => x.id === b.clientId);
    const { tier } = clientTier(c, briefs);
    const used = videos.filter((v) => v.clientId === b.clientId && v.month === thisMonth()).length;
    if (used >= TIERS[tier].videos) return toast(`Quota reached: ${used} of ${TIERS[tier].videos} videos this month on ${tier}.`);
    const v = await create<Video>(COL.videos, {
      clientId: b.clientId, briefId: b.id, title: b.title + ` #${used + 1}`, month: thisMonth(), languages: b.languages,
      clipIds: [], voice: "client", avatar: false, aiLabel: false, render: {}, approved: false,
    });
    toast("Video created. Run the script agent next.");
    openVideo(v.id);
  }

  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="muted small">One brief per campaign. Each brief can produce several videos within the monthly quota.</p>
        <Button kind="primary" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "New brief"}</Button>
      </div>
      {adding && (
        <Card title="New client brief">
          <Form onSubmit={save}>
            <Field label="Client"><ClientPicker id="vb-client" clients={clients} value={form.clientId} onChange={(id) => {
              const c = clients.find((x) => x.id === id);
              set({ clientId: id, tier: clientTier(c, briefs).tier, location: c?.town ?? "" });
            }} allowNone="Choose client" /></Field>
            <Field label="Tier"><Select id="vb-tier" value={form.tier} onChange={(t) => set({ tier: t, languages: form.languages.slice(0, TIERS[t].langs) })} options={Object.keys(TIERS) as Tier[]} /></Field>
            <Field label="Title"><Input id="vb-title" value={form.title} onChange={(v) => set({ title: v })} placeholder="Sunset trip Reel" /></Field>
            <Field label="Location"><Input id="vb-loc" value={form.location} onChange={(v) => set({ location: v })} placeholder="Los Cristianos harbour" /></Field>
            <Field label="Offer" wide><Input id="vb-offer" value={form.offer} onChange={(v) => set({ offer: v })} placeholder="What the viewer can book, in the client's words" /></Field>
            <Field label="Audience"><Input id="vb-aud" value={form.audience} onChange={(v) => set({ audience: v })} placeholder="German couples in Costa Adeje" /></Field>
            <Field label="Goal"><Input id="vb-goal" value={form.goal} onChange={(v) => set({ goal: v })} placeholder="WhatsApp bookings" /></Field>
            <Field label="Tone"><Input id="vb-tone" value={form.tone} onChange={(v) => set({ tone: v })} /></Field>
            <Field label={`Languages (${form.languages.length}/${langCap})`}><LangPicker value={form.languages} onChange={(l) => set({ languages: l })} options={VIDEO_LANGS} /></Field>
            <Field label="Notes" wide><TextArea id="vb-notes" rows={2} value={form.notes} onChange={(v) => set({ notes: v })} placeholder="Must-show moments, things to avoid" /></Field>
            <div className="row"><Button type="submit" kind="primary">Save brief</Button></div>
          </Form>
        </Card>
      )}
      {!briefs.length && !adding && <Empty action={<Button kind="primary" onClick={() => setAdding(true)}>Write the first brief</Button>}>No briefs yet. A brief holds the offer, audience and languages for a batch of videos.</Empty>}
      {briefs.map((b) => <BriefCard key={b.id} b={b} client={clients.find((c) => c.id === b.clientId)} videoCount={videos.filter((v) => v.briefId === b.id).length} onNewVideo={() => newVideo(b)} />)}
    </div>
  );
}

function BriefCard({ b, client, videoCount, onNewVideo }: { b: Brief; client?: Client; videoCount: number; onNewVideo: () => void }) {
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<"es" | "en">(b.shotsLang ?? "es");
  const [err, setErr] = useState<string>();

  async function genShots() {
    setBusy(true);
    const r = await aiJson<{ shots: Shot[] }>(
      `Write a phone shot list a small business owner can film alone for a 9:16 short video ad.
Business: ${client?.name} (${client?.kind}) in ${client?.town}. Notes: ${client?.notes ?? ""}
Brief: "${b.title}". Offer: ${b.offer}. Audience: ${b.audience}. Goal: ${b.goal}. Location: ${b.location}. Must show / avoid: ${b.notes}
Write in ${lang === "es" ? "Spanish" : "English"}, plain words, 6 to 8 shots, each 3 to 8 seconds, real footage only (no staged fake reviews).
Include filming tips: vertical, no zoom, ask permission before filming customers.
JSON shape: {"shots":[{"shot":"short name","how":"one or two sentences on how to film it","seconds":5}]}`,
      () => ({ shots: demoShots(client, lang) }),
    );
    setErr(r.error);
    await put<Brief>(COL.briefs, { ...b, shots: r.data.shots, shotsLang: lang, shotsLive: r.live });
    setBusy(false);
  }

  const shotText = (b.shots ?? []).map((s, i) => `${i + 1}. ${s.shot} (${s.seconds} s): ${s.how}`).join("\n");
  return (
    <Card title={b.title} aside={<>
      <Badge tone="accent">{b.tier}</Badge>{b.languages.map((l) => <LangTag key={l} lang={l} />)}
      <ConfirmButton label="Delete" confirm="Delete brief" onConfirm={() => remove(COL.briefs, b.id)} />
    </>}>
      <div className="grid-2">
        <div className="stack-sm small">
          <span className="strong">{client?.name ?? "Unknown client"} · {b.location}</span>
          <span><span className="faint">Offer:</span> {b.offer || "Not set"}</span>
          <span><span className="faint">Audience:</span> {b.audience || "Not set"}</span>
          <span><span className="faint">Goal:</span> {b.goal || "Not set"} · <span className="faint">Tone:</span> {b.tone}</span>
          {b.notes && <span><span className="faint">Notes:</span> {b.notes}</span>}
          <div className="row wrap" style={{ marginTop: 6 }}>
            <Button small kind="primary" onClick={onNewVideo}>New video from brief</Button>
            <span className="faint">{videoCount} video{videoCount === 1 ? "" : "s"} so far</span>
          </div>
        </div>
        <div className="stack">
          <div className="row between wrap">
            <span className="strong">Shot list for the client's phone</span>
            <span className="row">
              <Select id={"shots-lang-" + b.id} value={lang} onChange={setLang} options={[{ value: "es", label: "Spanish" }, { value: "en", label: "English" }]} />
              <Button small busy={busy} onClick={genShots}>{b.shots ? "Redo" : "Generate"}</Button>
            </span>
          </div>
          {err && <p className="small" style={{ color: "var(--warn)" }}>{err}</p>}
          {b.shots?.length ? (
            <div className="box stack-sm">
              <div className="row between"><Badge tone={b.shotsLive ? "accent" : "neutral"}>{b.shotsLive ? "AI draft" : "Demo draft"}</Badge><CopyButton text={shotText} label="Copy for WhatsApp" /></div>
              <ol className="small stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
                {b.shots.map((s, i) => <li key={i}><span className="strong">{s.shot}</span> <span className="faint">({s.seconds} s)</span><br /><span className="muted">{s.how}</span></li>)}
              </ol>
            </div>
          ) : <p className="small faint">No shot list yet. Clients film it on their phone and send clips by WhatsApp.</p>}
        </div>
      </div>
    </Card>
  );
}

// ---------- Clip intake ----------

function Clips({ clients, clips }: Ctx) {
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState({ clientId: "", fileName: "", source: "WhatsApp" as ClipSource, tags: "", seconds: "12" });
  const rows = clips.filter((c) => !filter || c.clientId === filter).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  async function add() {
    if (!form.clientId || !form.fileName.trim()) return toast("Pick a client and a file name.");
    const tags = form.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    await create<RawClip>(COL.clips, { clientId: form.clientId, fileName: form.fileName.trim(), source: form.source, tags, seconds: Number(form.seconds) || 0, receivedAt: now(), status: tags.length ? "tagged" : "new" });
    setForm({ ...form, fileName: "", tags: "" });
    toast("Clip logged");
  }

  async function simulate() {
    const pool = clients.filter((c) => c.subs.some((s) => s.plan === "p2") || ["surf", "boat", "dive"].includes(kindOf(c)));
    if (!pool.length) return toast("Add a video client first.");
    const n = clips.length + 1;
    const c = pool[n % pool.length];
    const src: ClipSource = n % 2 ? "WhatsApp" : "Google Drive";
    const t = new Date();
    const stamp = `${t.toISOString().slice(0, 10)} at ${String(t.getHours()).padStart(2, "0")}.${String(t.getMinutes()).padStart(2, "0")}.${String(t.getSeconds()).padStart(2, "0")}`;
    const fileName = src === "WhatsApp" ? `WhatsApp Video ${stamp}.mp4` : `IMG_${4100 + n}.MOV`;
    const bank = AUTO_TAGS[kindOf(c)];
    const tags = [bank[n % bank.length], bank[(n + 2) % bank.length], c.town.toLowerCase()];
    await create<RawClip>(COL.clips, { clientId: c.id, fileName, source: src, tags, seconds: 6 + (n * 7) % 30, receivedAt: now(), status: "tagged", note: "Auto-tagged by intake (simulated)" });
    toast(`New clip from ${c.name} via ${src} (simulated, n8n not connected)`);
  }

  return (
    <div className="split">
      <Card title="Log a clip">
        <p className="small muted">Clips arrive by WhatsApp or a shared Drive folder. The intake flow tags each one to a client. Neither is connected yet, so log them here.</p>
        <Form onSubmit={add}>
          <Field label="Client" wide><ClientPicker id="vc-client" clients={clients} value={form.clientId} onChange={(id) => setForm({ ...form, clientId: id })} allowNone="Choose client" /></Field>
          <Field label="Source"><Select id="vc-src" value={form.source} onChange={(v) => setForm({ ...form, source: v })} options={["WhatsApp", "Google Drive"]} /></Field>
          <Field label="Seconds"><Input id="vc-sec" type="number" min={1} value={form.seconds} onChange={(v) => setForm({ ...form, seconds: v })} /></Field>
          <Field label="File name" wide><Input id="vc-file" value={form.fileName} onChange={(v) => setForm({ ...form, fileName: v })} placeholder="WhatsApp Video 2026-10-17 at 10.42.13.mp4" /></Field>
          <Field label="Tags" hint="Comma separated" wide><Input id="vc-tags" value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} placeholder="whales, guests, sunset" /></Field>
          <div className="row wrap"><Button type="submit" kind="primary">Log clip</Button><Button onClick={simulate}>Simulate arrival</Button></div>
        </Form>
      </Card>
      <Card title="Intake log" aside={<ClientPicker id="vc-filter" clients={clients} value={filter} onChange={setFilter} allowNone="All clients" />}>
        <Table rows={rows} rowKey={(r) => r.id}
          empty="No clips yet. Send the client a shot list, then log what arrives."
          cols={[
            { label: "File", render: (r) => <div className="stack-sm"><span className="mono">{r.fileName}</span><span className="small faint">{nameOf(clients, r.clientId)} · {r.seconds} s</span></div> },
            { label: "Source", render: (r) => <Badge tone={r.source === "WhatsApp" ? "good" : "info"}>{r.source}</Badge> },
            { label: "Tags", render: (r) => <span className="row wrap">{r.tags.map((t) => <span key={t} className="lang-tag">{t}</span>)}{!r.tags.length && <span className="faint small">Untagged</span>}</span> },
            { label: "Received", render: (r) => <span className="small">{fmtDate(r.receivedAt)}</span> },
            { label: "Status", render: (r) => (
              <Select id={"cs-" + r.id} value={r.status} onChange={(s) => put<RawClip>(COL.clips, { ...r, status: s })}
                options={[{ value: "new", label: "New" }, { value: "tagged", label: "Tagged" }, { value: "used", label: "Used" }, { value: "rejected", label: "Unusable" }]} />
            ) },
          ]} />
      </Card>
    </div>
  );
}

// ---------- Videos: script agent, hooks, AI label ----------

function Videos({ clients, briefs, clips, videos, selected, onSelect }: Ctx & { selected: string; onSelect: (id: string) => void }) {
  const current = videos.find((v) => v.id === selected) ?? videos[0];
  if (!videos.length) return <Empty>No videos yet. Open a brief and press "New video from brief".</Empty>;
  return (
    <div className="split">
      <Card title="Videos">
        <Table rows={videos} rowKey={(v) => v.id} onRow={(v) => onSelect(v.id)}
          cols={[
            { label: "Video", render: (v) => <div className="stack-sm"><span className={v.id === current?.id ? "strong" : ""}>{v.title}</span><span className="small faint">{nameOf(clients, v.clientId)} · {v.month}</span></div> },
            { label: "State", render: (v) => <span className="row wrap">{v.script ? <Badge tone="good">Script</Badge> : <Badge>No script</Badge>}{v.aiLabel && <Badge tone="warn">AI label</Badge>}</span> },
          ]} />
      </Card>
      {current && <VideoDetail key={current.id} v={current} client={clients.find((c) => c.id === current.clientId)} brief={briefs.find((b) => b.id === current.briefId)} clips={clips.filter((c) => c.clientId === current.clientId && c.status !== "rejected")} />}
    </div>
  );
}

function VideoDetail({ v, client, brief, clips }: { v: Video; client?: Client; brief?: Brief; clips: RawClip[] }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [lang, setLang] = useState<Lang>(v.languages[0] ?? "es");
  const forced = labelForced(v);
  const save = (p: Partial<Video>) => {
    const next = { ...v, ...p };
    if (labelForced(next)) next.aiLabel = true;
    return put<Video>(COL.videos, next);
  };

  async function runAgent() {
    setBusy(true);
    const used = clips.filter((c) => v.clipIds.includes(c.id));
    const r = await aiJson<Script>(
      `You are the script agent for short vertical video ads (9:16, 20 to 30 seconds) built on REAL footage of a Tenerife business.
Business: ${client?.name} (${client?.kind}) in ${client?.town}. Known facts: ${client?.notes ?? "none"}
Brief: "${brief?.title}". Offer: ${brief?.offer}. Audience: ${brief?.audience}. Goal: ${brief?.goal}. Tone: ${brief?.tone}. Location: ${brief?.location}. Notes: ${brief?.notes}
Raw clips to cut from: ${used.length ? used.map((c) => `${c.fileName} [${c.tags.join(", ")}] ${c.seconds}s`).join("; ") : "not chosen yet, assume typical footage from the shot list"}
Voiceover: ${v.voice === "synthetic" ? "synthetic AI voice (ElevenLabs)" : v.voice === "client" ? "the owner's own voice" : "none, captions only"}.
Languages: ${v.languages.map((l) => LANGS[l]).join(", ")}. Write each language natively, not as a literal translation. Use only facts given above, no invented prices or claims.
Write 3 hooks with clearly different angles for an A/B/C test (max 8 words each).
JSON shape: {"hooks":[{"angle":"Curiosity","text":{"${v.languages.join('":"...","')}":"..."}}],"beats":["0-3 s: ..."],"captions":{"${v.languages[0]}":["on-screen line 1","line 2","line 3"]},"voiceover":{"${v.languages[0]}":["sentence 1","sentence 2","sentence 3"]},"cta":{"${v.languages[0]}":"..."}}
captions, voiceover and cta must contain every language code listed: ${v.languages.join(", ")}.`,
      () => demoScript(client, brief, v.languages, v.id),
    );
    setErr(r.error);
    await save({ script: r.data, scriptLive: r.live, approved: false });
    setBusy(false);
  }

  function toggleClip(id: string) {
    void save({ clipIds: v.clipIds.includes(id) ? v.clipIds.filter((x) => x !== id) : [...v.clipIds, id] });
  }

  async function queueRender() {
    if (!v.script) return toast("Write the script first.");
    const render = { ...v.render };
    v.languages.forEach((l) => { if (!render[l] || render[l] === "draft" || render[l] === "failed") render[l] = "queued"; });
    await save({ render });
    toast("Sent to the render queue (ElevenLabs and Creatomate not connected, statuses are simulated)");
  }

  const s = v.script;
  const scriptText = s ? [
    "HOOKS", ...s.hooks.map((h, i) => `${HOOK_LETTERS[i]} (${h.angle}): ${h.text[lang] ?? ""}`),
    "", "BEATS", ...s.beats, "", "CAPTIONS", ...(s.captions[lang] ?? []), "", "VOICEOVER", ...(s.voiceover[lang] ?? []), "", "CTA", s.cta[lang] ?? "",
    ...(v.aiLabel ? ["", "LABEL", labelText(v, lang)] : []),
  ].join("\n") : "";

  return (
    <div className="stack">
      <Card title={v.title} aside={<>{v.languages.map((l) => <LangTag key={l} lang={l} />)}<ConfirmButton label="Delete" confirm="Delete video" onConfirm={() => remove(COL.videos, v.id)} /></>}>
        <p className="small muted">{client?.name} · Brief: {brief?.title ?? "deleted"} · {brief?.offer}</p>
        <div className="grid-2">
          <Field label="Voiceover">
            <Select id="vv-voice" value={v.voice} onChange={(voice) => save({ voice })} options={[
              { value: "client", label: "Owner's own voice" }, { value: "synthetic", label: "AI voice (ElevenLabs)" }, { value: "none", label: "No voice, captions only" },
            ]} />
          </Field>
          <div className="stack-sm">
            <label className="row small"><input type="checkbox" checked={v.avatar} onChange={(e) => save({ avatar: e.target.checked })} /> Uses an AI avatar or presenter</label>
            <label className="row small" title={forced ? "Required by EU AI Act transparency rules" : ""}>
              <input type="checkbox" checked={v.aiLabel || forced} disabled={forced} onChange={(e) => save({ aiLabel: e.target.checked })} />
              EU AI Act label on video {forced && <Badge tone="warn">Required</Badge>}
            </label>
            {(v.aiLabel || forced) && <span className="small faint">On screen: "{labelText(v, v.languages[0] ?? "en")}"</span>}
          </div>
        </div>
        <div className="stack-sm">
          <span className="field-label">Raw clips for this edit</span>
          {clips.length ? (
            <div className="chips">
              {clips.map((c) => <button key={c.id} type="button" className={"chip" + (v.clipIds.includes(c.id) ? " chip-on" : "")} aria-pressed={v.clipIds.includes(c.id)} onClick={() => toggleClip(c.id)} title={c.tags.join(", ")}>{c.fileName.length > 28 ? c.fileName.slice(0, 26) + "..." : c.fileName}</button>)}
            </div>
          ) : <span className="small faint">No clips from this client yet. Log them in Clip intake.</span>}
        </div>
        <div className="row wrap">
          <Button kind="primary" busy={busy} onClick={runAgent}>{s ? "Rewrite script" : "Run script agent"}</Button>
          <Button disabled={!s || v.approved} onClick={() => save({ approved: true }).then(() => toast("Script approved"))}>{v.approved ? "Approved" : "Approve script"}</Button>
          <Button disabled={!s} onClick={queueRender}>Send to render</Button>
        </div>
        {err && <p className="small" style={{ color: "var(--warn)" }}>{err}</p>}
      </Card>
      {s ? (
        <Card title="Script" aside={<>
          <Badge tone={v.scriptLive ? "accent" : "neutral"}>{v.scriptLive ? "AI draft" : "Demo draft"}</Badge>
          <Select id="vv-lang" value={lang} onChange={setLang} options={v.languages.map((l) => ({ value: l, label: LANGS[l] }))} />
          <CopyButton text={scriptText} />
        </>}>
          <div className="stack-sm">
            <span className="field-label">Hook variants for A/B/C test</span>
            {s.hooks.map((h, i) => (
              <div key={i} className="box row between wrap">
                <span><span className="strong">{HOOK_LETTERS[i]}</span> · {h.text[lang] ?? <span className="faint">missing in {lang.toUpperCase()}</span>}</span>
                <Badge tone="info">{h.angle}</Badge>
              </div>
            ))}
          </div>
          <div className="grid-2">
            <div className="stack-sm"><span className="field-label">Beats</span><ol className="small stack-sm" style={{ margin: 0, paddingLeft: 18 }}>{s.beats.map((b, i) => <li key={i}>{b}</li>)}</ol></div>
            <div className="stack-sm"><span className="field-label">On-screen captions</span><ol className="small stack-sm" style={{ margin: 0, paddingLeft: 18 }}>{(s.captions[lang] ?? []).map((c, i) => <li key={i}>{c}</li>)}</ol></div>
          </div>
          <div className="stack-sm">
            <span className="field-label">Voiceover lines {v.voice === "none" && <span className="faint">(not used, captions only)</span>}</span>
            <div className="box small pre">{(s.voiceover[lang] ?? []).join("\n")}</div>
          </div>
          <div className="row wrap small"><span className="faint">CTA:</span> {s.cta[lang]}</div>
          {v.aiLabel && <div className="banner small"><span><span className="strong">AI label</span> · {labelText(v, lang)}</span><span className="faint">Shown on screen and in the post caption</span></div>}
        </Card>
      ) : <Empty>No script yet. Pick the raw clips, then run the script agent.</Empty>}
    </div>
  );
}

// ---------- Render queue ----------

function Queue({ clients, videos }: Ctx) {
  const rows = videos.flatMap((v) => v.languages.filter((l) => v.render[l] && v.render[l] !== "draft").map((l) => ({ v, l, s: v.render[l] as RenderStep })));
  async function advance(v: Video, l: Lang) {
    await put<Video>(COL.videos, { ...v, render: { ...v.render, [l]: nextStep(v.render[l] ?? "queued", v.voice) } });
  }
  async function processAll() {
    for (const v of videos) {
      const render = { ...v.render };
      let changed = false;
      for (const l of v.languages) {
        const s = render[l];
        if (s && s !== "ready" && s !== "draft" && s !== "failed") { render[l] = nextStep(s, v.voice); changed = true; }
      }
      if (changed) await put<Video>(COL.videos, { ...v, render });
    }
    toast("Queue advanced one step (simulated)");
  }
  const active = rows.filter((r) => r.s !== "ready").length;
  return (
    <Card title="Render queue" aside={<Button small kind="primary" disabled={!active} onClick={processAll}>Advance all</Button>}>
      <p className="small muted">Each language is one 9:16 render: ElevenLabs voiceover (AI voice only), then a Creatomate template with captions and the AI label. Neither service is connected, so steps are simulated.</p>
      <Table rows={rows} rowKey={(r) => r.v.id + r.l}
        empty="Nothing queued. Approve a script and press Send to render."
        cols={[
          { label: "Video", render: (r) => <div className="stack-sm"><span>{r.v.title}</span><span className="small faint">{nameOf(clients, r.v.clientId)}</span></div> },
          { label: "Lang", render: (r) => <LangTag lang={r.l} /> },
          { label: "Voice", render: (r) => <span className="small">{r.v.voice === "synthetic" ? "AI voice" : r.v.voice === "client" ? "Owner" : "None"}</span> },
          { label: "Label", render: (r) => r.v.aiLabel ? <Badge tone="warn">On</Badge> : <span className="faint small">Off</span> },
          { label: "Status", render: (r) => <Badge tone={STEP_TONE[r.s]}>{STEP_LABEL[r.s]}</Badge> },
          { label: "", render: (r) => (
            <span className="row">
              {r.s !== "ready" && <Button small onClick={() => advance(r.v, r.l)}>{r.s === "failed" ? "Retry" : "Next step"}</Button>}
              {r.s !== "ready" && r.s !== "failed" && <Button small kind="ghost" onClick={() => put<Video>(COL.videos, { ...r.v, render: { ...r.v.render, [r.l]: "failed" } })}>Mark failed</Button>}
            </span>
          ) },
        ]} />
    </Card>
  );
}

// ---------- Schedule & results ----------

function Posts({ clients, videos, posts }: Ctx) {
  const ready = videos.filter((v) => v.script && v.languages.some((l) => v.render[l] === "ready"));
  const [form, setForm] = useState({ videoId: "", lang: "" as Lang | "", hook: "0", date: dayOffset(1), time: "19:00", placement: "Instagram Reel" as Placement });
  const [logging, setLogging] = useState<Post | null>(null);
  const fv = ready.find((v) => v.id === form.videoId);
  const readyLangs = fv ? fv.languages.filter((l) => fv.render[l] === "ready") : [];

  async function schedule() {
    if (!fv || !form.lang) return toast("Pick a video and a rendered language.");
    await create<Post>(COL.posts, { videoId: fv.id, clientId: fv.clientId, hook: Number(form.hook), lang: form.lang, date: form.date, time: form.time, placement: form.placement, status: "scheduled", views: 0, clicks: 0 });
    toast("Added to schedule (Meta Business Suite not connected yet)");
  }

  async function scheduleAbc() {
    if (!fv || !form.lang) return toast("Pick a video and a rendered language.");
    for (let i = 0; i < 3; i++) {
      await create<Post>(COL.posts, { videoId: fv.id, clientId: fv.clientId, hook: i, lang: form.lang, date: dayOffset(1 + i * 2), time: form.time, placement: form.placement, status: "scheduled", views: 0, clicks: 0 });
    }
    toast("Hooks A, B and C scheduled two days apart (simulated)");
  }

  const sorted = [...posts].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  return (
    <div className="stack">
      <div className="split">
        <Card title="Schedule a post">
          {ready.length ? (
            <Form onSubmit={schedule}>
              <Field label="Video" wide><Select id="vp-video" value={form.videoId} onChange={(id) => setForm({ ...form, videoId: id, lang: "" })}
                options={[{ value: "", label: "Choose a rendered video" }, ...ready.map((v) => ({ value: v.id, label: `${v.title} · ${nameOf(clients, v.clientId)}` }))]} /></Field>
              <Field label="Language"><Select id="vp-lang" value={form.lang} onChange={(l) => setForm({ ...form, lang: l })}
                options={[{ value: "" as Lang | "", label: "Choose" }, ...readyLangs.map((l) => ({ value: l as Lang | "", label: LANGS[l] }))]} /></Field>
              <Field label="Hook"><Select id="vp-hook" value={form.hook} onChange={(h) => setForm({ ...form, hook: h })}
                options={[0, 1, 2].map((i) => ({ value: String(i), label: `${HOOK_LETTERS[i]} · ${fv?.script?.hooks[i]?.angle ?? ""}` }))} /></Field>
              <Field label="Date"><Input id="vp-date" type="date" value={form.date} onChange={(d) => setForm({ ...form, date: d })} /></Field>
              <Field label="Time"><Input id="vp-time" type="time" value={form.time} onChange={(t) => setForm({ ...form, time: t })} /></Field>
              <Field label="Placement" wide><Select id="vp-place" value={form.placement} onChange={(p) => setForm({ ...form, placement: p })} options={["Instagram Reel", "Facebook Reel", "Instagram Story"]} /></Field>
              <div className="row wrap"><Button type="submit" kind="primary">Schedule</Button><Button onClick={scheduleAbc}>Schedule A/B/C test</Button></div>
            </Form>
          ) : <Empty>No rendered videos yet. Finish a render in the queue first.</Empty>}
        </Card>
        <Card title="Posting schedule" aside={<span className="small faint">Meta Business Suite · simulated</span>}>
          <Table rows={sorted} rowKey={(p) => p.id} empty="No posts scheduled."
            cols={[
              { label: "When", render: (p) => <div className="stack-sm"><span>{fmtDate(p.date)}</span><span className="small faint">{p.time}</span></div> },
              { label: "Video", render: (p) => <div className="stack-sm"><span>{videos.find((v) => v.id === p.videoId)?.title ?? "Deleted video"}</span><span className="small faint">{p.placement}</span></div> },
              { label: "Hook", render: (p) => <span className="row"><Badge tone="info">{HOOK_LETTERS[p.hook]}</Badge><LangTag lang={p.lang} /></span> },
              { label: "Status", render: (p) => <Badge tone={p.status === "posted" ? "good" : "neutral"}>{p.status === "posted" ? "Posted" : "Scheduled"}</Badge> },
              { label: "", render: (p) => (
                <span className="row">
                  {p.status === "scheduled" && <Button small onClick={() => put<Post>(COL.posts, { ...p, status: "posted" }).then(() => toast("Marked as posted (Meta not connected yet)"))}>Mark posted</Button>}
                  {p.status === "posted" && <Button small onClick={() => setLogging(p)}>Log results</Button>}
                  <ConfirmButton label="Remove" confirm="Remove" onConfirm={() => remove(COL.posts, p.id)} />
                </span>
              ) },
            ]} />
        </Card>
      </div>
      <Results clients={clients} videos={videos} posts={posts} />
      <LogResults post={logging} onClose={() => setLogging(null)} />
    </div>
  );
}

function Results({ clients, videos, posts }: { clients: Client[]; videos: Video[]; posts: Post[] }) {
  const rows = useMemo(() => {
    const out: { key: string; video: Video; hook: number; views: number; clicks: number; posts: number; winner: boolean }[] = [];
    for (const v of videos) {
      const vp = posts.filter((p) => p.videoId === v.id && p.status === "posted");
      if (!vp.length) continue;
      const byHook = [0, 1, 2].map((h) => {
        const hp = vp.filter((p) => p.hook === h);
        return { hook: h, views: hp.reduce((n, p) => n + p.views, 0), clicks: hp.reduce((n, p) => n + p.clicks, 0), posts: hp.length };
      }).filter((x) => x.posts);
      const eligible = byHook.filter((x) => x.views >= 300);
      const best = eligible.length > 1 ? eligible.reduce((a, b) => (ctr(b.clicks, b.views) > ctr(a.clicks, a.views) ? b : a)).hook : -1;
      byHook.forEach((x) => out.push({ key: v.id + x.hook, video: v, ...x, winner: x.hook === best }));
    }
    return out;
  }, [videos, posts]);
  return (
    <Card title="Results by hook" aside={<span className="small faint">Winner: best click rate with 300+ views on 2 or more hooks</span>}>
      <Table rows={rows} rowKey={(r) => r.key} empty="No results yet. Mark posts as posted and log views and clicks."
        cols={[
          { label: "Video", render: (r) => <div className="stack-sm"><span>{r.video.title}</span><span className="small faint">{nameOf(clients, r.video.clientId)}</span></div> },
          { label: "Hook", render: (r) => <div className="stack-sm"><span className="row"><Badge tone="info">{HOOK_LETTERS[r.hook]}</Badge><span className="small">{r.video.script?.hooks[r.hook]?.angle}</span></span><span className="small faint">{r.video.script?.hooks[r.hook]?.text[r.video.languages[0]]}</span></div> },
          { label: "Posts", num: true, render: (r) => r.posts },
          { label: "Views", num: true, render: (r) => r.views.toLocaleString("en-GB") },
          { label: "Clicks", num: true, render: (r) => r.clicks },
          { label: "Click rate", num: true, render: (r) => pct(ctr(r.clicks, r.views)) },
          { label: "", render: (r) => r.winner ? <Badge tone="good">Winner</Badge> : null },
        ]} />
    </Card>
  );
}

function LogResults({ post, onClose }: { post: Post | null; onClose: () => void }) {
  const [views, setViews] = useState("");
  const [clicks, setClicks] = useState("");
  const [lastId, setLastId] = useState("");
  if (post && post.id !== lastId) { setLastId(post.id); setViews(String(post.views)); setClicks(String(post.clicks)); }
  return (
    <Modal open={!!post} title="Log results" onClose={onClose}
      footer={<Button kind="primary" onClick={async () => {
        if (!post) return;
        await put<Post>(COL.posts, { ...post, views: Math.max(0, Number(views) || 0), clicks: Math.max(0, Number(clicks) || 0) });
        toast("Results saved"); onClose();
      }}>Save</Button>}>
      <p className="small muted">Copy the numbers from Meta Business Suite insights. The sheet sync is not connected yet.</p>
      <div className="grid-2">
        <Field label="Views"><Input id="lr-views" type="number" min={0} value={views} onChange={setViews} /></Field>
        <Field label="Link clicks"><Input id="lr-clicks" type="number" min={0} value={clicks} onChange={setClicks} /></Field>
      </div>
    </Modal>
  );
}

// ---------- Seed ----------

export async function seed(): Promise<void> {
  const surf = EXAMPLE_CLIENTS.find((c) => c.id === EX.surf);
  const whale = EXAMPLE_CLIENTS.find((c) => c.id === EX.whale);
  const month = thisMonth();
  const bSurf: Brief = example("ex-video-brief-surf", {
    clientId: EX.surf, title: "Beginner lesson Reel", offer: "2-hour beginner lesson, board and wetsuit included, small groups",
    audience: "German and British tourists aged 20 to 40 staying in El Médano and Costa Adeje", goal: "Lesson requests on WhatsApp",
    tone: "Sunny, friendly, a bit cheeky", location: "Playa de El Médano", languages: ["en", "de"] as Lang[], tier: "Starter" as Tier,
    notes: "Show the kite surfers in the background. No drone shots (airport zone).", shots: demoShots(surf, "es"), shotsLang: "es" as const, shotsLive: false,
  });
  const bWhale: Brief = example("ex-video-brief-whale", {
    clientId: EX.whale, title: "Morning whale trip", offer: "3-hour trip at 10:00 and 14:00 with hotel pickup in the south",
    audience: "Families and couples in Los Cristianos, Playa de las Américas and Costa Adeje", goal: "Seat bookings for the 10:00 trip",
    tone: "Calm, wonder, respectful of the animals", location: "Los Cristianos harbour", languages: ["es", "en", "de", "it"] as Lang[], tier: "Growth" as Tier,
    notes: "Never show people touching or chasing whales. Keep the legal distance visible.",
  });
  for (const b of [bSurf, bWhale]) await put(COL.briefs, b);

  const clipData: [string, string, ClipSource, string[], number, number][] = [
    ["ex-video-clip-1", EX.surf, "WhatsApp", ["surf", "lesson", "beach"], 14, -3],
    ["ex-video-clip-2", EX.surf, "WhatsApp", ["waves", "sunset", "el médano"], 9, -3],
    ["ex-video-clip-3", EX.surf, "Google Drive", ["wetsuit", "briefing"], 22, -2],
    ["ex-video-clip-4", EX.whale, "Google Drive", ["whales", "sea", "guests"], 31, -6],
    ["ex-video-clip-5", EX.whale, "WhatsApp", ["harbour", "boat", "los cristianos"], 12, -5],
    ["ex-video-clip-6", EX.whale, "WhatsApp", ["dolphins", "kids"], 8, -1],
  ];
  for (const [id, clientId, source, tags, seconds, off] of clipData) {
    const day = dayOffset(off);
    const fileName = source === "WhatsApp" ? `WhatsApp Video ${day} at 1${Math.abs(off)}.2${seconds % 10}.0${off + 9}.mp4` : `IMG_${4000 + seconds}.MOV`;
    await put(COL.clips, example(id, { clientId, fileName, source, tags, seconds, receivedAt: day + "T10:00:00.000Z", status: (id.endsWith("6") ? "new" : "used") as ClipStatus }));
  }

  const v1: Video = example("ex-video-v1", {
    clientId: EX.surf, briefId: bSurf.id, title: "Beginner lesson Reel #1", month, languages: ["en", "de"] as Lang[],
    clipIds: ["ex-video-clip-1", "ex-video-clip-2"], script: demoScript(surf, bSurf, ["en", "de"], "ex-video-v1"), scriptLive: false,
    voice: "client" as Voice, avatar: false, aiLabel: false, render: { en: "ready", de: "ready" } as Video["render"], approved: true,
  });
  const v2: Video = example("ex-video-v2", {
    clientId: EX.whale, briefId: bWhale.id, title: "Morning whale trip #1", month, languages: ["es", "en", "de", "it"] as Lang[],
    clipIds: ["ex-video-clip-4", "ex-video-clip-5"], script: demoScript(whale, bWhale, ["es", "en", "de", "it"], "ex-video-v2"), scriptLive: false,
    voice: "synthetic" as Voice, avatar: false, aiLabel: true, render: { es: "ready", en: "ready", de: "rendering", it: "voiceover" } as Video["render"], approved: true,
  });
  const v3: Video = example("ex-video-v3", {
    clientId: EX.whale, briefId: bWhale.id, title: "Morning whale trip #2", month, languages: ["es", "en", "de", "it"] as Lang[],
    clipIds: ["ex-video-clip-6"], voice: "synthetic" as Voice, avatar: false, aiLabel: true, render: {}, approved: false,
  });
  for (const v of [v1, v2, v3]) await put(COL.videos, v);

  const postData: [string, Video, number, Lang, number, "scheduled" | "posted", number, number][] = [
    ["ex-video-p1", v1, 0, "en", -6, "posted", 1840, 41],
    ["ex-video-p2", v1, 1, "en", -4, "posted", 2310, 77],
    ["ex-video-p3", v1, 2, "en", -2, "posted", 960, 14],
    ["ex-video-p4", v1, 1, "de", -1, "posted", 1205, 33],
    ["ex-video-p5", v2, 0, "es", -3, "posted", 3120, 52],
    ["ex-video-p6", v2, 1, "es", -1, "posted", 2740, 61],
    ["ex-video-p7", v2, 2, "en", 2, "scheduled", 0, 0],
  ];
  for (const [id, v, hook, lang, off, status, views, clicks] of postData) {
    await put(COL.posts, example(id, { videoId: v.id, clientId: v.clientId, hook, lang, date: dayOffset(off), time: "19:00", placement: "Instagram Reel" as Placement, status, views, clicks }));
  }

  await put<Task>("tasks", example("ex-video-task-1", {
    title: "Check AI voice renders and hook C for Atlántico whale trip video", module: "video", clientId: EX.whale, due: dayOffset(1), done: false,
  }));
}
