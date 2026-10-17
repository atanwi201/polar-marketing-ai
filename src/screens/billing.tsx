import { useState } from "react";
import { Page, Card, Button, Badge, Table, Tabs, Modal, Stats, Stat, ConfirmButton, Field, Input, Empty, fmtDate, toast, type Tone } from "../core/ui";
import { useCollection, put, remove, uid, now, today } from "../core/store";
import { subLabel, totalMrr } from "../core/biz";
import { eur, IGIC } from "../core/plans";
import { useBusiness } from "./settings";
import type { Client, Invoice } from "../core/types";

const STATUS_TONE: Record<Invoice["status"], Tone> = { draft: "neutral", sent: "warn", paid: "good" };
export const invSubtotal = (i: Invoice) => i.lines.reduce((n, l) => n + l.amount, 0);
export const invIgic = (i: Invoice) => Math.round(invSubtotal(i) * i.igicRate * 100) / 100;
export const invTotal = (i: Invoice) => invSubtotal(i) + invIgic(i);

/** Fixed monthly costs from the plans doc (estimates). */
const COSTS = [
  { label: "Tarifa plana (autónomo, first 12 months)", amount: 80 },
  { label: "Gestoría", amount: 60 },
  { label: "Hetzner server (n8n)", amount: 5 },
  { label: "Claude API and other AI", amount: 40 },
  { label: "Domains, tools, keyword credits", amount: 25 },
];

export default function Billing() {
  const invoices = useCollection<Invoice>("invoices");
  const clients = useCollection<Client>("clients");
  const biz = useBusiness();
  const [tab, setTab] = useState<"invoices" | "igic" | "costs">("invoices");
  const [view, setView] = useState<Invoice | null>(null);
  const name = (id: string) => clients.find((c) => c.id === id)?.name ?? "Unknown client";

  const month = today().slice(0, 7);
  const thisMonth = invoices.filter((i) => i.date.startsWith(month));
  const unpaid = invoices.filter((i) => i.status === "sent");
  const mrr = totalMrr(clients);
  const costs = COSTS.reduce((n, c) => n + c.amount, 0);

  const nextNumber = (n: number) => {
    const year = today().slice(0, 4);
    const max = invoices.filter((i) => i.number.startsWith(year)).reduce((m, i) => Math.max(m, +i.number.split("-")[1] || 0), 0);
    return `${year}-${String(max + n).padStart(4, "0")}`;
  };

  const runMonth = async () => {
    const billed = new Set(thisMonth.map((i) => i.clientId));
    const due = clients.filter((c) => c.stage === "paid" && c.subs.length && !billed.has(c.id));
    if (!due.length) return toast("Every paying client already has an invoice this month.");
    let n = 1;
    for (const c of due) {
      const lines = c.subs.flatMap((s) => {
        const out = [{ description: s.annual ? `${subLabel(s)} (annual, 12 months for 10)` : subLabel(s), amount: s.annual ? s.price * 10 : s.price }];
        if (s.setup && s.startedAt.startsWith(month)) out.push({ description: `${subLabel(s)} setup`, amount: s.setup });
        return out;
      });
      await put<Invoice>("invoices", { id: uid(), createdAt: now(), number: nextNumber(n++), clientId: c.id, date: today(), lines, igicRate: IGIC, status: "draft" });
    }
    toast(`${due.length} draft invoice${due.length > 1 ? "s" : ""} created`);
  };

  // IGIC by quarter (Canary modelo 420)
  const quarters = new Map<string, { base: number; igic: number; count: number }>();
  for (const i of invoices.filter((i) => i.status !== "draft")) {
    const d = new Date(i.date + "T12:00:00");
    const q = `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;
    const cur = quarters.get(q) ?? { base: 0, igic: 0, count: 0 };
    quarters.set(q, { base: cur.base + invSubtotal(i), igic: cur.igic + invIgic(i), count: cur.count + 1 });
  }

  return (
    <Page title="Billing" intro="Monthly invoices with 7% IGIC, payment status and what you owe Hacienda each quarter."
      actions={<Button kind="primary" onClick={runMonth}>Create this month's invoices</Button>}>
      <Stats>
        <Stat label="Recurring per month" value={eur(Math.round(mrr))} sub="excl. IGIC" tone="accent" />
        <Stat label="Invoiced this month" value={eur(Math.round(thisMonth.reduce((n, i) => n + invTotal(i), 0)))} sub={`${thisMonth.length} invoices, incl. IGIC`} />
        <Stat label="Unpaid" value={eur(Math.round(unpaid.reduce((n, i) => n + invTotal(i), 0)))} sub={`${unpaid.length} sent, not paid`} tone={unpaid.length ? "warn" : "good"} />
        <Stat label="Profit per month" value={eur(Math.round(mrr - costs))} sub={`After ~${eur(costs)} fixed costs`} tone={mrr - costs > 0 ? "good" : "bad"} />
      </Stats>
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "invoices", label: "Invoices", count: invoices.length }, { id: "igic", label: "IGIC by quarter" }, { id: "costs", label: "Fixed costs" }]} />
        {tab === "invoices" && (
          <Table rows={[...invoices].sort((a, b) => b.number.localeCompare(a.number))} rowKey={(i) => i.id} onRow={setView}
            empty="No invoices yet. Create this month's invoices once clients are paying."
            cols={[
              { label: "Number", render: (i) => <span className="mono">{i.number}</span> },
              { label: "Client", render: (i) => name(i.clientId) },
              { label: "Date", render: (i) => fmtDate(i.date) },
              { label: "Total", render: (i) => eur(invTotal(i)), num: true },
              { label: "Status", render: (i) => <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge> },
            ]} />
        )}
        {tab === "igic" && (
          <div className="stack">
            <p className="small muted">IGIC you charged on sent and paid invoices. File it each quarter with modelo 420, usually through your gestoría.</p>
            <Table rows={[...quarters.entries()].sort((a, b) => b[0].localeCompare(a[0]))} rowKey={(q) => q[0]} empty="Nothing invoiced yet."
              cols={[
                { label: "Quarter", render: (q) => <span className="strong">{q[0]}</span> },
                { label: "Invoices", render: (q) => q[1].count, num: true },
                { label: "Taxable base", render: (q) => eur(q[1].base), num: true },
                { label: "IGIC 7%", render: (q) => eur(q[1].igic), num: true },
              ]} />
          </div>
        )}
        {tab === "costs" && (
          <Table rows={COSTS} rowKey={(c) => c.label}
            cols={[{ label: "Cost", render: (c) => c.label }, { label: "Per month", render: (c) => eur(c.amount), num: true }]} />
        )}
      </Card>
      {view && <InvoiceView inv={view} client={clients.find((c) => c.id === view.clientId)} biz={biz} onClose={() => setView(null)} />}
    </Page>
  );
}

function InvoiceView({ inv, client, biz, onClose }: { inv: Invoice; client?: Client; biz: ReturnType<typeof useBusiness>; onClose: () => void }) {
  const [i, setI] = useState(inv);
  const save = async (next: Invoice, msg: string) => { setI(next); await put("invoices", next); toast(msg); };
  return (
    <Modal open title={`Invoice ${i.number}`} onClose={onClose}
      footer={<>
        <ConfirmButton label="Delete" confirm="Delete invoice" onConfirm={async () => { await remove("invoices", i.id); onClose(); }} />
        <span style={{ flex: 1 }} />
        {i.status === "draft" && <Button kind="primary" onClick={() => save({ ...i, status: "sent" }, "Marked as sent. Email or WhatsApp the PDF to the client yourself.")}>Mark as sent</Button>}
        {i.status === "sent" && <Button kind="primary" onClick={() => save({ ...i, status: "paid" }, "Marked as paid")}>Mark as paid</Button>}
      </>}>
      <div className="box stack">
        <div className="row between wrap">
          <div className="stack-sm small">
            <span className="strong">{biz.name || "Your business name"}</span>
            <span>NIF {biz.nif || "set in Settings"}</span>
            <span className="pre">{biz.address || "Address set in Settings"}</span>
          </div>
          <div className="stack-sm small" style={{ textAlign: "right" }}>
            <span className="strong">Factura {i.number}</span>
            <span>{fmtDate(i.date)}</span>
            <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge>
          </div>
        </div>
        <div className="small"><span className="faint">Bill to</span><br /><span className="strong">{client?.name}</span><br />{client?.town}</div>
        <Table rows={i.lines.map((l, n) => ({ ...l, n }))} rowKey={(l) => String(l.n)}
          cols={[{ label: "Description", render: (l) => l.description }, { label: "Amount", render: (l) => eur(l.amount), num: true }]} />
        <div className="stack-sm tabular" style={{ alignSelf: "flex-end", minWidth: 220 }}>
          <div className="row between"><span>Base</span><span>{eur(invSubtotal(i))}</span></div>
          <div className="row between"><span>IGIC {Math.round(i.igicRate * 100)}%</span><span>{eur(invIgic(i))}</span></div>
          <div className="row between strong"><span>Total</span><span>{eur(invTotal(i))}</span></div>
        </div>
        <div className="small muted">Pay by transfer to {biz.iban || "IBAN set in Settings"}. Card payment link: Stripe not connected yet.</div>
      </div>
      {i.status === "draft" && (
        <Field label="Add a line (e.g. setup fee)"><AddLine onAdd={(description, amount) => save({ ...i, lines: [...i.lines, { description, amount }] }, "Line added")} /></Field>
      )}
    </Modal>
  );
}

function AddLine({ onAdd }: { onAdd: (d: string, a: number) => void }) {
  const [d, setD] = useState("");
  const [a, setA] = useState("");
  return (
    <div className="row wrap">
      <Input id="l-desc" value={d} onChange={setD} placeholder="Description" />
      <Input id="l-amt" type="number" value={a} onChange={setA} placeholder="EUR" />
      <Button onClick={() => { if (d && +a) { onAdd(d, +a); setD(""); setA(""); } }}>Add</Button>
    </div>
  );
}
