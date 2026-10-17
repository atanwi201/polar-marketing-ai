// Monthly report: views, calls, route requests, reviews answered, with an AI summary for the owner.
import { useState } from "react";
import { aiText } from "../core/ai";
import { create, put, now, today } from "../core/store";
import { AiOutput, Badge, Button, Card, Empty, Field, Input, Select, Stat, Stats, fmtDate, toast } from "../core/ui";
import { eur } from "../core/plans";
import type { Client } from "../core/types";
import { COL, monthLabel, p1Tier, shiftMonth, type Metrics, type MonthlyReport, type Post, type Review } from "./reviews-data";

type Num = "searchViews" | "mapsViews" | "calls" | "routes" | "webClicks";
const FIELDS: { k: Num; label: string }[] = [
  { k: "searchViews", label: "Search views" }, { k: "mapsViews", label: "Maps views" }, { k: "calls", label: "Calls" },
  { k: "routes", label: "Route requests" }, { k: "webClicks", label: "Website clicks" },
];

function delta(a?: number, b?: number) {
  if (a == null || b == null || b === 0) return undefined;
  const p = Math.round(((a - b) / b) * 100);
  return `${p >= 0 ? "+" : ""}${p}% vs last month`;
}

export function ReportTab(props: { client?: Client; metrics: Metrics[]; reviews: Review[]; posts: Post[]; reports: MonthlyReport[] }) {
  const c = props.client;
  const last = shiftMonth(today().slice(0, 7), -1);
  const [month, setMonth] = useState(last);
  const [stream, setStream] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!c) return <Empty>Pick a client at the top of the page.</Empty>;

  const m = props.metrics.find((x) => x.clientId === c.id && x.month === month);
  const prev = props.metrics.find((x) => x.clientId === c.id && x.month === shiftMonth(month, -1));
  const revs = props.reviews.filter((r) => r.clientId === c.id && r.date.startsWith(month));
  const answered = revs.filter((r) => r.status === "auto-posted" || r.status === "posted").length;
  const avg = revs.length ? revs.reduce((a, r) => a + r.rating, 0) / revs.length : 0;
  const langs = [...new Set(revs.map((r) => r.lang))];
  const posted = props.posts.filter((p) => p.clientId === c.id && p.month === month && p.status === "posted").length;
  const report = props.reports.find((r) => r.clientId === c.id && r.month === month);
  const sub = c.subs.find((s) => s.plan === "p1");
  const tenureDays = sub ? Math.round((Date.now() - new Date(sub.startedAt).getTime()) / 864e5) : 0;
  const history = [-2, -1, 0].map((k) => shiftMonth(month, k)).map((ym) => ({ ym, m: props.metrics.find((x) => x.clientId === c.id && x.month === ym) }));
  const maxCalls = Math.max(1, ...history.map((h) => (h.m?.calls ?? 0) + (h.m?.routes ?? 0)));

  async function summarise() {
    if (!c) return;
    setBusy(true); setStream("");
    const facts = m ? FIELDS.map((f) => `${f.label}: ${m[f.k]}${prev ? ` (last month ${prev[f.k]})` : ""}`).join("; ") : "No profile numbers entered.";
    const prompt = [
      `Write the monthly Google Maps report summary for ${c.contact}, owner of "${c.name}" (${c.kind}, ${c.town}), for ${monthLabel(month)}.`,
      `Write in Spanish, 90 to 140 words, plain and warm, no emoji. Start with the result that matters most to the business (calls and route requests mean customers).`,
      `Then one sentence on reviews, one on posts, and one concrete next step. Use only these numbers, never invent any:`,
      facts,
      `Reviews received: ${revs.length}, answered: ${answered}, average rating ${avg.toFixed(1)}, languages: ${langs.join(", ") || "none"}. Posts published: ${posted}.`,
    ].join("\n");
    const demo = () => {
      const calls = m?.calls ?? 0, routes = m?.routes ?? 0;
      const up = prev ? calls + routes - (prev.calls + prev.routes) : 0;
      return `Hola ${c.contact.split(" ")[0]}, este es el resumen de ${monthLabel(month).toLowerCase()} en Google Maps.\n\n` +
        `${calls} personas te llamaron desde el perfil y ${routes} pidieron cómo llegar${prev ? ` (${up >= 0 ? "+" : ""}${up} respecto al mes pasado)` : ""}. ` +
        `El perfil se vio ${(m?.searchViews ?? 0) + (m?.mapsViews ?? 0)} veces entre búsqueda y mapas.\n\n` +
        `Recibiste ${revs.length} reseñas con una media de ${avg.toFixed(1)} estrellas, en ${langs.length} idiomas, y respondimos ${answered}. ` +
        `Publicamos ${posted} posts.\n\nPróximo paso: subir 5 fotos nuevas de la terraza y del pescado del día para mantener el perfil fresco.`;
    };
    try {
      const res = await aiText(prompt, demo, { onText: setStream, tier: "quick" });
      if (report) await put(COL.reports, { ...report, summary: res.data, live: res.live });
      else await create<MonthlyReport>(COL.reports, { clientId: c.id, month, summary: res.data, live: res.live });
    } finally { setBusy(false); setStream(undefined); }
  }

  return (
    <div className="stack">
      <div className="row wrap between">
        <Select id="rp-month" value={month} onChange={setMonth} options={[-3, -2, -1, 0].map((k) => { const ym = shiftMonth(today().slice(0, 7), k); return { value: ym, label: monthLabel(ym) }; })} />
        <span className="small faint">Numbers come from the profile's Performance page (entered by hand until the Google API is connected).</span>
      </div>
      {tenureDays >= 75 && sub && !sub.annual && (
        <div className="banner">
          <span>{c.name} is {Math.round(tenureDays / 30)} months in. Offer the annual plan: 12 months for the price of 10 saves them {eur(sub.price * 2)}.</span>
          <Badge tone="info">Churn guard</Badge>
        </div>
      )}
      <Stats>
        <Stat label="Calls" value={m?.calls ?? "–"} sub={delta(m?.calls, prev?.calls)} tone="accent" />
        <Stat label="Route requests" value={m?.routes ?? "–"} sub={delta(m?.routes, prev?.routes)} tone="accent" />
        <Stat label="Profile views" value={m ? m.searchViews + m.mapsViews : "–"} sub={m && prev ? delta(m.searchViews + m.mapsViews, prev.searchViews + prev.mapsViews) : undefined} />
        <Stat label="Reviews answered" value={`${answered}/${revs.length}`} sub={revs.length ? `Average ${avg.toFixed(1)} stars` : "No reviews this month"} tone={answered === revs.length ? "good" : "warn"} />
        <Stat label="Posts published" value={posted} sub={`${p1Tier(c) ?? ""} plan`} />
      </Stats>
      <div className="grid-2">
        <Card title="Customers from the profile" aside={<span className="small faint">Calls + route requests</span>}>
          {history.map((h) => {
            const v = (h.m?.calls ?? 0) + (h.m?.routes ?? 0);
            return (
              <div key={h.ym} className="stack-sm">
                <div className="row between small"><span>{monthLabel(h.ym)}</span><span className="num strong">{h.m ? v : "no data"}</span></div>
                <div className="bar"><span style={{ width: `${(v / maxCalls) * 100}%` }} /></div>
              </div>
            );
          })}
        </Card>
        <MetricsForm key={c.id + month} client={c} month={month} m={m} />
      </div>
      <Card title={`Summary for ${c.contact.split(" ")[0]} · ${monthLabel(month)}`} aside={<>
        <Button small kind="primary" busy={busy} onClick={summarise}>{report ? "Rewrite summary" : "Write summary"}</Button>
        {report && <Button small onClick={async () => { await put(COL.reports, { ...report, sentAt: now() }); toast("Marked as sent (WhatsApp not connected yet). Copy the text to the owner."); }}>Mark as sent</Button>}
      </>}>
        {stream != null ? <AiOutput text={stream || "Writing…"} live /> :
          report ? <AiOutput title="Spanish" text={report.summary} live={report.live} /> :
          <Empty>Write the AI summary once the month's numbers are in. It goes to the owner with the PDF.</Empty>}
        {report?.sentAt && <span className="small faint">Sent {fmtDate(report.sentAt)} (simulated)</span>}
      </Card>
    </div>
  );
}

function MetricsForm(props: { client: Client; month: string; m?: Metrics }) {
  const [v, setV] = useState<Record<Num, string>>(() => {
    const o = {} as Record<Num, string>;
    FIELDS.forEach((f) => (o[f.k] = props.m ? String(props.m[f.k]) : ""));
    return o;
  });
  async function save() {
    const nums = Object.fromEntries(FIELDS.map((f) => [f.k, Number(v[f.k]) || 0])) as Record<Num, number>;
    if (props.m) await put(COL.metrics, { ...props.m, ...nums });
    else await create<Metrics>(COL.metrics, { clientId: props.client.id, month: props.month, ...nums });
    toast("Numbers saved.");
  }
  return (
    <Card title="Profile numbers">
      <div className="form-grid">
        {FIELDS.map((f) => (
          <Field key={f.k} label={f.label}><Input id={`mt-${f.k}`} type="number" min={0} value={v[f.k]} onChange={(x) => setV({ ...v, [f.k]: x })} /></Field>
        ))}
        <Button onClick={save}>Save numbers</Button>
      </div>
    </Card>
  );
}
