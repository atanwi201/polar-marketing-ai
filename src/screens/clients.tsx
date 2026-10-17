import { useState } from "react";
import { Page, Card, Button, Badge, Table, Tabs, Modal, Field, Input, TextArea, Select, LangPicker, ConfirmButton, Stats, Stat, Empty, fmtDate, toast, type Tone } from "../core/ui";
import { useCollection, put, remove, uid, now, today } from "../core/store";
import { clientMrr, subLabel, subMrr, upsellFor, withIgic } from "../core/biz";
import { PLANS, planById, TOWNS, eur } from "../core/plans";
import type { Client, Stage, Subscription, PlanId, Consent } from "../core/types";

export const STAGE_TONE: Record<Stage, Tone> = { lead: "info", pilot: "warn", paid: "good", churned: "neutral" };
const STAGES: Stage[] = ["lead", "pilot", "paid", "churned"];

const blank = (): Client => ({
  id: uid(), createdAt: now(), name: "", kind: "Restaurant", town: "Los Cristianos", contact: "", phone: "", stage: "lead",
  subs: [], consents: [], languages: ["es", "en"],
});

export default function Clients() {
  const clients = useCollection<Client>("clients");
  const [tab, setTab] = useState<Stage | "all">("all");
  const [editing, setEditing] = useState<Client | null>(null);
  const shown = tab === "all" ? clients : clients.filter((c) => c.stage === tab);
  const count = (s: Stage) => clients.filter((c) => c.stage === s).length;

  return (
    <Page title="Clients & pipeline" intro="Every business from first visit to paying client, with what they buy and the consents you hold."
      actions={<Button kind="primary" onClick={() => setEditing(blank())}>Add client</Button>}>
      <Stats>
        {STAGES.map((s) => <Stat key={s} label={s === "paid" ? "Paying" : s[0].toUpperCase() + s.slice(1) + "s"} value={count(s)}
          sub={s === "paid" ? eur(Math.round(clients.reduce((n, c) => n + clientMrr(c), 0))) + "/mo" : undefined} />)}
      </Stats>
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "all", label: "All", count: clients.length }, ...STAGES.map((s) => ({ id: s, label: s[0].toUpperCase() + s.slice(1), count: count(s) }))]} />
        <Table rows={shown} rowKey={(c) => c.id} onRow={(c) => setEditing(structuredClone(c))}
          empty={<>No clients here. Use <strong>Add client</strong> after a visit, or log visits first.</>}
          cols={[
            { label: "Business", render: (c) => <div className="stack-sm"><span className="strong">{c.name}</span><span className="small faint">{c.kind} · {c.town}</span></div> },
            { label: "Stage", render: (c) => <Badge tone={STAGE_TONE[c.stage]}>{c.stage}</Badge> },
            { label: "Services", render: (c) => c.subs.length ? <div className="row wrap">{c.subs.map((s, i) => <Badge key={i}>{subLabel(s)}</Badge>)}</div> : <span className="faint">None</span> },
            { label: "Per month", render: (c) => c.subs.length ? eur(Math.round(c.subs.reduce((n, s) => n + subMrr(s), 0))) : "", num: true },
            { label: "Next", render: (c) => { const u = upsellFor(c); return u ? <span className="small muted">Offer {planById(u.plan).name}</span> : null; } },
          ]} />
      </Card>
      {editing && <ClientEditor client={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function ClientEditor({ client, onClose }: { client: Client; onClose: () => void }) {
  const [c, setC] = useState<Client>(client);
  const set = <K extends keyof Client>(k: K, v: Client[K]) => setC({ ...c, [k]: v });
  const isNew = !client.name;

  const save = async () => {
    if (!c.name.trim()) return toast("Give the business a name first.");
    await put("clients", c);
    toast(isNew ? "Client added" : "Client saved");
    onClose();
  };

  return (
    <Modal open title={isNew ? "New client" : c.name} onClose={onClose}
      footer={<>
        {!isNew && <ConfirmButton label="Delete client" confirm="Delete for good" onConfirm={async () => { await remove("clients", c.id); toast("Client deleted"); onClose(); }} />}
        <span style={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button kind="primary" onClick={save}>Save</Button>
      </>}>
      <div className="form-grid">
        <Field label="Business name"><Input id="c-name" value={c.name} onChange={(v) => set("name", v)} placeholder="Tasca El Puerto" /></Field>
        <Field label="Type of business"><Input id="c-kind" value={c.kind} onChange={(v) => set("kind", v)} placeholder="Restaurant, dive school…" /></Field>
        <Field label="Town"><Select id="c-town" value={c.town} onChange={(v) => set("town", v)} options={TOWNS.includes(c.town) ? TOWNS : [c.town, ...TOWNS]} /></Field>
        <Field label="Stage"><Select id="c-stage" value={c.stage} onChange={(v) => set("stage", v)} options={STAGES} /></Field>
        <Field label="Contact person"><Input id="c-contact" value={c.contact} onChange={(v) => set("contact", v)} /></Field>
        <Field label="Business phone"><Input id="c-phone" value={c.phone} onChange={(v) => set("phone", v)} placeholder="+34 922…" /></Field>
        <Field label="Email (invoices only)"><Input id="c-email" value={c.email ?? ""} onChange={(v) => set("email", v)} /></Field>
        <Field label="Referred by"><Input id="c-ref" value={c.referredBy ?? ""} onChange={(v) => set("referredBy", v)} placeholder="Gestoría, partner, client" /></Field>
        <Field label="Customer languages" wide><LangPicker value={c.languages} onChange={(v) => set("languages", v)} /></Field>
        <Field label="Notes" wide><TextArea id="c-notes" rows={3} value={c.notes ?? ""} onChange={(v) => set("notes", v)} /></Field>
      </div>
      <hr className="divider" />
      <SubsEditor subs={c.subs} onChange={(subs) => set("subs", subs)} />
      <hr className="divider" />
      <ConsentEditor consents={c.consents} onChange={(v) => set("consents", v)} />
    </Modal>
  );
}

function SubsEditor({ subs, onChange }: { subs: Subscription[]; onChange: (s: Subscription[]) => void }) {
  const [plan, setPlan] = useState<PlanId>("p1");
  const p = planById(plan);
  const [tier, setTier] = useState(p.tiers[0].name);
  const t = p.tiers.find((x) => x.name === tier) ?? p.tiers[0];
  const total = subs.reduce((n, s) => n + subMrr(s), 0);
  return (
    <div className="stack">
      <div className="row between"><h3>Services</h3><span className="small muted tabular">{eur(Math.round(total))}/mo · {eur(withIgic(total))} with IGIC</span></div>
      {subs.length ? subs.map((s, i) => (
        <div key={i} className="row between box wrap">
          <div className="stack-sm">
            <span className="strong">{subLabel(s)}</span>
            <span className="small faint">Since {fmtDate(s.startedAt)}{s.setup ? ` · setup ${eur(s.setup)}` : ""}</span>
          </div>
          <span className="row wrap">
            <span className="tabular">{eur(s.price)}/mo</span>
            <Button small kind={s.annual ? "primary" : "ghost"} title="12 months for the price of 10"
              onClick={() => onChange(subs.map((x, j) => (j === i ? { ...x, annual: !x.annual } : x)))}>{s.annual ? "Annual" : "Monthly"}</Button>
            <Button small kind="ghost" onClick={() => onChange(subs.filter((_, j) => j !== i))}>Remove</Button>
          </span>
        </div>
      )) : <Empty>No services yet.</Empty>}
      <div className="form-grid">
        <Field label="Plan"><Select id="s-plan" value={plan} onChange={(v) => { setPlan(v); setTier(planById(v).tiers[0].name); }} options={PLANS.map((x) => ({ value: x.id, label: x.name }))} /></Field>
        <Field label="Tier" hint={t.detail}><Select id="s-tier" value={tier} onChange={setTier} options={p.tiers.map((x) => ({ value: x.name, label: `${x.name} · ${x.price ? eur(x.price) + "/mo" : "one-off"}` }))} /></Field>
        <Button onClick={() => onChange([...subs, { plan, tier: t.name, price: t.price, setup: p.setup, startedAt: today() }])}>Add service</Button>
      </div>
    </div>
  );
}

function ConsentEditor({ consents, onChange }: { consents: Consent[]; onChange: (c: Consent[]) => void }) {
  const [channel, setChannel] = useState<Consent["channel"]>("whatsapp");
  const [source, setSource] = useState("Said yes during visit");
  return (
    <div className="stack">
      <div className="stack-sm">
        <h3>Marketing consent</h3>
        <span className="small muted">Spanish law (LSSI) needs recorded consent before you send this business any commercial email or WhatsApp. Log it with the date and how you got it.</span>
      </div>
      {consents.map((c, i) => (
        <div key={i} className="row between box">
          <span><Badge tone="good">{c.channel}</Badge> <span className="small">{fmtDate(c.date)} · {c.source}</span></span>
          <Button small kind="ghost" onClick={() => onChange(consents.filter((_, j) => j !== i))}>Withdraw</Button>
        </div>
      ))}
      <div className="form-grid">
        <Field label="Channel"><Select id="cs-ch" value={channel} onChange={setChannel} options={["whatsapp", "email"]} /></Field>
        <Field label="How you got it"><Input id="cs-src" value={source} onChange={setSource} /></Field>
        <Button onClick={() => onChange([...consents, { channel, source, date: today() }])}>Record consent</Button>
      </div>
    </div>
  );
}
