import { useState } from "react";
import { Page, Card, Stats, Stat, Button, Badge, Empty, Table, fmtDate, toast } from "../core/ui";
import { useCollection, put, today } from "../core/store";
import { totalMrr, pilotMrr, upsellFor, clientMrr } from "../core/biz";
import { eur, planById, PLANS } from "../core/plans";
import { navigate } from "../core/nav";
import { loadExamples } from "./settings";
import type { Client, Task, Visit } from "../core/types";

const TARGET_LOW = 3000;
const TARGET_HIGH = 5000;

export default function Dashboard() {
  const clients = useCollection<Client>("clients");
  const tasks = useCollection<Task>("tasks");
  const visits = useCollection<Visit>("visits");
  const [loading, setLoading] = useState(false);

  const mrr = totalMrr(clients);
  const paying = clients.filter((c) => c.stage === "paid");
  const pilots = clients.filter((c) => c.stage === "pilot");
  const open = tasks.filter((t) => !t.done).sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
  const t = today();
  const followUps = visits.filter((v) => v.followUp && v.followUp <= addDays(t, 2) && v.outcome !== "signed");
  const visitsToday = visits.filter((v) => v.date === t).length;
  const upsells = paying.map((c) => ({ c, u: upsellFor(c) })).filter((x) => x.u);
  const byPlan = PLANS.map((p) => ({
    p,
    mrr: paying.reduce((n, c) => n + c.subs.filter((s) => s.plan === p.id).reduce((m, s) => m + (s.annual ? (s.price * 10) / 12 : s.price), 0), 0),
  })).filter((x) => x.mrr > 0);

  return (
    <Page title="Today" intro="What needs you today, and how the business is tracking against the €3k to €5k MRR year-one goal.">
      {!clients.length && (
        <div className="banner">
          <span>No clients yet. Load example data to see every screen working, or add your first client.</span>
          <span className="row wrap">
            <Button kind="primary" busy={loading} onClick={async () => { setLoading(true); await loadExamples(); setLoading(false); toast("Example data loaded"); }}>Load example data</Button>
            <Button onClick={() => navigate("clients")}>Add a client</Button>
          </span>
        </div>
      )}

      <Stats>
        <Stat label="Monthly recurring" value={eur(Math.round(mrr))} sub={`excl. IGIC · ${paying.length} paying`} tone="accent" />
        <Stat label="In pilot" value={pilots.length} sub={`${eur(Math.round(pilots.reduce((n, c) => n + pilotMrr(c), 0)))} if all convert`} />
        <Stat label="Visits today" value={`${visitsToday} / 10`} sub="Target: 10 businesses a day" tone={visitsToday >= 10 ? "good" : undefined} />
        <Stat label="Waiting on you" value={open.length} sub="Approvals and follow-ups" tone={open.length ? "warn" : "good"} />
      </Stats>

      <Card title="Year-one goal" aside={<span className="small muted tabular">{eur(Math.round(mrr))} of {eur(TARGET_LOW)} to {eur(TARGET_HIGH)}</span>}>
        <Goal mrr={mrr} />
        {byPlan.length > 0 && (
          <div className="row wrap small muted">
            {byPlan.map(({ p, mrr }) => <span key={p.id} className="box">{p.name}: <span className="strong tabular">{eur(Math.round(mrr))}</span></span>)}
          </div>
        )}
      </Card>

      <div className="grid-2">
        <Card title="Waiting on you" aside={<Badge tone={open.length ? "warn" : "good"}>{open.length} open</Badge>}>
          {open.length ? (
            <div className="stack">
              {open.slice(0, 8).map((task) => (
                <div key={task.id} className="row between box">
                  <div className="stack-sm">
                    <span>{task.title}</span>
                    <span className="small faint">{task.due ? `Due ${fmtDate(task.due)}` : "No due date"}{task.clientId ? ` · ${clients.find((c) => c.id === task.clientId)?.name ?? ""}` : ""}</span>
                  </div>
                  <span className="row" style={{ flex: "none" }}>
                    <Button small kind="ghost" onClick={() => navigate(task.module)}>Open</Button>
                    <Button small onClick={() => put("tasks", { ...task, done: true })}>Done</Button>
                  </span>
                </div>
              ))}
            </div>
          ) : <Empty>Nothing waiting. Low-star review replies, bot handoffs and follow-ups land here.</Empty>}
        </Card>

        <Card title="Follow-ups due" aside={<Button small kind="ghost" onClick={() => navigate("visits")}>All visits</Button>}>
          <Table rows={followUps} rowKey={(v) => v.id} onRow={() => navigate("visits")} empty="No follow-ups due in the next two days."
            cols={[
              { label: "Business", render: (v) => <span className="strong">{v.venue}</span> },
              { label: "Town", render: (v) => v.town },
              { label: "When", render: (v) => <Badge tone={v.followUp! < t ? "bad" : v.followUp === t ? "warn" : "neutral"}>{v.followUp! < t ? "Overdue" : fmtDate(v.followUp)}</Badge> },
            ]} />
        </Card>
      </div>

      <Card title="Upsell to existing clients" aside={<span className="small muted">Follows the plan: Maps first, then AI Visibility, WhatsApp Receptionist, Listing Kits</span>}>
        <Table rows={upsells} rowKey={(x) => x.c.id} onRow={() => navigate("clients")} empty="No obvious upsells right now."
          cols={[
            { label: "Client", render: (x) => <span className="strong">{x.c.name}</span> },
            { label: "Pays now", render: (x) => eur(Math.round(clientMrr(x.c))), num: true },
            { label: "Offer", render: (x) => <Badge tone="accent">{planById(x.u!.plan).name}</Badge> },
            { label: "Why", render: (x) => <span className="small muted">{x.u!.why}</span> },
          ]} />
      </Card>
    </Page>
  );
}

function Goal({ mrr }: { mrr: number }) {
  const pct = Math.min(100, (mrr / TARGET_HIGH) * 100);
  const low = (TARGET_LOW / TARGET_HIGH) * 100;
  return (
    <div className="stack-sm">
      <div style={{ position: "relative" }}>
        <div className="bar" style={{ height: 14 }}><span style={{ width: pct + "%" }} /></div>
        <div style={{ position: "absolute", left: low + "%", top: -4, bottom: -4, borderLeft: "2px dashed var(--ink-3)" }} aria-hidden />
      </div>
      <div className="small faint tabular" style={{ position: "relative", height: 18 }}>
        <span style={{ position: "absolute", left: 0 }}>€0</span>
        <span style={{ position: "absolute", left: low + "%", transform: "translateX(-50%)" }}>€3k</span>
        <span style={{ position: "absolute", right: 0 }}>€5k</span>
      </div>
    </div>
  );
}

function addDays(iso: string, n: number) {
  return new Date(new Date(iso + "T12:00:00").getTime() + n * 864e5).toISOString().slice(0, 10);
}
