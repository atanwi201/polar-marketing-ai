// Tracker views: overview (share of voice, trend, engines, questions, spot checks), tracked questions and settings, cited sources.
import { useState } from "react";
import { aiJson, useAiMode } from "../core/ai";
import { create, put, remove, today } from "../core/store";
import {
  Badge, Button, Card, ConfirmButton, Empty, Field, Input, LangPicker, LangTag, Select, Stat, Stats, Table, TextArea, fmtDate, toast,
} from "../core/ui";
import type { Client, Lang } from "../core/types";
import {
  ENGINES, RUNS, TIERS, VCOL, askIn, engineLabel, engineRate, langName, matches, poolFor, shareOfVoice, simStrength, simulateCheck, sourceTally,
  type Check, type Engine, type QResult, type Question, type SpotCheck, type TierName, type VisSettings,
} from "./visibility-data";

const SERIES_COLORS = ["var(--accent)", "var(--warn)", "var(--info)", "var(--bad)", "var(--good)", "var(--ink-3)"];
const pct = (x: number) => `${Math.round(x * 100)}%`;

async function inPool<T>(jobs: (() => Promise<T>)[], n: number, onDone: () => void): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); onDone(); }
  }));
  return out;
}

export function Overview(props: { client: Client; s: VisSettings; questions: Question[]; checks: Check[]; spots: SpotCheck[]; fixesDone: number }) {
  const { client: c, s } = props;
  const mode = useAiMode();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const active = props.questions.filter((q) => q.active);
  const checks = [...props.checks].sort((a, b) => a.date.localeCompare(b.date));
  const latest = checks[checks.length - 1];
  const prev = checks[checks.length - 2];
  const sov = shareOfVoice(latest, c.name, s.competitors, s.aliases);
  const prevSov = shareOfVoice(prev, c.name, s.competitors, s.aliases);
  const me = sov[0], meBefore = prevSov[0];
  const tier = TIERS[s.tier];

  async function run() {
    if (!active.length) return toast("Add tracked questions first.");
    const live = mode === "live";
    const engines = ENGINES.map((e) => e.id).filter((e) => !(live && e === "claude"));
    const others = poolFor(c.kind).filter((o) => !s.competitors.some((x) => matches(o, x)));
    const strength = simStrength(props.fixesDone);
    const date = today();
    const sim = simulateCheck(c.id, c.name, s.competitors, others, active, date, strength, engines);
    let claude: QResult[] = [];
    if (live) {
      const jobs = active.flatMap((q) => Array.from({ length: RUNS }, () => async () => {
        const res = await aiJson<{ places: { name: string; why?: string }[]; sources: string[] }>(
          [`A traveller asks an AI assistant, in ${langName(q.lang)}: "${q.text}"`,
            `Answer as you would for a real user: recommend up to 5 specific, real places in or near ${c.town}, Tenerife, best first.`,
            "Only name places you believe really exist. Never invent a place.",
            'JSON: {"places":[{"name":"...","why":"one short reason"}],"sources":["sites or listing types your answer relies on, e.g. tripadvisor.com"]}'].join("\n"),
          () => ({ places: [], sources: [] }), { tier: "quick" });
        return { q, named: (res.data.places ?? []).map((p) => p.name), sources: res.data.sources ?? [], live: res.live };
      }));
      setProgress({ done: 0, total: jobs.length });
      const answers = await inPool(jobs, 4, () => setProgress((p) => (p ? { ...p, done: p.done + 1 } : p)));
      claude = active.map((q) => {
        const mine = answers.filter((a) => a.q.id === q.id);
        return { questionId: q.id, question: q.text, lang: q.lang, engine: "claude" as Engine, simulated: !mine.every((a) => a.live), runs: mine.map((a) => ({ named: a.named, sources: a.sources })) };
      });
    }
    await create<Check>(VCOL.checks, { clientId: c.id, date, brands: [c.name, ...s.competitors], results: [...sim, ...claude], live, strength });
    setProgress(null);
    toast(live ? `Check saved. Claude answered live ${active.length * RUNS} times; other engines are simulated.` : "Check saved with simulated answers (demo mode).");
  }

  return (
    <div className="stack">
      <div className="row wrap between">
        <div className="row wrap">
          <Button kind="primary" busy={!!progress} onClick={run}>Run check now</Button>
          {progress && <span className="small muted">Asking Claude {progress.done}/{progress.total}…</span>}
          {!progress && <span className="small faint">{active.length} questions × {ENGINES.length} engines × {RUNS} runs = {active.length * ENGINES.length * RUNS} answers</span>}
        </div>
        <span className="small faint">{latest ? `Last check ${fmtDate(latest.date)} · ${tier.cadence} on ${s.tier}` : `Tracking runs ${tier.cadence} on ${s.tier}`}</span>
      </div>
      <div className="banner">
        <span className="small">
          {mode === "live" ? "Claude answers live. " : "Demo mode: every engine is simulated. "}
          ChatGPT, Gemini, Perplexity and Google AI Overviews are simulated until their API keys are added.
        </span>
        <Badge tone="warn">Simulated engines</Badge>
      </div>
      {!latest ? (
        <Empty action={<Button kind="primary" onClick={run}>Run first check</Button>}>No checks yet. Add questions, then run the first check to get a baseline.</Empty>
      ) : (
        <>
          <Stats>
            <Stat label="Share of voice" value={pct(me.share)} tone="accent" sub={meBefore ? `${me.share >= meBefore.share ? "+" : ""}${Math.round((me.share - meBefore.share) * 100)} pts since ${fmtDate(prev!.date)}` : "First check"} />
            <Stat label="Answers naming you" value={pct(me.rate)} sub={`${me.mentions} of ${latest.results.flatMap((r) => r.runs).length}`} />
            <Stat label="Top competitor" value={sov.slice(1).sort((a, b) => b.share - a.share)[0]?.brand ?? "–"} sub={sov.length > 1 ? pct(sov.slice(1).sort((a, b) => b.share - a.share)[0].share) + " share" : "Add competitors"} />
            <Stat label="Checks so far" value={checks.length} sub={`${s.languages.length} languages tracked`} />
          </Stats>
          <div className="grid-2">
            <Card title="Share of voice" aside={<span className="small faint">You vs competitors, latest check</span>}>
              {sov.map((v, i) => (
                <div key={v.brand} className="stack-sm">
                  <div className="row between small"><span className={v.isClient ? "strong" : ""}>{v.brand}{v.isClient && " (you)"}</span><span className="num">{pct(v.share)} · named in {pct(v.rate)}</span></div>
                  <div className="bar"><span style={{ width: pct(v.share), background: SERIES_COLORS[i % SERIES_COLORS.length] }} /></div>
                </div>
              ))}
              {s.competitors.length === 0 && <p className="small faint">Add competitors on the Questions tab to compare.</p>}
            </Card>
            <Card title="Trend" aside={<span className="small faint">Share of voice per check</span>}>
              <Trend checks={checks} s={s} client={c.name} />
            </Card>
          </div>
          <Card title="By engine">
            <Table rows={ENGINES} rowKey={(e) => e.id} cols={[
              { label: "Engine", render: (e) => <span className="strong">{e.label}</span> },
              { label: "Names you", num: true, render: (e) => pct(engineRate(latest, e.id, c.name, s.aliases).rate) },
              { label: "Named most", render: (e) => engineRate(latest, e.id, c.name, s.aliases).top },
              { label: "Source", render: (e) => engineRate(latest, e.id, c.name, s.aliases).simulated ? <Badge tone="warn">Simulated</Badge> : <Badge tone="accent">Live</Badge> },
            ]} />
          </Card>
          <QuestionGrid check={latest} client={c.name} aliases={s.aliases} />
        </>
      )}
      <SpotChecks client={c} spots={props.spots} questions={props.questions} />
      <p className="small faint">AI answers change all the time and no one can guarantee a mention. We sell trend tracking and fixes, never promised rankings.</p>
    </div>
  );
}

function Trend(props: { checks: Check[]; s: VisSettings; client: string }) {
  const { checks, s } = props;
  if (checks.length < 2) return <Empty>The trend line appears after the second check.</Empty>;
  const brands = [props.client, ...s.competitors];
  const series = brands.map((b, i) => checks.map((ch) => shareOfVoice(ch, props.client, s.competitors, s.aliases)[i]?.share ?? 0));
  const W = 560, H = 200, L = 34, R = 10, T = 10, B = 26;
  const max = Math.max(0.1, ...series.flat());
  const x = (i: number) => L + (i * (W - L - R)) / (checks.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <div className="stack-sm">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Share of voice over time">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" />
            <text x={L - 6} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">{Math.round(max * f * 100)}%</text>
          </g>
        ))}
        {checks.map((ch, i) => <text key={ch.id} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{fmtDate(ch.date).replace(/ \d{4}$/, "")}</text>)}
        {series.map((pts, si) => (
          <g key={brands[si]}>
            <polyline fill="none" stroke={SERIES_COLORS[si % SERIES_COLORS.length]} strokeWidth={si === 0 ? 3 : 1.6} strokeDasharray={si === 0 ? undefined : "4 3"}
              points={pts.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {pts.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={si === 0 ? 3.5 : 2.5} fill={SERIES_COLORS[si % SERIES_COLORS.length]} />)}
          </g>
        ))}
      </svg>
      <div className="row wrap small">
        {brands.map((b, i) => <span key={b} className="row"><span style={{ width: 10, height: 10, borderRadius: 2, background: SERIES_COLORS[i % SERIES_COLORS.length], display: "inline-block" }} />{b}</span>)}
      </div>
    </div>
  );
}

function QuestionGrid(props: { check: Check; client: string; aliases: string[] }) {
  const qs = [...new Map(props.check.results.map((r) => [r.questionId, r])).values()];
  return (
    <Card title="By question" aside={<span className="small faint">Times named out of {RUNS} runs</span>}>
      <Table rows={qs} rowKey={(q) => q.questionId} cols={[
        { label: "Question", render: (q) => <span className="row"><LangTag lang={q.lang} />{q.question}</span> },
        ...ENGINES.map((e) => ({
          label: e.id === "aio" ? "AI Overv." : e.label, num: true,
          render: (q: QResult) => {
            const r = props.check.results.find((x) => x.questionId === q.questionId && x.engine === e.id);
            if (!r) return "–";
            const hits = r.runs.filter((run) => run.named.some((n) => matches(n, props.client, props.aliases))).length;
            return <Badge tone={hits === 0 ? "bad" : hits === RUNS ? "good" : "warn"}>{hits}/{r.runs.length}</Badge>;
          },
        })),
      ]} />
    </Card>
  );
}

function SpotChecks(props: { client: Client; spots: SpotCheck[]; questions: Question[] }) {
  const [f, setF] = useState<{ engine: Engine; question: string; named: string; note: string }>({ engine: "chatgpt", question: props.questions[0]?.id ?? "", named: "no", note: "" });
  const list = props.spots.filter((x) => x.clientId === props.client.id).sort((a, b) => b.date.localeCompare(a.date));
  async function add() {
    const q = props.questions.find((x) => x.id === f.question);
    if (!q) return toast("Pick a question.");
    await create<SpotCheck>(VCOL.spot, { clientId: props.client.id, date: today(), engine: f.engine, question: q.text, lang: q.lang, named: f.named === "yes", note: f.note.trim() || undefined });
    setF({ ...f, note: "" });
    toast("Spot check saved.");
  }
  return (
    <Card title="Spot checks in the real apps" aside={<span className="small faint">API answers can differ from the consumer apps. Check monthly and show both.</span>}>
      <div className="form-grid">
        <Field label="App"><Select id="sp-eng" value={f.engine} onChange={(v) => setF({ ...f, engine: v })} options={ENGINES.map((e) => ({ value: e.id, label: e.label }))} /></Field>
        <Field label="Question"><Select id="sp-q" value={f.question} onChange={(v) => setF({ ...f, question: v })} options={props.questions.map((q) => ({ value: q.id, label: `${q.lang.toUpperCase()} · ${q.text}` }))} /></Field>
        <Field label="Named?"><Select id="sp-named" value={f.named} onChange={(v) => setF({ ...f, named: v })} options={[{ value: "yes", label: "Yes, named" }, { value: "no", label: "Not named" }]} /></Field>
        <Field label="Note"><Input id="sp-note" value={f.note} onChange={(v) => setF({ ...f, note: v })} placeholder="Named 4th, after La Marea" /></Field>
        <Button onClick={add}>Save spot check</Button>
      </div>
      <Table rows={list} rowKey={(x) => x.id} empty="No spot checks yet. Ask the question on your phone in the real app and record what it said."
        cols={[
          { label: "Date", render: (x) => fmtDate(x.date) },
          { label: "App", render: (x) => engineLabel(x.engine) },
          { label: "Question", render: (x) => <span className="row"><LangTag lang={x.lang} />{x.question}</span> },
          { label: "Result", render: (x) => (x.named ? <Badge tone="good">Named</Badge> : <Badge tone="bad">Not named</Badge>) },
          { label: "Note", render: (x) => <span className="small muted">{x.note}</span> },
        ]} />
    </Card>
  );
}

// ---------- questions + settings ----------

export function QuestionsTab(props: { client: Client; s: VisSettings; questions: Question[] }) {
  const { client: c } = props;
  const [s, setS] = useState(props.s);
  const [comp, setComp] = useState(props.s.competitors.join("\n"));
  const [text, setText] = useState("");
  const [lang, setLang] = useState<Lang>(props.s.languages[0] ?? "en");
  const [busy, setBusy] = useState(false);
  const tier = TIERS[s.tier];
  const active = props.questions.filter((q) => q.active);
  const trackLangs: Lang[] = s.languages.length ? s.languages : ["en"];

  async function saveSettings() {
    const competitors = comp.split(/\n|,/).map((x) => x.trim()).filter(Boolean);
    if (competitors.length > tier.competitors) return toast(`${s.tier} tracks up to ${tier.competitors} competitors.`);
    if (s.languages.length > tier.languages) return toast(`${s.tier} tracks up to ${tier.languages} languages.`);
    await put(VCOL.settings, { ...s, competitors });
    toast("Tracking settings saved.");
  }
  async function add(t: string, l: Lang) {
    if (!t.trim()) return;
    if (active.length >= tier.questions) return toast(`${s.tier} tracks up to ${tier.questions} questions. Pause one or upgrade.`);
    await create<Question>(VCOL.questions, { clientId: c.id, text: t.trim(), lang: l, active: true });
  }
  async function suggest() {
    setBusy(true);
    try {
      const res = await aiJson<{ questions: { text: string; lang: Lang }[] }>(
        [`Suggest 8 questions tourists really type into ChatGPT or Google when choosing a ${c.kind} like "${c.name}" in ${c.town}, Tenerife.`,
          `Write each question natively in one of these languages, spread evenly: ${trackLangs.map(langName).join(", ")}. Do not include the business name.`,
          c.notes ? `Context: ${c.notes}` : "", 'JSON: {"questions":[{"text":"...","lang":"de"}]}'].filter(Boolean).join("\n"),
        () => ({ questions: trackLangs.flatMap((l) => [0, 1, 2, 3].map((i) => ({ text: askIn(l, c.kind + " " + (c.notes ?? ""), c.town, i), lang: l }))).slice(0, 8) }),
        { tier: "quick" });
      const existing = new Set(props.questions.map((q) => q.text.toLowerCase()));
      let added = 0;
      for (const q of res.data.questions) {
        if (existing.has(q.text.toLowerCase()) || active.length + added >= tier.questions) continue;
        await create<Question>(VCOL.questions, { clientId: c.id, text: q.text, lang: q.lang, active: true }); added++;
      }
      toast(added ? `${added} questions added${res.live ? "" : " (demo suggestions)"}.` : "No new questions fit the plan limit.");
    } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="split">
        <Card title="Tracking settings">
          <Field label="Plan">
            <Select id="vs-tier" value={s.tier} onChange={(v: TierName) => setS({ ...s, tier: v })}
              options={(Object.keys(TIERS) as TierName[]).map((t) => ({ value: t, label: `${t} · €${TIERS[t].price}/mo` }))} />
          </Field>
          <p className="small faint">{tier.detail}.</p>
          <Field label={`Languages (up to ${tier.languages})`}><LangPicker value={s.languages} onChange={(v) => setS({ ...s, languages: v })} /></Field>
          <Field label={`Competitors (up to ${tier.competitors}, one per line)`}><TextArea id="vs-comp" rows={3} value={comp} onChange={setComp} /></Field>
          <Field label="Other names AIs use for you" hint="Comma separated, e.g. a short name"><Input id="vs-alias" value={s.aliases.join(", ")} onChange={(v) => setS({ ...s, aliases: v.split(",").map((x) => x.trim()).filter(Boolean) })} /></Field>
          <Button kind="primary" onClick={saveSettings}>Save settings</Button>
        </Card>
        <Card title="Tracked questions" aside={<Badge tone={active.length >= tier.questions ? "warn" : "neutral"}>{active.length}/{tier.questions} active</Badge>}>
          <div className="row wrap">
            <div style={{ flex: "1 1 240px" }}><Input id="vq-text" value={text} onChange={setText} placeholder="best seafood restaurant in Los Cristianos" /></div>
            <Select id="vq-lang" value={lang} onChange={setLang} options={trackLangs.map((l) => ({ value: l, label: langName(l) }))} />
            <Button onClick={async () => { await add(text, lang); setText(""); }}>Add</Button>
            <Button kind="ghost" busy={busy} onClick={suggest}>Suggest with AI</Button>
          </div>
          {props.questions.length === 0 ? <Empty>No questions yet. Use the phrases tourists type, in their languages.</Empty> : (
            <div className="stack-sm">
              {[...props.questions].sort((a, b) => a.lang.localeCompare(b.lang)).map((q) => (
                <div key={q.id} className="row between box">
                  <span className="row"><LangTag lang={q.lang} /><span className={q.active ? "" : "faint"}>{q.text}</span></span>
                  <span className="row">
                    <Button small kind="ghost" onClick={() => put(VCOL.questions, { ...q, active: !q.active })}>{q.active ? "Pause" : "Resume"}</Button>
                    <ConfirmButton label="Delete" confirm="Delete" onConfirm={() => remove(VCOL.questions, q.id)} />
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="small faint">Each question runs {RUNS} times on every engine to smooth out random answers.</p>
        </Card>
      </div>
    </div>
  );
}

// ---------- sources ----------

export function SourcesTab(props: { client: Client; s: VisSettings; checks: Check[] }) {
  const latest = [...props.checks].sort((a, b) => b.date.localeCompare(a.date))[0];
  const rows = sourceTally(latest);
  const listed = new Set(props.s.listedOn);
  async function toggle(src: string) {
    const next = listed.has(src) ? props.s.listedOn.filter((x) => x !== src) : [...props.s.listedOn, src];
    await put(VCOL.settings, { ...props.s, listedOn: next });
  }
  const gaps = rows.filter((r) => !listed.has(r.source)).slice(0, 3);
  if (!latest) return <Empty>Run a check to see which pages and listings the AIs cite.</Empty>;
  return (
    <div className="stack">
      {gaps.length > 0 && (
        <div className="banner">
          <span className="small">Biggest gaps: {gaps.map((g) => `${g.source} (cited ${g.count}×)`).join(", ")}. Claim or fix these listings first; the fix pack picks them up.</span>
        </div>
      )}
      <Card title="Cited sources" aside={<span className="small faint">From the check on {fmtDate(latest.date)}. Mark where {props.client.name} is listed and up to date.</span>}>
        <Table rows={rows} rowKey={(r) => r.source} cols={[
          { label: "Source", render: (r) => <span className="mono">{r.source}</span> },
          { label: "Citations", num: true, render: (r) => r.count },
          { label: "Engines", render: (r) => <span className="small">{r.engines.map(engineLabel).join(", ")}</span> },
          { label: "Languages", render: (r) => <span className="row wrap">{r.langs.map((l) => <LangTag key={l} lang={l} />)}</span> },
          { label: "Your listing", render: (r) => (
            <Button small kind={listed.has(r.source) ? "ghost" : "secondary"} onClick={() => toggle(r.source)}>
              {listed.has(r.source) ? "Listed and correct" : "Missing or wrong"}
            </Button>) },
        ]} />
        <p className="small faint">Sources from simulated engines are typical of what those engines cite for Tenerife queries, not live data.</p>
      </Card>
    </div>
  );
}
