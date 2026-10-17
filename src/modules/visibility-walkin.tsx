// Live walk-in check: "Does AI recommend you?" in 4 languages, as a printable one-page result,
// plus the free public "Who AI recommends in <town>" report built from saved checks.
import { useState } from "react";
import { aiJson, aiText, useAiMode } from "../core/ai";
import { create, put } from "../core/store";
import { dayOffset } from "../core/seed";
import { TOWNS, eur } from "../core/plans";
import {
  AiOutput, Badge, Button, Card, Empty, Field, Input, LangPicker, LangTag, Select, Table, fmtDate, toast,
} from "../core/ui";
import type { Client, Lang, Task } from "../core/types";
import { ONE_OFF, TIERS, askIn, demoWalkinPlaces, engineLabel, langName, matches, rng, type Engine, type Walkin, type WalkinLang, VCOL } from "./visibility-data";

const SIM_ENGINES: Engine[] = ["chatgpt", "gemini", "perplexity"];

function namedNotYou(w: Walkin): { name: string; count: number }[] {
  const tally = new Map<string, number>();
  w.results.forEach((r) => r.places.forEach((p) => { if (!matches(p.name, w.venue)) tally.set(p.name, (tally.get(p.name) ?? 0) + 1); }));
  return [...tally.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function WalkinTab(props: { walkins: Walkin[] }) {
  const mode = useAiMode();
  const [f, setF] = useState({ venue: "", town: "Los Cristianos", category: "" });
  const [langs, setLangs] = useState<Lang[]>(["en", "de", "nl", "es"]);
  const [busy, setBusy] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(props.walkins[0]?.id ?? null);
  const current = props.walkins.find((w) => w.id === currentId) ?? props.walkins[0] ?? null;

  async function run() {
    if (!f.venue.trim() || !f.category.trim()) return toast("Add the venue and what it sells.");
    if (langs.length === 0 || langs.length > 4) return toast("Pick 1 to 4 languages.");
    setBusy(true);
    const venue = f.venue.trim(), town = f.town.trim(), category = f.category.trim();
    try {
      const results: WalkinLang[] = await Promise.all(langs.map(async (lang) => {
        const res = await aiJson<{ question: string; places: { name: string; why: string }[] }>(
          [`A tourist in Tenerife asks an AI assistant, in ${langName(lang)}, for a ${category} in ${town}.`,
            `1. Write the exact question they would type, natively in ${langName(lang)}.`,
            `2. Answer it honestly as you would for a real user: up to 5 specific, real places in or near ${town}, best first, each with a short reason in ${langName(lang)}.`,
            "Only name places you believe really exist. Never invent one, and do not favour any business because it is mentioned here.",
            'JSON: {"question":"...","places":[{"name":"...","why":"..."}]}'].join("\n"),
          () => ({ question: askIn(lang, category, town), places: demoWalkinPlaces(venue, town, category, lang) }),
          { tier: "quick" });
        const places = (res.data.places ?? []).slice(0, 5);
        const mentioned = places.some((p) => matches(p.name, venue));
        const sim = SIM_ENGINES.map((engine) => ({ engine, mentioned: rng(`${venue}|${town}|${lang}|${engine}`)() < (mentioned ? 0.6 : 0.18) }));
        return { lang, question: res.data.question || askIn(lang, category, town), places, mentioned, live: res.live, sim };
      }));
      const w = await create<Walkin>(VCOL.walkins, { venue, town, category, results, live: results.every((r) => r.live) });
      setCurrentId(w.id);
    } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="split">
        <Card title="Live walk-in check">
          <p className="small muted">Run it on your phone at the counter: "When a tourist asks AI for the best {f.category || "seafood"} in {f.town || "town"}, does it name you?"</p>
          <Field label="Venue"><Input id="wk-venue" value={f.venue} onChange={(v) => setF({ ...f, venue: v })} placeholder="Bar La Ola" /></Field>
          <Field label="Town"><Select id="wk-town" value={f.town} onChange={(v) => setF({ ...f, town: v })} options={TOWNS} /></Field>
          <Field label="Cuisine or activity"><Input id="wk-cat" value={f.category} onChange={(v) => setF({ ...f, category: v })} placeholder="seafood, tapas, whale watching, diving…" /></Field>
          <Field label="Languages (4)"><LangPicker value={langs} onChange={setLangs} /></Field>
          <Button kind="primary" busy={busy} onClick={run}>Ask AI now</Button>
          <p className="small faint">
            {mode === "live" ? "Claude answers for real. " : "Demo mode: answers are examples. "}
            ChatGPT, Gemini and Perplexity are simulated until their API keys are added.
          </p>
        </Card>
        {current ? <ResultSheet w={current} /> : <Empty>Run a check to get the one-page result to show on your phone.</Empty>}
      </div>
      <Card title="Saved walk-in checks">
        <Table rows={props.walkins} rowKey={(w) => w.id} onRow={(w) => setCurrentId(w.id)} empty="No walk-in checks yet."
          cols={[
            { label: "Venue", render: (w) => <span className="strong">{w.venue}</span> },
            { label: "Town", render: (w) => w.town },
            { label: "Asked for", render: (w) => w.category },
            { label: "Named by Claude", render: (w) => { const n = w.results.filter((r) => r.mentioned).length; return <Badge tone={n ? "warn" : "bad"}>{n} of {w.results.length}</Badge>; } },
            { label: "Status", render: (w) => (w.leadClientId ? <Badge tone="good">Lead saved</Badge> : <Badge>Prospect</Badge>) },
            { label: "Date", render: (w) => fmtDate(w.createdAt) },
          ]} />
      </Card>
      <TownReport walkins={props.walkins} />
    </div>
  );
}

function ResultSheet(props: { w: Walkin }) {
  const { w } = props;
  const hits = w.results.filter((r) => r.mentioned).length;
  const rivals = namedNotYou(w).slice(0, 3);
  async function saveLead() {
    const lead = await create<Client>("clients", {
      name: w.venue, kind: w.category, town: w.town, contact: "", phone: "", stage: "lead", subs: [], consents: [],
      languages: ["es", ...w.results.map((r) => r.lang).filter((l) => l !== "es")],
      notes: `Walk-in AI check ${fmtDate(w.createdAt)}: named by Claude in ${hits} of ${w.results.length} languages. Named instead: ${rivals.map((r) => r.name).join(", ")}.`,
    });
    await put(VCOL.walkins, { ...w, leadClientId: lead.id });
    await create<Task>("tasks", { title: `Follow up with ${w.venue} (${w.town}) about their AI check`, module: "visibility", clientId: lead.id, due: dayOffset(2), done: false });
    toast("Saved as a lead with a follow-up task in 2 days.");
  }
  return (
    <Card title="One-page result" aside={<>
      {!w.leadClientId && <Button small onClick={saveLead}>Save as lead</Button>}
    </>}>
      <div className="box stack" style={{ background: "var(--surface)", padding: 20 }}>
        <div className="stack-sm">
          <span className="eyebrow">Does AI recommend you?</span>
          <h2>{w.venue}, {w.town}</h2>
          <span className="small muted">Asked for "{w.category}" in {w.results.length} languages · {fmtDate(w.createdAt)}</span>
        </div>
        <div className="row wrap">
          <span style={{ fontFamily: "var(--f-display)", fontSize: "2rem", fontWeight: 700, color: hits ? "var(--warn)" : "var(--bad)" }}>{hits} of {w.results.length}</span>
          <span className="muted">languages where Claude named you {w.live ? "(live answer)" : "(demo answer)"}</span>
        </div>
        {rivals.length > 0 && (
          <div className="stack-sm">
            <span className="strong">These {rivals.length} places are named{hits === 0 ? ", not you" : " more often than you"}:</span>
            {rivals.map((r, i) => <span key={r.name}>{i + 1}. {r.name} <span className="small faint">named in {r.count} of {w.results.length} languages</span></span>)}
          </div>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Question asked</th><th>Claude</th>{SIM_ENGINES.map((e) => <th key={e}>{engineLabel(e)}</th>)}</tr></thead>
            <tbody>
              {w.results.map((r) => (
                <tr key={r.lang}>
                  <td><span className="row"><LangTag lang={r.lang} /><span className="small">{r.question}</span></span>
                    <span className="small faint">Named: {r.places.map((p) => p.name).join(", ") || "no places"}</span></td>
                  <td>{r.mentioned ? <Badge tone="good">Named</Badge> : <Badge tone="bad">Not named</Badge>}<div className="small faint">{r.live ? "live" : "demo"}</div></td>
                  {r.sim.map((s) => <td key={s.engine}>{s.mentioned ? <Badge>Named</Badge> : <Badge>Not named</Badge>}<div className="small faint">simulated</div></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <hr className="divider" />
        <p className="small muted">
          Full AI visibility check {eur(ONE_OFF)} once. Monthly tracking and fixes from {eur(TIERS["Add-on"].price)}/month with Maps & Reviews,
          or {eur(TIERS.Check.price)}, {eur(TIERS.Grow.price)} or {eur(TIERS.Pro.price)}/month on its own (+7% IGIC). First month free for pilots.
        </p>
        <p className="small faint">
          AI answers change and no one can guarantee a mention. We track the trend and fix what the AIs read: your Google profile, reviews, directories and menu.
          Simulated columns are estimates until those engines are connected.
        </p>
      </div>
    </Card>
  );
}

function TownReport(props: { walkins: Walkin[] }) {
  const towns = [...new Set(props.walkins.map((w) => w.town))];
  const [town, setTown] = useState(towns[0] ?? "");
  const [text, setText] = useState<string | undefined>();
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const inTown = props.walkins.filter((w) => w.town === (town || towns[0]));
  const tally = new Map<string, number>();
  inTown.forEach((w) => w.results.forEach((r) => r.places.forEach((p) => tally.set(p.name, (tally.get(p.name) ?? 0) + 1))));
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const answers = inTown.reduce((a, w) => a + w.results.length, 0);
  const quarter = `Q${Math.floor(new Date().getMonth() / 3) + 1} ${new Date().getFullYear()}`;

  async function write() {
    setBusy(true); setText("");
    const t = town || towns[0];
    const prompt = [
      `Write a short Facebook post in Spanish for local business groups: "¿A quién recomienda la IA en ${t}? ${quarter}".`,
      `Method: ${answers} AI answers to tourist questions in ${[...new Set(inTown.flatMap((w) => w.results.map((r) => r.lang)))].join(", ")}, ${inTown.map((w) => w.category).join(", ")}.`,
      `Most named places: ${top.map(([n, c]) => `${n} (${c})`).join(", ")}.`,
      "120 to 170 words. Explain why it matters for local businesses, list the top names, say that AI answers change often and nobody can guarantee a mention,",
      "and invite owners to ask for a free check in person or by message. No emoji, no hashtags.",
    ].join("\n");
    const demo = () => `¿A quién recomienda la IA en ${t}? Informe ${quarter}\n\nCada vez más turistas preguntan a ChatGPT o a Gemini dónde comer o qué excursión reservar. Hemos hecho ${answers} preguntas reales en varios idiomas sobre ${t} y estos son los sitios que más aparecen:\n\n${top.slice(0, 5).map(([n, c], i) => `${i + 1}. ${n} (${c} menciones)`).join("\n")}\n\nLas respuestas de la IA cambian a menudo y nadie puede garantizar una mención, pero sí se puede mejorar lo que la IA lee: la ficha de Google, las reseñas respondidas y los directorios.\n\nSi tienes un negocio en ${t} y quieres saber si la IA te recomienda, pásate o escríbenos y te hacemos la prueba gratis en cinco minutos.`;
    try { const res = await aiText(prompt, demo, { onText: setText, tier: "quick" }); setText(res.data); setLive(res.live); }
    finally { setBusy(false); }
  }

  return (
    <Card title={`Public "Who AI recommends" report`} aside={<span className="small faint">Free quarterly report for business groups and the Cámara de Comercio</span>}>
      {towns.length === 0 ? <Empty>Run walk-in checks in a town to build its report.</Empty> : (
        <div className="grid-2">
          <div className="stack">
            <Field label="Town"><Select id="tr-town" value={town || towns[0]} onChange={setTown} options={towns} /></Field>
            <div className="stack-sm">
              <span className="small faint">{answers} answers from {inTown.length} checks</span>
              {top.map(([n, c]) => (
                <div key={n} className="stack-sm">
                  <div className="row between small"><span>{n}</span><span className="num">{c}</span></div>
                  <div className="bar"><span style={{ width: `${(c / (top[0]?.[1] || 1)) * 100}%` }} /></div>
                </div>
              ))}
            </div>
            <div><Button kind="primary" busy={busy} onClick={write}>Write the post</Button></div>
          </div>
          {text != null ? <AiOutput title="Facebook post (Spanish)" text={text || "Writing…"} live={live} /> : <Empty>The post is written from the saved checks for this town.</Empty>}
        </div>
      )}
    </Card>
  );
}
