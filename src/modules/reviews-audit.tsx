// Profile health audit. Doubles as the free printed walk-in audit for prospects
// (Maps score, unanswered reviews, a sample reply in German).
import { useState } from "react";
import { BRAND } from "../core/brand";
import { aiJson } from "../core/ai";
import { create } from "../core/store";
import { dayOffset } from "../core/seed";
import {
  AiOutput, Badge, Button, Card, ClientPicker, Empty, Field, Input, Table, TextArea, fmtDate, toast,
} from "../core/ui";
import { IconCheck, IconX } from "./polar-icons";
import type { Client, Task } from "../core/types";
import { eur } from "../core/plans";
import { COL, demoReply, detectTopics, type Audit, type AuditItem, type Review } from "./reviews-data";

export const AUDIT_ITEMS: Omit<AuditItem, "ok">[] = [
  { id: "hours", label: "Opening hours set, including holiday hours", weight: 15 },
  { id: "photos", label: "20+ photos, some from the last 90 days", weight: 15 },
  { id: "categories", label: "Right primary and secondary categories", weight: 10 },
  { id: "menu", label: "Menu or services added (link or items)", weight: 10 },
  { id: "description", label: "Description names the town and specialities", weight: 10 },
  { id: "qa", label: "Questions & answers: common questions answered", weight: 10 },
  { id: "posts", label: "A post in the last 30 days", weight: 10 },
  { id: "contact", label: "Phone, website and booking link", weight: 5 },
];
const REVIEW_WEIGHT = 15;

export function auditScore(items: AuditItem[], unanswered: number): number {
  const base = items.reduce((a, i) => a + (i.ok ? i.weight : 0), 0);
  const rev = Math.round(REVIEW_WEIGHT * (1 - Math.min(unanswered, 10) / 10));
  return base + rev;
}

const scoreTone = (s: number) => (s >= 75 ? "good" : s >= 50 ? "warn" : "bad");

interface Draft { venue: string; town: string; kind: string; clientId: string; rating: string; reviewCount: string; unanswered: string; sampleReview: string; checks: Record<string, boolean> }
const blank = (): Draft => ({ venue: "", town: "", kind: "Restaurant", clientId: "", rating: "4.3", reviewCount: "", unanswered: "", sampleReview: "", checks: {} });

export function AuditTab(props: { audits: Audit[]; clients: Client[]; reviews: Review[] }) {
  const [d, setD] = useState<Draft>(blank());
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<Audit | null>(props.audits[0] ?? null);
  const shown = props.audits.find((a) => a.id === current?.id) ?? current ?? props.audits[0] ?? null;

  function pickClient(id: string) {
    const c = props.clients.find((x) => x.id === id);
    if (!c) return setD({ ...d, clientId: "" });
    const open = props.reviews.filter((r) => r.clientId === id && r.status === "new").length;
    const total = props.reviews.filter((r) => r.clientId === id).length;
    setD({ ...d, clientId: id, venue: c.name, town: c.town, kind: c.kind, unanswered: String(open), reviewCount: String(total) });
  }

  async function run() {
    if (!d.venue.trim()) return toast("Add the venue name.");
    setBusy(true);
    const items: AuditItem[] = AUDIT_ITEMS.map((i) => ({ ...i, ok: !!d.checks[i.id] }));
    const unanswered = Number(d.unanswered) || 0;
    const review = d.sampleReview.trim() || "Sehr leckeres Essen und tolle Lage am Meer, aber wir mussten fast eine Stunde auf unsere Hauptspeisen warten.";
    const rating = detectTopics(review).some((t) => t === "wait" || t === "price" || t === "noise") ? 3 : 4;
    const fakeClient = { name: d.venue, kind: d.kind, town: d.town, phone: "", contact: "" } as Client;
    try {
      const res = await aiJson<{ reply: string }>(
        [`Write a sample reply in German, as the owner of "${d.venue}" (${d.kind} in ${d.town}, Tenerife), to this Google review.`,
          `If the review is not in German, reply as if the same guest had written it in German.`,
          "60 to 90 words, warm, specific to what they said, no emoji, no discounts. Sign off with: Ihr Team von " + d.venue + ".",
          `Review: """${review}"""`, 'JSON: {"reply":"..."}'].join("\n"),
        () => ({ reply: demoReply({ reviewer: "Gast", rating, text: review, lang: "de" }, fakeClient, { signoff: `Ihr Team von ${d.venue}` }).reply.replace(", Gast!", "!").replace(/^Gast, (\S)/, (_m: string, ch: string) => ch.toUpperCase()) }),
        { tier: "quick" });
      const audit = await create<Audit>(COL.audits, {
        venue: d.venue.trim(), town: d.town.trim(), kind: d.kind, clientId: d.clientId || undefined, items, unanswered,
        rating: Number(d.rating) || 0, reviewCount: Number(d.reviewCount) || 0, score: auditScore(items, unanswered),
        sampleReview: review, sampleReplyDe: res.data.reply, live: res.live,
      });
      setCurrent(audit);
      toast("Audit ready. Show it on your phone during the visit.");
    } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="split">
        <Card title="Run a profile check">
          <Field label="Existing client (optional)">
            <ClientPicker id="au-client" clients={props.clients} value={d.clientId} onChange={pickClient} allowNone="Prospect, not a client yet" />
          </Field>
          <div className="form-grid">
            <Field label="Venue"><Input id="au-venue" value={d.venue} onChange={(v) => setD({ ...d, venue: v })} placeholder="Bar La Ola" /></Field>
            <Field label="Town"><Input id="au-town" value={d.town} onChange={(v) => setD({ ...d, town: v })} placeholder="Puerto de la Cruz" /></Field>
            <Field label="Rating"><Input id="au-rating" type="number" step={0.1} value={d.rating} onChange={(v) => setD({ ...d, rating: v })} /></Field>
            <Field label="Reviews"><Input id="au-count" type="number" value={d.reviewCount} onChange={(v) => setD({ ...d, reviewCount: v })} /></Field>
            <Field label="Unanswered (last 20)"><Input id="au-open" type="number" value={d.unanswered} onChange={(v) => setD({ ...d, unanswered: v })} /></Field>
          </div>
          <div className="stack-sm">
            <span className="field-label">What the profile already has</span>
            {AUDIT_ITEMS.map((i) => (
              <label key={i.id} className="row small">
                <input type="checkbox" checked={!!d.checks[i.id]} onChange={(e) => setD({ ...d, checks: { ...d.checks, [i.id]: e.target.checked } })} />
                <span>{i.label}</span><span className="faint">{i.weight}</span>
              </label>
            ))}
          </div>
          <Field label="Their newest unanswered review" hint="Paste one. A German review shows the point best. Left empty, a typical one is used.">
            <TextArea id="au-review" rows={3} value={d.sampleReview} onChange={(v) => setD({ ...d, sampleReview: v })} />
          </Field>
          <Button kind="primary" busy={busy} onClick={run}>Score profile and draft German reply</Button>
        </Card>
        {shown ? <AuditSheet a={shown} /> : <Empty>Run a check to get a one-page audit to show on your phone at the counter.</Empty>}
      </div>
      <Card title="Saved audits">
        <Table rows={props.audits} rowKey={(a) => a.id} onRow={setCurrent} empty="No audits yet."
          cols={[
            { label: "Venue", render: (a) => <span className="strong">{a.venue}</span> },
            { label: "Town", render: (a) => a.town },
            { label: "Type", render: (a) => (a.clientId ? <Badge tone="accent">Client</Badge> : <Badge>Prospect</Badge>) },
            { label: "Score", num: true, render: (a) => <Badge tone={scoreTone(a.score)}>{a.score}/100</Badge> },
            { label: "Date", render: (a) => fmtDate(a.createdAt) },
          ]} />
      </Card>
    </div>
  );
}

function AuditSheet(props: { a: Audit }) {
  const a = props.a;
  const missing = a.items.filter((i) => !i.ok).sort((x, y) => y.weight - x.weight);
  const good = a.items.filter((i) => i.ok);
  async function followUp() {
    await create<Task>("tasks", { title: `Call ${a.venue} (${a.town}) about their Maps audit (${a.score}/100)`, module: "reviews", due: dayOffset(2), done: false });
    toast("Follow-up task added for the day after tomorrow.");
  }
  return (
    <Card title="Audit sheet" aside={<>
      {!a.clientId && <Button small onClick={followUp}>Add follow-up task</Button>}
    </>}>
      <div className="box stack" style={{ background: "var(--surface)", padding: 20 }}>
        <div className="row between wrap">
          <div className="stack-sm">
            <span className="eyebrow">Free Google Maps check</span>
            <h2>{a.venue}</h2>
            <span className="small muted">{a.town} · {a.kind} · {fmtDate(a.createdAt)}</span>
          </div>
          <div className="stat" style={{ textAlign: "center" }}>
            <div className="stat-label">Maps score</div>
            <div className="stat-value" style={{ color: `var(--${scoreTone(a.score)})` }}>{a.score}<span className="small faint">/100</span></div>
          </div>
        </div>
        <div className="grid-3">
          <div className="stack-sm"><span className="small faint">Rating</span><span className="strong">{a.rating.toFixed(1)} from {a.reviewCount} reviews</span></div>
          <div className="stack-sm"><span className="small faint">Unanswered reviews</span><span className="strong" style={{ color: a.unanswered ? "var(--bad)" : "var(--good)" }}>{a.unanswered}</span></div>
          <div className="stack-sm"><span className="small faint">Checklist</span><span className="strong">{good.length} of {a.items.length + 1} done</span></div>
        </div>
        <hr className="divider" />
        <div className="grid-2">
          <div className="stack-sm">
            <span className="strong">Fix first</span>
            {a.unanswered > 0 && <span className="small pm-line pm-line-bad"><IconX />Reply to {a.unanswered} waiting reviews, in each guest's language</span>}
            {missing.map((i) => <span key={i.id} className="small pm-line pm-line-bad"><IconX />{i.label}</span>)}
            {!missing.length && !a.unanswered && <span className="small">Nothing urgent. Keep posting and replying.</span>}
          </div>
          <div className="stack-sm">
            <span className="strong">Already good</span>
            {good.map((i) => <span key={i.id} className="small muted pm-line pm-line-good"><IconCheck />{i.label}</span>)}
            {!a.unanswered && <span className="small muted pm-line pm-line-good"><IconCheck />Every review answered</span>}
          </div>
        </div>
        {a.sampleReplyDe && (
          <div className="stack-sm">
            <span className="strong">How we would answer a German guest</span>
            {a.sampleReview && <span className="small faint">"{a.sampleReview}"</span>}
            <AiOutput title="Sample reply in German" text={a.sampleReplyDe} live={a.live} />
          </div>
        )}
        <hr className="divider" />
        <p className="small muted">
          Maps & Reviews from {eur(99)}/month + 7% IGIC: profile clean-up, monthly posts, and a reply to every review in the guest's language.
          Free 30-day pilot. We improve your profile; nobody can guarantee a Google ranking.
        </p>
        <p className="small faint">Prepared by {BRAND}, Tenerife.</p>
      </div>
    </Card>
  );
}

