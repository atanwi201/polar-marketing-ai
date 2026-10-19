import { useEffect, useState } from "react";
import { Page, Card, Button, Field, Input, TextArea, Stats, Stat, Badge, toast } from "../core/ui";
import { useCollection } from "../core/store";
import { useOffer, saveOffer, monthlyIncome, clientMonthly, PLAN_IDS, type Offer, type PaidPlan, type PaidPlanId } from "../core/offer";
import { withIgic } from "../core/biz";
import { eur } from "../core/plans";
import { navigate } from "../core/nav";
import type { Client } from "../core/types";
import { useStudio, publishOffer } from "../core/studio-sync";
import { call } from "./studio-api";

/** The weekly limit every business gets unless you set its own (Business › Overview). */
function WeeklyLimitCard() {
  const studio = useStudio();
  const [n, setN] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const current = studio?.limits?.postsPerWeek;
  useEffect(() => { if (current != null) setN(String(current)); }, [current]);
  if (!studio) return null;
  const save = async () => {
    setBusy(true);
    const r = await call("POST", "/settings/limits", { postsPerWeek: Number(n) });
    setBusy(false);
    toast(r.kind === "ok" ? "Weekly limit saved" : r.kind === "error" ? r.message : "Couldn't reach the studio server");
  };
  const own = studio.clients.filter((c) => c.usage?.custom).length;
  return (
    <Card title="Posts and videos a week" aside={<Button small kind="primary" busy={busy} disabled={String(current) === n} onClick={() => void save()}>Save</Button>}>
      <div className="stack-sm">
        <p className="small muted" style={{ margin: 0 }}>The most posts and video ads each business can get in 7 days: from their AI assistant, their dashboard and autopilot together. What you make yourself doesn't count.{own ? ` ${own} business${own > 1 ? "es have" : " has"} its own limit.` : ""}</p>
        <div className="row"><Field label="Default limit"><Input id="lim-week" type="number" min={0} step={1} value={n} onChange={setN} /></Field></div>
      </div>
    </Card>
  );
}

/** Your two paid plans: names, prices and what's included. Changing a price changes it for every client on the list price. */
export default function Plans() {
  const offer = useOffer();
  const clients = useCollection<Client>("clients");
  const [o, setO] = useState<Offer>(offer);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  // Follow the saved prices (e.g. after loading) until you start editing.
  const savedKey = JSON.stringify(offer);
  useEffect(() => { if (!dirty) setO(offer); }, [savedKey, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPlan = (id: PaidPlanId, patch: Partial<PaidPlan>) => { setDirty(true); setO((x) => ({ ...x, plans: { ...x.plans, [id]: { ...x.plans[id], ...patch } } })); };
  const save = async () => {
    for (const id of PLAN_IDS) {
      const p = o.plans[id];
      if (!p.name.trim()) return toast("Give each plan a name.");
      if (!(p.price >= 0)) return toast("Prices can't be negative.");
    }
    setBusy(true);
    await saveOffer(o);
    void publishOffer(o); // the landing page shows the new prices straight away
    setBusy(false);
    setDirty(false);
    toast("Prices saved. Clients on the list price pay the new price from their next invoice.");
  };

  const paying = clients.filter((c) => c.stage === "paid");
  const on = (id: PaidPlanId) => paying.filter((c) => c.plan === id);
  const custom = paying.filter((c) => c.plan && c.customPrice != null && c.customPrice !== offer.plans[c.plan].price);

  return (
    <Page title="Plans & prices" intro="You sell two plans. Set their names, prices and what's included here. Prices are per month, before 7% IGIC."
      actions={<Button kind="primary" busy={busy} disabled={!dirty} onClick={save}>{dirty ? "Save prices" : "Saved"}</Button>}>
      <Stats>
        <Stat label="You earn per month" value={eur(Math.round(monthlyIncome(clients, offer)))} sub={`${eur(withIgic(monthlyIncome(clients, offer)))} with IGIC`} tone="accent" />
        {PLAN_IDS.map((id) => (
          <Stat key={id} label={`On ${offer.plans[id].name}`} value={on(id).length}
            sub={`${eur(Math.round(on(id).reduce((n, c) => n + clientMonthly(c, offer), 0)))} a month`} />
        ))}
        <Stat label="Custom prices" value={custom.length} sub="Clients with their own price" />
      </Stats>

      <WeeklyLimitCard />

      <div className="grid-2">
        {PLAN_IDS.map((id) => {
          const p = o.plans[id];
          return (
            <Card key={id} title={<span className="row wrap">{p.name || "Plan"} <Badge tone={id === "pro" ? "accent" : "info"}>{id === "pro" ? "Plan 2" : "Plan 1"}</Badge></span>}
              aside={<span className="strong tabular" style={{ fontSize: "1.3rem" }}>{eur(p.price || 0)}<span className="small muted">/mo</span></span>}>
              <div className="form-grid top">
                <Field label="Name"><Input id={`pl-${id}-name`} value={p.name} onChange={(v) => setPlan(id, { name: v.slice(0, 40) })} /></Field>
                <Field label="Price per month (€)" hint={`${eur(withIgic(p.price || 0))} with IGIC`}>
                  <Input id={`pl-${id}-price`} type="number" min={0} step={1} value={p.price} onChange={(v) => setPlan(id, { price: Math.max(0, Number(v) || 0) })} />
                </Field>
                <Field label="Setup fee (€, once)" hint="0 for none. Billed in the first month.">
                  <Input id={`pl-${id}-setup`} type="number" min={0} step={1} value={p.setup} onChange={(v) => setPlan(id, { setup: Math.max(0, Number(v) || 0) })} />
                </Field>
                <Field label="One-line description" wide><Input id={`pl-${id}-tag`} value={p.tagline} onChange={(v) => setPlan(id, { tagline: v.slice(0, 120) })} /></Field>
                <Field label="What's included (one per line)" wide>
                  <TextArea id={`pl-${id}-feat`} rows={4} value={p.features.join("\n")} onChange={(v) => setPlan(id, { features: v.split("\n").map((x) => x.slice(0, 120)).slice(0, 10) })} />
                </Field>
                <Field label="AI posts per week" hint="Autopilot posts for clients on this plan.">
                  <Input id={`pl-${id}-ppw`} type="number" min={0} step={1} value={p.postsPerWeek} onChange={(v) => setPlan(id, { postsPerWeek: Math.max(0, Math.min(14, Math.round(Number(v) || 0))) })} />
                </Field>
                <Field label="Video ads per week">
                  <Input id={`pl-${id}-vpw`} type="number" min={0} step={1} value={p.videosPerWeek} onChange={(v) => setPlan(id, { videosPerWeek: Math.max(0, Math.min(7, Math.round(Number(v) || 0))) })} />
                </Field>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid-2">
        <Card title="Free trial and goal">
          <div className="form-grid top">
            <Field label="Free trial length (days)" hint="New sign-ups start on a free trial.">
              <Input id="pl-trial" type="number" min={0} step={1} value={o.trialDays} onChange={(v) => { setDirty(true); setO((x) => ({ ...x, trialDays: Math.max(0, Math.round(Number(v) || 0)) })); }} />
            </Field>
            <Field label="Monthly earnings goal (€)" hint="Shown on Today.">
              <Input id="pl-goal" type="number" min={0} step={100} value={o.goal} onChange={(v) => { setDirty(true); setO((x) => ({ ...x, goal: Math.max(0, Number(v) || 0) })); }} />
            </Field>
          </div>
        </Card>
        <Card title="Charging one business a different price?">
          <p className="small muted" style={{ marginTop: 0 }}>Open the business in Clients and type their price under Plan. It overrides the list price for that business only.</p>
          {custom.length > 0 && (
            <div className="stack-sm">
              {custom.map((c) => <span key={c.id} className="small"><span className="strong">{c.name}</span>: {eur(c.customPrice!)} instead of {eur(offer.plans[c.plan!].price)}</span>)}
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}><Button small onClick={() => navigate("clients")}>Go to Clients</Button></div>
        </Card>
      </div>
    </Page>
  );
}
