// Plan 7 · EpisodeEngine: long videos and podcasts into clips, posts and newsletters.
import { useState } from "react";
import {
  Page, Card, Button, Field, Input, TextArea, Select, Form, Tabs, Badge, Stat, Stats, Table, Empty,
  AiOutput, LangPicker, LangTag, ClientPicker, Modal, ConfirmButton, toast, fmtDate, type Tone,
} from "../core/ui";
import { useCollection, create, put, remove, today, now } from "../core/store";
import { aiJson, aiText, pick } from "../core/ai";
import { eur, LANGS } from "../core/plans";
import { EX, example, dayOffset } from "../core/seed";
import type { Client, Lang, Rec, Task } from "../core/types";

// ---------- Types ----------

type Tier = "Starter" | "Growth" | "Pro";
const TIERS: Record<Tier, { episodesWeek: number; clipsMonth: number; langs: number; price: number; posts: boolean }> = {
  Starter: { episodesWeek: 1, clipsMonth: 8, langs: 1, price: 200, posts: false },
  Growth: { episodesWeek: 2, clipsMonth: 16, langs: 1, price: 380, posts: true },
  Pro: { episodesWeek: 3, clipsMonth: 24, langs: 4, price: 600, posts: true },
};
type Scheduler = "Metricool" | "Buffer";
interface Rights { basis: "own" | "permission"; holder: string; note: string; confirmedAt: string }
interface Written { lang: Lang; linkedin: string; instagram: string; newsletterSubject: string; newsletter: string; live: boolean }
interface Episode extends Rec {
  clientId: string; title: string; source: "link" | "file"; link: string; fileName: string; durationMin: number;
  recordedOn: string; language: Lang; transcript: string; rights: Rights | null; picked: boolean; momentsLive?: boolean; written?: Written;
}
type ClipStatus = "draft" | "approved" | "scheduled" | "rejected";
interface CaptionSet { hook: string; text: string }
interface Clip extends Rec {
  episodeId: string; clientId: string; start: string; end: string; seconds: number; hook: string; why: string; quote: string;
  captions: Partial<Record<Lang, CaptionSet>>; captionsLive?: boolean; live: boolean; status: ClipStatus;
  scheduledFor?: string; scheduler?: Scheduler; platform?: string; views?: number;
}
interface Style extends Rec {
  clientId: string; tone: string; captionStyle: string; hookRules: string; dos: string; donts: string; ctas: string;
  hashtags: string; languages: Lang[]; scheduler: Scheduler;
}
interface Report extends Rec { clientId: string; weekOf: string; text: string; live: boolean }
type PackId = "Basic" | "Standard" | "Full";
const PACKS: Record<PackId, { price: number; detail: string }> = {
  Basic: { price: 150, detail: "1 recap reel (60 s) + 3 clips, captions in 1 language" },
  Standard: { price: 220, detail: "1 recap reel + 6 clips, captions ES + EN" },
  Full: { price: 300, detail: "2 recap reels + 10 clips, 3 languages, 48 h delivery" },
};
type EventStatus = "quoted" | "booked" | "delivered" | "invoiced";
interface EventPack extends Rec {
  organiser: string; clientId: string; event: string; town: string; date: string; pack: PackId; languages: Lang[];
  rightsConfirmed: boolean; status: EventStatus; plan?: string; planLive?: boolean;
}

const COL = { episodes: "clips_episodes", clips: "clips_items", styles: "clips_styles", reports: "clips_reports", events: "clips_events" } as const;
const STATUS_TONE: Record<ClipStatus, Tone> = { draft: "neutral", approved: "good", scheduled: "accent", rejected: "bad" };
const thisMonth = () => today().slice(0, 7);

// ---------- Helpers ----------

function clientTier(c?: Client): { tier: Tier; paid: boolean } {
  const s = c?.subs.find((x) => x.plan === "p7");
  return s && s.tier in TIERS ? { tier: s.tier as Tier, paid: true } : { tier: "Starter", paid: false };
}
const toSec = (t: string) => { const p = t.split(":").map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (p[0] || 0) * 60 + (p[1] || 0); };
const toTs = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const errLine = (e?: string) => e ? <p className="small" style={{ color: "var(--warn)" }}>{e}</p> : null;

// ---------- Demo generators ----------

interface Line { sec: number; text: string }
function parseTranscript(t: string): Line[] {
  const rows = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const stamped = rows.map((r) => r.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–:]?\s*(.*)$/)).filter(Boolean) as RegExpMatchArray[];
  if (stamped.length >= 3) return stamped.map((m) => ({ sec: toSec(m[1]), text: m[2] }));
  // No timestamps: estimate at ~150 words a minute.
  let sec = 0;
  return t.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 20).map((s) => {
    const line = { sec, text: s.trim() };
    sec += Math.max(4, Math.round((s.split(/\s+/).length / 150) * 60));
    return line;
  });
}
const STRONG = /\b(nunca|never|error|mistake|secret|secreto|clave|key|por qué|why|\d+)\b|\?/i;

const HOOK_SETS: Partial<Record<Lang, string>>[] = [
  { es: "Nadie te dice esto cuando empiezas", en: "Nobody tells you this when you start", de: "Das sagt dir keiner, wenn du anfängst", it: "Nessuno te lo dice quando inizi" },
  { es: "El error que más veo en negocios locales", en: "The mistake I see most in local businesses", de: "Der Fehler, den ich bei lokalen Firmen am häufigsten sehe", it: "L'errore che vedo di più nelle attività locali" },
  { es: "Si solo cambias una cosa este mes, que sea esta", en: "If you change one thing this month, make it this", de: "Wenn du diesen Monat nur eins änderst, dann das", it: "Se cambi una sola cosa questo mese, che sia questa" },
  { es: "Esto me costó años entenderlo", en: "It took me years to understand this", de: "Das habe ich erst nach Jahren verstanden", it: "Ci ho messo anni a capirlo" },
];
const hookIn = (hook: string, lang: Lang) => HOOK_SETS.find((h) => Object.values(h).includes(hook))?.[lang];
const DEMO_TRANSLATIONS: Record<string, Partial<Record<Lang, string>>> = {
  "El 80% de los negocios que veo en Tenerife no tienen un precio claro en su web.": { en: "80% of the businesses I see in Tenerife have no clear price on their website.", de: "80 % der Unternehmen, die ich auf Teneriffa sehe, haben keinen klaren Preis auf ihrer Website.", it: "L'80% delle attività che vedo a Tenerife non ha un prezzo chiaro sul sito." },
  "¿Por qué? Porque tienen miedo de espantar al cliente. Y pasa justo lo contrario.": { en: "Why? Because they're afraid of scaring the customer away. And the opposite happens.", de: "Warum? Weil sie Angst haben, Kunden abzuschrecken. Und genau das Gegenteil passiert.", it: "Perché? Perché hanno paura di spaventare il cliente. E succede proprio il contrario." },
  "El error más caro que cometí fue decir que sí a todos los clientes el primer año.": { en: "The most expensive mistake I made was saying yes to every client in my first year.", de: "Mein teuerster Fehler war, im ersten Jahr zu jedem Kunden Ja zu sagen.", it: "L'errore più caro che ho fatto è stato dire di sì a tutti i clienti il primo anno." },
  "Nunca vendas tu tiempo por horas si puedes vender un resultado.": { en: "Never sell your time by the hour if you can sell a result.", de: "Verkaufe deine Zeit nie stundenweise, wenn du ein Ergebnis verkaufen kannst.", it: "Non vendere mai il tuo tempo a ore se puoi vendere un risultato." },
  "La clave en una isla es la reputación: aquí todo el mundo se conoce.": { en: "On an island, reputation is everything: everyone here knows each other.", de: "Auf einer Insel ist der Ruf alles: Hier kennt jeder jeden.", it: "Su un'isola la chiave è la reputazione: qui si conoscono tutti." },
  "Tres preguntas que hago a cada cliente antes de mandar un presupuesto.": { en: "Three questions I ask every client before sending a quote.", de: "Drei Fragen, die ich jedem Kunden stelle, bevor ich ein Angebot schicke.", it: "Tre domande che faccio a ogni cliente prima di mandare un preventivo." },
};
function demoTranslate(text: string, lang: Lang, from: Lang): string {
  if (lang === from) return text;
  return DEMO_TRANSLATIONS[text]?.[lang] ?? `${text} [${lang.toUpperCase()} translation is written when AI is on]`;
}

interface PickedMoment { start: string; end: string; hook: string; why: string; quote: string }
function demoMoments(ep: Episode, count: number): PickedMoment[] {
  const lines = parseTranscript(ep.transcript);
  if (!lines.length) return [];
  const scored = lines.map((l, i) => ({ l, i, score: l.text.length / 40 + (STRONG.test(l.text) ? 3 : 0) + (i === 0 ? -2 : 0) }))
    .sort((a, b) => b.score - a.score).slice(0, count).sort((a, b) => a.l.sec - b.l.sec);
  const total = ep.durationMin * 60 || lines[lines.length - 1].sec + 90;
  return scored.map(({ l, i }, n) => {
    const nextTwo = lines[i + 3]?.sec ?? l.sec + 60;
    const len = Math.min(90, Math.max(30, nextTwo - l.sec));
    return {
      start: toTs(l.sec), end: toTs(Math.min(total, l.sec + len)),
      hook: (() => { const h = pick(HOOK_SETS, l.text + n); return h[ep.language] ?? h.en ?? ""; })(),
      why: STRONG.test(l.text) ? "Concrete claim or question in the first 3 seconds, stands alone without context." : "Clear single idea with a natural ending, good for a 45 s clip.",
      quote: l.text,
    };
  });
}

function demoWritten(ep: Episode, clips: Clip[], lang: Lang, client?: Client): Omit<Written, "live"> {
  const qs = clips.slice(0, 3).map((c) => c.quote);
  if (lang === "es") return {
    lang,
    linkedin: `Esta semana en el episodio "${ep.title}" hablé de algo que veo cada mes con negocios de Tenerife.\n\n${qs.map((q) => "→ " + q).join("\n")}\n\nSi tienes un negocio local, empieza por la primera. Es la más barata de arreglar.\n\nEpisodio completo en el primer comentario.`,
    instagram: `${qs[0] ?? ep.title}\n\nGuárdalo para cuando revises tu web. Episodio completo en el enlace de la bio.\n\n#Tenerife #emprender #negocioslocales #canarias`,
    newsletterSubject: `${ep.title}: 3 ideas para esta semana`,
    newsletter: `Hola,\n\nEn el episodio de esta semana, ${client?.name ?? "hablamos"} de ${ep.title.toLowerCase()}.\n\nTres ideas que puedes aplicar hoy:\n${qs.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nEscucha el episodio completo: ${ep.link || "(enlace)"}\n\nHasta la semana que viene.`,
  };
  return {
    lang,
    linkedin: `In this week's episode, "${ep.title}", I talked about something I see every month with Tenerife businesses.\n\n${qs.map((q) => "→ " + demoTranslate(q, lang, ep.language)).join("\n")}\n\nIf you run a local business, start with the first one. It is the cheapest to fix.\n\nFull episode in the first comment.`,
    instagram: `${qs[0] ? demoTranslate(qs[0], lang, ep.language) : ep.title}\n\nSave this for your next website review. Full episode at the link in bio.\n\n#Tenerife #smallbusiness #canaryislands`,
    newsletterSubject: `${ep.title}: 3 ideas for this week`,
    newsletter: `Hi,\n\nThis week's episode is about ${ep.title.toLowerCase()}.\n\nThree ideas you can use today:\n${qs.map((q, i) => `${i + 1}. ${demoTranslate(q, lang, ep.language)}`).join("\n")}\n\nListen to the full episode: ${ep.link || "(link)"}\n\nSee you next week.`,
  };
}

// ---------- Screen ----------

type TabId = "overview" | "episodes" | "board" | "style" | "report" | "events";

export default function Screen() {
  const [tab, setTab] = useState<TabId>("overview");
  const clients = useCollection<Client>("clients");
  const episodes = useCollection<Episode>(COL.episodes);
  const clips = useCollection<Clip>(COL.clips);
  const styles = useCollection<Style>(COL.styles);
  const reports = useCollection<Report>(COL.reports);
  const events = useCollection<EventPack>(COL.events);
  const ctx: Ctx = { clients, episodes, clips, styles, reports, events };

  return (
    <Page plan="Plan 7 · EpisodeEngine" title="Clip Engine"
      intro="Turn each episode into short clips, translated captions, posts and a newsletter. Every clip gets a human check before it is scheduled.">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "overview", label: "Clients" },
        { id: "episodes", label: "Episodes", count: episodes.length },
        { id: "board", label: "Review board", count: clips.filter((c) => c.status === "draft").length },
        { id: "style", label: "Style guides", count: styles.length },
        { id: "report", label: "Weekly report" },
        { id: "events", label: "Event packs", count: events.filter((e) => e.status !== "invoiced").length },
      ]} />
      {tab === "overview" && <Overview {...ctx} />}
      {tab === "episodes" && <Episodes {...ctx} />}
      {tab === "board" && <Board {...ctx} />}
      {tab === "style" && <Styles {...ctx} />}
      {tab === "report" && <Reports {...ctx} />}
      {tab === "events" && <Events {...ctx} />}
    </Page>
  );
}

interface Ctx { clients: Client[]; episodes: Episode[]; clips: Clip[]; styles: Style[]; reports: Report[]; events: EventPack[] }
const nameOf = (clients: Client[], id: string) => clients.find((c) => c.id === id)?.name ?? "Unknown client";
const clipClients = (clients: Client[], episodes: Episode[]) =>
  clients.filter((c) => c.subs.some((s) => s.plan === "p7") || episodes.some((e) => e.clientId === c.id));

// ---------- Overview ----------

function Overview({ clients, episodes, clips }: Ctx) {
  const month = thisMonth();
  const rows = clipClients(clients, episodes).map((c) => {
    const { tier, paid } = clientTier(c);
    const sub = c.subs.find((s) => s.plan === "p7");
    const monthsIn = sub ? Math.floor((Date.now() - new Date(sub.startedAt).getTime()) / (30 * 864e5)) : 0;
    const mine = clips.filter((x) => x.clientId === c.id && (x.status === "approved" || x.status === "scheduled") && x.createdAt.slice(0, 7) === month);
    return { c, tier, paid, monthsIn, used: mine.length, eps: episodes.filter((e) => e.clientId === c.id && e.createdAt.slice(0, 7) === month).length };
  });
  const mrr = rows.filter((r) => r.paid).reduce((n, r) => n + TIERS[r.tier].price, 0);
  const sched = clips.filter((c) => c.status === "scheduled");
  return (
    <div className="stack">
      <Stats>
        <Stat label="Clip Engine MRR" value={eur(mrr)} sub="Excl. 7% IGIC" tone="accent" />
        <Stat label="Clips to review" value={clips.filter((c) => c.status === "draft").length} tone={clips.some((c) => c.status === "draft") ? "warn" : "good"} />
        <Stat label="Scheduled" value={sched.length} sub="Metricool / Buffer, simulated" />
        <Stat label="Views logged" value={sched.reduce((n, c) => n + (c.views ?? 0), 0).toLocaleString("en-GB")} />
      </Stats>
      <Card title="Clients and monthly allowance">
        <Table rows={rows} rowKey={(r) => r.c.id} empty="No clip clients yet. Add a Plan 7 subscription on the client page."
          cols={[
            { label: "Client", render: (r) => <div className="stack-sm"><span className="strong">{r.c.name}</span><span className="small faint">{r.c.kind} · {r.c.town}</span></div> },
            { label: "Tier", render: (r) => <span className="row wrap"><Badge tone="accent">{r.tier}</Badge>{!r.paid && <Badge tone="warn">Pilot</Badge>}</span> },
            { label: "Episodes", render: (r) => <span className="small">{r.eps} this month · {TIERS[r.tier].episodesWeek}/week</span> },
            { label: "Clips approved", render: (r) => (
              <div className="stack-sm" style={{ minWidth: 140 }}>
                <span className="small">{r.used} of {TIERS[r.tier].clipsMonth}</span>
                <div className="bar"><span style={{ width: `${Math.min(100, (r.used / TIERS[r.tier].clipsMonth) * 100)}%` }} /></div>
              </div>
            ) },
            { label: "Term", render: (r) => r.paid ? <span className="small">{r.monthsIn < 3 ? <Badge tone="info">{`Minimum term: month ${r.monthsIn + 1} of 3`}</Badge> : "Rolling monthly"}</span> : <span className="small faint">2-week pilot</span> },
          ]} />
      </Card>
      <Card title="Tiers">
        <div className="grid-3">
          {(Object.keys(TIERS) as Tier[]).map((t) => (
            <div key={t} className="box stack-sm">
              <span className="row between"><span className="strong">{t}</span><span>{eur(TIERS[t].price)}/mo</span></span>
              <span className="small muted">{TIERS[t].episodesWeek} episode{TIERS[t].episodesWeek > 1 ? "s" : ""} a week · {TIERS[t].clipsMonth} clips · {t === "Pro" ? "2 to 4 languages, thumbnails" : "ES or EN"}</span>
              {TIERS[t].posts && <span className="small faint">LinkedIn and Instagram posts, newsletter draft</span>}
            </div>
          ))}
        </div>
        <p className="small faint">After the free 2-week pilot: 3-month minimum. Clip only the client's own content or creators with written permission.</p>
      </Card>
    </div>
  );
}

// ---------- Episodes ----------

const BLANK_EP = { clientId: "", title: "", source: "link" as "link" | "file", link: "", fileName: "", durationMin: "45", recordedOn: today(), language: "es" as Lang, transcript: "",
  basis: "own" as Rights["basis"], holder: "", note: "", confirm: false };

function Episodes(ctx: Ctx) {
  const { clients, episodes, clips } = ctx;
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState("");
  const current = episodes.find((e) => e.id === sel) ?? episodes[0];
  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="small muted">A new file in the client's Drive or YouTube feed starts the pipeline (not connected yet). Add episodes here.</p>
        <Button kind="primary" onClick={() => setAdding(true)}>Add episode</Button>
      </div>
      <AddEpisode open={adding} onClose={() => setAdding(false)} clients={clients} onSaved={(id) => setSel(id)} />
      {!episodes.length ? <Empty>No episodes yet. Add one with its transcript to find the best moments.</Empty> : (
        <div className="split">
          <Card title="Episodes">
            <Table rows={episodes} rowKey={(e) => e.id} onRow={(e) => setSel(e.id)}
              cols={[
                { label: "Episode", render: (e) => <div className="stack-sm"><span className={e.id === current?.id ? "strong" : ""}>{e.title}</span><span className="small faint">{nameOf(clients, e.clientId)} · {fmtDate(e.recordedOn)}</span></div> },
                { label: "State", render: (e) => !e.rights ? <Badge tone="bad">Rights missing</Badge> : e.picked ? <Badge tone="good">{clips.filter((c) => c.episodeId === e.id).length} clips</Badge> : <Badge>New</Badge> },
              ]} />
          </Card>
          {current && <EpisodeDetail key={current.id} ep={current} {...ctx} />}
        </div>
      )}
    </div>
  );
}

function AddEpisode({ open, onClose, clients, onSaved }: { open: boolean; onClose: () => void; clients: Client[]; onSaved: (id: string) => void }) {
  const [f, setF] = useState(BLANK_EP);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  async function save() {
    if (!f.clientId || !f.title.trim()) return toast("Pick a client and a title.");
    if (f.source === "link" ? !f.link.trim() : !f.fileName.trim()) return toast("Add the link or the file name.");
    if (!f.confirm || (f.basis === "permission" && !f.holder.trim())) return toast("Confirm the rights first. We only clip own content or content with written permission.");
    const ep = await create<Episode>(COL.episodes, {
      clientId: f.clientId, title: f.title.trim(), source: f.source, link: f.link.trim(), fileName: f.fileName.trim(), durationMin: Number(f.durationMin) || 0,
      recordedOn: f.recordedOn, language: f.language, transcript: f.transcript, picked: false,
      rights: { basis: f.basis, holder: f.basis === "own" ? nameOf(clients, f.clientId) : f.holder.trim(), note: f.note.trim(), confirmedAt: now() },
    });
    setF(BLANK_EP); onSaved(ep.id); onClose(); toast("Episode added");
  }
  return (
    <Modal open={open} title="Add episode" onClose={onClose} footer={<Button kind="primary" onClick={save} disabled={!f.confirm}>Save episode</Button>}>
      <Form onSubmit={save}>
        <Field label="Client"><ClientPicker id="ep-client" clients={clients} value={f.clientId} onChange={(v) => set({ clientId: v })} allowNone="Choose" /></Field>
        <Field label="Title"><Input id="ep-title" value={f.title} onChange={(v) => set({ title: v })} placeholder="Precios claros: por qué venden más" /></Field>
        <Field label="Source"><Select id="ep-src" value={f.source} onChange={(v) => set({ source: v })} options={[{ value: "link", label: "YouTube or Drive link" }, { value: "file", label: "Uploaded file" }]} /></Field>
        {f.source === "link"
          ? <Field label="Link"><Input id="ep-link" value={f.link} onChange={(v) => set({ link: v })} placeholder="https://youtube.com/watch?v=..." /></Field>
          : <Field label="File name"><Input id="ep-file" value={f.fileName} onChange={(v) => set({ fileName: v })} placeholder="podcast_ep42_master.mp4" /></Field>}
        <Field label="Minutes"><Input id="ep-min" type="number" min={1} value={f.durationMin} onChange={(v) => set({ durationMin: v })} /></Field>
        <Field label="Recorded"><Input id="ep-date" type="date" value={f.recordedOn} onChange={(v) => set({ recordedOn: v })} /></Field>
        <Field label="Spoken language"><Select id="ep-lang" value={f.language} onChange={(v) => set({ language: v })} options={(Object.keys(LANGS) as Lang[]).map((l) => ({ value: l, label: LANGS[l] }))} /></Field>
        <Field label="Transcript" hint="Paste from Whisper or Deepgram. Lines starting with mm:ss give exact timestamps." wide>
          <TextArea id="ep-tr" rows={6} value={f.transcript} onChange={(v) => set({ transcript: v })} placeholder={"00:00 Bienvenidos al episodio...\n02:14 El error más caro que cometí..."} />
        </Field>
      </Form>
      <div className="box stack-sm">
        <span className="strong">Copyright gate</span>
        <Field label="Rights basis"><Select id="ep-basis" value={f.basis} onChange={(v) => set({ basis: v })} options={[{ value: "own", label: "The client's own content" }, { value: "permission", label: "Third party, written permission on file" }]} /></Field>
        {f.basis === "permission" && <>
          <Field label="Rights holder"><Input id="ep-holder" value={f.holder} onChange={(v) => set({ holder: v })} placeholder="Name of the creator or organiser" /></Field>
          <Field label="Where the permission is" hint="Email date, signed form, contract"><Input id="ep-note" value={f.note} onChange={(v) => set({ note: v })} /></Field>
        </>}
        <label className="row small"><input type="checkbox" checked={f.confirm} onChange={(e) => set({ confirm: e.target.checked })} />
          I confirm this is {f.basis === "own" ? "the client's own content" : "covered by written permission"} and guests agreed to be recorded.</label>
      </div>
    </Modal>
  );
}

function EpisodeDetail({ ep, clients, clips, styles }: { ep: Episode } & Ctx) {
  const client = clients.find((c) => c.id === ep.clientId);
  const style = styles.find((s) => s.clientId === ep.clientId);
  const { tier } = clientTier(client);
  const mine = clips.filter((c) => c.episodeId === ep.id).sort((a, b) => toSec(a.start) - toSec(b.start));
  const [count, setCount] = useState("3");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string>();
  const [lang, setLang] = useState<Lang>(ep.written?.lang ?? ep.language);
  const [showTr, setShowTr] = useState(false);
  const blocked = !ep.rights;

  async function pickMoments() {
    if (blocked) return toast("Copyright gate: confirm rights before processing.");
    if (!ep.transcript.trim()) return toast("Paste the transcript first.");
    setBusy("pick");
    const n = Number(count);
    const r = await aiJson<{ moments: PickedMoment[] }>(
      `From this episode transcript pick the ${n} strongest standalone moments for vertical short clips, each 30 to 90 seconds long.
Client: ${client?.name} (${client?.kind}, ${client?.town}). Episode: "${ep.title}", ${ep.durationMin} min, spoken in ${LANGS[ep.language]}.
Style guide: tone ${style?.tone ?? "natural"}; hook rules: ${style?.hookRules ?? "short, concrete, no clickbait"}; avoid: ${style?.donts ?? "nothing specific"}.
Prefer moments with a concrete claim, story or question in the first 3 seconds that make sense without context. Use the transcript timestamps.
Transcript:
${ep.transcript.slice(0, 20000)}
JSON shape: {"moments":[{"start":"mm:ss","end":"mm:ss","hook":"on-screen hook in ${LANGS[ep.language]}, max 9 words","why":"one sentence on why it works","quote":"the key sentence, verbatim"}]}`,
      () => ({ moments: demoMoments(ep, n) }),
      { tier: "complex" },
    );
    setErr(r.error);
    for (const c of mine.filter((x) => x.status === "draft")) await remove(COL.clips, c.id);
    for (const m of r.data.moments) {
      const secs = Math.max(0, toSec(m.end) - toSec(m.start));
      await create<Clip>(COL.clips, {
        episodeId: ep.id, clientId: ep.clientId, start: m.start, end: m.end, seconds: secs, hook: m.hook, why: m.why, quote: m.quote,
        captions: { [ep.language]: { hook: m.hook, text: m.quote } }, live: r.live, status: "draft",
      });
    }
    await put<Episode>(COL.episodes, { ...ep, picked: true, momentsLive: r.live });
    await create<Task>("tasks", { title: `Review ${r.data.moments.length} clips from "${ep.title}"`, module: "clips", clientId: ep.clientId, due: dayOffset(1), done: false });
    setBusy("");
    toast(`${r.data.moments.length} moments picked. Review them on the board.`);
  }

  async function translate() {
    const langs = (style?.languages ?? client?.languages ?? ["es", "en"]).filter((l) => l !== ep.language).slice(0, Math.max(1, TIERS[tier].langs));
    if (!mine.length) return toast("Pick moments first.");
    if (!langs.length) return toast("The style guide has no extra languages.");
    setBusy("tr");
    const r = await aiJson<{ clips: { id: string; captions: Partial<Record<Lang, CaptionSet>> }[] }>(
      `Translate short-clip captions from ${LANGS[ep.language]} into ${langs.map((l) => LANGS[l]).join(", ")}. Keep them natural and short enough to burn into a vertical video; keep the speaker's voice. Style: ${style?.captionStyle ?? "plain sentences"}.
Clips: ${JSON.stringify(mine.map((c) => ({ id: c.id, hook: c.hook, text: c.quote })))}
JSON shape: {"clips":[{"id":"clip id","captions":{"${langs[0]}":{"hook":"...","text":"..."}}}]} with every language: ${langs.join(", ")}.`,
      () => ({ clips: mine.map((c) => ({ id: c.id, captions: Object.fromEntries(langs.map((l) => [l, { hook: hookIn(c.hook, l) ?? demoTranslate(c.hook, l, ep.language), text: demoTranslate(c.quote, l, ep.language) }])) })) }),
    );
    for (const t of r.data.clips) {
      const c = mine.find((x) => x.id === t.id);
      if (c) await put<Clip>(COL.clips, { ...c, captions: { ...c.captions, ...t.captions }, captionsLive: r.live });
    }
    setBusy("");
    toast(`Captions translated into ${langs.map((l) => l.toUpperCase()).join(", ")}`);
  }

  async function writePosts() {
    if (blocked) return toast("Copyright gate: confirm rights before processing.");
    if (!TIERS[tier].posts) toast("Posts and newsletter are in Growth and Pro. Drafting anyway as an upsell sample.");
    setBusy("posts");
    const r = await aiJson<Omit<Written, "live" | "lang">>(
      `Write social posts and a newsletter draft in ${LANGS[lang]} from this episode, in the voice of ${client?.name} (${client?.kind}, ${client?.town}).
Style guide: tone ${style?.tone ?? "natural"}; do: ${style?.dos ?? ""}; don't: ${style?.donts ?? ""}; CTAs: ${style?.ctas ?? "listen to the full episode"}; hashtags: ${style?.hashtags ?? ""}.
Episode: "${ep.title}" (${ep.link || ep.fileName}). Best moments: ${mine.map((c) => c.quote).join(" | ") || "not picked yet"}.
Transcript excerpt: ${ep.transcript.slice(0, 6000)}
Only use claims made in the transcript. The newsletter goes only to the client's existing opt-in subscribers.
JSON shape: {"linkedin":"post up to 1,300 characters","instagram":"caption with up to 6 hashtags","newsletterSubject":"...","newsletter":"plain-text email body"}`,
      () => { const d = demoWritten(ep, mine, lang, client); return { linkedin: d.linkedin, instagram: d.instagram, newsletterSubject: d.newsletterSubject, newsletter: d.newsletter }; },
    );
    setErr(r.error);
    await put<Episode>(COL.episodes, { ...ep, written: { ...r.data, lang, live: r.live } });
    setBusy("");
  }

  return (
    <div className="stack">
      <Card title={ep.title} aside={<><LangTag lang={ep.language} /><ConfirmButton label="Delete" confirm="Delete episode" onConfirm={async () => { for (const c of mine) await remove(COL.clips, c.id); await remove(COL.episodes, ep.id); }} /></>}>
        <div className="stack-sm small">
          <span className="muted">{client?.name} · {ep.durationMin} min · recorded {fmtDate(ep.recordedOn)} · {tier}</span>
          <span>{ep.source === "link" ? <a href={ep.link} target="_blank" rel="noreferrer">{ep.link}</a> : <span className="mono">{ep.fileName}</span>}</span>
          {ep.rights
            ? <span className="row wrap"><Badge tone="good">Rights confirmed</Badge><span className="faint">{ep.rights.basis === "own" ? "Own content" : `Written permission from ${ep.rights.holder}`}{ep.rights.note ? ` · ${ep.rights.note}` : ""} · {fmtDate(ep.rights.confirmedAt)}</span></span>
            : <RightsGate ep={ep} />}
        </div>
        <div className="row wrap">
          <Field label="Moments"><Select id="ep-count" value={count} onChange={setCount} options={["2", "3", "4", "5", "6"]} /></Field>
          <Button kind="primary" busy={busy === "pick"} disabled={blocked} onClick={pickMoments}>{ep.picked ? "Pick again" : "Pick best moments"}</Button>
          <Button busy={busy === "tr"} disabled={blocked || !mine.length} onClick={translate}>Translate captions</Button>
          <Button kind="ghost" onClick={() => setShowTr(!showTr)}>{showTr ? "Hide transcript" : "Show transcript"}</Button>
        </div>
        {errLine(err)}
        {showTr && <div className="box small pre" style={{ maxHeight: 240, overflowY: "auto" }}>{ep.transcript || "No transcript yet."}</div>}
      </Card>
      <Card title="Picked moments" aside={ep.picked ? <Badge tone={ep.momentsLive ? "accent" : "neutral"}>{ep.momentsLive ? "AI draft" : "Demo draft"}</Badge> : undefined}>
        {!mine.length ? <Empty>{blocked ? "Confirm the rights to unlock processing." : "No moments yet. The AI picks 30 to 90 second segments with a hook and the reason."}</Empty> : mine.map((c) => (
          <div key={c.id} className="box stack-sm">
            <div className="row between wrap">
              <span className="row"><span className="mono strong">{c.start}–{c.end}</span><span className="small faint">{c.seconds} s</span></span>
              <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
            </div>
            <span className="strong">{c.hook}</span>
            <span className="small">"{c.quote}"</span>
            <span className="small faint">Why: {c.why}</span>
            {Object.keys(c.captions).length > 1 && (
              <div className="stack-sm">
                {(Object.entries(c.captions) as [Lang, CaptionSet][]).filter(([l]) => l !== ep.language).map(([l, cs]) => (
                  <span key={l} className="small row wrap"><LangTag lang={l} /><span className="strong">{cs.hook}</span><span className="muted">{cs.text}</span></span>
                ))}
              </div>
            )}
          </div>
        ))}
      </Card>
      <Card title="Posts and newsletter" aside={<>
        <Select id="ep-wlang" value={lang} onChange={setLang} options={(style?.languages ?? client?.languages ?? ["es", "en"]).map((l) => ({ value: l, label: LANGS[l] }))} />
        <Button small kind="primary" busy={busy === "posts"} disabled={blocked} onClick={writePosts}>{ep.written ? "Rewrite" : "Write"}</Button>
      </>}>
        {!TIERS[tier].posts && <p className="small faint">Included from Growth. On {tier} this is a sample to show the client.</p>}
        {ep.written ? (
          <div className="stack">
            <AiOutput title="LinkedIn" text={ep.written.linkedin} live={ep.written.live} />
            <AiOutput title="Instagram" text={ep.written.instagram} live={ep.written.live} />
            <AiOutput title={`Newsletter · ${ep.written.newsletterSubject}`} text={ep.written.newsletter} live={ep.written.live} />
            <p className="small faint">The newsletter goes only to the client's opt-in subscribers.</p>
          </div>
        ) : <Empty>No posts yet. Write a LinkedIn post, an Instagram caption and a newsletter draft from this episode.</Empty>}
      </Card>
    </div>
  );
}

function RightsGate({ ep }: { ep: Episode }) {
  const [basis, setBasis] = useState<Rights["basis"]>("own");
  const [holder, setHolder] = useState("");
  const [ok, setOk] = useState(false);
  return (
    <div className="box stack-sm" style={{ borderColor: "var(--bad)" }}>
      <span className="strong" style={{ color: "var(--bad)" }}>Copyright gate: processing is locked</span>
      <span className="small">Confirm this is own content or covered by written permission.</span>
      <div className="row wrap">
        <Select id={"rg-" + ep.id} value={basis} onChange={setBasis} options={[{ value: "own", label: "Own content" }, { value: "permission", label: "Written permission" }]} />
        {basis === "permission" && <Input id={"rgh-" + ep.id} value={holder} onChange={setHolder} placeholder="Rights holder" />}
      </div>
      <label className="row small"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I confirm the rights and guests' consent.</label>
      <span><Button small kind="primary" disabled={!ok || (basis === "permission" && !holder.trim())}
        onClick={() => put<Episode>(COL.episodes, { ...ep, rights: { basis, holder: basis === "own" ? "Client" : holder.trim(), note: "", confirmedAt: now() } })}>Unlock</Button></span>
    </div>
  );
}

// ---------- Review board ----------

function Board({ clients, episodes, clips, styles }: Ctx) {
  const [client, setClient] = useState("");
  const [scheduling, setScheduling] = useState<Clip | null>(null);
  const [logging, setLogging] = useState<Clip | null>(null);
  const list = clips.filter((c) => !client || c.clientId === client);
  const cols: { id: ClipStatus; label: string }[] = [{ id: "draft", label: "Draft" }, { id: "approved", label: "Approved" }, { id: "scheduled", label: "Scheduled" }];
  const ep = (id: string) => episodes.find((e) => e.id === id);

  function approve(c: Clip) {
    const cl = clients.find((x) => x.id === c.clientId);
    const { tier } = clientTier(cl);
    const used = clips.filter((x) => x.clientId === c.clientId && (x.status === "approved" || x.status === "scheduled") && x.createdAt.slice(0, 7) === thisMonth()).length;
    if (used >= TIERS[tier].clipsMonth) toast(`Over the ${tier} allowance (${TIERS[tier].clipsMonth} clips). Approved, but consider an upgrade.`);
    void put<Clip>(COL.clips, { ...c, status: "approved" });
  }

  return (
    <div className="stack">
      <div className="row wrap between">
        <Field label="Client"><ClientPicker id="bd-client" clients={clipClients(clients, episodes)} value={client} onChange={setClient} allowNone="All clients" /></Field>
        <span className="small muted">Every clip is checked by a human before it is scheduled.</span>
      </div>
      {!list.length ? <Empty>No clips yet. Open an episode and pick the best moments.</Empty> : (
        <div className="grid-3">
          {cols.map((col) => {
            const items = list.filter((c) => c.status === col.id);
            return (
              <Card key={col.id} title={<span className="row">{col.label} <Badge>{items.length}</Badge></span>}>
                {!items.length && <p className="small faint">Nothing here.</p>}
                {items.map((c) => (
                  <div key={c.id} className="box stack-sm">
                    <span className="strong">{c.hook}</span>
                    <span className="small faint">{nameOf(clients, c.clientId)} · {ep(c.episodeId)?.title ?? "Episode"} · <span className="mono">{c.start}–{c.end}</span></span>
                    <span className="row wrap">{Object.keys(c.captions).map((l) => <LangTag key={l} lang={l} />)}<Badge tone={c.live ? "accent" : "neutral"}>{c.live ? "AI draft" : "Demo draft"}</Badge></span>
                    {c.status === "scheduled" && <span className="small">{c.scheduler} · {c.platform} · {fmtDate(c.scheduledFor)}{c.views != null ? ` · ${c.views.toLocaleString("en-GB")} views` : ""}</span>}
                    <div className="row wrap">
                      {c.status === "draft" && <><Button small kind="primary" onClick={() => approve(c)}>Approve</Button><Button small kind="ghost" onClick={() => put<Clip>(COL.clips, { ...c, status: "rejected" })}>Reject</Button></>}
                      {c.status === "approved" && <><Button small kind="primary" onClick={() => setScheduling(c)}>Schedule</Button><Button small kind="ghost" onClick={() => put<Clip>(COL.clips, { ...c, status: "draft" })}>Back to draft</Button></>}
                      {c.status === "scheduled" && <><Button small onClick={() => setLogging(c)}>Log views</Button><Button small kind="ghost" onClick={() => put<Clip>(COL.clips, { ...c, status: "approved", scheduledFor: undefined })}>Unschedule</Button></>}
                    </div>
                  </div>
                ))}
              </Card>
            );
          })}
        </div>
      )}
      {list.some((c) => c.status === "rejected") && (
        <p className="small faint">{list.filter((c) => c.status === "rejected").length} rejected clip(s) hidden. Use the notes to refine the style guide.</p>
      )}
      <ScheduleModal clip={scheduling} scheduler={styles.find((s) => s.clientId === scheduling?.clientId)?.scheduler ?? "Metricool"} onClose={() => setScheduling(null)} />
      <ViewsModal clip={logging} onClose={() => setLogging(null)} />
    </div>
  );
}

function ScheduleModal({ clip, scheduler, onClose }: { clip: Clip | null; scheduler: Scheduler; onClose: () => void }) {
  const [date, setDate] = useState(dayOffset(1));
  const [tool, setTool] = useState<Scheduler>(scheduler);
  const [platform, setPlatform] = useState("Instagram Reels");
  return (
    <Modal open={!!clip} title="Schedule clip" onClose={onClose} footer={<Button kind="primary" onClick={async () => {
      if (!clip) return;
      await put<Clip>(COL.clips, { ...clip, status: "scheduled", scheduledFor: date, scheduler: tool, platform });
      toast(`Marked as scheduled in ${tool} (not connected yet, nothing was sent)`); onClose();
    }}>Schedule</Button>}>
      <div className="grid-2">
        <Field label="Date"><Input id="sc-date" type="date" value={date} onChange={setDate} /></Field>
        <Field label="Scheduler"><Select id="sc-tool" value={tool} onChange={setTool} options={["Metricool", "Buffer"]} /></Field>
        <Field label="Platform"><Select id="sc-plat" value={platform} onChange={setPlatform} options={["Instagram Reels", "YouTube Shorts", "TikTok", "LinkedIn"]} /></Field>
      </div>
    </Modal>
  );
}

function ViewsModal({ clip, onClose }: { clip: Clip | null; onClose: () => void }) {
  const [views, setViews] = useState("");
  const [last, setLast] = useState("");
  if (clip && clip.id !== last) { setLast(clip.id); setViews(String(clip.views ?? "")); }
  return (
    <Modal open={!!clip} title="Log views" onClose={onClose} footer={<Button kind="primary" onClick={async () => {
      if (!clip) return;
      await put<Clip>(COL.clips, { ...clip, views: Math.max(0, Number(views) || 0) });
      toast("Views saved"); onClose();
    }}>Save</Button>}>
      <Field label="Views so far" hint="Copy from Metricool or Buffer analytics"><Input id="vw" type="number" min={0} value={views} onChange={setViews} /></Field>
    </Modal>
  );
}

// ---------- Style guides ----------

function Styles({ clients, episodes, styles }: Ctx) {
  const list = clipClients(clients, episodes);
  const [clientId, setClientId] = useState(list[0]?.id ?? "");
  const existing = styles.find((s) => s.clientId === clientId);
  if (!list.length) return <Empty>No clip clients yet.</Empty>;
  return (
    <div className="stack">
      <Field label="Client"><ClientPicker id="st-client" clients={list} value={clientId} onChange={setClientId} /></Field>
      {clientId && <StyleForm key={clientId + (existing?.id ?? "")} clientId={clientId} existing={existing} client={clients.find((c) => c.id === clientId)} />}
    </div>
  );
}

function StyleForm({ clientId, existing, client }: { clientId: string; existing?: Style; client?: Client }) {
  const [f, setF] = useState<Omit<Style, "id" | "createdAt">>(existing ?? {
    clientId, tone: "", captionStyle: "White bold, 2 lines max, key word highlighted", hookRules: "Max 9 words. Concrete. No clickbait.",
    dos: "", donts: "", ctas: "", hashtags: "", languages: client?.languages.slice(0, 2) ?? ["es"], scheduler: "Metricool",
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  async function save() {
    if (existing) await put<Style>(COL.styles, { ...existing, ...f });
    else await create<Style>(COL.styles, f);
    toast("Style guide saved");
  }
  return (
    <Card title={`Style guide · ${client?.name ?? ""}`} aside={!existing ? <Badge tone="warn">Not saved yet</Badge> : <span className="small faint">Refine after month 1</span>}>
      <Form onSubmit={save}>
        <Field label="Tone" wide><Input id="sf-tone" value={f.tone} onChange={(v) => set({ tone: v })} placeholder="Direct, warm, practical. Uses tú." /></Field>
        <Field label="Caption style"><Input id="sf-cap" value={f.captionStyle} onChange={(v) => set({ captionStyle: v })} /></Field>
        <Field label="Hook rules"><Input id="sf-hook" value={f.hookRules} onChange={(v) => set({ hookRules: v })} /></Field>
        <Field label="Do" wide><TextArea id="sf-do" rows={2} value={f.dos} onChange={(v) => set({ dos: v })} /></Field>
        <Field label="Don't" wide><TextArea id="sf-dont" rows={2} value={f.donts} onChange={(v) => set({ donts: v })} /></Field>
        <Field label="CTAs"><Input id="sf-cta" value={f.ctas} onChange={(v) => set({ ctas: v })} /></Field>
        <Field label="Hashtags"><Input id="sf-tags" value={f.hashtags} onChange={(v) => set({ hashtags: v })} /></Field>
        <Field label="Caption languages"><LangPicker value={f.languages} onChange={(l) => set({ languages: l })} /></Field>
        <Field label="Scheduler"><Select id="sf-sched" value={f.scheduler} onChange={(v) => set({ scheduler: v })} options={["Metricool", "Buffer"]} /></Field>
        <div className="row"><Button type="submit" kind="primary">Save style guide</Button></div>
      </Form>
    </Card>
  );
}

// ---------- Weekly report ----------

function Reports({ clients, episodes, clips, reports }: Ctx) {
  const list = clipClients(clients, episodes);
  const [clientId, setClientId] = useState(list[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<string>();
  const [err, setErr] = useState<string>();
  const client = clients.find((c) => c.id === clientId);
  const since = dayOffset(-7);
  const prevSince = dayOffset(-14);
  const mine = clips.filter((c) => c.clientId === clientId);
  const week = mine.filter((c) => c.createdAt.slice(0, 10) >= since || (c.scheduledFor ?? "") >= since);
  const views = mine.filter((c) => (c.scheduledFor ?? "") >= since).reduce((n, c) => n + (c.views ?? 0), 0);
  const prevViews = mine.filter((c) => (c.scheduledFor ?? "") >= prevSince && (c.scheduledFor ?? "") < since).reduce((n, c) => n + (c.views ?? 0), 0);
  const top = [...mine].filter((c) => c.views).sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
  const eps = episodes.filter((e) => e.clientId === clientId && e.recordedOn >= since);
  const growth = prevViews ? Math.round(((views - prevViews) / prevViews) * 100) : null;
  const past = reports.filter((r) => r.clientId === clientId).sort((a, b) => b.weekOf.localeCompare(a.weekOf));
  const lang: Lang = client?.languages[0] === "es" ? "es" : "en";

  async function generate() {
    setBusy(true); setStream("");
    const facts = { episodes: eps.length, clipsMade: week.length, approved: week.filter((c) => c.status !== "draft").length, scheduled: week.filter((c) => c.status === "scheduled").length, views, prevViews, topClip: top ? { hook: top.hook, views: top.views } : null };
    const r = await aiText(
      `Write a short weekly report (under 180 words) in ${LANGS[lang]} for ${client?.name}, a ${client?.kind} in ${client?.town}, about their clip service.
Numbers for the week: ${JSON.stringify(facts)}. Mention view growth vs last week, the top clip and one concrete suggestion for next week's recording. Plain text, no invented numbers.`,
      () => lang === "es"
        ? `Resumen semanal · ${client?.name}\n\nEsta semana: ${eps.length} episodio(s), ${week.length} clips creados, ${facts.approved} revisados y ${facts.scheduled} programados.\n\nVisualizaciones: ${views.toLocaleString("es-ES")}${growth != null ? ` (${growth >= 0 ? "+" : ""}${growth}% frente a la semana pasada)` : ""}.\n${top ? `El clip que más funcionó: "${top.hook}" con ${top.views?.toLocaleString("es-ES")} visualizaciones.\n` : ""}\nPara la próxima grabación: empieza cada bloque con una cifra o una pregunta directa. Los clips que abren así retienen mejor los primeros 3 segundos.\n\nNos vemos la semana que viene.`
        : `Weekly summary · ${client?.name}\n\nThis week: ${eps.length} episode(s), ${week.length} clips made, ${facts.approved} reviewed and ${facts.scheduled} scheduled.\n\nViews: ${views.toLocaleString("en-GB")}${growth != null ? ` (${growth >= 0 ? "+" : ""}${growth}% vs last week)` : ""}.\n${top ? `Top clip: "${top.hook}" with ${top.views?.toLocaleString("en-GB")} views.\n` : ""}\nFor the next recording: open each section with a number or a direct question. Clips that start that way hold the first 3 seconds better.\n\nSee you next week.`,
      { onText: setStream },
    );
    setErr(r.error);
    await create<Report>(COL.reports, { clientId, weekOf: today(), text: r.data, live: r.live });
    setStream(undefined); setBusy(false);
  }

  if (!list.length) return <Empty>No clip clients yet.</Empty>;
  return (
    <div className="stack">
      <div className="row wrap"><Field label="Client"><ClientPicker id="rp-client" clients={list} value={clientId} onChange={setClientId} /></Field></div>
      <Stats>
        <Stat label="Episodes (7 days)" value={eps.length} />
        <Stat label="Clips made" value={week.length} />
        <Stat label="Views (7 days)" value={views.toLocaleString("en-GB")} sub={growth != null ? `${growth >= 0 ? "+" : ""}${growth}% vs last week` : "No previous week"} tone={growth != null && growth < 0 ? "bad" : "good"} />
        <Stat label="Top clip" value={top ? (top.views ?? 0).toLocaleString("en-GB") : "None"} sub={top?.hook} />
      </Stats>
      <Card title="Weekly report" aside={<Button small kind="primary" busy={busy} onClick={generate}>Write this week's report</Button>}>
        <p className="small muted">Sent by n8n every Monday once connected. For now, copy it into WhatsApp or email to the client.</p>
        {errLine(err)}
        {stream != null && <div className="box small pre">{stream || "Writing..."}</div>}
        {!past.length && stream == null && <Empty>No reports yet for this client.</Empty>}
        {past.map((r) => <AiOutput key={r.id} title={`Week of ${fmtDate(r.weekOf)}`} text={r.text} live={r.live} actions={<ConfirmButton label="Delete" confirm="Delete" onConfirm={() => remove(COL.reports, r.id)} />} />)}
      </Card>
    </div>
  );
}

// ---------- Event recap packs ----------

const BLANK_EV = { organiser: "", clientId: "", event: "", town: "Santa Cruz", date: dayOffset(14), pack: "Standard" as PackId, languages: ["es", "en"] as Lang[], rightsConfirmed: false };

function Events({ clients, events }: Ctx) {
  const [f, setF] = useState(BLANK_EV);
  const [busyId, setBusyId] = useState("");
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const booked = events.filter((e) => e.status !== "quoted").reduce((n, e) => n + PACKS[e.pack].price, 0);

  async function add() {
    if (!f.organiser.trim() || !f.event.trim()) return toast("Add the organiser and the event.");
    await create<EventPack>(COL.events, { ...f, organiser: f.organiser.trim(), event: f.event.trim(), status: "quoted" });
    setF(BLANK_EV); toast("Quote saved");
  }
  async function plan(e: EventPack) {
    setBusyId(e.id);
    const r = await aiText(
      `Plan a local event recap pack for ${e.organiser}: "${e.event}" in ${e.town}, Tenerife on ${e.date}. Pack: ${e.pack} (${PACKS[e.pack].detail}). Caption languages: ${e.languages.map((l) => LANGS[l]).join(", ")}.
Write: 1) a shot list of 8 moments to film, 2) the deliverables with lengths, 3) sample captions for the recap reel in each language, 4) consent notes (signage at the entrance, no close-ups of minors without parental consent). Plain text, short lines.`,
      () => `${e.event} · ${e.pack} recap pack\n\nShot list\n1. Wide shot of the venue filling up, ${e.town}\n2. Organiser welcome, 1 sentence to camera\n3. Hands, details, food or costumes close-up\n4. Crowd reaction at the main moment\n5. Performers or speakers from the side\n6. Slow-motion highlight (fireworks, dance, toast)\n7. Two short guest soundbites (signed release)\n8. Closing shot: venue from a distance at night\n\nDeliverables\n- ${PACKS[e.pack].detail}\n- Delivered in 9:16 with burned-in captions\n\nSample captions\n${e.languages.map((l) => `${l.toUpperCase()}: ${({ es: `Así se vivió ${e.event} en ${e.town}. Gracias a todos los que vinisteis.`, en: `This was ${e.event} in ${e.town}. Thank you to everyone who came.`, de: `So war ${e.event} in ${e.town}. Danke an alle, die dabei waren.`, it: `Ecco com'è stato ${e.event} a ${e.town}. Grazie a tutti quelli che sono venuti.` } as Record<string, string>)[l] ?? `${e.event} · ${e.town}`}`).join("\n")}\n\nConsent\n- Filming notice at the entrance\n- No close-ups of minors without parental consent\n- Organiser confirms in writing that we may publish the footage`,
    );
    await put<EventPack>(COL.events, { ...e, plan: r.data, planLive: r.live });
    setBusyId("");
  }

  return (
    <div className="stack">
      <Stats>
        <Stat label="Booked or delivered" value={eur(booked)} sub={`${eur(booked * 1.07)} with IGIC`} tone="accent" />
        <Stat label="Open quotes" value={events.filter((e) => e.status === "quoted").length} />
      </Stats>
      <div className="grid-3">
        {(Object.keys(PACKS) as PackId[]).map((p) => (
          <div key={p} className="box stack-sm"><span className="row between"><span className="strong">{p}</span><span>{eur(PACKS[p].price)}</span></span><span className="small muted">{PACKS[p].detail}</span><span className="small faint">{eur(PACKS[p].price * 1.07)} with 7% IGIC</span></div>
        ))}
      </div>
      <div className="split">
        <Card title="New recap pack">
          <Form onSubmit={add}>
            <Field label="Organiser" wide><Input id="ev-org" value={f.organiser} onChange={(v) => set({ organiser: v })} placeholder="Hotel, festival, Carnaval group" /></Field>
            <Field label="Linked client" hint="Optional"><ClientPicker id="ev-client" clients={clients} value={f.clientId} onChange={(v) => set({ clientId: v })} allowNone="None" /></Field>
            <Field label="Event"><Input id="ev-name" value={f.event} onChange={(v) => set({ event: v })} placeholder="Noche de jazz en la terraza" /></Field>
            <Field label="Town"><Input id="ev-town" value={f.town} onChange={(v) => set({ town: v })} /></Field>
            <Field label="Date"><Input id="ev-date" type="date" value={f.date} onChange={(v) => set({ date: v })} /></Field>
            <Field label="Pack"><Select id="ev-pack" value={f.pack} onChange={(v) => set({ pack: v })} options={(Object.keys(PACKS) as PackId[]).map((p) => ({ value: p, label: `${p} · ${eur(PACKS[p].price)}` }))} /></Field>
            <Field label="Languages"><LangPicker value={f.languages} onChange={(l) => set({ languages: l })} /></Field>
            <div className="row"><Button type="submit" kind="primary">Save quote</Button></div>
          </Form>
        </Card>
        <Card title="Packs">
          {!events.length && <Empty>No event packs yet. Hotels, festivals and Carnaval groups pay {eur(150)} to {eur(300)} per recap.</Empty>}
          {[...events].sort((a, b) => a.date.localeCompare(b.date)).map((e) => (
            <div key={e.id} className="box stack-sm">
              <div className="row between wrap"><span className="strong">{e.event}</span><span className="row"><Badge tone="accent">{e.pack} · {eur(PACKS[e.pack].price)}</Badge><Badge tone={e.status === "invoiced" ? "good" : e.status === "quoted" ? "neutral" : "info"}>{e.status}</Badge></span></div>
              <span className="small muted">{e.organiser} · {e.town} · {fmtDate(e.date)} · {e.languages.map((l) => l.toUpperCase()).join(" ")}</span>
              <label className="row small"><input type="checkbox" checked={e.rightsConfirmed} onChange={(x) => put<EventPack>(COL.events, { ...e, rightsConfirmed: x.target.checked })} /> Organiser's written permission to film and publish</label>
              <div className="row wrap">
                <Select id={"evs-" + e.id} value={e.status} onChange={(s) => {
                  if (s !== "quoted" && !e.rightsConfirmed) return toast("Copyright gate: get the organiser's written permission first.");
                  void put<EventPack>(COL.events, { ...e, status: s });
                }} options={[{ value: "quoted", label: "Quoted" }, { value: "booked", label: "Booked" }, { value: "delivered", label: "Delivered" }, { value: "invoiced", label: "Invoiced" }]} />
                <Button small busy={busyId === e.id} disabled={!e.rightsConfirmed} onClick={() => plan(e)}>{e.plan ? "Redo plan" : "Plan the pack"}</Button>
                <ConfirmButton label="Delete" confirm="Delete" onConfirm={() => remove(COL.events, e.id)} />
              </div>
              {e.plan && <AiOutput title="Recap plan" text={e.plan} live={e.planLive} />}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// ---------- Seed ----------

const COACH_TRANSCRIPT = `00:00 Bienvenidos a un nuevo episodio. Hoy hablamos de precios.
01:12 El 80% de los negocios que veo en Tenerife no tienen un precio claro en su web.
02:05 ¿Por qué? Porque tienen miedo de espantar al cliente. Y pasa justo lo contrario.
04:40 Cuando el cliente no ve un precio, se va a la competencia que sí lo pone.
07:18 El error más caro que cometí fue decir que sí a todos los clientes el primer año.
09:02 Acabé trabajando sesenta horas a la semana por menos dinero.
12:30 Nunca vendas tu tiempo por horas si puedes vender un resultado.
15:10 La clave en una isla es la reputación: aquí todo el mundo se conoce.
18:45 Tres preguntas que hago a cada cliente antes de mandar un presupuesto.
22:00 Y con esto cerramos. Si te ha servido, compártelo con alguien que lo necesite.`;

export async function seed(): Promise<void> {
  const ep1: Episode = example("ex-clips-ep-1", {
    clientId: EX.coach, title: "Precios claros: por qué venden más", source: "link" as const, link: "https://youtube.com/watch?v=example42",
    fileName: "", durationMin: 24, recordedOn: dayOffset(-3), language: "es" as Lang, transcript: COACH_TRANSCRIPT,
    rights: { basis: "own" as const, holder: "Coach Raúl Torres", note: "Own podcast", confirmedAt: dayOffset(-3) + "T09:00:00.000Z" },
    picked: true, momentsLive: false,
  });
  const ep2: Episode = example("ex-clips-ep-2", {
    clientId: EX.coach, title: "Entrevista: abrir un coworking en La Laguna", source: "file" as const, link: "", fileName: "ep43_entrevista_master.mp4",
    durationMin: 51, recordedOn: dayOffset(-1), language: "es" as Lang, transcript: "", rights: null, picked: false,
  });
  await put(COL.episodes, ep2);

  const moments = demoMoments(ep1, 5);
  const states: { status: ClipStatus; off?: number; views?: number }[] = [
    { status: "scheduled", off: -9, views: 3120 }, { status: "scheduled", off: -2, views: 4870 }, { status: "approved" }, { status: "draft" }, { status: "draft" },
  ];
  ep1.written = { ...demoWritten(ep1, moments.map((m) => ({ quote: m.quote }) as Clip), "es"), live: false };
  await put(COL.episodes, ep1);
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i];
    const st = states[i];
    await put(COL.clips, example(`ex-clips-clip-${i + 1}`, {
      episodeId: ep1.id, clientId: EX.coach, start: m.start, end: m.end, seconds: toSec(m.end) - toSec(m.start), hook: m.hook, why: m.why, quote: m.quote,
      captions: { es: { hook: m.hook, text: m.quote }, en: { hook: hookIn(m.hook, "en") ?? m.hook, text: demoTranslate(m.quote, "en", "es") } } as Clip["captions"],
      captionsLive: false, live: false, status: st.status,
      ...(st.status === "scheduled" ? { scheduledFor: dayOffset(st.off ?? 1), scheduler: "Metricool" as Scheduler, platform: "Instagram Reels", views: st.views } : {}),
    }));
  }

  await put(COL.styles, example("ex-clips-style-coach", {
    clientId: EX.coach, tone: "Direct, warm, practical. Uses tú. Canarian expressions are fine.", captionStyle: "White bold, 2 lines max, key number in yellow",
    hookRules: "Max 9 words. Start with a number or a mistake. No clickbait.", dos: "Real examples from Tenerife businesses. End clips on a complete sentence.",
    donts: "No stock footage. No promises of income. Never name clients without permission.", ctas: "Episodio completo en el enlace de la bio",
    hashtags: "#Tenerife #emprender #negocioslocales", languages: ["es", "en"] as Lang[], scheduler: "Metricool" as Scheduler,
  }));

  await put(COL.reports, example("ex-clips-report-1", {
    clientId: EX.coach, weekOf: dayOffset(-7), live: false,
    text: "Resumen semanal · Coach Raúl Torres\n\nEsta semana: 1 episodio, 4 clips creados, 3 revisados y 1 programado.\n\nVisualizaciones: 3.120 (primera semana con datos).\nEl clip que más funcionó: el del 80% de negocios sin precio en la web.\n\nPara la próxima grabación: abre cada bloque con una cifra concreta.\n\nNos vemos la semana que viene.",
  }));

  await put(COL.events, example("ex-clips-event-1", {
    organiser: "Hotel Mar Azul Costa Adeje", clientId: "", event: "Noche de jazz en la terraza", town: "Costa Adeje", date: dayOffset(9),
    pack: "Standard" as PackId, languages: ["es", "en", "de"] as Lang[], rightsConfirmed: true, status: "booked" as EventStatus,
  }));
  await put(COL.events, example("ex-clips-event-2", {
    organiser: "Comparsa Brisas del Puerto", clientId: "", event: "Ensayo general de Carnaval", town: "Santa Cruz", date: dayOffset(30),
    pack: "Full" as PackId, languages: ["es", "en", "it"] as Lang[], rightsConfirmed: false, status: "quoted" as EventStatus,
  }));

  await put<Task>("tasks", example("ex-clips-task-1", {
    title: "Review 2 draft clips and confirm rights for Raúl's interview episode", module: "clips", clientId: EX.coach, due: dayOffset(1), done: false,
  }));
}
