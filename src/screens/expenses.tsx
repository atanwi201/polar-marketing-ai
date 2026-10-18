// Expenses tab for one business: turn the receipt scanner on, set locations and currency, review and export expenses.
// Server side: server/expenses-routes.mjs (owner scope /api/studio/expenses).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Badge, Field, Input, TextArea, Select, Empty, Stat, Stats, ConfirmButton, toast } from "../core/ui";
import { ecall, eerr, fmtMoney, downloadExpenses, type EConfig, type ELocation, type Expense, type ExpenseInput, type ExpensesData, type Currency } from "./expenses-api";

const CURRENCIES: Currency[] = ["EUR", "USD", "GBP"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtMonth = (m: string) => (m ? new Date(m + "-01T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "All time");
const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "expenses";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: ExpensesData };

export function ExpensesPanel({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [s, setS] = useState<Load>({ state: "loading" });
  const [month, setMonth] = useState(thisMonth());
  const [loc, setLoc] = useState("");
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    const qs = new URLSearchParams({ clientId });
    if (month) qs.set("month", month);
    if (loc) qs.set("locationId", loc);
    void ecall<ExpensesData>("GET", "?" + qs.toString()).then((r) => {
      if (n !== seq.current) return;
      setS(r.kind === "ok" ? { state: "ok", data: r.data } : { state: "error", message: eerr(r) });
    });
  }, [clientId, month, loc]);
  useEffect(() => { load(); return () => { seq.current++; }; }, [load]);

  if (s.state === "loading") return <div className="loy-skel-wrap" aria-busy="true" aria-label="Loading"><div className="loy-skel" style={{ height: 120 }} /><div className="loy-skel" style={{ height: 240 }} /></div>;
  if (s.state === "error") return <Empty action={<Button onClick={load}>Try again</Button>}>{s.message}</Empty>;
  const { config } = s.data;
  return (
    <div className="stack">
      <SetupCard clientId={clientId} clientName={clientName} config={config} onSaved={(c) => { if (loc && !c.locations.some((l) => l.id === loc)) setLoc(""); setS({ state: "ok", data: { ...s.data, config: c } }); load(); }} />
      {config.enabled && <Report clientId={clientId} clientName={clientName} data={s.data} month={month} setMonth={setMonth} loc={loc} setLoc={setLoc} onRefresh={load} />}
    </div>
  );
}

// ---------- Setup ----------

function SetupCard({ clientId, clientName, config, onSaved }: { clientId: string; clientName: string; config: EConfig; onSaved: (c: EConfig) => void }) {
  const [locs, setLocs] = useState<ELocation[]>(config.locations);
  const [currency, setCurrency] = useState<Currency>(config.currency);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setLocs(config.locations); setCurrency(config.currency); }, [config]);
  const dirty = JSON.stringify({ locs, currency }) !== JSON.stringify({ locs: config.locations, currency: config.currency });

  const put = async (body: unknown, okMsg: string) => {
    setSaving(true); setErr("");
    const r = await ecall<EConfig>("PUT", `/config?clientId=${encodeURIComponent(clientId)}`, body);
    setSaving(false);
    if (r.kind !== "ok") { const m = eerr(r); setErr(m); toast(m); return false; }
    onSaved(r.data); toast(okMsg); return true;
  };
  const toggle = () => void put({ enabled: !config.enabled }, config.enabled ? "Expenses are off." : "Expenses are on.");
  const save = () => void put({ locations: locs, currency }, "Expense settings saved.");

  return (
    <Card title="Expenses" aside={<Badge tone={config.enabled ? "good" : "neutral"}>{config.enabled ? "On" : "Off"}</Badge>}>
      <div className="stack">
        <div className="loy-box">
          <label className="row"><input type="checkbox" checked={config.enabled} disabled={saving} onChange={toggle} />
            <span className="strong">Turn on receipt scanner and expenses for {clientName}</span></label>
          <p className="small muted">When on, the client sees an Expenses section in their portal and can scan receipts with their phone. Each receipt becomes an expense they can review, and you can export them here.</p>
        </div>

        <div className="grid-2">
          <div className="stack-sm">
            <span className="field-label">Locations</span>
            {locs.map((l, i) => (
              <div className="row" key={l.id || i}>
                <Input id={`ex-loc-${i}`} value={l.name} placeholder="Location name" onChange={(v) => setLocs((a) => a.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
                <Button small kind="ghost" disabled={locs.length <= 1} onClick={() => setLocs((a) => a.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
            <div><Button small onClick={() => setLocs((a) => [...a, { id: "", name: "" }])}>Add location</Button></div>
            <span className="small faint">A location with expenses cannot be removed. Rename it instead.</span>
          </div>
          <Field label="Currency"><Select id="ex-cur" value={currency} onChange={setCurrency} options={CURRENCIES} /></Field>
        </div>

        {err && <p className="small" role="alert" style={{ color: "var(--bad, #c0392b)" }}>{err}</p>}
        <div className="row wrap">
          <Button kind="primary" busy={saving} disabled={!dirty} onClick={save}>Save settings</Button>
          {dirty && <Button kind="ghost" onClick={() => { setLocs(config.locations); setCurrency(config.currency); setErr(""); }}>Discard changes</Button>}
          {!dirty && <span className="small faint">All changes saved.</span>}
        </div>
      </div>
    </Card>
  );
}

// ---------- Report ----------

function Report({ clientId, clientName, data, month, setMonth, loc, setLoc, onRefresh }: {
  clientId: string; clientName: string; data: ExpensesData; month: string; setMonth: (m: string) => void; loc: string; setLoc: (l: string) => void; onRefresh: () => void;
}) {
  const { config, expenses, summary } = data;
  const cur = config.currency;
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [busy, setBusy] = useState("");
  const months = useMemo(() => { const set = new Set([thisMonth(), ...data.months]); if (month) set.add(month); return [...set].sort().reverse(); }, [data.months, month]);
  const locName = (id: string) => config.locations.find((l) => l.id === id)?.name ?? "";

  const exportFile = async (format: "ods" | "csv") => {
    setBusy(format);
    try { await downloadExpenses(clientId, format, month, loc, `expenses-${slug(clientName)}-${month || "all"}`); } catch (e) { toast((e as Error).message); }
    setBusy("");
  };
  const remove = async (x: Expense) => {
    const r = await ecall("DELETE", `/items/${x.id}?clientId=${encodeURIComponent(clientId)}`);
    if (r.kind !== "ok") return toast(eerr(r));
    toast("Expense deleted."); onRefresh();
  };

  return (
    <Card title="Expense report" aside={<span className="row wrap">
      <Button small busy={busy === "ods"} onClick={() => void exportFile("ods")}>Export .ods</Button>
      <Button small busy={busy === "csv"} onClick={() => void exportFile("csv")}>Export .csv</Button>
    </span>}>
      <div className="stack">
        <div className="grid-2">
          <Field label="Month"><Select id="ex-month" value={month} onChange={setMonth} options={[{ value: "", label: "All time" }, ...months.map((m) => ({ value: m, label: fmtMonth(m) }))]} /></Field>
          <Field label="Location"><Select id="ex-locf" value={loc} onChange={setLoc} options={[{ value: "", label: "All locations" }, ...config.locations.map((l) => ({ value: l.id, label: l.name }))]} /></Field>
        </div>

        <Stats>
          <Stat label={month ? fmtMonth(month) : "All time"} value={fmtMoney(summary.totalCents, cur)} sub={`${summary.count} expense${summary.count === 1 ? "" : "s"}`} />
        </Stats>

        {summary.count > 0 && <div className="grid-2">
          <div className="stack-sm">
            <span className="field-label">By category</span>
            {summary.byCategory.map((c) => <div className="row between" key={c.category}><span>{cap(c.category)}</span><span className="strong">{fmtMoney(c.totalCents, cur)}</span></div>)}
          </div>
          <div className="stack-sm">
            <span className="field-label">By location</span>
            {summary.byLocation.map((l) => <div className="row between" key={l.locationId}><span>{l.name}</span><span className="strong">{fmtMoney(l.totalCents, cur)}</span></div>)}
          </div>
        </div>}

        <div className="row wrap"><Button small onClick={() => setEditing("new")}>Add expense</Button></div>

        {editing && <ExpenseForm key={editing === "new" ? "new" : editing.id} clientId={clientId} config={config} expense={editing === "new" ? null : editing} defaultLoc={loc}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onRefresh(); }} />}

        {expenses.length === 0 ? <Empty>No expenses for this selection yet. Receipts the client scans will show up here.</Empty> : (
          <div className="stack-sm">
            {expenses.map((x) => (
              <div className="loy-box" key={x.id}>
                <div className="row between wrap">
                  <span className="strong">{x.store || "Expense"}</span>
                  <span className="strong">{fmtMoney(x.totalCents, cur)}</span>
                </div>
                <div className="row wrap small muted">
                  <span>{fmtDay(x.date)}</span><Badge>{cap(x.category)}</Badge>
                  {config.locations.length > 1 && <span>{locName(x.locationId)}</span>}
                  {x.source === "scan" && <Badge tone="info">Scanned</Badge>}
                  {x.taxCents != null && <span>Tax {fmtMoney(x.taxCents, cur)}</span>}
                </div>
                {x.items.length > 0 && <p className="small muted">{x.items.map((i) => `${i.qty > 1 ? i.qty + " × " : ""}${i.name}`).join(", ")}</p>}
                {x.notes && <p className="small">{x.notes}</p>}
                <div className="row wrap" style={{ marginTop: 8 }}>
                  <Button small kind="ghost" onClick={() => setEditing(x)}>Edit</Button>
                  <ConfirmButton label="Delete" confirm="Delete expense" onConfirm={() => void remove(x)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- Add / edit form ----------

function ExpenseForm({ clientId, config, expense, defaultLoc, onClose, onSaved }: {
  clientId: string; config: EConfig; expense: Expense | null; defaultLoc: string; onClose: () => void; onSaved: () => void;
}) {
  const [date, setDate] = useState(expense?.date ?? today());
  const [store, setStore] = useState(expense?.store ?? "");
  const [locationId, setLocationId] = useState(expense?.locationId ?? (defaultLoc || config.locations[0]?.id || ""));
  const [category, setCategory] = useState(expense?.category ?? "other");
  const [total, setTotal] = useState(expense ? (expense.totalCents / 100).toFixed(2) : "");
  const [tax, setTax] = useState(expense?.taxCents != null ? (expense.taxCents / 100).toFixed(2) : "");
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setSaving(true); setErr("");
    const body: ExpenseInput = { date, store, locationId, category, total, tax: tax === "" ? null : tax, notes };
    const base = `?clientId=${encodeURIComponent(clientId)}`;
    const r = expense ? await ecall<Expense>("PATCH", `/items/${expense.id}${base}`, body) : await ecall<Expense>("POST", `/items${base}`, body);
    setSaving(false);
    if (r.kind !== "ok") return setErr(eerr(r));
    toast(expense ? "Expense updated." : "Expense added."); onSaved();
  };

  return (
    <div className="loy-box stack">
      <h3>{expense ? "Edit expense" : "Add expense"}</h3>
      <div className="grid-2">
        <Field label="Date"><Input id="ex-date" type="date" value={date} onChange={setDate} /></Field>
        <Field label="Store"><Input id="ex-store" value={store} onChange={setStore} /></Field>
        <Field label="Total"><Input id="ex-total" type="number" min={0} step={0.01} value={total} onChange={setTotal} /></Field>
        <Field label="Tax (optional)"><Input id="ex-tax" type="number" min={0} step={0.01} value={tax} onChange={setTax} /></Field>
        <Field label="Category"><Select id="ex-cat" value={category} onChange={setCategory} options={config.categories.map((c) => ({ value: c, label: cap(c) }))} /></Field>
        <Field label="Location"><Select id="ex-loc" value={locationId} onChange={setLocationId} options={config.locations.map((l) => ({ value: l.id, label: l.name }))} /></Field>
      </div>
      <Field label="Notes"><TextArea id="ex-notes" rows={2} value={notes} onChange={(v) => setNotes(v.slice(0, 500))} /></Field>
      {err && <p className="small" role="alert" style={{ color: "var(--bad, #c0392b)" }}>{err}</p>}
      <div className="row wrap">
        <Button kind="primary" busy={saving} onClick={() => void save()}>{expense ? "Save changes" : "Add expense"}</Button>
        <Button kind="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}
