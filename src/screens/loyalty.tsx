// Loyalty cards: overview of every business's programmes, and one programme's design, rules, rewards, customers, sharing and activity.
// Server side: server/loyalty-routes.mjs (owner scope /api/studio/loyalty/...). Also embedded as a tab in a business (LoyaltyPanel).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Page, Card, Button, Badge, Tabs, Field, Input, TextArea, Select, ConfirmButton, Empty, CopyButton, Modal, Stat, Stats, Table, Icon, toast, type Tone } from "../core/ui";
import { useRoute, navigate } from "../core/nav";
import {
  lcall, errText, designImg, readImage, fetchBlobUrl, downloadBlob, slug, fmtWhen, TYPE_INFO, FONT_STACK,
  type LoyaltyList, type ProgramView, type ProgramDetail, type Design, type Reward, type Tier, type LType, type LStatus, type Template,
  type WalletStatus, type CustomerRow, type CustomerDetail, type Txn, type FontStyle, type Layout,
} from "./loyalty-api";

const STATUS_TONE: Record<LStatus, Tone> = { draft: "neutral", live: "good", paused: "warn" };
const STATUS_LABEL: Record<LStatus, string> = { draft: "Draft", live: "Live", paused: "Paused" };
const num = (v: string | number, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const uid = () => "r" + Math.random().toString(36).slice(2, 9);

/** A number as a person reads it: grouped for the two countries our customers have. Anything else
 *  keeps its own shape rather than being sliced into groups we made up. */
export function fmtPhone(v: string): string {
  const digits = String(v ?? "").replace(/[^\d+]/g, "");
  const es = /^\+34(\d{9})$/.exec(digits);
  if (es) return `+34 ${es[1].slice(0, 3)} ${es[1].slice(3, 5)} ${es[1].slice(5, 7)} ${es[1].slice(7, 9)}`;
  const pt = /^\+351(\d{9})$/.exec(digits);
  if (pt) return `+351 ${pt[1].slice(0, 3)} ${pt[1].slice(3, 6)} ${pt[1].slice(6, 9)}`;
  return digits;
}

// ---------- Load helper ----------

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: T };
function useLoad<T>(path: string): [Load<T>, () => void, (d: T) => void] {
  const [s, setS] = useState<Load<T>>({ state: "loading" });
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    void lcall<T>("GET", path).then((r) => {
      if (n !== seq.current) return;
      setS(r.kind === "ok" ? { state: "ok", data: r.data } : { state: "error", message: errText(r) });
    });
  }, [path]);
  useEffect(() => { setS({ state: "loading" }); load(); return () => { seq.current++; }; }, [load]);
  return [s, load, (d) => setS({ state: "ok", data: d })];
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Empty action={<Button onClick={onRetry}>Try again</Button>}>{message}</Empty>;
}

function Skeleton({ rows = 3, h = 120 }: { rows?: number; h?: number }) {
  return <div className="loy-skel-wrap" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="loy-skel" style={{ height: h }} />)}</div>;
}

// ---------- The card, drawn in CSS ----------

function QrArt({ seed }: { seed: string }) {
  // Looks like a QR code on the preview; the real one is on the customer's card.
  const cells = useMemo(() => {
    let h = 2166136261;
    for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const out: string[] = [];
    const n = 21;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      if (finder) {
        const fx = x > 13 ? x - 14 : x, fy = y > 13 ? y - 14 : y;
        const on = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
        if (on) out.push(`M${x} ${y}h1v1h-1z`);
        continue;
      }
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      if (h & 1) out.push(`M${x} ${y}h1v1h-1z`);
    }
    return out.join("");
  }, [seed]);
  return <svg viewBox="-1 -1 23 23" aria-hidden><rect x="-1" y="-1" width="23" height="23" fill="#fff" /><path d={cells} fill="#111" /></svg>;
}

export function CardPreview({ design, type, goal = 8, businessName, tiers = [], compact }: {
  design: Design; type: LType; goal?: number; businessName: string; tiers?: Tier[]; compact?: boolean;
}) {
  const g = Math.min(Math.max(goal || 8, 1), 20);
  const filled = Math.max(1, Math.round(g * 0.6));
  const showStamps = type !== "points";
  const showPoints = type !== "stamps";
  const logo = designImg(design.logoFile), strip = designImg(design.stripFile), bgImg = designImg(design.backgroundFile);
  const sortedTiers = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
  const cur = sortedTiers[0];
  const next = sortedTiers[1];
  const pts = 240;
  const style = {
    "--p-bg": design.background, "--p-fg": design.foreground, "--p-lb": design.label, "--p-ac": design.accent,
    fontFamily: FONT_STACK[design.fontStyle] ?? FONT_STACK.modern,
  } as React.CSSProperties;
  const title = design.cardTitle || businessName;
  const balLabel = type === "stamps" ? "Stamps" : "Points";
  const balValue = type === "stamps" ? `${filled} / ${g}` : String(pts);
  const card = (
    <div className={`loy-pass loy-lay-${design.layout}`} style={style} role="img" aria-label={`Preview of the ${title} loyalty card`}>
      {design.layout === "full" && <>
        <div className="loy-pass-bgimg" style={bgImg ? { backgroundImage: `url("${bgImg}")` } : undefined} />
        <div className="loy-pass-scrim" />
      </>}
      <div className="loy-pass-head">
        <span className="loy-pass-logo" style={logo ? { backgroundImage: `url("${logo}")` } : undefined}>{logo ? "" : (title[0] ?? "?").toUpperCase()}</span>
        <span className="loy-pass-title">{title}</span>
        <span className="loy-pass-bal"><small>{balLabel}</small><b>{balValue}</b></span>
      </div>
      {design.layout === "stripe" && (
        <div className="loy-pass-strip" style={strip ? { backgroundImage: `url("${strip}")` } : undefined}>
          {!strip && <span className="loy-pass-strip-art" aria-hidden />}
        </div>
      )}
      <div className="loy-pass-body">
        {design.tagline && <div className="loy-pass-tag">{design.tagline}</div>}
        {showStamps && (
          <div className="loy-stamps" style={{ gridTemplateColumns: `repeat(${g > 10 ? Math.ceil(g / 2) : Math.min(g, 5)}, 1fr)` }}>
            {Array.from({ length: g }, (_, i) => (
              <span key={i} className={"loy-stamp" + (i < filled ? " on" : "")}>{i < filled ? design.stampIcon || "★" : design.stampEmptyIcon || ""}</span>
            ))}
          </div>
        )}
        {showPoints && type === "custom" && cur && (
          <div className="loy-tierbar">
            <div className="loy-tierbar-top"><span>{cur.name}</span><span>{next ? `${Math.max(next.minPoints - pts, 0)} to ${next.name}` : "Top tier"}</span></div>
            <div className="loy-tierbar-track"><span style={{ width: `${next ? Math.min(100, Math.round(((pts - cur.minPoints) / Math.max(next.minPoints - cur.minPoints, 1)) * 100)) : 100}%` }} /></div>
          </div>
        )}
        {type === "points" && (
          <div className="loy-pts-line"><span>{design.stampIcon || "★"}</span> Earn points on every purchase</div>
        )}
      </div>
      <div className="loy-pass-code"><div className="loy-pass-qr"><QrArt seed={design.cardTitle + design.background} /></div><small>LC1-••••••</small></div>
    </div>
  );
  if (!compact) return <div className="loy-pass-wrap">{card}</div>;
  return <div className="loy-pass-mini" aria-hidden><div className="loy-pass-mini-in">{card}</div></div>;
}

// ---------- Wallet banner ----------

function GoogleLine({ wallet }: { wallet: WalletStatus }) {
  const g = wallet.google;
  if (!g) return null;
  if (g.configured) return <span className="small muted">Google Wallet is on: Android customers get <b>Add to Google Wallet</b> and their balance updates after every scan.</span>;
  return <span className="small muted">Google Wallet (free) is not set up: missing {g.missing.map((m) => <code key={m} className="loy-env">{m}</code>)}</span>;
}

function WalletBanner({ wallet }: { wallet: WalletStatus }) {
  if (wallet.configured) {
    return (
      <div className="loy-wallet loy-wallet-ok" role="status">
        <div className="stack-sm">
          <span className="strong">Apple Wallet is on</span>
          <span className="small muted">Customers can add their card to Apple Wallet{wallet.passTypeId ? <> (<span className="mono">{wallet.passTypeId}</span>)</> : null}.
            {wallet.pushReady ? " Balance changes update on their phone straight away." : " Live balance updates need a public https address, so cards refresh when opened."}</span>
          <GoogleLine wallet={wallet} />
        </div>
        <Badge tone="good">Wallet ready</Badge>
      </div>
    );
  }
  return (
    <div className="loy-wallet" role="status">
      <div className="stack-sm">
        <span className="strong">Apple Wallet is not set up yet</span>
        <span className="small muted">Until it is, customers get a web card at the same link. It shows their QR code and balance and can be added to the phone's home screen. Nothing else changes when you turn Wallet on later.</span>
        {wallet.missing.length > 0 && (
          <span className="small">Still missing in the server settings: {wallet.missing.map((m) => <code key={m} className="loy-env">{m}</code>)}</span>
        )}
        <GoogleLine wallet={wallet} />
        {!wallet.publicUrlHttps && <span className="small muted">Wallet also needs <code className="loy-env">PUBLIC_URL</code> set to an https address.</span>}
      </div>
      <Badge tone="warn">Web card only</Badge>
    </div>
  );
}

// ---------- Overview ----------

const TYPE_CHOICES: LType[] = ["stamps", "points", "custom"];
const DESIGN_IDEAS = [
  "Warm coffee browns with a hand-drawn cup on the stamps",
  "Clean white and ocean blue, modern and calm",
  "Bold black and yellow, playful, big stamps",
  "Elegant dark green with gold, serif letters",
];
const PROGRESS = ["Reading your description", "Choosing colours and letters", "Painting the banner picture", "Putting the card together", "Almost there"];

function useProgress(active: boolean) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) { setT(0); return; }
    const i = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [active]);
  return { text: PROGRESS[Math.min(Math.floor(t / 12), PROGRESS.length - 1)], secs: t };
}

function CreateProgram({ open, onClose, clients, fixedClient, templates, onCreated }: {
  open: boolean; onClose: () => void; clients: { id: string; name: string }[]; fixedClient?: string; templates: Template[]; onCreated: (p: ProgramView) => void;
}) {
  const [clientId, setClientId] = useState(fixedClient ?? "");
  const [type, setType] = useState<LType>("stamps");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [tpl, setTpl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const prog = useProgress(busy && !tpl && !!prompt.trim());
  useEffect(() => { if (open) { setErr(""); setClientId((c) => fixedClient ?? (clients.some((x) => x.id === c) ? c : clients[0]?.id ?? "")); } }, [open, fixedClient, clients]);
  const clientName = clients.find((c) => c.id === clientId)?.name ?? "";
  useEffect(() => { if (open && !name.trim() && clientName) setName(`${clientName} rewards`); }, [open, clientName]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!clientId) return setErr("Pick the business first.");
    if (name.trim().length < 2) return setErr("Give the programme a name.");
    setBusy(true); setErr("");
    const r = tpl
      ? await lcall<ProgramView>("POST", "/programs/from-template", { templateId: tpl, clientId, name: name.trim() })
      : await lcall<ProgramView>("POST", "/programs", { clientId, name: name.trim(), type, ...(prompt.trim() ? { prompt: prompt.trim() } : {}) });
    if (r.kind !== "ok") { setBusy(false); return setErr(errText(r)); }
    // If the server did not design it as part of creating, ask for the design now (the card still exists if this fails).
    if (!tpl && prompt.trim() && !r.data.design.prompt) {
      const d = await lcall<ProgramView>("POST", `/programs/${r.data.id}/design`, { prompt: prompt.trim() });
      if (d.kind === "ok") r.data = d.data; else toast("Programme created, but the design failed: " + errText(d) + " Try Generate on the Design tab.");
    }
    setBusy(false);
    toast("Programme created");
    setName(""); setPrompt(""); setTpl("");
    onCreated(r.data);
  };

  return (
    <Modal open={open} title="New loyalty programme" onClose={() => !busy && onClose()} footer={<>
      {busy && prompt.trim() && !tpl && <div className="loy-progress loy-progress-foot" role="status"><span className="spinner" aria-hidden /> {prog.text}… <span className="faint small">{prog.secs}s, up to a minute</span></div>}
      <Button kind="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button kind="primary" busy={busy} onClick={() => void create()}>{prompt.trim() && !tpl ? "Create and design the card" : "Create programme"}</Button>
    </>}>
      <div className="stack">
        {!fixedClient && (
          <Field label="Which business is it for?">
            {clients.length ? <Select id="lp-client" value={clientId} onChange={setClientId} options={clients.map((c) => ({ value: c.id, label: c.name }))} />
              : <p className="small muted">Add a business first (Businesses page), then come back.</p>}
          </Field>
        )}
        <fieldset className="loy-fieldset" disabled={!!tpl}>
          <legend className="field-label">How should customers earn?</legend>
          <div className="loy-types" role="radiogroup" aria-label="Programme type">
            {TYPE_CHOICES.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} className={"plan-opt loy-type" + (type === t ? " on" : "")} onClick={() => setType(t)}>
                <span className="strong">{TYPE_INFO[t].label}</span>
                <span className="small muted">{TYPE_INFO[t].blurb}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="Programme name" hint="Customers see this on their card."><Input id="lp-name" value={name} onChange={setName} placeholder="Coffee club" /></Field>
        <Field label="Describe the card in your own words" hint="The AI designs the colours, letters, picture and stamp icon. You can change everything afterwards.">
          <TextArea id="lp-prompt" rows={3} value={prompt} onChange={setPrompt} placeholder="Warm coffee browns, a little cup on each stamp, friendly and cosy" />
        </Field>
        <div className="chips">{DESIGN_IDEAS.map((i) => <button key={i} type="button" className="chip" onClick={() => setPrompt(i)}>{i}</button>)}</div>
        {templates.length > 0 && (
          <Field label="Or start from a saved design" hint="Skips the AI and copies the look.">
            <Select id="lp-tpl" value={tpl} onChange={setTpl} options={[{ value: "", label: "No, design it with AI" }, ...templates.map((t) => ({ value: t.id, label: t.name }))]} />
          </Field>
        )}
        {err && <p className="loy-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function ProgramCard({ p, onOpen }: { p: ProgramView; onOpen: () => void }) {
  return (
    <button type="button" className="loy-prog" onClick={onOpen}>
      <CardPreview design={p.design} type={p.type} goal={p.stamps.goal} businessName={p.clientName} tiers={p.tiers} compact />
      <span className="loy-prog-info">
        <span className="row between wrap"><Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge><span className="small faint">{TYPE_INFO[p.type].label}</span></span>
        <span className="strong loy-prog-name">{p.name}</span>
        <span className="small muted">{p.clientName}</span>
        <span className="loy-mini-stats">
          <span><b>{p.stats.customers}</b> customers</span>
          <span><b>{p.stats.activeLast30d}</b> active</span>
          <span><b>{p.stats.rewardsRedeemed}</b> rewards</span>
        </span>
      </span>
    </button>
  );
}

function ProgramGrid({ programs, onNew, showEmptyCta }: { programs: ProgramView[]; onNew: () => void; showEmptyCta?: boolean }) {
  if (!programs.length) {
    return <Empty action={showEmptyCta ? <Button kind="primary" onClick={onNew}>Create the first programme</Button> : undefined}>No loyalty programmes yet. Make a stamp card or points scheme and give customers a card for their phone.</Empty>;
  }
  return <div className="loy-grid">{programs.map((p) => <ProgramCard key={p.id} p={p} onOpen={() => navigate(`loyalty/${p.id}`)} />)}</div>;
}

function Overview() {
  const [s, reload] = useLoad<LoyaltyList>("/");
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  return (
    <Page title="Loyalty cards" intro="Give each business a stamp card or points scheme that lives on the customer's phone. Staff scan the card at the till; you see who comes back."
      actions={<Button kind="primary" onClick={() => setCreating(true)} disabled={s.state !== "ok"}>New programme</Button>}>
      {s.state === "loading" && <><Skeleton rows={1} h={70} /><Skeleton rows={3} h={160} /></>}
      {s.state === "error" && <Card><LoadError message={s.message} onRetry={reload} /></Card>}
      {s.state === "ok" && (() => {
        const d = s.data;
        const clients = d.clients ?? [];
        const progs = filter ? d.programs.filter((p) => p.clientId === filter) : d.programs;
        const sum = (f: (p: ProgramView) => number) => progs.reduce((a, p) => a + f(p), 0);
        return <>
          <WalletBanner wallet={d.wallet} />
          {d.programs.length > 0 && <Stats>
            <Stat label="Programmes" value={progs.length} sub={`${progs.filter((p) => p.status === "live").length} live`} />
            <Stat label="Customers with a card" value={sum((p) => p.stats.customers)} />
            <Stat label="Active, last 30 days" value={sum((p) => p.stats.activeLast30d)} tone="good" />
            <Stat label="Rewards given" value={sum((p) => p.stats.rewardsRedeemed)} tone="accent" />
          </Stats>}
          {d.programs.length > 0 && clients.length > 1 && (
            <div className="row wrap"><span className="small muted">Business</span>
              <div style={{ minWidth: 220 }}><Select id="lo-filter" value={filter} onChange={setFilter} options={[{ value: "", label: "All businesses" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]} /></div>
            </div>
          )}
          <ProgramGrid programs={progs} onNew={() => setCreating(true)} showEmptyCta />
          <CreateProgram open={creating} onClose={() => setCreating(false)} clients={clients} templates={d.templates} onCreated={(p) => { setCreating(false); navigate(`loyalty/${p.id}/design`); }} />
        </>;
      })()}
    </Page>
  );
}

/** The Loyalty tab inside one business. */
export function LoyaltyPanel({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [s, reload] = useLoad<LoyaltyList>("/");
  const [creating, setCreating] = useState(false);
  if (s.state === "loading") return <Skeleton rows={2} h={150} />;
  if (s.state === "error") return <LoadError message={s.message} onRetry={reload} />;
  const progs = s.data.programs.filter((p) => p.clientId === clientId);
  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="muted" style={{ maxWidth: "60ch" }}>Stamp cards and points for {clientName}'s customers, on their phone and in Apple Wallet.</p>
        <div className="row wrap"><Button small kind="ghost" onClick={() => navigate("loyalty")}>All loyalty cards</Button><Button kind="primary" onClick={() => setCreating(true)}>New programme</Button></div>
      </div>
      {!s.data.wallet.configured && <p className="small loy-note">Apple Wallet is not set up yet, so customers get a web card for now. <button type="button" className="link-btn" onClick={() => navigate("loyalty")}>See what is missing</button></p>}
      <ProgramGrid programs={progs} onNew={() => setCreating(true)} showEmptyCta />
      <CreateProgram open={creating} onClose={() => setCreating(false)} clients={[{ id: clientId, name: clientName }]} fixedClient={clientId} templates={s.data.templates}
        onCreated={(p) => { setCreating(false); navigate(`loyalty/${p.id}/design`); }} />
    </div>
  );
}

// ---------- Programme detail ----------

type PTab = "design" | "rules" | "rewards" | "customers" | "share" | "activity";
const PTABS: PTab[] = ["design", "rules", "rewards", "customers", "share", "activity"];

export default function Loyalty() {
  const route = useRoute();
  const [, id, tabParam] = route.split("/");
  return id ? <ProgramScreen id={id} tabParam={PTABS.includes(tabParam as PTab) ? (tabParam as PTab) : "design"} /> : <Overview />;
}

function ProgramScreen({ id, tabParam }: { id: string; tabParam: PTab }) {
  const [s, reload, set] = useLoad<ProgramDetail>(`/programs/${id}`);
  const [wallet, setWallet] = useState<LoyaltyList | null>(null);
  const [tab, setTabState] = useState<PTab>(tabParam);
  const setTab = (t: PTab) => { setTabState(t); history.replaceState(null, "", `#loyalty/${id}/${t}`); };
  const [busy, setBusy] = useState("");
  useEffect(() => { void lcall<LoyaltyList>("GET", "/").then((r) => { if (r.kind === "ok") setWallet(r.data); }); }, [id]);

  const back = <button type="button" className="link-btn" onClick={() => navigate("loyalty")}><Icon name="arrow-left" size="sm" /> Loyalty cards</button>;
  if (s.state === "loading") return <Page title="Loading…" intro={back}><Skeleton rows={2} h={200} /></Page>;
  if (s.state === "error") return <Page title="Loyalty programme" intro={back}><Card><LoadError message={s.message} onRetry={reload} /></Card></Page>;
  const p = s.data;
  const patch = async (body: unknown, ok?: string): Promise<boolean> => {
    const r = await lcall<ProgramView>("PATCH", `/programs/${p.id}`, body);
    if (r.kind !== "ok") { toast(errText(r)); return false; }
    set({ ...p, ...r.data }); if (ok) toast(ok); return true;
  };
  const setStatus = async (st: LStatus) => { if (st === p.status) return; setBusy("status"); await patch({ status: st }, st === "live" ? "The programme is live" : st === "paused" ? "Paused" : "Back to draft"); setBusy(""); };
  const duplicate = async () => {
    setBusy("dup");
    const r = await lcall<ProgramView>("POST", `/programs/${p.id}/duplicate`);
    setBusy("");
    if (r.kind !== "ok") return toast(errText(r));
    toast("Duplicated as a draft"); navigate(`loyalty/${r.data.id}/design`);
  };
  const del = async () => {
    const r = await lcall<unknown>("DELETE", `/programs/${p.id}`, { confirm: true });
    if (r.kind !== "ok") return toast(errText(r));
    toast("Programme deleted"); navigate("loyalty");
  };
  const reloadSilently = () => { void lcall<ProgramDetail>("GET", `/programs/${p.id}`).then((r) => { if (r.kind === "ok") set(r.data); }); };

  return (
    <Page title={p.name} intro={<span className="row wrap">{back}<span className="faint">{p.clientName} · {TYPE_INFO[p.type].label}</span></span>}
      actions={<>
        <div className="seg-mini loy-status" role="group" aria-label="Programme status">
          {(["draft", "live", "paused"] as LStatus[]).map((st) => (
            <button key={st} type="button" aria-pressed={p.status === st} disabled={busy === "status"} onClick={() => void setStatus(st)} className={"loy-st-" + st}>{STATUS_LABEL[st]}</button>
          ))}
        </div>
        <Button small onClick={() => void duplicate()} busy={busy === "dup"}>Duplicate</Button>
        {p.status !== "live" && <ConfirmButton label="Delete" confirm="Yes, delete it" onConfirm={() => void del()} />}
      </>}>
      {p.status !== "live" && (
        <div className="loy-note-bar" role="status">
          {p.status === "draft" ? "This programme is a draft. Customers can't join yet. Set it to Live when the card looks right." : "This programme is paused. Customers keep their cards but can't earn or join until you set it to Live."}
        </div>
      )}
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: "design", label: "Design" }, { id: "rules", label: "Rules" }, { id: "rewards", label: "Rewards", count: p.rewards.length },
          { id: "customers", label: "Customers", count: p.customers.length }, { id: "share", label: "Share" }, { id: "activity", label: "Activity" },
        ]} />
        <div style={{ marginTop: 16 }}>
          {tab === "design" && <DesignTab key={p.updatedAt} p={p} templates={wallet?.templates ?? []} patch={patch} refresh={reloadSilently} onTemplates={() => void lcall<LoyaltyList>("GET", "/").then((r) => { if (r.kind === "ok") setWallet(r.data); })} />}
          {tab === "rules" && <RulesTab key={p.updatedAt} p={p} patch={patch} />}
          {tab === "rewards" && <RewardsTab key={p.updatedAt} p={p} patch={patch} />}
          {tab === "customers" && <CustomersTab p={p} refresh={reloadSilently} />}
          {tab === "share" && <ShareTab p={p} wallet={wallet?.wallet} onToken={(staffToken, staffUrl) => set({ ...p, staffToken, staffUrl })} />}
          {tab === "activity" && <ActivityTab p={p} />}
        </div>
      </Card>
    </Page>
  );
}

// ---------- Design ----------

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const ok = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <Field label={label}>
      <span className="loy-color">
        <input type="color" aria-label={label + " picker"} value={ok ? value : "#000000"} onChange={(e) => onChange(e.target.value)} />
        <input id={id} className="input mono" value={value} maxLength={7} onChange={(e) => onChange(e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value)} />
      </span>
    </Field>
  );
}

function ImageField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const src = designImg(value);
  return (
    <div className="loy-imgfield">
      <span className="loy-imgprev" style={src ? { backgroundImage: `url("${src}")` } : undefined}>{src ? "" : "None"}</span>
      <div className="stack-sm" style={{ flex: 1 }}>
        <span className="strong">{label}</span><span className="small muted">{hint}</span>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
          try { onChange(await readImage(f, label === "Logo" ? 600 : 1400)); } catch (er) { toast((er as Error).message); }
        }} />
        <div className="row wrap"><Button small onClick={() => ref.current?.click()}>{src ? "Replace" : "Upload"}</Button>{src && <Button small kind="ghost" onClick={() => onChange("")}>Remove</Button>}</div>
      </div>
    </div>
  );
}

const KEEPS = [{ id: "colors", label: "My colours" }, { id: "text", label: "My title and tagline" }, { id: "images", label: "My pictures" }];
const FONTS: { value: FontStyle; label: string }[] = [{ value: "modern", label: "Modern" }, { value: "serif", label: "Classic serif" }, { value: "rounded", label: "Soft and rounded" }, { value: "mono", label: "Typewriter" }];
const LAYOUTS: { value: Layout; label: string; hint: string }[] = [
  { value: "stripe", label: "Banner", hint: "A picture band under the header" }, { value: "full", label: "Full picture", hint: "Picture behind the whole card" }, { value: "minimal", label: "Flat colour", hint: "Clean, no picture" },
];

function DesignTab({ p, templates, patch, refresh, onTemplates }: {
  p: ProgramDetail; templates: Template[]; patch: (b: unknown, ok?: string) => Promise<boolean>; refresh: () => void; onTemplates: () => void;
}) {
  const [d, setD] = useState<Design>(p.design);
  const [prompt, setPrompt] = useState(p.design.prompt ?? "");
  const [keep, setKeep] = useState<string[]>([]);
  const [gen, setGen] = useState(false);
  const [genErr, setGenErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [tplName, setTplName] = useState("");
  const dirty = JSON.stringify(d) !== JSON.stringify(p.design);
  const prog = useProgress(gen);
  const set = <K extends keyof Design>(k: K, v: Design[K]) => setD((x) => ({ ...x, [k]: v }));

  const generate = async () => {
    if (prompt.trim().length < 5) return setGenErr("Describe the card in a sentence or two first.");
    setGen(true); setGenErr("");
    const r = await lcall<ProgramView>("POST", `/programs/${p.id}/design`, { prompt: prompt.trim(), ...(keep.length ? { keep } : {}) });
    setGen(false);
    if (r.kind !== "ok") return setGenErr(errText(r));
    toast("New design ready"); refresh();
  };
  const save = async () => {
    setSaving(true);
    // New pictures are still data URLs here: store them first (POST /upload {image} -> {file}), then save the file names.
    const out: Design = { ...d, prompt };
    for (const k of ["logoFile", "stripFile", "backgroundFile"] as const) {
      if (!out[k].startsWith("data:")) continue;
      const u = await lcall<{ file: string }>("POST", "/upload", { image: out[k] });
      if (u.kind !== "ok") { setSaving(false); return toast("Could not upload the picture: " + errText(u)); }
      out[k] = u.data.file;
    }
    await patch({ design: out }, "Design saved");
    setSaving(false);
  };
  const saveTpl = async () => {
    if (tplName.trim().length < 2) return toast("Name the template first");
    const r = await lcall<Template>("POST", `/programs/${p.id}/save-template`, { name: tplName.trim() });
    if (r.kind !== "ok") return toast(errText(r));
    toast("Saved as a template"); setTplName(""); onTemplates();
  };
  const applyTpl = (t: Template) => setD({ ...t.design, prompt: d.prompt });
  const mine = templates.filter((t) => !t.clientId || t.clientId === p.clientId);

  return (
    <div className="loy-design">
      <div className="loy-design-preview">
        <CardPreview design={d} type={p.type} goal={p.stamps.goal} businessName={p.clientName} tiers={p.tiers} />
        <p className="small faint" style={{ textAlign: "center" }}>Preview with example numbers. Customers see their own balance.</p>
        {d.generatedBy?.model && <p className="small faint" style={{ textAlign: "center" }}>Designed by {d.generatedBy.model}</p>}
      </div>
      <div className="stack loy-design-controls">
        <div className="loy-box">
          <h3>Describe the card</h3>
          <TextArea id="ld-prompt" rows={3} value={prompt} onChange={setPrompt} placeholder="Warm coffee browns, a little cup on each stamp, friendly and cosy" />
          <span className="small muted">When making a new design, keep:</span>
          <div className="chips">{KEEPS.map((k) => (
            <button key={k.id} type="button" className={"chip" + (keep.includes(k.id) ? " chip-on" : "")} aria-pressed={keep.includes(k.id)}
              onClick={() => setKeep((x) => x.includes(k.id) ? x.filter((y) => y !== k.id) : [...x, k.id])}>{k.label}</button>
          ))}</div>
          <div className="row wrap"><Button kind="primary" busy={gen} onClick={() => void generate()}>{p.design.generatedBy?.model ? "Generate a new design" : "Generate design"}</Button>
            {gen && <span className="small muted" role="status"><span className="spinner" aria-hidden /> {prog.text}… {prog.secs}s (up to a minute)</span>}</div>
          {genErr && <p className="loy-err" role="alert">{genErr} <button type="button" className="link-btn" onClick={() => void generate()}>Try again</button></p>}
          {dirty && !gen && <p className="small muted">You have unsaved edits. A new design replaces them unless you save first.</p>}
        </div>

        <div className="loy-box">
          <h3>Colours and letters</h3>
          <div className="form-grid">
            <ColorField id="ld-bg" label="Background" value={d.background} onChange={(v) => set("background", v)} />
            <ColorField id="ld-fg" label="Text" value={d.foreground} onChange={(v) => set("foreground", v)} />
            <ColorField id="ld-lb" label="Small labels" value={d.label} onChange={(v) => set("label", v)} />
            <ColorField id="ld-ac" label="Stamps and highlights" value={d.accent} onChange={(v) => set("accent", v)} />
            <Field label="Font style"><Select id="ld-font" value={d.fontStyle} onChange={(v) => set("fontStyle", v)} options={FONTS} /></Field>
          </div>
          <Field label="Layout">
            <div className="loy-layouts" role="radiogroup" aria-label="Layout">
              {LAYOUTS.map((l) => (
                <button key={l.value} type="button" role="radio" aria-checked={d.layout === l.value} className={"plan-opt" + (d.layout === l.value ? " on" : "")} onClick={() => set("layout", l.value)}>
                  <span className="strong">{l.label}</span><span className="small muted">{l.hint}</span>
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="loy-box">
          <h3>Words and icons</h3>
          <div className="form-grid">
            <Field label="Card title" hint="Shown at the top left."><Input id="ld-title" value={d.cardTitle} onChange={(v) => set("cardTitle", v)} /></Field>
            <Field label="Tagline"><Input id="ld-tag" value={d.tagline} onChange={(v) => set("tagline", v)} placeholder="Every 8th coffee is on us" /></Field>
            <Field label="Stamp icon" hint="One emoji or letter."><Input id="ld-icon" value={d.stampIcon} onChange={(v) => set("stampIcon", [...v].slice(0, 2).join(""))} /></Field>
            <Field label="Empty stamp" hint="Leave blank for an empty circle."><Input id="ld-empty" value={d.stampEmptyIcon} onChange={(v) => set("stampEmptyIcon", [...v].slice(0, 2).join(""))} /></Field>
          </div>
        </div>

        <div className="loy-box">
          <h3>Pictures</h3>
          <div className="loy-imgs">
            <ImageField label="Logo" hint="Square or round works best. PNG keeps see-through areas." value={d.logoFile} onChange={(v) => set("logoFile", v)} />
            <ImageField label="Banner" hint="Wide picture under the header (Banner layout)." value={d.stripFile} onChange={(v) => set("stripFile", v)} />
            <ImageField label="Full background" hint="Behind the whole card (Full picture layout)." value={d.backgroundFile} onChange={(v) => set("backgroundFile", v)} />
          </div>
        </div>

        <div className="row wrap loy-savebar">
          <Button kind="primary" busy={saving} disabled={!dirty && prompt === (p.design.prompt ?? "")} onClick={() => void save()}>Save design</Button>
          <Button kind="ghost" disabled={!dirty} onClick={() => setD(p.design)}>Undo edits</Button>
          {dirty && <span className="small muted">Unsaved changes</span>}
        </div>

        <div className="loy-box">
          <h3>Templates</h3>
          <p className="small muted">Save this look to reuse it for another programme or business.</p>
          <div className="row wrap"><div style={{ flex: "1 1 200px" }}><Input id="ld-tplname" value={tplName} onChange={setTplName} placeholder="Template name" /></div><Button onClick={() => void saveTpl()} disabled={dirty}>Save as template</Button></div>
          {dirty && <p className="small faint">Save the design first, then save it as a template.</p>}
          {mine.length > 0 ? (
            <div className="loy-tpls">{mine.map((t) => (
              <div key={t.id} className="loy-tpl">
                <CardPreview design={t.design} type={p.type} goal={p.stamps.goal} businessName={p.clientName} tiers={p.tiers} compact />
                <div className="stack-sm"><span className="strong">{t.name}</span><Button small onClick={() => applyTpl(t)}>Use this look</Button></div>
              </div>
            ))}</div>
          ) : <p className="small faint">No templates yet.</p>}
        </div>
      </div>
    </div>
  );
}

// ---------- Rules ----------

function RulesTab({ p, patch }: { p: ProgramDetail; patch: (b: unknown, ok?: string) => Promise<boolean> }) {
  const [stamps, setStamps] = useState(p.stamps);
  const [points, setPoints] = useState(p.points);
  const [tiers, setTiers] = useState<Tier[]>(p.tiers);
  const [bonus, setBonus] = useState(p.welcomeBonus);
  const [expire, setExpire] = useState<string>(p.pointsExpireDays == null ? "" : String(p.pointsExpireDays));
  const [terms, setTerms] = useState(p.terms);
  const [saving, setSaving] = useState(false);
  const useStamps = p.type !== "points", usePoints = p.type !== "stamps";
  const setTier = (i: number, t: Partial<Tier>) => setTiers((a) => a.map((x, j) => j === i ? { ...x, ...t } : x));
  const save = async () => {
    setSaving(true);
    await patch({
      stamps: { goal: Math.max(1, Math.round(num(stamps.goal, 8))), perVisit: Math.max(1, Math.round(num(stamps.perVisit, 1))), minSpendEur: Math.max(0, num(stamps.minSpendEur)) },
      points: { perEuro: Math.max(0, num(points.perEuro)), perVisit: Math.max(0, Math.round(num(points.perVisit))) },
      tiers: p.type === "custom" ? [...tiers].sort((a, b) => a.minPoints - b.minPoints) : p.tiers,
      welcomeBonus: { stamps: Math.max(0, Math.round(num(bonus.stamps))), points: Math.max(0, Math.round(num(bonus.points))) },
      pointsExpireDays: expire.trim() === "" ? null : Math.max(1, Math.round(num(expire, 365))), terms,
    }, "Rules saved");
    setSaving(false);
  };
  return (
    <div className="stack">
      {useStamps && (
        <div className="loy-box">
          <h3>Stamps</h3>
          <div className="form-grid top">
            <Field label="Stamps to fill the card" hint="Rewards cost stamps, usually the full card."><Input id="lr-goal" type="number" min={1} value={stamps.goal} onChange={(v) => setStamps({ ...stamps, goal: num(v) })} /></Field>
            <Field label="Stamps per visit" hint="Added each time staff scan the card."><Input id="lr-per" type="number" min={1} value={stamps.perVisit} onChange={(v) => setStamps({ ...stamps, perVisit: num(v) })} /></Field>
            <Field label="Minimum spend for a stamp (EUR)" hint="0 means every visit counts."><Input id="lr-min" type="number" min={0} step={0.5} value={stamps.minSpendEur} onChange={(v) => setStamps({ ...stamps, minSpendEur: num(v) })} /></Field>
          </div>
          <p className="small faint">One stamp per customer every 10 minutes, so a double scan can't give two.</p>
        </div>
      )}
      {usePoints && (
        <div className="loy-box">
          <h3>Points</h3>
          <div className="form-grid top">
            <Field label="Points per euro spent" hint="2 means 20 euros earns 40 points."><Input id="lr-pe" type="number" min={0} step={0.5} value={points.perEuro} onChange={(v) => setPoints({ ...points, perEuro: num(v) })} /></Field>
            <Field label="Bonus points per visit" hint="On top of spend. Often 0."><Input id="lr-pv" type="number" min={0} value={points.perVisit} onChange={(v) => setPoints({ ...points, perVisit: num(v) })} /></Field>
            <Field label="Points expire after (days)" hint="Leave blank so they never expire."><Input id="lr-exp" type="number" min={1} value={expire} onChange={setExpire} placeholder="Never" /></Field>
          </div>
        </div>
      )}
      {p.type === "custom" && (
        <div className="loy-box">
          <div className="row between wrap"><h3>Member tiers</h3><Button small onClick={() => setTiers((a) => [...a, { name: "", minPoints: (a[a.length - 1]?.minPoints ?? 0) + 500, perk: "" }])}>Add tier</Button></div>
          <p className="small muted">Tiers use lifetime points, so spending points on rewards never drops a customer down. The first tier is where everyone starts.</p>
          {tiers.length === 0 && <p className="small faint">No tiers yet.</p>}
          {tiers.map((t, i) => (
            <div key={i} className="loy-tier-row">
              <Field label={i === 0 ? "Tier name" : "Name"}><Input id={`lt-n${i}`} value={t.name} onChange={(v) => setTier(i, { name: v })} placeholder="Silver" /></Field>
              <Field label="From lifetime points"><Input id={`lt-p${i}`} type="number" min={0} value={t.minPoints} onChange={(v) => setTier(i, { minPoints: num(v) })} /></Field>
              <Field label="Perk"><Input id={`lt-k${i}`} value={t.perk} onChange={(v) => setTier(i, { perk: v })} placeholder="A small gift on their birthday" /></Field>
              <Button small kind="ghost" onClick={() => setTiers((a) => a.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
        </div>
      )}
      <div className="loy-box">
        <h3>Welcome and small print</h3>
        <div className="form-grid top">
          {useStamps && <Field label="Welcome stamps" hint="Given when someone first joins."><Input id="lr-ws" type="number" min={0} value={bonus.stamps} onChange={(v) => setBonus({ ...bonus, stamps: num(v) })} /></Field>}
          {usePoints && <Field label="Welcome points"><Input id="lr-wp" type="number" min={0} value={bonus.points} onChange={(v) => setBonus({ ...bonus, points: num(v) })} /></Field>}
          <Field label="Terms shown on the card" wide><TextArea id="lr-terms" rows={3} value={terms} onChange={setTerms} placeholder="One reward per visit. Not valid with other offers." /></Field>
        </div>
      </div>
      <div className="row"><Button kind="primary" busy={saving} onClick={() => void save()}>Save rules</Button></div>
    </div>
  );
}

// ---------- Rewards ----------

function RewardsTab({ p, patch }: { p: ProgramDetail; patch: (b: unknown, ok?: string) => Promise<boolean> }) {
  const [rewards, setRewards] = useState<Reward[]>(p.rewards);
  const [saving, setSaving] = useState(false);
  const defKind: Reward["kind"] = p.type === "points" ? "points" : "stamps";
  const kinds: Reward["kind"][] = p.type === "stamps" ? ["stamps"] : p.type === "points" ? ["points"] : ["stamps", "points"];
  const set = (i: number, r: Partial<Reward>) => setRewards((a) => a.map((x, j) => j === i ? { ...x, ...r } : x));
  const dirty = JSON.stringify(rewards) !== JSON.stringify(p.rewards);
  const save = async () => {
    if (rewards.some((r) => !r.name.trim())) return toast("Every reward needs a name");
    setSaving(true);
    await patch({ rewards: rewards.map((r) => ({ ...r, name: r.name.trim(), cost: Math.max(1, Math.round(num(r.cost, 1))) })) }, "Rewards saved");
    setSaving(false);
  };
  const tierOpts = [{ value: "", label: "Any customer" }, ...p.tiers.map((t) => ({ value: t.name, label: t.name + " and above" }))];
  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="muted" style={{ maxWidth: "60ch" }}>What customers can claim. Staff redeem it at the till and the cost comes off their balance.</p>
        <Button onClick={() => setRewards((a) => [...a, { id: uid(), name: "", description: "", kind: defKind, cost: defKind === "stamps" ? p.stamps.goal : 100, expiresDays: null, minTier: "", active: true }])}>Add reward</Button>
      </div>
      {rewards.length === 0 && <Empty>No rewards yet. Add one so customers know what they are collecting for.</Empty>}
      {rewards.map((r, i) => (
        <div key={r.id} className={"loy-reward" + (r.active ? "" : " off")}>
          <div className="form-grid top">
            <Field label="Reward"><Input id={`rw-n${i}`} value={r.name} onChange={(v) => set(i, { name: v })} placeholder="Free coffee" /></Field>
            <Field label="Description"><Input id={`rw-d${i}`} value={r.description} onChange={(v) => set(i, { description: v })} placeholder="Any size, any drink" /></Field>
            {kinds.length > 1 && <Field label="Costs"><Select id={`rw-k${i}`} value={r.kind} onChange={(v) => set(i, { kind: v })} options={kinds.map((k) => ({ value: k, label: k === "stamps" ? "Stamps" : "Points" }))} /></Field>}
            <Field label={r.kind === "stamps" ? "Stamps needed" : "Points needed"}><Input id={`rw-c${i}`} type="number" min={1} value={r.cost} onChange={(v) => set(i, { cost: num(v, 1) })} /></Field>
            <Field label="Voucher valid for (days)" hint="Blank means no limit."><Input id={`rw-e${i}`} type="number" min={1} value={r.expiresDays ?? ""} onChange={(v) => set(i, { expiresDays: v.trim() === "" ? null : Math.max(1, num(v, 30)) })} /></Field>
            {p.tiers.length > 0 && <Field label="Who can claim"><Select id={`rw-t${i}`} value={r.minTier} onChange={(v) => set(i, { minTier: v })} options={tierOpts} /></Field>}
          </div>
          <div className="row between wrap">
            <label className="row small"><input type="checkbox" checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} /> Available to customers</label>
            <ConfirmButton label="Remove" confirm="Yes, remove" onConfirm={() => setRewards((a) => a.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      <div className="row"><Button kind="primary" busy={saving} disabled={!dirty} onClick={() => void save()}>Save rewards</Button>{dirty && <span className="small muted">Unsaved changes</span>}</div>
    </div>
  );
}

// ---------- Customers ----------

function CustomersTab({ p, refresh }: { p: ProgramDetail; refresh: () => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<CustomerRow | null>(null);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const digits = t.replace(/\D/g, "");
    return p.customers.filter((c) => !t
      || [c.name, c.email, c.phone, c.phoneE164, c.tier].some((x) => (x ?? "").toLowerCase().includes(t))
      || (digits.length >= 3 && String(c.phoneE164 ?? c.phone ?? "").replace(/\D/g, "").includes(digits)));
  }, [p.customers, q]);
  const hasTier = p.type === "custom" || p.tiers.length > 0;
  const bal = (c: CustomerRow) => p.type === "stamps" ? `${c.stamps} / ${p.stamps.goal}` : p.type === "points" ? String(c.points) : `${c.stamps} st · ${c.points} pts`;
  return (
    <div className="stack">
      <Stats>
        <Stat label="Customers" value={p.stats.customers} />
        <Stat label="Active, last 30 days" value={p.stats.activeLast30d} tone="good" />
        <Stat label="Visits" value={p.stats.visits} />
        <Stat label="Rewards given" value={p.stats.rewardsRedeemed} tone="accent" />
      </Stats>
      <div className="loy-search"><Input id="lc-q" value={q} onChange={setQ} placeholder="Search by name, email or phone" type="search" /></div>
      <Table rows={rows} rowKey={(c) => c.id} onRow={setOpen} empty={p.customers.length ? "No one matches that search." : "No customers yet. Share the join link and they will appear here."}
        cols={[
          { label: "Customer", render: (c) => <div className="stack-sm"><span className="strong">{c.name || "Unnamed"}</span><span className="small muted">{c.email || fmtPhone(c.phoneE164 ?? c.phone) || "No contact"}</span></div> },
          { label: "Balance", render: (c) => <span className="tabular">{bal(c)}</span> },
          ...(hasTier ? [{ label: "Tier", render: (c: CustomerRow) => c.tier ? <Badge tone="accent">{c.tier}</Badge> : <span className="faint">-</span> }] : []),
          { label: "Visits", num: true, render: (c) => c.visits },
          { label: "Last visit", render: (c) => <span className="small">{c.lastVisitAt ? fmtWhen(c.lastVisitAt) : "Never"}</span> },
          { label: "Wallet", render: (c) => c.walletDevices > 0 ? <Badge tone="good">{c.walletDevices} {c.walletDevices === 1 ? "device" : "devices"}</Badge> : <span className="faint small">Web card</span> },
        ]} />
      {open && <CustomerDrawer p={p} row={open} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  );
}

const TXN_LABEL: Record<Txn["type"], string> = { join: "Joined", visit: "Visit", purchase: "Purchase", redeem: "Reward claimed", adjust: "Adjustment" };
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const txnDelta = (t: Txn) => [t.stamps ? `${signed(t.stamps)} stamps` : "", t.points ? `${signed(t.points)} points` : "", t.amountEur ? `${t.amountEur.toFixed(2)} EUR` : ""].filter(Boolean).join(" · ");

function CustomerDrawer({ p, row, onClose, onChanged }: { p: ProgramDetail; row: CustomerRow; onClose: () => void; onChanged: () => void }) {
  const [s, reload, set] = useLoad<CustomerDetail>(`/programs/${p.id}/customers/${row.id}`);
  const [st, setSt] = useState(""); const [pt, setPt] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const adjust = async () => {
    const stamps = Math.round(num(st)), points = Math.round(num(pt));
    if (!stamps && !points) return toast("Enter how many stamps or points to add or remove");
    if (note.trim().length < 2) return toast("Add a short reason so the history makes sense");
    setBusy(true);
    const r = await lcall<CustomerDetail>("POST", `/programs/${p.id}/customers/${row.id}/adjust`, { ...(stamps ? { stamps } : {}), ...(points ? { points } : {}), note: note.trim() });
    setBusy(false);
    if (r.kind !== "ok") return toast(errText(r));
    toast("Balance updated"); setSt(""); setPt(""); setNote(""); reload(); onChanged();
  };
  void set;
  const c = s.state === "ok" ? s.data : row;
  return (
    <div className="loy-drawer-back" onClick={onClose}>
      <aside className="loy-drawer" role="dialog" aria-label={`Customer ${row.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h2>{row.name || "Customer"}</h2><Button small kind="ghost" onClick={onClose}>Close</Button></div>
        <div className="loy-drawer-body">
          <div className="loy-kv">
            {row.email && <span><small>Email</small><a href={`mailto:${row.email}`}>{row.email}</a></span>}
            {row.phone && <span><small>Phone</small><a href={`tel:${String(row.phoneE164 || row.phone).replace(/[^\d+]/g, "")}`}>{fmtPhone(row.phoneE164 ?? row.phone)}</a></span>}
            <span><small>Joined</small>{fmtWhen(row.createdAt)}</span>
            <span><small>Visits</small>{c.visits}</span>
            {p.type !== "points" && <span><small>Stamps</small>{c.stamps} / {p.stamps.goal}</span>}
            {p.type !== "stamps" && <span><small>Points</small>{c.points} <i className="faint">({c.lifetimePoints} lifetime)</i></span>}
            {c.tier && <span><small>Tier</small>{c.tier}</span>}
            <span><small>Wallet</small>{row.walletDevices > 0 ? `${row.walletDevices} device${row.walletDevices === 1 ? "" : "s"}` : "Web card only"}</span>
          </div>
          <div className="loy-box">
            <h3>Fix a balance</h3>
            <p className="small muted">Use positive numbers to add, negative to remove. It is recorded in their history and their card updates.</p>
            <div className="form-grid top">
              {p.type !== "points" && <Field label="Stamps"><Input id="ca-st" type="number" value={st} onChange={setSt} placeholder="0" /></Field>}
              {p.type !== "stamps" && <Field label="Points"><Input id="ca-pt" type="number" value={pt} onChange={setPt} placeholder="0" /></Field>}
              <Field label="Reason" wide><Input id="ca-note" value={note} onChange={setNote} placeholder="Forgot to scan on Saturday" /></Field>
            </div>
            <div className="row"><Button kind="primary" busy={busy} onClick={() => void adjust()}>Apply</Button></div>
          </div>
          <div className="stack-sm">
            <h3>History</h3>
            {s.state === "loading" && <Skeleton rows={3} h={44} />}
            {s.state === "error" && <LoadError message={s.message} onRetry={reload} />}
            {s.state === "ok" && (s.data.txns.length === 0 ? <p className="small faint">Nothing yet.</p> : (
              <ul className="loy-hist">{s.data.txns.map((t) => (
                <li key={t.id}><span className="strong">{TXN_LABEL[t.type]}</span>{txnDelta(t) && <span className="small">{txnDelta(t)}</span>}{t.note && t.note !== TXN_LABEL[t.type] && <span className="small muted">{t.note}</span>}<span className="small faint">{fmtWhen(t.at)} · {t.by}</span></li>
              ))}</ul>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ---------- Share ----------

function ShareTab({ p, wallet, onToken }: { p: ProgramDetail; wallet?: WalletStatus; onToken: (t: string, url: string) => void }) {
  const [qr, setQr] = useState<{ url: string; svg: string } | null>(null);
  const [err, setErr] = useState("");
  const [regen, setRegen] = useState(false);
  useEffect(() => {
    let alive = true;
    setQr(null); setErr("");
    void lcall<{ url: string; svg: string }>("GET", `/programs/${p.id}/qr`).then((r) => { if (!alive) return; if (r.kind === "ok") setQr(r.data); else setErr(errText(r)); });
    return () => { alive = false; };
  }, [p.id]);
  const regenerate = async () => {
    setRegen(true);
    const r = await lcall<{ staffToken: string; staffUrl: string }>("POST", `/programs/${p.id}/regenerate-staff-token`);
    setRegen(false);
    if (r.kind !== "ok") return toast(errText(r));
    onToken(r.data.staffToken, r.data.staffUrl); toast("New staff link created. The old one stopped working.");
  };
  const wl = wallet?.configured;
  return (
    <div className="stack">
      {p.status !== "live" && <p className="loy-note">This programme is {p.status}, so the links below show a "not open yet" message until you set it to Live.</p>}
      <div className="loy-share">
        <div className="loy-box">
          <h3>Customer join link</h3>
          <p className="small muted">Customers open this, type their name and get their card. Put it on a poster, menu or receipt, or share the QR code.</p>
          <div className="loy-link"><span className="mono">{p.joinUrl}</span></div>
          <div className="row wrap"><CopyButton text={p.joinUrl} label="Copy link" /><a className="btn btn-secondary btn-sm" href={p.joinUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Open it</a></div>
        </div>
        <div className="loy-box loy-qrbox">
          {qr ? <div className="loy-qr" role="img" aria-label={`QR code for ${qr.url}`} dangerouslySetInnerHTML={{ __html: qr.svg.replace("<svg ", '<svg style="width:100%;height:100%" ') }} />
            : err ? <div className="loy-qr loy-qr-err small">{err}</div> : <div className="loy-qr loy-skel" />}
          <div className="stack-sm"><span className="strong">Printable QR code</span><span className="small muted">Print it for the till or window. Scanning it opens the join link.</span>
            <div className="row wrap"><Button small onClick={async () => { try { await downloadBlob(`/programs/${p.id}/qr.png`, `${slug(p.clientName + " " + p.name)}-join-qr.png`); } catch (e) { toast((e as Error).message); } }}>Download PNG</Button></div></div>
        </div>
      </div>
      <div className="loy-box">
        <h3>Staff scanner</h3>
        <p className="small muted">Staff open this on a phone at the till, scan the customer's card and tap Visit, Purchase or Reward. No sign in needed, so keep the link private. If it leaks, make a new one.</p>
        <div className="loy-link"><span className="mono">{p.staffUrl}</span></div>
        <div className="row wrap"><CopyButton text={p.staffUrl} label="Copy staff link" /><a className="btn btn-secondary btn-sm" href={p.staffUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Open scanner</a>
          <ConfirmButton label={regen ? "Working…" : "Make a new link"} confirm="Yes, stop the old link" onConfirm={() => void regenerate()} /></div>
      </div>
      <div className="loy-box">
        <h3>How customers add the card to their phone</h3>
        <ol className="loy-steps">
          <li>They scan the QR code or open the join link and enter their name.</li>
          <li>{wl ? <>On iPhone they tap <b>Add to Apple Wallet</b>. The card sits with their passes and updates after every scan.</> : <>Their card opens as a web page with their QR code and balance. On iPhone they tap Share, then <b>Add to Home Screen</b>; on Android, the browser menu then <b>Add to Home screen</b>.</>}</li>
          <li>At the till, staff scan the QR code on the card.</li>
        </ol>
        {!wl && <p className="small muted">Apple Wallet is not set up yet{wallet?.missing.length ? ` (missing ${wallet.missing.join(", ")})` : ""}. When it is, the same link offers Add to Apple Wallet automatically.</p>}
      </div>
    </div>
  );
}

// ---------- Activity ----------

function ActivityTab({ p }: { p: ProgramDetail }) {
  const names = useMemo(() => new Map(p.customers.map((c) => [c.id, c.name || "Unnamed"])), [p.customers]);
  return (
    <div className="stack">
      <Table rows={p.txns} rowKey={(t) => t.id} empty="Nothing has happened yet. Joins, visits and rewards will show here."
        cols={[
          { label: "When", render: (t) => <span className="small">{fmtWhen(t.at)}</span> },
          ...(p.txns.some((t) => t.customerId) ? [{ label: "Customer", render: (t: Txn) => names.get(t.customerId ?? "") ?? "Unknown" }] : []),
          { label: "What", render: (t) => <div className="stack-sm"><span className="strong">{TXN_LABEL[t.type]}</span>{t.note && t.note !== TXN_LABEL[t.type] && <span className="small muted">{t.note}</span>}</div> },
          { label: "Change", render: (t) => <span className="small tabular">{txnDelta(t) || "-"}</span> },
          { label: "By", render: (t) => <span className="small faint">{t.by}</span> },
        ]} />
      {p.txns.length >= 100 && <p className="small faint">Showing the latest 100.</p>}
    </div>
  );
}

