import { useEffect, useRef, useState } from "react";
import { Page, Card, Button, Badge, Table, Tabs, Modal, Field, Input, TextArea, Select, LangPicker, ConfirmButton, Stats, Stat, Empty, fmtDate, toast, type Tone } from "../core/ui";
import { useCollection, put, remove, uid, now, today } from "../core/store";
import { withIgic, STAGE_LABEL, clientMonthly, monthlyIncome, planLabel, trialDaysLeft } from "../core/biz";
import { useOffer, PLAN_IDS, type Offer } from "../core/offer";
import { TOWNS, eur } from "../core/plans";
import { pushPlanToStudio, useStudio } from "../core/studio-sync";
import { navigate } from "../core/nav";
import { Avatar } from "./business";
import type { Client, Stage, Consent } from "../core/types";

export const STAGE_TONE: Record<Stage, Tone> = { lead: "info", pilot: "warn", paid: "good", churned: "neutral" };
const STAGES: Stage[] = ["paid", "pilot", "lead", "churned"];

const blank = (): Client => ({
  id: uid(), createdAt: now(), name: "", kind: "Restaurant", town: "Los Cristianos", contact: "", phone: "", stage: "lead",
  subs: [], consents: [], languages: ["es", "en"],
});

export default function Clients() {
  const clients = useCollection<Client>("clients");
  const offer = useOffer();
  const studio = useStudio();
  const [filter, setFilter] = useState<Stage | "all" | "needs">("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Client | null>(null);
  // Today's "Add a client" opens the form straight away.
  useEffect(() => {
    let id: string | null = null;
    try { id = sessionStorage.getItem("isla:openClient"); sessionStorage.removeItem("isla:openClient"); } catch { /* ignore */ }
    if (id === "new") setEditing(blank());
    else if (id) navigate(`business/${id}`);
  }, []);

  const flaggedFor = (c: Client) => studio?.messages.filter((m) => m.clientId === c.studioId && m.needsOwner && !m.seenByOwner).length ?? 0;
  const sc = (c: Client) => studio?.clients.find((x) => x.id === c.studioId);
  const readyPosts = (c: Client) => studio?.posts.filter((p) => p.clientId === c.studioId && (p.status === "ready" || p.status === "published")).length ?? 0;
  const lastActive = (c: Client) => {
    const times = [c.createdAt, ...(studio?.messages.filter((m) => m.clientId === c.studioId).map((m) => m.createdAt) ?? []), ...(studio?.posts.filter((p) => p.clientId === c.studioId).map((p) => p.createdAt) ?? [])];
    return times.sort().pop() ?? c.createdAt;
  };
  const needle = q.trim().toLowerCase();
  const shown = clients
    .filter((c) => filter === "all" || (filter === "needs" ? flaggedFor(c) > 0 : c.stage === filter))
    .filter((c) => !needle || `${c.name} ${c.kind} ${c.town} ${c.contact} ${c.phone}`.toLowerCase().includes(needle))
    .sort((a, b) => flaggedFor(b) - flaggedFor(a) || lastActive(b).localeCompare(lastActive(a)));
  const count = (s: Stage) => clients.filter((c) => c.stage === s).length;
  const needs = clients.filter((c) => flaggedFor(c) > 0).length;

  return (
    <Page title="Businesses" intro="Everyone you work with. Click a business to see and manage everything: its conversation with the assistant, posts, videos, website, plan and details."
      actions={<Button kind="primary" onClick={() => setEditing(blank())}>Add business</Button>}>
      <div className="biz-toolbar">
        <input className="input" type="search" placeholder="Search by name, town or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search businesses" style={{ maxWidth: 340 }} />
        <div className="chips">
          {([["all", `All ${clients.length}`], ...(needs ? [["needs", `Need you ${needs}`]] : []), ...STAGES.map((s) => [s, `${STAGE_LABEL[s]} ${count(s)}`])] as [typeof filter, string][]).map(([v, label]) => (
            <button key={v} type="button" className={"chip" + (filter === v ? " chip-on" : "")} aria-pressed={filter === v} onClick={() => setFilter(v)}>{label}</button>
          ))}
        </div>
        <span className="small muted" style={{ marginLeft: "auto" }}>{eur(Math.round(monthlyIncome(clients, offer)))} a month from {count("paid")} paying</span>
      </div>

      {!shown.length ? (
        <Card><Empty>{clients.length ? "No business matches." : <>No businesses yet. Share your sign-up link, or use <strong>Add business</strong>.</>}</Empty></Card>
      ) : (
        <div className="biz-grid">
          {shown.map((c) => {
            const s = sc(c);
            const left = trialDaysLeft(c, offer);
            const flagged = flaggedFor(c);
            return (
              <button key={c.id} type="button" className="biz-card" onClick={() => navigate(`business/${c.id}`)}>
                <span className="row" style={{ gap: 12 }}>
                  <Avatar name={c.name} logoFile={s?.logoFile} />
                  <span className="stack-sm" style={{ minWidth: 0, flex: 1 }}>
                    <span className="strong biz-name">{c.name}</span>
                    <span className="small faint biz-name">{[c.kind, c.town].filter(Boolean).join(" · ") || "No details yet"}</span>
                  </span>
                  {flagged > 0 && <Badge tone="bad">{flagged} need{flagged === 1 ? "s" : ""} you</Badge>}
                  {sc(c)?.approvalStatus === "pending" && <Badge tone="accent">Approve</Badge>}
                  {sc(c)?.approvalStatus === "declined" && <Badge tone="neutral">Declined</Badge>}
                </span>
                <span className="row wrap">
                  <Badge tone={STAGE_TONE[c.stage]}>{STAGE_LABEL[c.stage]}</Badge>
                  {(c.plan || c.stage === "pilot") && <span className="small">{planLabel(c, offer)}</span>}
                  {c.stage === "paid" && c.plan && <span className="small strong tabular">{eur(Math.round(clientMonthly(c, offer)))}/mo</span>}
                  {left != null && <span className="small" style={{ color: left <= 0 ? "var(--bad)" : "var(--ink-3)" }}>{left > 0 ? `${left} days left` : "trial ended"}</span>}
                </span>
                <span className="row wrap small muted biz-meta">
                  {s ? <>
                    <span>{s.websiteMode === "own" ? <><span className="dot dot-good" />Own website</> : <><span className={"dot " + (s.site?.status === "ready" ? "dot-good" : s.site?.status === "building" ? "dot-info" : "dot-bad")} />{s.site?.status === "ready" ? "Website live" : s.site?.status === "building" ? "Website building" : "No website"}</>}</span>
                    <span>{readyPosts(c)} posts</span>
                    {s.autopilot && <span>autopilot {s.postsPerWeek}/wk</span>}
                  </> : <span>Not on the autopilot yet</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {editing && <ClientEditor client={editing} offer={offer} onClose={(saved) => { setEditing(null); if (saved) navigate(`business/${saved}`); }} />}
    </Page>
  );
}


function ClientEditor({ client, offer, onClose }: { client: Client; offer: Offer; onClose: (savedId?: string) => void }) {
  const [c, setC] = useState<Client>(client);
  const set = <K extends keyof Client>(k: K, v: Client[K]) => setC((x) => ({ ...x, [k]: v }));
  const isNew = !client.name;

  const save = async () => {
    if (!c.name.trim()) return toast("Give the business a name first.");
    if (c.stage === "paid" && !c.plan) return toast("Pick a plan for a paying client.");
    await put("clients", c);
    const planChanged = c.plan !== client.plan || c.customPrice !== client.customPrice || c.stage !== client.stage;
    if (c.studioId && planChanged) await pushPlanToStudio(c, offer);
    toast(isNew ? "Business added" : "Business saved");
    onClose(c.id);
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
        <Field label="Contact person"><Input id="c-contact" value={c.contact} onChange={(v) => set("contact", v)} /></Field>
        <Field label="Business phone"><Input id="c-phone" value={c.phone} onChange={(v) => set("phone", v)} placeholder="+34 922…" /></Field>
        <Field label="Email (invoices only)"><Input id="c-email" value={c.email ?? ""} onChange={(v) => set("email", v)} /></Field>
        <Field label="Referred by"><Input id="c-ref" value={c.referredBy ?? ""} onChange={(v) => set("referredBy", v)} placeholder="Gestoría, partner, client" /></Field>
        <Field label="Customer languages" wide><LangPicker value={c.languages} onChange={(v) => set("languages", v)} /></Field>
        <Field label="Notes" wide><TextArea id="c-notes" rows={3} value={c.notes ?? ""} onChange={(v) => set("notes", v)} /></Field>
      </div>
      <hr className="divider" />
      <PlanPicker c={c} offer={offer} onChange={(patch) => setC((x) => ({ ...x, ...patch }))} />
      <hr className="divider" />
      <ConsentEditor consents={c.consents} onChange={(v) => set("consents", v)} />
    </Modal>
  );
}

/** Status and plan: lead, free trial, one of the two paid plans, or left; plus a custom price for this business. */
export function PlanPicker({ c, offer, onChange }: { c: Client; offer: Offer; onChange: (patch: Partial<Client>) => void }) {
  type Choice = "lead" | "trial" | "basic" | "pro" | "churned";
  const current: Choice = c.stage === "paid" && c.plan ? c.plan : c.stage === "pilot" ? "trial" : c.stage === "churned" ? "churned" : "lead";
  const pick = (v: Choice) => {
    if (v === "basic" || v === "pro") onChange({ stage: "paid", plan: v, planSince: c.stage === "paid" && c.plan ? c.planSince : today(), customPrice: c.plan === v ? c.customPrice : undefined });
    else if (v === "trial") onChange({ stage: "pilot", plan: c.plan ?? "basic", trialStart: c.stage === "pilot" ? c.trialStart : today() });
    else onChange({ stage: v });
  };
  const options: { v: Choice; title: string; sub: string }[] = [
    { v: "lead", title: "Lead", sub: "Not using it yet" },
    { v: "trial", title: "Free trial", sub: `${offer.trialDays} days, no charge` },
    ...PLAN_IDS.map((id) => ({ v: id as Choice, title: offer.plans[id].name, sub: `${eur(offer.plans[id].price)} a month` })),
    { v: "churned", title: "Left", sub: "No longer a client" },
  ];
  const listPrice = c.plan ? offer.plans[c.plan].price : 0;
  const price = c.customPrice ?? listPrice;
  const monthly = c.annual ? (price * 10) / 12 : price;
  const left = trialDaysLeft(c, offer);
  return (
    <div className="stack">
      <div className="row between wrap"><h3>Plan</h3>{c.stage === "paid" && c.plan && <span className="small muted tabular">{eur(Math.round(monthly))} a month · {eur(withIgic(monthly))} with IGIC</span>}</div>
      <div className="plan-pick" role="radiogroup" aria-label="Plan">
        {options.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={current === o.v} className={"plan-opt" + (current === o.v ? " on" : "")} onClick={() => pick(o.v)}>
            <span className="strong">{o.title}</span><span className="small muted">{o.sub}</span>
          </button>
        ))}
      </div>
      {c.stage === "pilot" && (
        <div className="form-grid top">
          <Field label="Trying which plan?" hint={left != null ? (left > 0 ? `${left} days left on the trial` : "The trial has ended: move them to a paid plan") : undefined}>
            <Select id="c-trial-plan" value={c.plan ?? "basic"} onChange={(v) => onChange({ plan: v })} options={PLAN_IDS.map((id) => ({ value: id, label: offer.plans[id].name }))} />
          </Field>
          <Field label="Trial started"><Input id="c-trial-start" type="date" value={c.trialStart ?? c.createdAt.slice(0, 10)} onChange={(v) => onChange({ trialStart: v })} /></Field>
        </div>
      )}
      {c.stage === "paid" && c.plan && (
        <div className="form-grid top">
          <Field label="Price for this business (€ a month)" hint={c.customPrice != null && c.customPrice !== listPrice ? `Custom price. The ${offer.plans[c.plan].name} list price is ${eur(listPrice)}.` : "This is the list price. Type another amount to give this business its own price."}>
            <Input id="c-price" type="number" min={0} step={1} value={price}
              onChange={(v) => { const n = Math.max(0, Number(v) || 0); onChange({ customPrice: n === listPrice ? undefined : n }); }} />
          </Field>
          <Field label="Billing">
            <Select id="c-annual" value={c.annual ? "annual" : "monthly"} onChange={(v) => onChange({ annual: v === "annual" })}
              options={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Yearly (12 months for 10)" }]} />
          </Field>
          <Field label="Paying since"><Input id="c-since" type="date" value={c.planSince ?? today()} onChange={(v) => onChange({ planSince: v })} /></Field>
        </div>
      )}
      {c.subs.length > 0 && <p className="small faint" style={{ margin: 0 }}>This client also has {c.subs.length} older service{c.subs.length > 1 ? "s" : ""} from before the two plans. They're no longer billed.</p>}
    </div>
  );
}

export function ConsentEditor({ consents, onChange }: { consents: Consent[]; onChange: (c: Consent[]) => void }) {
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
