// Plan 10 · Retention Flows.
import { useEffect, useMemo, useState } from "react";
import {
  Page, Card, Button, Field, Input, TextArea, Select, Tabs, Badge, Empty, Table, Stats, Stat, Modal, ClientPicker, LangTag, CopyButton, ConfirmButton, toast, fmtDate, type Tone,
} from "../core/ui";
import { useCollection, put, remove, create, now } from "../core/store";
import { eur } from "../core/plans";
import { EX, example, dayOffset } from "../core/seed";
import type { Client, Task } from "../core/types";
import {
  COL, type Customer, type RetSetup, type Flow, type Campaign, type Channel, type MsgLang, type Audience, type ConsentRec, type MonthReport, type Send,
  consentState, segments, spend, lastVisit, STOP_RE, defaultSetup, SEGMENT_LABEL, isoDate, lastMonths,
} from "./retention-logic";
import { qrPath } from "./retention-qr";
import { SegmentsView, FlowsView, CampaignsView, ReportView, defaultFlows } from "./retention-views";

type TabId = "customers" | "optin" | "segments" | "flows" | "campaigns" | "report";
export interface Prefill { audience: Audience; goal: string }

export default function Screen() {
  const clients = useCollection<Client>("clients");
  const setups = useCollection<RetSetup>(COL.setup);
  const allCustomers = useCollection<Customer>(COL.customers);
  const [clientId, setClientId] = useState("");
  const [tab, setTab] = useState<TabId>("customers");
  const [prefill, setPrefill] = useState<Prefill | null>(null);

  const sorted = useMemo(() => {
    const paying = (c: Client) => Number(c.subs.some((s) => s.plan === "p10")) * 2 + Number(setups.some((s) => s.clientId === c.id));
    return [...clients].sort((a, b) => paying(b) - paying(a) || a.name.localeCompare(b.name));
  }, [clients, setups]);
  useEffect(() => { if (!clientId && sorted.length) setClientId(sorted[0].id); }, [sorted, clientId]);

  const client = clients.find((c) => c.id === clientId);
  const setup = setups.find((s) => s.clientId === clientId);
  const customers = allCustomers.filter((c) => c.clientId === clientId);

  async function start() {
    if (!client) return;
    await put(COL.setup, { ...defaultSetup(client), id: "setup-" + client.id, createdAt: now() });
    for (const f of defaultFlows(client)) await put(COL.flows, f);
    toast("Retention set up with default flows. Add the opt-in QR next.");
    setTab("optin");
  }

  return (
    <Page
      plan="Plan 10 · Retention Flows"
      title="Retention flows"
      intro="WhatsApp and email marketing to each business's own opted-in customers. Consent is recorded with date and source, opt-outs block sends at once, and every campaign is drafted in ES, EN and DE for approval."
      actions={clients.length ? <ClientPicker id="rt-client" clients={sorted} value={clientId} onChange={setClientId} /> : undefined}
    >
      {!clients.length && <Empty>Add a client first.</Empty>}
      {client && !setup && (
        <Empty action={<Button kind="primary" onClick={start}>Set up retention for {client.name}</Button>}>
          {client.name} has no retention setup yet. You will get a consent wording, an opt-in QR, frequency caps and default flows.
        </Empty>
      )}
      {client && setup && (
        <>
          <Tabs<TabId> value={tab} onChange={setTab} tabs={[
            { id: "customers", label: "Customers", count: customers.length },
            { id: "optin", label: "Opt-in & consent" },
            { id: "segments", label: "Segments" },
            { id: "flows", label: "Flows" },
            { id: "campaigns", label: "Campaigns" },
            { id: "report", label: "Monthly report" },
          ]} />
          {tab === "customers" && <CustomersView client={client} setup={setup} customers={customers} />}
          {tab === "optin" && <OptInView key={client.id} client={client} setup={setup} customers={customers} />}
          {tab === "segments" && <SegmentsView key={client.id} client={client} setup={setup} customers={customers} onDraft={(p) => { setPrefill(p); setTab("campaigns"); }} />}
          {tab === "flows" && <FlowsView client={client} setup={setup} customers={customers} />}
          {tab === "campaigns" && <CampaignsView key={client.id} client={client} setup={setup} customers={customers} prefill={prefill} onUsed={() => setPrefill(null)} />}
          {tab === "report" && <ReportView client={client} setup={setup} customers={customers} />}
        </>
      )}
    </Page>
  );
}

/* ---------- Shared bits ---------- */

const CONSENT_TONE: Record<string, Tone> = { in: "good", out: "bad", none: "neutral" };
const CONSENT_LABEL: Record<string, string> = { in: "Opted in", out: "Opted out", none: "No consent" };
export function ConsentBadge(props: { c: Customer; ch: Channel }) {
  const s = consentState(props.c, props.ch);
  return <Badge tone={CONSENT_TONE[s]}>{CONSENT_LABEL[s]}</Badge>;
}
const SEG_TONE: Record<string, Tone> = { new: "info", vip: "accent", lapsed: "warn", regular: "neutral" };
export function SegmentBadges(props: { c: Customer; setup: RetSetup }) {
  return <span className="row wrap">{segments(props.c, props.setup).map((s) => <Badge key={s} tone={SEG_TONE[s]}>{SEGMENT_LABEL[s]}</Badge>)}</span>;
}

const SOURCES = ["QR at counter", "QR on table", "Web form", "Booking form", "Paper form, signed in person"];
const digits = (s?: string) => (s ?? "").replace(/\D/g, "");

/* ---------- Customers ---------- */

function CustomersView(props: { client: Client; setup: RetSetup; customers: Customer[] }) {
  const { client, setup, customers } = props;
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = customers
    .filter((c) => !q || (c.name + " " + (c.phone ?? "") + " " + (c.email ?? "")).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (lastVisit(b) ?? "").localeCompare(lastVisit(a) ?? ""));
  const count = (ch: Channel, st: string) => customers.filter((c) => consentState(c, ch) === st).length;
  const open = customers.find((c) => c.id === openId);

  return (
    <div className="stack">
      <Stats>
        <Stat label="Customers" value={customers.length} />
        <Stat label="WhatsApp opt-ins" value={count("whatsapp", "in")} sub={`${count("whatsapp", "none")} without consent`} tone="good" />
        <Stat label="Email opt-ins" value={count("email", "in")} />
        <Stat label="Opted out" value={customers.filter((c) => consentState(c, "whatsapp") === "out" || consentState(c, "email") === "out").length} sub="Blocked from sends" tone="bad" />
      </Stats>
      <Card title={`${client.name} customers`} aside={<>
        <Input id="rt-q" value={q} onChange={setQ} placeholder="Search name, phone, email" />
        <Button small kind="primary" onClick={() => setAdding(true)}>Add customer</Button>
      </>}>
        <Table<Customer>
          rows={rows}
          rowKey={(c) => c.id}
          onRow={(c) => setOpenId(c.id)}
          empty={customers.length ? "No match." : "No customers yet. Put the opt-in QR on the counter, or import a list that has recorded consent."}
          cols={[
            { label: "Name", render: (c) => <span className="row">{c.name}<LangTag lang={c.lang} /></span> },
            { label: "Segment", render: (c) => <SegmentBadges c={c} setup={setup} /> },
            { label: "Visits", num: true, render: (c) => c.visits.length },
            { label: "Last visit", render: (c) => <span className="small">{fmtDate(lastVisit(c))}</span> },
            { label: "Spend", num: true, render: (c) => eur(spend(c)) },
            { label: "WhatsApp", render: (c) => <ConsentBadge c={c} ch="whatsapp" /> },
            { label: "Email", render: (c) => <ConsentBadge c={c} ch="email" /> },
          ]}
        />
        <p className="small faint">Segments update on their own from visits and orders. Only customers with a recorded opt-in get marketing messages (GDPR and LSSI).</p>
      </Card>
      {open && <CustomerModal c={open} setup={setup} onClose={() => setOpenId(null)} />}
      <AddCustomerModal open={adding} client={client} setup={setup} customers={customers} onClose={() => setAdding(false)} />
    </div>
  );
}

function CustomerModal(props: { c: Customer; setup: RetSetup; onClose: () => void }) {
  const { c, setup } = props;
  const [amount, setAmount] = useState("35");
  const [src, setSrc] = useState(SOURCES[4]);
  const [agreed, setAgreed] = useState(false);
  const save = (patch: Partial<Customer>) => put(COL.customers, { ...c, ...patch });

  async function optOut(ch: Channel) {
    await save({ optOuts: [...c.optOuts, { channel: ch, date: now(), via: "Marked by staff" }] });
    toast(`${c.name} opted out of ${ch}. All ${ch} sends are blocked from now on.`);
  }
  async function consent(ch: Channel) {
    if (!agreed) { toast("Tick that the customer agreed. Never record consent you do not have."); return; }
    await save({ consents: [...c.consents, { channel: ch, date: now(), source: src, wording: setup.wording[c.lang === "es" ? "es" : "en"] }] });
    setAgreed(false);
    toast(`Consent for ${ch} recorded with date and source.`);
  }
  async function visit() {
    const n = Number(amount);
    if (!(n > 0)) return;
    await save({ visits: [...c.visits, { date: isoDate(), amount: n }] });
    toast("Visit recorded. Segments updated.");
  }

  return (
    <Modal open title={c.name} onClose={props.onClose} footer={
      <ConfirmButton kind="danger" label="Delete (right to erasure)" confirm="Delete all data" onConfirm={async () => { await remove(COL.customers, c.id); props.onClose(); toast("Customer and consent history deleted."); }} />
    }>
      <div className="row wrap"><LangTag lang={c.lang} /><SegmentBadges c={c} setup={setup} /><span className="small muted">{c.phone} {c.email && `· ${c.email}`} {c.birthday && `· birthday ${c.birthday}`}</span></div>
      <div className="grid-2">
        {(["whatsapp", "email"] as Channel[]).map((ch) => (
          <div key={ch} className="box stack-sm">
            <div className="row between"><strong>{ch === "whatsapp" ? "WhatsApp" : "Email"}</strong><ConsentBadge c={c} ch={ch} /></div>
            {c.consents.filter((x) => x.channel === ch).map((x, i) => (
              <span key={i} className="small">Opted in {fmtDate(x.date)} via {x.source}<br /><span className="faint">"{x.wording}"</span></span>
            ))}
            {c.optOuts.filter((x) => x.channel === ch).map((x, i) => <span key={i} className="small" style={{ color: "var(--bad)" }}>Opted out {fmtDate(x.date)} ({x.via})</span>)}
            {consentState(c, ch) === "in"
              ? <Button small kind="ghost" onClick={() => optOut(ch)}>Opt out now</Button>
              : <Button small onClick={() => consent(ch)}>Record new opt-in</Button>}
          </div>
        ))}
      </div>
      <div className="form-grid">
        <Field label="Source of a new opt-in"><Select id="cm-src" value={src} onChange={setSrc} options={SOURCES} /></Field>
        <label className="row small"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> The customer agreed just now</label>
      </div>
      <hr className="divider" />
      <div className="row between wrap">
        <strong>Visits ({c.visits.length}, {eur(spend(c))})</strong>
        <span className="row"><Input id="cm-amt" type="number" min={0} value={amount} onChange={setAmount} /><Button small onClick={visit}>Record visit</Button></span>
      </div>
      <div className="small muted">{[...c.visits].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map((v) => `${fmtDate(v.date)} ${eur(v.amount)}`).join(" · ") || "No visits yet."}</div>
      <strong>Messages sent</strong>
      {c.sends.length ? (
        <div className="stack-sm small">{[...c.sends].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6).map((s, i) => (
          <span key={i}>{fmtDate(s.at)} · {s.label} · {s.channel}{s.cost ? ` · ${eur(s.cost)}` : ""}{!s.marketing && " · service"}</span>
        ))}</div>
      ) : <span className="small muted">None yet.</span>}
    </Modal>
  );
}

function AddCustomerModal(props: { open: boolean; client: Client; setup: RetSetup; customers: Customer[]; onClose: () => void }) {
  const blank = { name: "", phone: "", email: "", lang: "es" as MsgLang, birthday: "", wa: false, em: false, source: SOURCES[4] };
  const [f, setF] = useState(blank);
  async function save() {
    if (!f.name.trim() || (!f.phone.trim() && !f.email.trim())) { toast("Add a name and a phone or email."); return; }
    const res = await submitOptIn(props.client, props.setup, props.customers, f);
    toast(res);
    setF(blank);
    props.onClose();
  }
  return (
    <Modal open={props.open} title="Add customer" onClose={props.onClose} footer={<Button kind="primary" onClick={save}>Save</Button>}>
      <OptInFields f={f} setF={setF} wording={props.setup.wording} withSource />
    </Modal>
  );
}

type OptInForm = { name: string; phone: string; email: string; lang: MsgLang; birthday: string; wa: boolean; em: boolean; source: string };

function OptInFields(props: { f: OptInForm; setF: (f: OptInForm) => void; wording: RetSetup["wording"]; withSource?: boolean }) {
  const { f, setF } = props;
  return (
    <div className="form-grid">
      <Field label="Name"><Input id="oi-n" value={f.name} onChange={(v) => setF({ ...f, name: v })} /></Field>
      <Field label="Mobile (WhatsApp)"><Input id="oi-p" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} placeholder="+34 6.." /></Field>
      <Field label="Email"><Input id="oi-e" type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })} /></Field>
      <Field label="Birthday (optional)"><Input id="oi-b" value={f.birthday} onChange={(v) => setF({ ...f, birthday: v })} placeholder="MM-DD" /></Field>
      <Field label="Language"><Select<MsgLang> id="oi-l" value={f.lang} onChange={(v) => setF({ ...f, lang: v })} options={[{ value: "es", label: "Español" }, { value: "en", label: "English" }, { value: "de", label: "Deutsch" }]} /></Field>
      {props.withSource && <Field label="Source"><Select id="oi-s" value={f.source} onChange={(v) => setF({ ...f, source: v })} options={SOURCES} /></Field>}
      <div className="field-wide stack-sm small">
        <label className="row"><input type="checkbox" checked={f.wa} onChange={(e) => setF({ ...f, wa: e.target.checked })} /> {f.lang === "es" ? "Quiero recibir ofertas por WhatsApp" : "Send me offers on WhatsApp"}</label>
        <label className="row"><input type="checkbox" checked={f.em} onChange={(e) => setF({ ...f, em: e.target.checked })} /> {f.lang === "es" ? "Quiero recibir ofertas por email" : "Send me offers by email"}</label>
        <span className="faint">{props.wording[f.lang === "es" ? "es" : "en"]} Boxes start unticked.</span>
      </div>
    </div>
  );
}

/** Create or update a customer from an opt-in form. Consent is recorded only for ticked boxes. */
async function submitOptIn(client: Client, setup: RetSetup, customers: Customer[], f: OptInForm): Promise<string> {
  const at = now();
  const wording = setup.wording[f.lang === "es" ? "es" : "en"];
  const consents: ConsentRec[] = [
    ...(f.wa && f.phone ? [{ channel: "whatsapp" as const, date: at, source: f.source, wording }] : []),
    ...(f.em && f.email ? [{ channel: "email" as const, date: at, source: f.source, wording }] : []),
  ];
  const bday = /^\d{2}-\d{2}$/.test(f.birthday) ? f.birthday : undefined;
  const existing = customers.find((c) => (f.phone && digits(c.phone) === digits(f.phone)) || (f.email && c.email?.toLowerCase() === f.email.toLowerCase()));
  if (existing) {
    await put(COL.customers, { ...existing, phone: existing.phone || f.phone || undefined, email: existing.email || f.email || undefined, birthday: existing.birthday ?? bday, consents: [...existing.consents, ...consents] });
    return consents.length ? `${existing.name} updated with ${consents.length} new consent record(s).` : `${existing.name} updated. No consent ticked, so no marketing.`;
  }
  await create<Customer>(COL.customers, {
    clientId: client.id, name: f.name.trim(), phone: f.phone.trim() || undefined, email: f.email.trim() || undefined, lang: f.lang, birthday: bday,
    visits: [], consents, optOuts: [], sends: [],
  });
  return consents.length ? `${f.name} added with consent recorded (${f.source}, ${fmtDate(at)}).` : `${f.name} added without marketing consent.`;
}

/* ---------- Opt-in & consent ---------- */

function OptInView(props: { client: Client; setup: RetSetup; customers: Customer[] }) {
  const { client, customers } = props;
  const [s, setS] = useState<RetSetup>(props.setup);
  const [form, setForm] = useState<OptInForm>({ name: "", phone: "", email: "", lang: "es", birthday: "", wa: false, em: false, source: "QR at counter" });
  const [inbox, setInbox] = useState({ phone: "", text: "BAJA" });
  const dirty = JSON.stringify(s) !== JSON.stringify(props.setup);
  const url = (src: string) => `https://optin.example/${s.slug}?src=${src}`;

  async function saveSetup() {
    if (s.waCost < 0.05 || s.waCost > 0.07) { toast("WhatsApp cost should be between €0.05 and €0.07 per marketing message."); return; }
    if (s.capWeek < 1 || s.capMonth < s.capWeek) { toast("Set a weekly cap of at least 1 and a monthly cap at least as high."); return; }
    await put(COL.setup, s);
    toast("Setup saved.");
  }
  async function submitForm() {
    if (!form.name.trim() || (!form.phone.trim() && !form.email.trim())) { toast("The form needs a name and a phone or email."); return; }
    if (!form.wa && !form.em) { toast("No box ticked: nothing saved. Consent must be an active choice."); return; }
    toast(await submitOptIn(client, props.setup, customers, form));
    setForm({ ...form, name: "", phone: "", email: "", birthday: "", wa: false, em: false });
  }
  async function handleReply() {
    const c = customers.find((x) => digits(x.phone) && digits(x.phone) === digits(inbox.phone));
    if (!STOP_RE.test(inbox.text)) { toast("Not an opt-out keyword. The message would go to the normal inbox."); return; }
    if (!c) { toast("No customer with that number. Nothing to block."); return; }
    await put(COL.customers, { ...c, optOuts: [...c.optOuts, { channel: "whatsapp", date: now(), via: `Replied "${inbox.text.trim()}"` }] });
    toast(`${c.name} opted out instantly. WhatsApp sends to this number are now blocked.`);
  }

  const log = customers
    .flatMap((c) => [
      ...c.consents.map((x) => ({ c, kind: "Opt-in" as const, channel: x.channel, date: x.date, detail: x.source })),
      ...c.optOuts.map((x) => ({ c, kind: "Opt-out" as const, channel: x.channel, date: x.date, detail: x.via })),
    ])
    .sort((a, b) => b.date.localeCompare(a.date));
  const csv = ["customer,phone,email,event,channel,date,source,wording",
    ...customers.flatMap((c) => [
      ...c.consents.map((x) => [c.name, c.phone ?? "", c.email ?? "", "opt-in", x.channel, x.date, x.source, x.wording]),
      ...c.optOuts.map((x) => [c.name, c.phone ?? "", c.email ?? "", "opt-out", x.channel, x.date, x.via, ""]),
    ].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")))].join("\n");

  return (
    <div className="stack">
      <div className="banner small"><span><strong>Consent rules:</strong> marketing goes only to customers who ticked a box, with date, source and wording stored. Lists without proof are not used; rebuild them with a QR offer.</span></div>
      <div className="grid-2">
        <Card title="Opt-in QR codes">
          <div className="grid-2">
            {[["counter", "Counter"], ["table", "Table or mirror"]].map(([src, label]) => <QrCard key={src} url={url(src)} label={label} offer={s.offer.es} biz={client.name} />)}
          </div>
          <p className="small faint">Each QR opens the opt-in form and records its source. The form page is a placeholder until the web form is hosted.</p>
        </Card>
        <Card title="Opt-in form preview" aside={<Badge tone="info">Test it</Badge>}>
          <p className="small muted">What a customer sees after scanning. Submitting records consent here.</p>
          <OptInFields f={form} setF={setForm} wording={props.setup.wording} />
          <div className="row"><Select id="oi-src" value={form.source} onChange={(v) => setForm({ ...form, source: v })} options={SOURCES} /><Button kind="primary" onClick={submitForm}>Submit as customer</Button></div>
        </Card>
      </div>
      <Card title="Setup" aside={<Button small kind="primary" onClick={saveSetup} disabled={!dirty}>Save</Button>}>
        <div className="form-grid">
          <Field label="Tone of voice" wide><Input id="st-tone" value={s.tone} onChange={(v) => setS({ ...s, tone: v })} /></Field>
          <Field label="Approved offer (ES)"><Input id="st-oes" value={s.offer.es} onChange={(v) => setS({ ...s, offer: { ...s.offer, es: v } })} /></Field>
          <Field label="Approved offer (EN)"><Input id="st-oen" value={s.offer.en} onChange={(v) => setS({ ...s, offer: { ...s.offer, en: v } })} /></Field>
          <Field label="Approved offer (DE)"><Input id="st-ode" value={s.offer.de} onChange={(v) => setS({ ...s, offer: { ...s.offer, de: v } })} /></Field>
          <Field label="Max marketing messages per week"><Input id="st-cw" type="number" min={1} value={s.capWeek} onChange={(v) => setS({ ...s, capWeek: Number(v) || 0 })} /></Field>
          <Field label="Max per 30 days"><Input id="st-cm" type="number" min={1} value={s.capMonth} onChange={(v) => setS({ ...s, capMonth: Number(v) || 0 })} /></Field>
          <Field label="WhatsApp cost per message (€)" hint="€0.05 to €0.07, billed to the client at cost"><Input id="st-wa" type="number" step={0.005} min={0.05} value={s.waCost} onChange={(v) => setS({ ...s, waCost: Number(v) || 0 })} /></Field>
          <Field label="Form address"><Input id="st-slug" value={s.slug} onChange={(v) => setS({ ...s, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></Field>
          <Field label="Online store (simulated)"><Select<RetSetup["store"]> id="st-store" value={s.store} onChange={(v) => setS({ ...s, store: v })} options={[{ value: "", label: "None (local business)" }, { value: "Shopify", label: "Shopify" }, { value: "WooCommerce", label: "WooCommerce" }]} /></Field>
          <Field label="Consent wording (ES)" wide><TextArea id="st-wes" rows={2} value={s.wording.es} onChange={(v) => setS({ ...s, wording: { ...s.wording, es: v } })} /></Field>
          <Field label="Consent wording (EN)" wide><TextArea id="st-wen" rows={2} value={s.wording.en} onChange={(v) => setS({ ...s, wording: { ...s.wording, en: v } })} /></Field>
        </div>
      </Card>
      <div className="grid-2">
        <Card title="Opt-out handling">
          <p className="small muted">Replies with BAJA, STOP, ABMELDEN or similar block the number at once, before any queued send.</p>
          <div className="form-grid">
            <Field label="From number"><Input id="ob-p" value={inbox.phone} onChange={(v) => setInbox({ ...inbox, phone: v })} placeholder={customers.find((c) => c.phone)?.phone ?? "+34 6.."} /></Field>
            <Field label="Message"><Input id="ob-t" value={inbox.text} onChange={(v) => setInbox({ ...inbox, text: v })} /></Field>
          </div>
          <div className="row"><Button onClick={handleReply}>Simulate incoming reply</Button></div>
        </Card>
        <Card title="Consent log" aside={<CopyButton text={csv} label="Copy CSV" />}>
          {log.length ? (
            <div className="stack-sm small">
              {log.slice(0, 10).map((e, i) => (
                <div key={i} className="row between">
                  <span>{e.c.name} · {e.channel}</span>
                  <span className="row"><Badge tone={e.kind === "Opt-in" ? "good" : "bad"}>{e.kind}</Badge><span className="faint">{fmtDate(e.date)} · {e.detail}</span></span>
                </div>
              ))}
            </div>
          ) : <Empty>No consent records yet.</Empty>}
        </Card>
      </div>
    </div>
  );
}

function QrCard(props: { url: string; label: string; offer: string; biz: string }) {
  const qr = useMemo(() => { try { return qrPath(props.url); } catch { return null; } }, [props.url]);
  return (
    <div className="box stack-sm" style={{ alignItems: "center", textAlign: "center" }}>
      <strong className="small">{props.label}</strong>
      {qr ? (
        <svg viewBox={`0 0 ${qr.size} ${qr.size}`} width="150" height="150" role="img" aria-label={`QR code for ${props.url}`} shapeRendering="crispEdges">
          <rect width={qr.size} height={qr.size} fill="var(--rail-hi)" />
          <path d={qr.d} fill="var(--rail)" />
        </svg>
      ) : <span className="small faint">Address too long for a QR</span>}
      <span className="small">Escanea y llévate {props.offer}</span>
      <span className="small faint">{props.biz} · baja cuando quieras</span>
      <span className="mono small faint" style={{ overflowWrap: "anywhere" }}>{props.url}</span>
    </div>
  );
}

/* ---------- Seed ---------- */

function rng(seed: number) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const NAMES: [string, MsgLang][] = [
  ["Carla Hernández", "es"], ["Nayra Pérez", "es"], ["Yaiza González", "es"], ["Laura Rodríguez", "es"], ["Elena Afonso", "es"], ["Raquel Díaz", "es"],
  ["Cristina Martín", "es"], ["Ana Delgado", "es"], ["Patricia Expósito", "es"], ["Tamara Cabrera", "es"], ["Irene Suárez", "es"], ["Marina Castro", "es"],
  ["Beatriz Febles", "es"], ["Noelia Ramos", "es"], ["Lorena Padrón", "es"], ["Judith Mesa", "es"], ["Sara Morales", "es"], ["Alba Trujillo", "es"],
  ["Emily Clarke", "en"], ["Sophie Turner", "en"], ["Hannah Brooks", "en"], ["Lena Fischer", "de"], ["Katrin Bauer", "de"], ["Miriam Hoffmann", "de"],
  ["Davinia Barrios", "es"], ["Iratxe Gil", "es"],
];

export async function seed(): Promise<void> {
  const S = EX.salon;
  const r = rng(1027);
  await put(COL.setup, example("ex-retention-setup-salon", {
    clientId: S, tone: "Cercano y alegre, tutea, frases cortas, nada de mayúsculas gritonas", offer: { es: "un 15% en tu próximo tratamiento", en: "15% off your next treatment", de: "15 % auf deine nächste Behandlung" },
    capWeek: 1, capMonth: 4, lapsedDays: 60, vipVisits: 8, vipSpend: 400, waCost: 0.06, slug: "salon-nube",
    wording: {
      es: "Acepto recibir ofertas y recordatorios de Salón Nube por el canal marcado. Puedo darme de baja en cualquier momento respondiendo BAJA.",
      en: "I agree to receive offers and reminders from Salón Nube on the channel I ticked. I can opt out at any time by replying STOP.",
    },
    store: "" as const,
  }));

  const winbackId = "ex-retention-camp-1";
  const birthdayFlow = "ex-retention-flow-birthday";
  const reviewFlow = "ex-retention-flow-review";
  const customers: Customer[] = NAMES.map(([name, lang], i) => {
    const profile = i % 5; // 0 VIP, 1 regular, 2 lapsed, 3 new, 4 occasional
    const n = profile === 0 ? 9 + Math.floor(r() * 5) : profile === 1 ? 4 + Math.floor(r() * 3) : profile === 2 ? 2 + Math.floor(r() * 3) : profile === 3 ? 1 : 2 + Math.floor(r() * 2);
    const visits = Array.from({ length: n }, (_, k) => {
      const span = profile === 2 ? [90, 230] : profile === 3 ? [2, 25] : profile === 4 ? [65, 220] : [3, 220];
      const off = profile === 3 ? span[0] + Math.floor(r() * (span[1] - span[0])) : span[0] + Math.floor(((span[1] - span[0]) * (k + r() * 0.8)) / n);
      return { date: dayOffset(-off), amount: [28, 35, 45, 60, 75, 90][Math.floor(r() * 6)] };
    });
    const phone = `+34 6${String(10000000 + Math.floor(r() * 89999999)).slice(0, 2)} ${String(Math.floor(100 + r() * 899))} ${String(Math.floor(100 + r() * 899))}`;
    const first = name.split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const consents: ConsentRec[] = [];
    const wording = lang === "es" ? "Acepto recibir ofertas y recordatorios de Salón Nube por el canal marcado. Puedo darme de baja en cualquier momento respondiendo BAJA." : "I agree to receive offers and reminders from Salón Nube on the channel I ticked. I can opt out at any time by replying STOP.";
    if (i % 7 !== 6) consents.push({ channel: "whatsapp", date: new Date(Date.now() - (10 + Math.floor(r() * 60)) * 864e5).toISOString(), source: i % 3 ? "QR at counter" : "QR on table", wording });
    if (i % 3 === 0) consents.push({ channel: "email", date: new Date(Date.now() - (5 + Math.floor(r() * 70)) * 864e5).toISOString(), source: "Booking form", wording });
    const optOuts = i === 9 || i === 17 ? [{ channel: "whatsapp" as const, date: new Date(Date.now() - (2 + i % 5) * 864e5).toISOString(), via: 'Replied "BAJA"' }] : [];
    const sends: Send[] = [];
    if (profile === 2 && consents.some((c) => c.channel === "whatsapp") && !optOuts.length) {
      sends.push({ at: new Date(Date.now() - 18 * 864e5).toISOString(), ref: winbackId, label: "Octubre: te echamos de menos", channel: "whatsapp", cost: 0.06, marketing: true });
      if (i === 12 || i === 22) visits.push({ date: dayOffset(-14), amount: 60 });
    }
    if (profile === 1 && i % 2 === 1) sends.push({ at: new Date(Date.now() - 40 * 864e5).toISOString(), ref: reviewFlow, label: "Review request", channel: "whatsapp", cost: 0.06, marketing: true });
    if (profile === 1 && i % 2 === 0 && consents.length) {
      visits.push({ date: dayOffset(-7), amount: 45 });
      sends.push({ at: new Date(Date.now() - 6 * 864e5).toISOString(), ref: reviewFlow, label: "Review request", channel: "whatsapp", cost: 0.06, marketing: true });
    }
    const bday = `${String(((i * 5) % 12) + 1).padStart(2, "0")}-${String(((i * 7) % 27) + 1).padStart(2, "0")}`;
    return {
      ...example(`ex-retention-cust-${i + 1}`, {
        clientId: S, name, phone, email: i % 3 === 0 ? `${first}.${i}@correo.es` : undefined, lang,
        birthday: i === 4 ? isoDate(3).slice(5) : i % 2 ? bday : undefined,
        visits, consents, optOuts, sends,
        nextAppointment: i === 1 || i === 6 ? dayOffset(1) : i === 11 ? dayOffset(2) : undefined,
      }),
    };
  });
  // A birthday flow send last month that brought a visit.
  customers[8].sends.push({ at: new Date(Date.now() - 35 * 864e5).toISOString(), ref: birthdayFlow, label: "Birthday", channel: "whatsapp", cost: 0.06, marketing: true });
  customers[8].visits.push({ date: dayOffset(-31), amount: 75 });
  for (const c of customers) await put(COL.customers, c);

  const salon = { id: S, name: "Salón Nube", kind: "Beauty salon", town: "La Laguna" } as Client;
  for (const f of defaultFlows(salon, { es: "un 15% en tu próximo tratamiento", en: "15% off your next treatment", de: "15 % auf deine nächste Behandlung" })) {
    await put(COL.flows, { ...f, ...example(f.id.replace(/^flow-ex-salon-/, "ex-retention-flow-"), {}), on: ["birthday", "winback", "review", "reminder"].includes(f.kind) } as Flow);
  }

  const sentList = customers.filter((c) => c.sends.some((s) => s.ref === winbackId));
  await put(COL.campaigns, example(winbackId, {
    clientId: S, title: "Octubre: te echamos de menos", goal: "winback", brief: "Clientas que no vienen desde el verano", audience: "lapsed" as Audience, channel: "whatsapp" as Channel,
    drafts: {
      es: "¡Hola {nombre}! Hace tiempo que no te vemos por Salón Nube y te echamos de menos. Para tu próxima visita tienes un 15% en tu próximo tratamiento. Reserva respondiendo a este mensaje.\n\nResponde BAJA para no recibir más mensajes.",
      en: "Hi {name}! It has been a while since your last visit to Salón Nube. Come back and enjoy 15% off your next treatment. Just reply here to book.\n\nReply STOP to opt out.",
      de: "Hallo {vorname}! Wir haben dich bei Salón Nube schon länger nicht gesehen. Bei deinem nächsten Besuch bekommst du 15 % auf deine nächste Behandlung. Antworte einfach hier, um zu buchen.\n\nAntworte STOP, um dich abzumelden.",
    },
    live: false, status: "sent" as const, sentAt: new Date(Date.now() - 18 * 864e5).toISOString(), recipients: sentList.length,
    excluded: { noContact: 0, optedOut: 1, noConsent: 1, capped: 0 }, cost: sentList.length * 0.06,
  }));
  const task: Task = example("ex-retention-task-1", { title: "Approve Salón Nube campaign: Navidad, reserva tu cita", module: "retention", clientId: S, due: dayOffset(1), done: false });
  await put("tasks", task);
  await put(COL.campaigns, example("ex-retention-camp-2", {
    clientId: S, title: "Navidad: reserva tu cita", goal: "promo", brief: "Huecos para Navidad y Reyes, peinados de fiesta", audience: "all" as Audience, channel: "whatsapp" as Channel,
    drafts: {
      es: "¡Hola {nombre}! Ya puedes reservar tu cita para Navidad y Reyes en Salón Nube: peinados de fiesta, color y manicura. Los huecos de diciembre vuelan, ¿te guardamos uno? Responde a este mensaje.\n\nResponde BAJA para no recibir más mensajes.",
      en: "Hi {name}! Christmas and Three Kings bookings are open at Salón Nube: party hair, colour and nails. December slots go fast, shall we save you one? Reply here.\n\nReply STOP to opt out.",
      de: "Hallo {vorname}! Ab sofort kannst du bei Salón Nube deinen Termin für Weihnachten und Heilige Drei Könige buchen: Festfrisuren, Farbe und Maniküre. Die Dezembertermine sind schnell weg. Antworte hier.\n\nAntworte STOP, um dich abzumelden.",
    },
    live: false, status: "draft" as const, taskId: "ex-retention-task-1",
  }));

  const prevMonth = lastMonths(2)[1];
  const rep: MonthReport = example("ex-retention-report-1", {
    clientId: S, month: prevMonth, live: false,
    text: `Informe de Salón Nube, ${prevMonth}\n\nLas clientas que repiten trajeron la mayor parte de la facturación del mes. El flujo de cumpleaños trajo de vuelta a una clienta en menos de una semana y las peticiones de reseña sumaron 4 opiniones nuevas en Google.\nMensajes enviados: 9. Coste de WhatsApp: 0,54 €, facturado al coste.\n\nPruebas para el mes que viene:\n1. Campaña de win-back a clientas sin visita desde el verano.\n2. Poner el QR también en el espejo de cada puesto.`,
  });
  await put(COL.reports, rep);
}
