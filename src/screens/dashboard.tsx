import { useState, type ReactNode } from "react";
import { Page, Card, Button, Badge, fmtDate, toast, type Tone } from "../core/ui";
import { useCollection, put, today } from "../core/store";
import { monthlyIncome, trialPotential, clientMonthly, trialDaysLeft, withIgic } from "../core/biz";
import { useOffer, PLAN_IDS } from "../core/offer";
import { eur } from "../core/plans";
import { navigate } from "../core/nav";
import { useStudio } from "../core/studio-sync";
import { apiOrigin, copyText } from "./studio-api";
import { invTotal } from "./billing";
import { loadExamples } from "./settings";
import type { Client, Invoice, Task, Visit } from "../core/types";

/** Open another screen at a specific place (read once by that screen). */
export function goTo(route: string, hint?: { studioTab?: string; client?: string }) {
  try {
    if (hint?.studioTab) sessionStorage.setItem("isla:studioTab", hint.studioTab);
    if (hint?.client) sessionStorage.setItem("isla:openClient", hint.client);
  } catch { /* storage blocked: just open the screen */ }
  navigate(route);
}

interface Todo { key: string; tone: Tone; tag: string; title: ReactNode; detail?: ReactNode; action: ReactNode; order: number }

export default function Dashboard() {
  const clients = useCollection<Client>("clients");
  const tasks = useCollection<Task>("tasks");
  const visits = useCollection<Visit>("visits");
  const invoices = useCollection<Invoice>("invoices");
  const offer = useOffer();
  const studio = useStudio();
  const [loading, setLoading] = useState(false);

  const t = today();
  const month = t.slice(0, 7);
  const paying = clients.filter((c) => c.stage === "paid");
  const trials = clients.filter((c) => c.stage === "pilot");
  const income = monthlyIncome(clients, offer);
  const potential = trialPotential(clients, offer);
  const unpaid = invoices.filter((i) => i.status === "sent");
  const unpaidTotal = unpaid.reduce((n, i) => n + invTotal(i), 0);
  const signupLink = `${apiOrigin}/signup`;

  // ---------- one to-do list, most urgent first ----------
  const todos: Todo[] = [];
  const openClient = (c: Client, label = "Open", tab = "") => <Button small kind="primary" onClick={() => navigate(`business/${c.id}${tab ? "/" + tab : ""}`)}>{label}</Button>;

  if (studio) {
    // New sign-ups wait for your approval before they can use anything.
    for (const sc of studio.clients.filter((x) => x.approvalStatus === "pending")) {
      const c = clients.find((x) => x.studioId === sc.id);
      todos.push({ key: "approve-" + sc.id, order: -1, tone: "accent", tag: "Approve",
        title: `${sc.name} wants to join`,
        detail: `${[sc.kind, sc.town].filter(Boolean).join(" · ")}. Check their details and approve to build their website and first post.`,
        action: c ? openClient(c, "Review") : <Button small onClick={() => navigate("clients")}>Open</Button> });
    }
    // Things the assistant couldn't do: only you can answer.
    const flagged = studio.messages.filter((m) => m.needsOwner && !m.seenByOwner);
    for (const sid of [...new Set(flagged.map((m) => m.clientId))]) {
      const c = clients.find((x) => x.studioId === sid);
      const sc = studio.clients.find((x) => x.id === sid);
      const ms = flagged.filter((m) => m.clientId === sid);
      const asked = studio.messages.filter((m) => m.clientId === sid && m.role === "client").pop();
      todos.push({ key: "msg-" + sid, order: 0, tone: "bad", tag: "Message",
        title: `${c?.name ?? sc?.name ?? "A business"} needs you`,
        detail: asked?.text ? `“${asked.text.slice(0, 110)}${asked.text.length > 110 ? "…" : ""}”` : `${ms.length} message${ms.length > 1 ? "s" : ""} the assistant couldn't handle.`,
        action: c ? openClient(c, "Reply", "chat") : <Button small onClick={() => navigate("clients")}>Open</Button> });
    }
    const ready = studio.posts.filter((p) => p.status === "ready");
    const failed = studio.posts.filter((p) => p.status === "failed").length + studio.videos.filter((v) => v.status === "failed").length;
    const videos = studio.videos.filter((v) => v.status === "ready");
    if (ready.length) todos.push({ key: "posts", order: 1, tone: "accent", tag: "Posts",
      title: `${ready.length} post${ready.length > 1 ? "s are" : " is"} ready for you to check and share`,
      detail: "Written and illustrated by the AI. Check them, then share or publish.",
      action: <Button small kind="primary" onClick={() => goTo("studio", { studioTab: "feed" })}>Check posts</Button> });
    if (videos.length) todos.push({ key: "videos", order: 2, tone: "accent", tag: "Videos",
      title: `${videos.length} video ad${videos.length > 1 ? "s are" : " is"} ready to share`,
      detail: "For Instagram Reels, Facebook and YouTube Shorts.",
      action: <Button small kind="primary" onClick={() => goTo("studio", { studioTab: "videos" })}>See videos</Button> });
    if (failed) todos.push({ key: "failed", order: 3, tone: "bad", tag: "Fix",
      title: `${failed} post${failed > 1 ? "s or videos" : " or video"} couldn't be made`,
      detail: "Usually a busy free service. Press Retry on them.",
      action: <Button small onClick={() => goTo("studio", { studioTab: "feed" })}>Open studio</Button> });
  }

  for (const c of trials) {
    const left = trialDaysLeft(c, offer);
    if (left == null || left > 3) continue;
    const plan = offer.plans[c.plan ?? "basic"];
    todos.push({ key: "trial-" + c.id, order: left <= 0 ? 4 : 5, tone: left <= 0 ? "bad" : "warn", tag: "Trial",
      title: left <= 0 ? `${c.name}'s free trial has ended` : `${c.name}'s free trial ends in ${left} day${left > 1 ? "s" : ""}`,
      detail: `Ask them to continue on ${plan.name} (${eur(c.customPrice ?? plan.price)} a month)${c.phone ? ` · ${c.phone}` : ""}.`,
      action: openClient(c, "Choose plan", "plan") });
  }
  for (const c of paying.filter((x) => !x.plan)) {
    todos.push({ key: "noplan-" + c.id, order: 6, tone: "warn", tag: "Plan",
      title: `${c.name} is paying but has no plan`, detail: `Pick ${offer.plans.basic.name} or ${offer.plans.pro.name} so they're billed correctly.`,
      action: openClient(c, "Choose plan", "plan") });
  }

  const billed = new Set(invoices.filter((i) => i.date.startsWith(month)).map((i) => i.clientId));
  const toBill = paying.filter((c) => c.plan && !billed.has(c.id) && (!c.annual || !c.planSince || c.planSince.slice(5, 7) === month.slice(5, 7)));
  if (toBill.length) todos.push({ key: "bill", order: 7, tone: "info", tag: "Invoices",
    title: `Create this month's invoices (${toBill.length} client${toBill.length > 1 ? "s" : ""})`,
    detail: `${eur(Math.round(toBill.reduce((n, c) => n + clientMonthly(c, offer), 0)))} before IGIC.`,
    action: <Button small kind="primary" onClick={() => navigate("billing")}>Go to billing</Button> });
  for (const i of unpaid.filter((x) => daysBetween(x.date, t) >= 14)) {
    const c = clients.find((x) => x.id === i.clientId);
    todos.push({ key: "unpaid-" + i.id, order: 8, tone: "warn", tag: "Payment",
      title: `${c?.name ?? "A client"} hasn't paid invoice ${i.number}`, detail: `${eur(invTotal(i))} · sent ${fmtDate(i.date)}`,
      action: <Button small onClick={() => navigate("billing")}>See invoice</Button> });
  }
  for (const v of visits.filter((x) => x.followUp && x.followUp <= addDays(t, 1) && x.outcome !== "signed")) {
    todos.push({ key: "visit-" + v.id, order: 9, tone: v.followUp! < t ? "bad" : "info", tag: "Follow-up",
      title: `Call back ${v.venue}`, detail: `${v.town}${v.note ? ` · ${v.note}` : ""} · ${v.followUp! < t ? "overdue" : v.followUp === t ? "today" : "tomorrow"}`,
      action: <Button small onClick={() => navigate("visits")}>Open</Button> });
  }
  for (const task of tasks.filter((x) => !x.done)) {
    todos.push({ key: "task-" + task.id, order: 10, tone: "neutral", tag: "Task",
      title: task.title, detail: task.due ? `Due ${fmtDate(task.due)}` : undefined,
      action: <span className="row"><Button small kind="ghost" onClick={() => navigate(task.module)}>Open</Button><Button small onClick={() => put("tasks", { ...task, done: true })}>Done</Button></span> });
  }
  // Waiting ones already have their own "wants to join" item.
  const waitingIds = new Set(studio?.clients.filter((x) => x.approvalStatus && x.approvalStatus !== "approved").map((x) => x.id) ?? []);
  const newSignups = trials.filter((c) => c.studioId && !waitingIds.has(c.studioId) && daysBetween(c.createdAt.slice(0, 10), t) <= 2);
  for (const c of newSignups) {
    todos.push({ key: "new-" + c.id, order: 11, tone: "good", tag: "New",
      title: `${c.name} signed up`, detail: `${c.kind || "Business"}${c.town ? ` in ${c.town}` : ""}. Free trial started; their website and first post are being made.`,
      action: openClient(c) });
  }
  todos.sort((a, b) => a.order - b.order);

  const goal = offer.goal || 1;
  const pct = Math.min(100, Math.round((income / goal) * 100));

  return (
    <Page title={greeting()} intro={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}>
      {!clients.length && (
        <div className="banner">
          <span>No clients yet. Share your sign-up link with businesses, add one by hand, or load example data to look around.</span>
          <span className="row wrap">
            <Button kind="primary" onClick={() => void copyText(signupLink, "Sign-up link copied")}>Copy sign-up link</Button>
            <Button onClick={() => navigate("clients")}>Add a client</Button>
            <Button busy={loading} onClick={async () => { setLoading(true); await loadExamples(); setLoading(false); toast("Example data loaded"); }}>Load example data</Button>
          </span>
        </div>
      )}

      <div className="money">
        <div className="money-main">
          <span className="money-label">You earn per month</span>
          <span className="money-value tabular">{eur(Math.round(income))}</span>
          <span className="money-sub">{eur(withIgic(income))} with IGIC · {paying.length} paying client{paying.length === 1 ? "" : "s"}</span>
          <div className="money-goal" aria-label={`${pct}% of your ${eur(goal)} monthly goal`}>
            <div className="money-bar"><span style={{ width: pct + "%" }} /></div>
            <span className="small">{pct}% of your {eur(goal)} goal{income < goal ? ` · ${eur(Math.round(goal - income))} to go` : ""}</span>
          </div>
        </div>
        <div className="money-side">
          <MoneyFact label="Free trials" value={String(trials.length)} sub={trials.length ? `+${eur(Math.round(potential))}/mo if they all pay` : "None right now"} onClick={() => navigate("clients")} />
          <MoneyFact label="Waiting to be paid" value={eur(Math.round(unpaidTotal))} sub={unpaid.length ? `${unpaid.length} invoice${unpaid.length > 1 ? "s" : ""} sent` : "Nothing outstanding"} onClick={() => navigate("billing")} />
        </div>
      </div>

      <div className="quick">
        <QuickAction label="Add a business" onClick={() => goTo("clients", { client: "new" })} icon={<path d="M12 5v14M5 12h14" />} />
        <QuickAction label="Make a post" onClick={() => goTo("studio", { studioTab: "briefs" })} icon={<><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 16l5-4 4 3 3-2 4 3" /></>} />
        <QuickAction label="Make a video" onClick={() => goTo("studio", { studioTab: "videos" })} icon={<><rect x="3" y="6" width="13" height="12" rx="3" /><path d="M16 10.5l5-3v9l-5-3z" /></>} />
        <QuickAction label="Invoices" onClick={() => navigate("billing")} icon={<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>} />
        <QuickAction label="Copy sign-up link" onClick={() => void copyText(signupLink, "Sign-up link copied. Send it to a business.")} icon={<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>} />
      </div>

      <div className="dash-grid">
        <Card title="To do" aside={<Badge tone={todos.length ? "warn" : "good"}>{todos.length ? `${todos.length} thing${todos.length > 1 ? "s" : ""}` : "All done"}</Badge>}>
          {todos.length ? (
            <div className="todo-list">
              {todos.slice(0, 12).map((x) => (
                <div key={x.key} className="todo">
                  <Badge tone={x.tone}>{x.tag}</Badge>
                  <div className="todo-text"><span className="strong">{x.title}</span>{x.detail && <span className="small muted">{x.detail}</span>}</div>
                  <div className="todo-act">{x.action}</div>
                </div>
              ))}
              {todos.length > 12 && <span className="small faint">and {todos.length - 12} more</span>}
            </div>
          ) : (
            <div className="stack-sm" style={{ padding: "8px 0" }}>
              <span className="strong">Nothing needs you right now.</span>
              <span className="small muted">New posts to check, trials ending, invoices and follow-ups show up here.{studio ? "" : " Start the studio server (npm run dev) to see posts and videos too."}</span>
            </div>
          )}
        </Card>

        <Card title="Your plans" aside={<Button small kind="ghost" onClick={() => navigate("plans")}>Edit prices</Button>}>
          <div className="stack">
            {PLAN_IDS.map((id) => {
              const p = offer.plans[id];
              const on = paying.filter((c) => c.plan === id);
              const trying = trials.filter((c) => (c.plan ?? "basic") === id).length;
              return (
                <button key={id} type="button" className="plan-tile" onClick={() => navigate("plans")}>
                  <span className="row between"><span className="strong">{p.name}</span><span className="strong tabular">{eur(p.price)}<span className="small muted">/mo</span></span></span>
                  <span className="small muted">{p.tagline}</span>
                  <span className="row wrap small">
                    <span><span className="strong tabular">{on.length}</span> paying</span>
                    {trying > 0 && <span className="faint">· {trying} on trial</span>}
                    <span className="faint">· {eur(Math.round(on.reduce((n, c) => n + clientMonthly(c, offer), 0)))} a month</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      </div>
    </Page>
  );
}

function MoneyFact({ label, value, sub, onClick }: { label: string; value: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" className="money-fact" onClick={onClick}>
      <span className="money-label">{label}</span>
      <span className="money-fact-value tabular">{value}</span>
      <span className="money-sub">{sub}</span>
    </button>
  );
}

function QuickAction({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="quick-btn" onClick={onClick}>
      <span className="quick-ic"><svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg></span>
      <span>{label}</span>
    </button>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 20 ? "Good afternoon" : "Good evening";
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / 864e5);
}

function addDays(iso: string, n: number) {
  return new Date(new Date(iso + "T12:00:00").getTime() + n * 864e5).toISOString().slice(0, 10);
}
