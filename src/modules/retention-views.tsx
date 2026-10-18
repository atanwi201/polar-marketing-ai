// Retention sub-screens: segments, flows, campaigns and the monthly report.
import { useEffect, useMemo, useState } from "react";
import {
  Card, Button, Field, Input, TextArea, Select, Badge, Empty, Table, Stats, Stat, AiOutput, LangTag, ConfirmButton, toast, fmtDate, type Tone,
} from "../core/ui";
import { useCollection, put, remove, create, now, today } from "../core/store";
import { eur, IGIC } from "../core/plans";
import type { Client, Task } from "../core/types";
import {
  COL, type Customer, type RetSetup, type Flow, type FlowKind, type Campaign, type Channel, type MsgLang, type Audience, type Segment, type MonthReport, type SendPlan,
  segments, spend, planSend, inAudience, flowTriggered, monthStats, lastMonths, monthLabel, personalise, tierOf, flowIncluded,
  FLOW_DEFS, FLOW_ORDER, SEGMENT_LABEL, AUDIENCE_LABEL, EXCLUSION_LABEL, MSG_LANGS, defaultSetup, type Exclusion,
} from "./retention-logic";
import { draftCopy, templateDraft, writeMonthReport, GOALS, type GoalKey } from "./retention-ai";
import type { Prefill } from "./retention";

const LANG_NAME: Record<MsgLang, string> = { es: "Spanish", en: "English", de: "German" };

export function defaultFlows(client: Client, offer: Record<MsgLang, string> = defaultSetup(client).offer): Flow[] {
  return FLOW_ORDER.map((kind) => {
    const d = templateDraft(client.name, client.town, offer, kind, "");
    return {
      id: `flow-${client.id}-${kind}`, createdAt: now(), clientId: client.id, kind, on: kind === "birthday" || kind === "winback",
      channel: "whatsapp" as Channel, message: { es: d.es, en: d.en, de: d.de }, live: false,
    };
  });
}

/** Record a simulated send on every recipient, so frequency caps and attribution see it. */
async function recordSends(plan: SendPlan, ref: string, label: string, ch: Channel, setup: RetSetup, marketing: boolean) {
  const at = now();
  for (const c of plan.ok) {
    await put(COL.customers, { ...c, sends: [...c.sends, { at, ref, label, channel: ch, cost: ch === "whatsapp" ? setup.waCost : 0, marketing }] });
  }
}

function CostLine(props: { n: number; setup: RetSetup; channel: Channel }) {
  if (props.channel === "email") return <span className="small muted">Email: no per-message fee (Brevo plan).</span>;
  const { n, setup } = props;
  return (
    <span className="small">
      WhatsApp: {n} × {eur(0.05)}–{eur(0.07)} = {eur(n * 0.05)}–{eur(n * 0.07)}. At the set rate {eur(setup.waCost)}: <strong>{eur(n * setup.waCost)}</strong>, billed at cost (+{Math.round(IGIC * 100)}% IGIC).
    </span>
  );
}

function ExclusionList(props: { excluded: Record<Exclusion, number> }) {
  const rows = (Object.keys(props.excluded) as Exclusion[]).filter((k) => props.excluded[k] > 0);
  if (!rows.length) return <span className="small muted">Nobody excluded.</span>;
  return <span className="row wrap">{rows.map((k) => <Badge key={k} tone={k === "optedOut" ? "bad" : "warn"}>{EXCLUSION_LABEL[k]}: {props.excluded[k]}</Badge>)}</span>;
}

/* ---------- Segments ---------- */

const SEG_GOAL: Record<Segment, GoalKey> = { new: "review", vip: "vip", lapsed: "winback", regular: "promo" };
const SEG_RULE = (s: RetSetup): Record<Segment, string> => ({
  new: "First visit in the last 30 days",
  vip: `${s.vipVisits}+ visits or ${eur(s.vipSpend)}+ spent`,
  lapsed: `No visit for ${s.lapsedDays}+ days`,
  regular: "Everyone else",
});
const SEG_TONE: Record<Segment, Tone> = { new: "info", vip: "accent", lapsed: "warn", regular: "neutral" };

export function SegmentsView(props: { client: Client; setup: RetSetup; customers: Customer[]; onDraft: (p: Prefill) => void }) {
  const [s, setS] = useState(props.setup);
  const dirty = JSON.stringify(s) !== JSON.stringify(props.setup);
  const segs: Segment[] = ["new", "vip", "lapsed", "regular"];
  const rules = SEG_RULE(s);
  return (
    <div className="stack">
      <Card title="Auto-tagging rules" aside={<Button small kind="primary" disabled={!dirty} onClick={async () => { await put(COL.setup, s); toast("Rules saved. Tags update on their own."); }}>Save</Button>}>
        <div className="form-grid">
          <Field label="Lapsed after (days)"><Input id="sg-l" type="number" min={1} value={s.lapsedDays} onChange={(v) => setS({ ...s, lapsedDays: Number(v) || 1 })} /></Field>
          <Field label="VIP from visits"><Input id="sg-v" type="number" min={1} value={s.vipVisits} onChange={(v) => setS({ ...s, vipVisits: Number(v) || 1 })} /></Field>
          <Field label="or VIP from spend (€)"><Input id="sg-s" type="number" min={0} value={s.vipSpend} onChange={(v) => setS({ ...s, vipSpend: Number(v) || 0 })} /></Field>
        </div>
      </Card>
      {!props.customers.length && <Empty>No customers yet, so no segments. Start collecting opt-ins with the QR.</Empty>}
      <div className="grid-2">
        {segs.map((seg) => {
          const list = props.customers.filter((c) => segments(c, s).includes(seg));
          const plan = planSend(list, "whatsapp", s, true);
          return (
            <Card key={seg} title={<span className="row">{SEGMENT_LABEL[seg]}<Badge tone={SEG_TONE[seg]}>{list.length}</Badge></span>} aside={
              <Button small disabled={!list.length} onClick={() => props.onDraft({ audience: seg, goal: SEG_GOAL[seg] })}>Draft campaign</Button>
            }>
              <span className="small muted">{rules[seg]}</span>
              <Stats>
                <Stat label="Reachable on WhatsApp" value={plan.ok.length} sub="opted in, under the cap" />
                <Stat label="Avg spend" value={list.length ? eur(Math.round(list.reduce((t, c) => t + spend(c), 0) / list.length)) : "–"} />
              </Stats>
              <span className="small">{list.slice(0, 8).map((c) => c.name).join(", ")}{list.length > 8 ? ` and ${list.length - 8} more` : ""}</span>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Flows ---------- */

export function FlowsView(props: { client: Client; setup: RetSetup; customers: Customer[] }) {
  const { client, setup, customers } = props;
  const flows = useCollection<Flow>(COL.flows).filter((f) => f.clientId === client.id);
  const tier = tierOf(client);
  const [busy, setBusy] = useState<string | null>(null);
  const month = today().slice(0, 7);

  if (!flows.length) {
    return <Empty action={<Button kind="primary" onClick={async () => { for (const f of defaultFlows(client)) await put(COL.flows, f); toast("Default flows created."); }}>Create default flows</Button>}>No flows for {client.name} yet.</Empty>;
  }
  const byKind = new Map(flows.map((f) => [f.kind, f]));
  const plans = new Map(flows.map((f) => [f.id, planSend(customers.filter((c) => flowTriggered(f, c, setup)), f.channel, setup, FLOW_DEFS[f.kind].marketing)]));
  const activeNow = flows.filter((f) => f.on).reduce((n, f) => n + (f.channel === "whatsapp" ? plans.get(f.id)!.ok.length : 0), 0);

  async function run(f: Flow) {
    const plan = plans.get(f.id)!;
    if (!plan.ok.length) { toast("Nobody to send to right now."); return; }
    await recordSends(plan, f.id, FLOW_DEFS[f.kind].label, f.channel, setup, FLOW_DEFS[f.kind].marketing);
    await put(COL.flows, { ...f, lastRun: now() });
    toast(`Marked as sent to ${plan.ok.length} opted-in contact${plan.ok.length > 1 ? "s" : ""} (WhatsApp not connected yet).`);
  }
  async function redraft(f: Flow) {
    setBusy(f.id);
    const res = await draftCopy({ client, setup, goal: f.kind, audience: FLOW_DEFS[f.kind].label, channel: f.channel, brief: "" });
    await put(COL.flows, { ...f, message: { es: res.data.es, en: res.data.en, de: res.data.de }, live: res.live });
    setBusy(null);
    if (res.error) toast(res.error);
  }

  return (
    <div className="stack">
      <div className="banner small">
        <span>Active flows would message <strong>{activeNow}</strong> contacts on WhatsApp right now. <CostLine n={activeNow} setup={setup} channel="whatsapp" /></span>
      </div>
      <div className="grid-2">
        {FLOW_ORDER.map((kind) => {
          const f = byKind.get(kind);
          if (!f) return null;
          return <FlowCard key={kind} f={f} kind={kind} tier={tier} setup={setup} customers={customers} plan={plans.get(f.id)!} month={month}
            busy={busy === f.id} onRun={() => run(f)} onRedraft={() => redraft(f)} />;
        })}
      </div>
    </div>
  );
}

function FlowCard(props: { f: Flow; kind: FlowKind; tier: string; setup: RetSetup; customers: Customer[]; plan: SendPlan; month: string; busy: boolean; onRun: () => void; onRedraft: () => void }) {
  const { f, kind, tier, setup, plan } = props;
  const def = FLOW_DEFS[kind];
  const [lang, setLang] = useState<MsgLang>("es");
  const [msg, setMsg] = useState(f.message);
  useEffect(() => setMsg(f.message), [f.message]);
  const msgDirty = JSON.stringify(msg) !== JSON.stringify(f.message);
  const included = flowIncluded(tier, kind);
  const needsStore = (kind === "cart" || kind === "postpurchase") && !setup.store;
  const sentMonth = props.customers.reduce((n, c) => n + c.sends.filter((s) => s.ref === f.id && s.at.startsWith(props.month)).length, 0);
  const triggered = plan.ok.length + Object.values(plan.excluded).reduce((a, b) => a + b, 0);
  return (
    <Card title={<span className="row wrap">{def.label}<Badge tone={f.on ? "good" : "neutral"}>{f.on ? "On" : "Off"}</Badge>{!included && <Badge tone="warn">Not in {tier}</Badge>}{!def.marketing && <Badge tone="info">Service</Badge>}</span>}
      aside={<label className="row small"><input type="checkbox" checked={f.on} onChange={(e) => put(COL.flows, { ...f, on: e.target.checked })} /> On</label>}>
      <span className="small muted">{def.trigger}</span>
      {needsStore && <span className="small" style={{ color: "var(--warn)" }}>Connect Shopify or WooCommerce in Opt-in & consent to use this flow.</span>}
      <div className="row wrap small">
        <span>Triggered now: <strong>{triggered}</strong></span>
        <span>Will send: <strong>{plan.ok.length}</strong></span>
        <span>Sent this month: <strong>{sentMonth}</strong></span>
        {f.lastRun && <span className="faint">Last run {fmtDate(f.lastRun)}</span>}
      </div>
      {triggered > plan.ok.length && <ExclusionList excluded={plan.excluded} />}
      <div className="row">
        {MSG_LANGS.map((l) => <button key={l} type="button" className={"chip" + (l === lang ? " chip-on" : "")} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
        <Badge tone={f.live ? "accent" : "neutral"}>{f.live ? "AI draft" : "Template"}</Badge>
      </div>
      <TextArea id={`fl-${f.id}-${lang}`} rows={4} value={msg[lang]} onChange={(v) => setMsg({ ...msg, [lang]: v })} />
      <div className="row wrap">
        {msgDirty && <Button small onClick={() => put(COL.flows, { ...f, message: msg })}>Save text</Button>}
        <Button small busy={props.busy} onClick={props.onRedraft}>Redraft with AI</Button>
        <Button small kind="primary" disabled={!f.on || !plan.ok.length || needsStore} onClick={props.onRun}>Run now (simulated)</Button>
      </div>
    </Card>
  );
}

/* ---------- Campaigns ---------- */

const STATUS_TONE: Record<Campaign["status"], Tone> = { draft: "warn", approved: "info", sent: "good" };

export function CampaignsView(props: { client: Client; setup: RetSetup; customers: Customer[]; prefill: Prefill | null; onUsed: () => void }) {
  const { client, setup, customers } = props;
  const campaigns = useCollection<Campaign>(COL.campaigns).filter((c) => c.clientId === client.id);
  const tasks = useCollection<Task>("tasks");
  const [selId, setSelId] = useState<string>("");
  const [form, setForm] = useState({ goal: "promo" as GoalKey, audience: "all" as Audience, channel: "whatsapp" as Channel, brief: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (props.prefill) {
      setForm((f) => ({ ...f, audience: props.prefill!.audience, goal: (props.prefill!.goal as GoalKey) ?? f.goal }));
      setSelId("new");
      props.onUsed();
    }
  }, [props.prefill]);
  useEffect(() => { if (!selId && campaigns.length) setSelId(campaigns[0].id); }, [campaigns.length]);

  async function draft() {
    setBusy(true);
    const res = await draftCopy({ client, setup, goal: form.goal, audience: AUDIENCE_LABEL[form.audience], channel: form.channel, brief: form.brief });
    const task = await create<Task>("tasks", { title: `Approve ${client.name} campaign: ${res.data.title}`, module: "retention", clientId: client.id, due: today(), done: false });
    const c = await create<Campaign>(COL.campaigns, {
      clientId: client.id, title: res.data.title, goal: form.goal, brief: form.brief, audience: form.audience, channel: form.channel,
      drafts: { es: res.data.es, en: res.data.en, de: res.data.de }, live: res.live, status: "draft", taskId: task.id,
    });
    setSelId(c.id);
    setBusy(false);
    toast(res.error ?? "Draft ready. Approval task added to Today.");
  }

  const sel = campaigns.find((c) => c.id === selId);
  return (
    <div className="stack">
      <div className="split">
        <div className="stack">
          <Card title="New campaign">
            <div className="form-grid">
              <Field label="Goal"><Select<GoalKey> id="cp-g" value={form.goal} onChange={(v) => setForm({ ...form, goal: v })} options={GOALS} /></Field>
              <Field label="Audience"><Select<Audience> id="cp-a" value={form.audience} onChange={(v) => setForm({ ...form, audience: v })} options={(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }))} /></Field>
              <Field label="Channel"><Select<Channel> id="cp-c" value={form.channel} onChange={(v) => setForm({ ...form, channel: v })} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }]} /></Field>
              <Field label="Brief (what is new, dates, conditions)" wide><TextArea id="cp-b" rows={2} value={form.brief} onChange={(v) => setForm({ ...form, brief: v })} placeholder="e.g. Keratin treatment launch, 20% until 30 November" /></Field>
            </div>
            <Button kind="primary" busy={busy} onClick={draft}>Draft in ES, EN and DE</Button>
          </Card>
          <Card title="Campaigns">
            {campaigns.length ? (
              <div className="stack-sm">
                {campaigns.map((c) => (
                  <button key={c.id} type="button" className={"chip" + (c.id === selId ? " chip-on" : "")} style={{ textAlign: "left", borderRadius: "var(--radius-md)" }} onClick={() => setSelId(c.id)}>
                    {c.title} · {AUDIENCE_LABEL[c.audience]} · {c.status}
                  </button>
                ))}
              </div>
            ) : <Empty>No campaigns yet. Draft one above or from a segment.</Empty>}
          </Card>
        </div>
        {sel ? <CampaignDetail key={sel.id} c={sel} client={client} setup={setup} customers={customers} tasks={tasks} /> : (
          <Empty>{selId === "new" ? "Fill in the brief and draft the campaign." : "Pick a campaign to review, approve and send."}</Empty>
        )}
      </div>
    </div>
  );
}

function CampaignDetail(props: { c: Campaign; client: Client; setup: RetSetup; customers: Customer[]; tasks: Task[] }) {
  const { c, setup, customers } = props;
  const [drafts, setDrafts] = useState(c.drafts);
  const dirty = JSON.stringify(drafts) !== JSON.stringify(c.drafts);
  const audience = customers.filter((x) => inAudience(x, c.audience, setup));
  const plan = useMemo(() => planSend(audience, c.channel, setup, true), [audience, c.channel, setup]);
  const sample = plan.ok[0];
  const after = useMemo(() => {
    let visits = 0, revenue = 0;
    for (const x of customers) {
      const s = x.sends.find((y) => y.ref === c.id);
      if (!s) continue;
      const t0 = new Date(s.at).getTime();
      for (const v of x.visits) {
        const d = new Date(v.date + "T12:00:00").getTime() - t0;
        if (d >= 0 && d <= 7 * 864e5) { visits++; revenue += v.amount; }
      }
    }
    return { visits, revenue };
  }, [customers, c.id]);

  async function approve() {
    await put(COL.campaigns, { ...c, drafts, status: "approved" });
    const t = props.tasks.find((x) => x.id === c.taskId);
    if (t && !t.done) await put("tasks", { ...t, done: true });
    toast("Approved. Ready to send.");
  }
  async function send() {
    await recordSends(plan, c.id, c.title, c.channel, setup, true);
    await put(COL.campaigns, { ...c, status: "sent", sentAt: now(), recipients: plan.ok.length, excluded: plan.excluded, cost: plan.cost });
    toast(`Marked as sent to ${plan.ok.length} opted-in contacts (${c.channel === "whatsapp" ? "WhatsApp" : "Brevo"} not connected yet).`);
  }

  return (
    <div className="stack">
      <Card title={c.title} aside={<>
        <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
        <Badge tone={c.live ? "accent" : "neutral"}>{c.live ? "AI draft" : "Demo draft"}</Badge>
        {c.status !== "sent" && <ConfirmButton label="Delete" confirm="Delete" onConfirm={() => remove(COL.campaigns, c.id)} />}
      </>}>
        <span className="small muted">{AUDIENCE_LABEL[c.audience]} · {c.channel === "whatsapp" ? "WhatsApp" : "Email"}{c.brief && ` · ${c.brief}`}</span>
        <div className="stack">
          {MSG_LANGS.map((l) => (
            <Field key={l} label={`${LANG_NAME[l]} (${plan.byLang[l]} recipient${plan.byLang[l] === 1 ? "" : "s"})`}>
              {c.status === "sent" ? <div className="box pre small">{c.drafts[l]}</div>
                : <TextArea id={`cd-${c.id}-${l}`} rows={4} value={drafts[l]} onChange={(v) => setDrafts({ ...drafts, [l]: v })} />}
            </Field>
          ))}
        </div>
        {dirty && <div className="row"><Button small onClick={() => put(COL.campaigns, { ...c, drafts, status: "draft" })}>Save edits</Button><span className="small faint">Edits after approval need approval again.</span></div>}
      </Card>

      {c.status === "sent" ? (
        <Card title="Result">
          <Stats>
            <Stat label="Sent to" value={c.recipients ?? 0} sub={`on ${fmtDate(c.sentAt)}`} />
            <Stat label="Message cost" value={eur(c.cost ?? 0)} sub="billed at cost" />
            <Stat label="Visits within 7 days" value={after.visits} sub="estimate" tone="good" />
            <Stat label="Revenue from those visits" value={eur(after.revenue)} tone="accent" />
          </Stats>
          {c.excluded && <ExclusionList excluded={c.excluded} />}
        </Card>
      ) : (
        <Card title="Send check">
          <Stats>
            <Stat label="In audience" value={audience.length} />
            <Stat label="Will receive" value={plan.ok.length} tone="good" sub="opted in, not opted out, under the cap" />
          </Stats>
          <ExclusionList excluded={plan.excluded} />
          <CostLine n={plan.ok.length} setup={setup} channel={c.channel} />
          {sample && (
            <div className="stack-sm">
              <span className="small muted">Preview for {sample.name} <LangTag lang={sample.lang} /></span>
              <div className="chat" style={{ minHeight: 0 }}><div className="bubble bubble-out">{personalise(drafts[sample.lang], sample)}<div className="bubble-meta">{props.client.name}</div></div></div>
            </div>
          )}
          <div className="row wrap">
            {c.status === "draft" && <Button kind="primary" onClick={approve}>Approve</Button>}
            <Button kind={c.status === "approved" ? "primary" : "secondary"} disabled={c.status !== "approved" || !plan.ok.length || dirty} onClick={send}>Send (simulated)</Button>
            {c.status === "draft" && <span className="small faint">The owner approves before anything goes out.</span>}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------- Monthly report ---------- */

export function ReportView(props: { client: Client; setup: RetSetup; customers: Customer[] }) {
  const { client, customers } = props;
  const months = lastMonths(6);
  const [month, setMonth] = useState(months[0]);
  const [stream, setStream] = useState<string>();
  const [busy, setBusy] = useState(false);
  const reports = useCollection<MonthReport>(COL.reports).filter((r) => r.clientId === client.id && r.month === month);
  const stats = useMemo(() => months.map((m) => monthStats(customers, m)), [customers, months.join()]);
  const st = stats[months.indexOf(month)];
  const prev = stats[months.indexOf(month) + 1];
  const max = Math.max(1, ...stats.map((s) => s.revenue));
  const share = st.revenue ? Math.round((st.returningRevenue / st.revenue) * 100) : 0;

  async function write() {
    setBusy(true);
    setStream("");
    const res = await writeMonthReport(client, st, prev, setStream);
    await create<MonthReport>(COL.reports, { clientId: client.id, month, text: res.data, live: res.live });
    setStream(undefined);
    setBusy(false);
    if (res.error) toast(res.error);
  }

  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="small muted">Revenue from customers who came back, and visits within 7 days of a message (estimate).</p>
        <Select id="rp-m" value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} />
      </div>
      <Stats>
        <Stat label="Returning revenue" value={eur(st.returningRevenue)} sub={`${share}% of ${eur(st.revenue)}`} tone="accent" />
        <Stat label="Returning customers" value={st.returningCustomers} sub={`${st.newCustomers} new`} />
        <Stat label="After a message" value={eur(st.attributed)} sub={`${st.attributedVisits} visits within 7 days`} tone="good" />
        <Stat label="Messages" value={st.messages} sub={`${eur(st.cost)} WhatsApp fees`} />
        <Stat label="Return on fees" value={st.cost ? `${Math.round(st.attributed / st.cost)}×` : "–"} />
      </Stats>
      <div className="grid-2">
        <Card title="Last 6 months">
          {[...stats].reverse().map((s) => (
            <div key={s.month} className="stack-sm">
              <div className="row between small"><span>{monthLabel(s.month)}</span><span>{eur(s.returningRevenue)} returning · {eur(s.newRevenue)} new</span></div>
              <div className="bar"><span style={{ width: `${(s.returningRevenue / max) * 100}%` }} /></div>
            </div>
          ))}
        </Card>
        <Card title="By campaign and flow">
          <Table rows={st.byRef} rowKey={(r) => r.ref} empty="No messages this month."
            cols={[
              { label: "Name", render: (r) => r.label },
              { label: "Sent", num: true, render: (r) => r.sent },
              { label: "Visits", num: true, render: (r) => r.visits },
              { label: "Revenue", num: true, render: (r) => eur(r.revenue) },
              { label: "Cost", num: true, render: (r) => eur(r.cost) },
            ]} />
          <p className="small faint">Invoice line: WhatsApp fees at cost, {st.messages} messages, {eur(st.cost)} + IGIC = {eur(Math.round(st.cost * (1 + IGIC) * 100) / 100)}.</p>
        </Card>
      </div>
      <Card title="Report and next tests" aside={<Button kind="primary" busy={busy} onClick={write}>Write report</Button>}>
        {stream != null ? <AiOutput text={stream || "…"} live /> : reports[0] ? (
          <AiOutput title={monthLabel(month)} text={reports[0].text} live={reports[0].live} actions={<ConfirmButton label="Delete" confirm="Delete" onConfirm={() => remove(COL.reports, reports[0].id)} />} />
        ) : <Empty>No report for {monthLabel(month)} yet. Write it and send it to {client.contact}.</Empty>}
      </Card>
    </div>
  );
}
