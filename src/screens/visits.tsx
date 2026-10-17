import { useState } from "react";
import { Page, Card, Button, Badge, Table, Field, Input, Select, TextArea, Form, Stats, Stat, AiOutput, ConfirmButton, fmtDate, toast, type Tone } from "../core/ui";
import { useCollection, create, put, remove, uid, now, today } from "../core/store";
import { aiText, pick } from "../core/ai";
import { TOWNS } from "../core/plans";
import type { Visit, Client } from "../core/types";

const OUTCOMES: Visit["outcome"][] = ["no-one", "interested", "pilot", "signed", "not now"];
const TONE: Record<Visit["outcome"], Tone> = { "no-one": "neutral", interested: "info", pilot: "warn", signed: "good", "not now": "neutral" };

export default function Visits() {
  const visits = useCollection<Visit>("visits");
  const t = today();
  const [venue, setVenue] = useState("");
  const [town, setTown] = useState("Los Cristianos");
  const [outcome, setOutcome] = useState<Visit["outcome"]>("interested");
  const [followUp, setFollowUp] = useState("");
  const [note, setNote] = useState("");

  const todayCount = visits.filter((v) => v.date === t).length;
  const week = visits.filter((v) => v.date >= addDays(t, -6));
  const conv = week.length ? Math.round((week.filter((v) => v.outcome === "pilot" || v.outcome === "signed").length / week.length) * 100) : 0;
  const sorted = [...visits].sort((a, b) => b.date.localeCompare(a.date));

  const log = async () => {
    if (!venue.trim()) return toast("Add the business name.");
    await create<Visit>("visits", { venue, town, date: t, outcome, followUp: followUp || undefined, note: note || undefined });
    toast(`Logged ${venue}`);
    setVenue(""); setNote(""); setFollowUp("");
  };

  const toClient = async (v: Visit) => {
    const id = uid();
    await put<Client>("clients", { id, createdAt: now(), name: v.venue, kind: "", town: v.town, contact: "", phone: "", stage: v.outcome === "signed" ? "paid" : v.outcome === "pilot" ? "pilot" : "lead", subs: [], consents: [], languages: ["es", "en"], notes: v.note });
    await put("visits", { ...v, clientId: id });
    toast(`${v.venue} added to clients`);
  };

  return (
    <Page title="Visits & follow-ups" intro="Selling is in person and by phone: Spanish law bans cold email, even to businesses. Log every walk-in here.">
      <Stats>
        <Stat label="Today" value={`${todayCount} / 10`} tone={todayCount >= 10 ? "good" : undefined} sub="Businesses visited" />
        <Stat label="Last 7 days" value={week.length} sub="Visits" />
        <Stat label="Pilot or signed" value={conv + "%"} sub="Of this week's visits" />
        <Stat label="Follow-ups due" value={visits.filter((v) => v.followUp && v.followUp <= t && v.outcome !== "signed").length} tone="warn" />
      </Stats>

      <div className="split">
        <div className="stack">
          <Card title="Log a visit">
            <Form onSubmit={log}>
              <Field label="Business" wide><Input id="v-venue" value={venue} onChange={setVenue} placeholder="Bar La Ola" /></Field>
              <Field label="Town"><Select id="v-town" value={town} onChange={setTown} options={TOWNS} /></Field>
              <Field label="Outcome"><Select id="v-out" value={outcome} onChange={setOutcome} options={OUTCOMES} /></Field>
              <Field label="Follow up on"><Input id="v-fu" type="date" value={followUp} onChange={setFollowUp} /></Field>
              <Field label="Note" wide><TextArea id="v-note" rows={2} value={note} onChange={setNote} placeholder="Owner back Thursday, left the printed audit" /></Field>
              <Button kind="primary" type="submit">Log visit</Button>
            </Form>
          </Card>
          <PitchCard />
        </div>

        <Card title="Visit log">
          <Table rows={sorted} rowKey={(v) => v.id} empty="No visits logged yet. Aim for 10 a day in one town."
            cols={[
              { label: "Business", render: (v) => <div className="stack-sm"><span className="strong">{v.venue}</span><span className="small faint">{v.town} · {fmtDate(v.date)}</span>{v.note && <span className="small muted">{v.note}</span>}</div> },
              { label: "Outcome", render: (v) => <Badge tone={TONE[v.outcome]}>{v.outcome}</Badge> },
              { label: "Follow up", render: (v) => v.followUp ? <Badge tone={v.followUp < t ? "bad" : v.followUp === t ? "warn" : "neutral"}>{fmtDate(v.followUp)}</Badge> : "" },
              { label: "", render: (v) => (
                <span className="row">
                  {!v.clientId && v.outcome !== "no-one" && <Button small onClick={() => toClient(v)}>Add as client</Button>}
                  {v.followUp && <Button small kind="ghost" onClick={() => put("visits", { ...v, followUp: undefined })}>Done</Button>}
                  <ConfirmButton label="Delete" confirm="Delete" onConfirm={() => remove("visits", v.id)} />
                </span>
              ) },
            ]} />
        </Card>
      </div>
    </Page>
  );
}

function PitchCard() {
  const [kind, setKind] = useState("Seafood restaurant");
  const [town, setTown] = useState("Los Cristianos");
  const [out, setOut] = useState<{ text: string; live: boolean; error?: string }>();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await aiText(
      `Write a 60-second in-person pitch (Spanish first, then the same in English) for an 18-year-old walking into a ${kind} in ${town}, Tenerife. ` +
      `Open with: "When a tourist asks ChatGPT for the best ${kind.toLowerCase()} in ${town}, does it name you?" and offer to run the check on the phone right now. ` +
      `Then mention unanswered reviews in German/English and a free 30-day pilot. End with a clear next step. Plain text, short lines.`,
      () => demoPitch(kind, town),
      { onText: (text) => setOut((o) => ({ ...o, text, live: true })) },
    );
    setOut({ text: r.data, live: r.live, error: r.error });
    setBusy(false);
  };
  return (
    <Card title="Walk-in pitch">
      <div className="form-grid">
        <Field label="Business type"><Input id="p-kind" value={kind} onChange={setKind} /></Field>
        <Field label="Town"><Select id="p-town" value={town} onChange={setTown} options={TOWNS} /></Field>
      </div>
      <Button kind="primary" busy={busy} onClick={run}>Write pitch</Button>
      <AiOutput text={out?.text} live={out?.live} error={out?.error} />
    </Card>
  );
}

function demoPitch(kind: string, town: string) {
  const k = kind.toLowerCase();
  return `ES
Hola, soy ${pick(["Alex", "Sara", "Leo"], town)}, trabajo con negocios aquí en ${town}.
Una pregunta rápida: cuando un turista le pregunta a ChatGPT por el mejor ${k} de ${town}, ¿te nombra a ti?
Lo miramos ahora en mi móvil, son 30 segundos.
[Run the check]
También he visto reseñas en alemán e inglés sin responder. Yo las contesto en su idioma, cada semana.
Te lo hago gratis 30 días. Si no ves más llamadas y rutas en Google Maps, no pagas nada.
¿Te paso el lunes a las 11 para darte acceso?

EN
Hi, I'm ${pick(["Alex", "Sara", "Leo"], town)}, I work with businesses here in ${town}.
Quick question: when a tourist asks ChatGPT for the best ${k} in ${town}, does it name you?
Let's check on my phone right now, it takes 30 seconds.
I also saw German and English reviews with no reply. I answer every one in the guest's language.
I'll do it free for 30 days. If you don't see more calls and route requests on Google Maps, you pay nothing.
Can I come by Monday at 11 to set up access?`;
}

function addDays(iso: string, n: number) {
  return new Date(new Date(iso + "T12:00:00").getTime() + n * 864e5).toISOString().slice(0, 10);
}
