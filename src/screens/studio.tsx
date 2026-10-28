import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Page, Card, Button, Badge, Table, Tabs, Modal, Field, Input, TextArea, Select, LangPicker, LangTag,
  ConfirmButton, CopyButton, Stats, Stat, Empty, fmtDate, toast, type Tone,
} from "../core/ui";
import { useCollection, put as putRecord } from "../core/store";
import { useOffer, PLAN_IDS, type PaidPlanId } from "../core/offer";
import { eur } from "../core/plans";
import type { Client as AppClient, Lang } from "../core/types";

import {
  type SClient, type Post, type PostStatus, type StudioData, type Act, type Platform, type ImageSettings, type ImageProvider, type AiSettings,
  readToken, saveToken, readAiProvider, saveAiProvider, downloadSiteZip, uploadSiteZip, downloadQrPng, type SiteQr, apiOrigin, mediaUrl, siteUrl, call, downscale, tagLine,
} from "./studio-api";
import { ShareModal } from "./studio-share";
import { VideosTab } from "./studio-videos";

const PLATFORMS = ["instagram", "facebook", "x", "youtube", "google", "tiktok", "linkedin"];
const STATUS_TONE: Record<PostStatus, Tone> = { generating: "info", waiting: "info", ready: "warn", published: "good", failed: "bad" };
const SITE_TONE: Record<string, Tone> = { building: "info", waiting: "info", ready: "good", failed: "bad" };

const blankClient = (): SClient => ({
  id: "", token: "", name: "", kind: "", town: "", phone: "", email: "", domain: "", offer: "", hours: "", tone: "friendly, warm, simple",
  languages: ["es", "en"], platforms: ["instagram", "facebook"], autopilot: true, postsPerWeek: 7, autoPublish: false,
  webhookUrl: "", createdAt: "",
});

const isBusy = (d: StudioData | null) =>
  !!d && (d.posts.some((p) => p.status === "generating" || p.status === "waiting") || d.videos.some((v) => v.status === "generating") || d.clients.some((c) => c.site?.status === "building" || c.site?.status === "waiting"));

const weekAgo = () => Date.now() - 7 * 24 * 3600 * 1000;


// ---- Screen ----
export default function Studio() {
  const [data, setData] = useState<StudioData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unreachable" | "auth">("loading");
  const [tab, setTab] = useState<"clients" | "feed" | "videos" | "briefs">(() => {
    // Today's buttons can open a specific tab.
    try {
      const t = sessionStorage.getItem("isla:studioTab");
      sessionStorage.removeItem("isla:studioTab");
      if (t === "feed" || t === "videos" || t === "briefs") return t;
    } catch { /* ignore */ }
    return "clients";
  });
  const [editing, setEditing] = useState<SClient | null>(null);
  const [imgSettings, setImgSettings] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [aiPick, setAiPick] = useState(readAiProvider());
  const [feedClient, setFeedClient] = useState("");
  const [briefClient, setBriefClient] = useState("");
  const alive = useRef(true);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const r = await call<StudioData>("GET", "");
    if (!alive.current) return;
    if (r.kind === "ok") { setData(r.data); setState("ok"); busyRef.current = isBusy(r.data); }
    else if (r.kind === "auth") setState("auth");
    else if (r.kind === "unreachable") setState("unreachable");
    else toast(r.message);
  }, []);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await load();
      if (alive.current) timer = setTimeout(tick, busyRef.current ? 3500 : 20000);
    };
    void tick();
    return () => { alive.current = false; clearTimeout(timer); };
  }, [load]);

  // Run a mutation, report errors, refresh.
  const act = useCallback(async (method: string, path: string, body?: unknown, okMsg?: string) => {
    const r = await call<unknown>(method, path, body);
    if (r.kind === "ok") { if (okMsg) toast(okMsg); await load(); return r.data; }
    if (r.kind === "auth") setState("auth");
    else toast(r.kind === "error" ? r.message : "The server is not reachable.");
    return undefined;
  }, [load]);

  if (state === "loading") return <Page title="Content Studio"><Card><p className="muted">Connecting to the studio server...</p></Card></Page>;
  if (state === "unreachable") return <Page title="Content Studio"><SetupCard onRetry={() => { setState("loading"); void load(); }} /></Page>;
  if (state === "auth") return <Page title="Content Studio"><TokenCard onSaved={() => { setState("loading"); void load(); }} /></Page>;
  if (!data) return null;

  const nameOf = (id: string) => data.clients.find((c) => c.id === id)?.name ?? "Deleted client";
  const week = weekAgo();
  const generating = data.posts.filter((p) => p.status === "generating").length + data.videos.filter((v) => v.status === "generating").length;
  const live = data.clients.filter((c) => c.site?.status === "ready").length;

  return (
    <Page title="Content Studio" plan="Autopilot"
      intro="Clients get a website, fresh posts with a new AI image and caption every time, and short video ads for Reels and Shorts. Share them to Instagram, Facebook, X and YouTube, or let autopilot post on its own."
      actions={<>
        <select className="input" style={{ width: "auto", padding: "4px 8px" }} aria-label="AI to use" title="Which AI does the work you start here"
          value={aiPick} onChange={(e) => { setAiPick(e.target.value); saveAiProvider(e.target.value); }}>
          <option value="">AI: Auto (free, in order)</option>
          {data.ai.list.filter((p) => p.key || data.ai.sources[p.id]).map((p) => <option key={p.id} value={p.id}>{p.label}{p.paid ? " (paid)" : ""} only</option>)}
        </select>
        <Button small kind="ghost" onClick={() => setAiSettings(true)} title="Choose the AI text providers and add keys">
          {data.ai.openrouter ? `AI: ${data.ai.providers.join(" / ")}` : "AI: template captions (no key)"} ›
        </Button>
        <Button small kind="ghost" onClick={() => setImgSettings(true)} title="Choose how images are made">
          {ENGINE_LABEL(data.images)} ›
        </Button>
        <Badge tone={data.video.ffmpeg ? "accent" : "warn"}>{data.video.ffmpeg ? "Video: ffmpeg" : "Video: install ffmpeg"}</Badge>
        <Button kind="primary" onClick={() => setEditing(blankClient())}>Add client</Button>
      </>}>
      <Stats>
        <Stat label="Active clients" value={data.clients.length} />
        <Stat label="Posts this week" value={data.posts.filter((p) => new Date(p.createdAt).getTime() >= week).length} />
        <Stat label="Generating now" value={generating} tone={generating ? "info" : undefined} />
        <Stat label="Sites live" value={live} sub={`of ${data.clients.length}`} />
      </Stats>

      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: "clients", label: "Clients", count: data.clients.length },
          { id: "feed", label: "Feed", count: data.posts.length },
          { id: "videos", label: "Videos", count: data.videos.length },
          { id: "briefs", label: "Briefs", count: data.briefs.length },
        ]} />
        {tab === "clients" && <ClientsTab data={data} onEdit={(c) => setEditing(structuredClone(c))} />}
        {tab === "feed" && <FeedTab data={data} nameOf={nameOf} filter={feedClient} setFilter={setFeedClient} act={act} />}
        {tab === "videos" && <VideosTab data={data} nameOf={nameOf} act={act} />}
        {tab === "briefs" && <BriefsTab data={data} nameOf={nameOf} clientId={briefClient} setClientId={setBriefClient} act={act} />}
      </Card>

      {editing && <ClientEditor client={editing} data={data} onClose={() => setEditing(null)} act={act} />}
      {aiSettings && <AiSettingsModal s={data.ai} act={act} onClose={() => setAiSettings(false)} />}
      {imgSettings && <ImageSettingsModal s={data.images} act={act} onClose={() => setImgSettings(false)} />}
    </Page>
  );
}

export { Studio };

// ---- Unreachable / auth ----
function SetupCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card title="The studio server is not running">
      <div className="stack">
        <p className="muted">The autonomous studio runs on your local server, not in this page. It builds client websites, writes posts and draws a new image for each one.</p>
        <ol className="stack-sm" style={{ paddingLeft: 20, margin: 0 }}>
          <li>Copy the settings file and add a free OpenRouter key: <code className="mono">cp .env.example .env</code></li>
          <li>Install the packages: <code className="mono">npm install</code></li>
          <li>Start everything: <code className="mono">npm run dev</code></li>
        </ol>
        <div className="box">
          <div className="small muted">Client sign-up page, once the server is running</div>
          <div className="row wrap"><a className="mono" href={`${apiOrigin}/signup`} target="_blank" rel="noreferrer">{`${apiOrigin}/signup`}</a><CopyButton text={`${apiOrigin}/signup`} /></div>
        </div>
        <div className="row"><Button kind="primary" onClick={onRetry}>Try again</Button></div>
      </div>
    </Card>
  );
}

function TokenCard({ onSaved }: { onSaved: () => void }) {
  const [t, setT] = useState(readToken());
  return (
    <Card title="Sign in again">
      <div className="stack">
        <p className="muted">Your session has ended. Sign in with your admin password to keep going.</p>
        <div className="row"><a className="btn btn-primary" href="/login#admin" style={{ textDecoration: "none" }}>Sign in</a></div>
        <details>
          <summary className="small muted">Use an ADMIN_TOKEN instead</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <Field label="Admin token" hint="The ADMIN_TOKEN value from your .env file. Kept in this browser only."><Input id="studio-token" type="password" value={t} onChange={setT} /></Field>
            <div className="row"><Button onClick={() => { saveToken(t.trim()); onSaved(); }}>Save and continue</Button></div>
          </div>
        </details>
      </div>
    </Card>
  );
}

// ---- Clients tab ----
function ClientsTab({ data, onEdit }: { data: StudioData; onEdit: (c: SClient) => void }) {
  const lastPost = (id: string) => data.posts.filter((p) => p.clientId === id).map((p) => p.createdAt).sort().pop();
  return (
    <Table rows={data.clients} rowKey={(c) => c.id} onRow={onEdit}
      empty={<>No studio clients yet. Use <strong>Add client</strong>, or share the sign-up link: {apiOrigin}/signup</>}
      cols={[
        { label: "Business", render: (c) => <div className="stack-sm"><span className="strong">{c.name}</span><span className="small faint">{c.kind}</span></div> },
        { label: "Town", render: (c) => c.town },
        {
          label: "Website", render: (c) => c.site ? (
            <div className="stack-sm">
              <span className="row wrap">
                <Badge tone={SITE_TONE[c.site.status] ?? "neutral"}>{c.site.status}</Badge>
                {c.site.url && <a href={siteUrl(c.site.url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open site</a>}
              </span>
              {c.site.path && <span className="small faint mono">{c.site.path}</span>}
              {c.site.error && <span className="small" style={{ color: "var(--bad)" }}>{c.site.error}</span>}
            </div>
          ) : <span className="faint">No site</span>,
        },
        { label: "Autopilot", render: (c) => c.autopilot && (c.postsPerWeek > 0 || (c.videosPerWeek ?? 0) > 0)
          ? <span className="row wrap"><Badge tone="accent">{c.postsPerWeek} posts / week</Badge>{(c.videosPerWeek ?? 0) > 0 && <Badge tone="accent">{c.videosPerWeek} videos / week</Badge>}</span>
          : <span className="faint">Off</span> },
        { label: "Connected", render: (c) => {
          const on = (Object.entries(c.connections ?? {}) as [Platform, { ready: boolean }][]).filter(([, v]) => v.ready).map(([k]) => k);
          return on.length ? <span className="row wrap">{on.map((k) => <Badge key={k} tone="good">{k === "x" ? "X" : k}</Badge>)}</span> : <span className="faint">Share by hand</span>;
        } },
        { label: "Last post", render: (c) => { const d = lastPost(c.id); return d ? fmtDate(d) : <span className="faint">None</span>; } },
      ]} />
  );
}

// ---- Client editor ----
/** QR code of the client's website, to print or share. Points at their own domain when they have one. */
export function SiteQrCard({ client }: { client: SClient }) {
  const [where, setWhere] = useState<"domain" | "studio">("domain");
  const [qr, setQr] = useState<SiteQr | null>(null);
  useEffect(() => {
    let alive = true;
    void call<SiteQr>("GET", `/clients/${client.id}/qr?where=${where}`).then((r) => { if (alive && r.kind === "ok") setQr(r.data); });
    return () => { alive = false; };
  }, [client.id, where]);
  if (!qr) return null;
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
      <div style={{ width: 132, height: 132, background: "#fff", borderRadius: 12, padding: 6, flex: "none" }} aria-label={`QR code for ${qr.url}`} role="img"
        dangerouslySetInnerHTML={{ __html: qr.svg.replace("<svg ", '<svg style="width:100%;height:100%" ') }} />
      <div className="stack-sm" style={{ minWidth: 200, flex: 1 }}>
        <span className="strong">QR code</span>
        <span className="small muted">Scan it to open <span className="mono" style={{ wordBreak: "break-all" }}>{qr.url}</span>. Print it for the shop window, menus or cards.</span>
        {qr.hasDomain && (
          <label className="row small"><input type="checkbox" checked={where === "studio"} onChange={(e) => setWhere(e.target.checked ? "studio" : "domain")} /> Use the studio link instead of their domain (works before the domain is live)</label>
        )}
        <div className="row wrap">
          <Button small onClick={async () => { try { await downloadQrPng(client.id, client.name, where); } catch (e) { toast((e as Error).message); } }}>Download PNG</Button>
          <CopyButton text={qr.url} />
        </div>
      </div>
    </div>
  );
}

function ClientEditor({ client, data, onClose, act }: { client: SClient; data: StudioData; onClose: () => void; act: Act }) {
  const [c, setC] = useState<SClient>(client);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState("");
  const appClients = useCollection<AppClient>("clients");
  const offer = useOffer();
  const isNew = !client.id;
  const zipRef = useRef<HTMLInputElement>(null);
  const [exText, setExText] = useState((client.exampleUrls ?? []).join("\n"));
  const set = <K extends keyof SClient>(k: K, v: SClient[K]) => setC((p) => ({ ...p, [k]: v }));
  const portal = c.token ? `${apiOrigin}/portal/${c.token}` : "";

  const importFrom = (id: string) => {
    setPicked(id);
    const a = appClients.find((x) => x.id === id);
    if (!a) return;
    setC((p) => ({
      ...p, name: a.name, kind: a.kind, town: a.town, phone: a.phone,
      languages: a.languages?.length ? a.languages : p.languages, offer: a.notes ?? p.offer, email: a.email ?? p.email,
    }));
  };

  // Plan: kept in step with the same business in Clients.
  const linked = appClients.find((a) => (c.id && a.studioId === c.id) || (picked && a.id === picked));
  const planChoice: "trial" | PaidPlanId = c.plan ? c.plan : "trial";
  const choosePlan = (v: "trial" | PaidPlanId) => {
    const limits = offer.plans[v === "trial" ? (linked?.plan ?? "basic") : v];
    setC((p) => ({ ...p, plan: v === "trial" ? "" : v, postsPerWeek: limits.postsPerWeek, videosPerWeek: limits.videosPerWeek }));
  };

  const save = async () => {
    if (!c.name.trim()) return toast("Give the business a name first.");
    setBusy(true);
    const { site: _s, token: _t, createdAt: _c, connections: _k, id, ...rest } = c;
    const payload = isNew ? { ...rest, buildSite: true } : { id, ...rest };
    const r = (await act("POST", "/clients", payload, isNew ? "Client added. Building the website." : "Client saved")) as SClient | undefined;
    if (r && linked) {
      const paid = !!r.plan;
      await putRecord<AppClient>("clients", {
        ...linked, studioId: r.id, plan: (r.plan || linked.plan || "basic") as PaidPlanId,
        stage: paid ? "paid" : linked.stage === "paid" ? "pilot" : linked.stage,
        planSince: paid && linked.stage !== "paid" ? new Date().toISOString().slice(0, 10) : linked.planSince,
        trialStart: !paid && linked.stage === "paid" ? new Date().toISOString().slice(0, 10) : linked.trialStart,
      });
    }
    setBusy(false);
    if (r !== undefined) onClose();
  };
  const togglePlatform = (p: string) => set("platforms", c.platforms.includes(p) ? c.platforms.filter((x) => x !== p) : [...c.platforms, p]);

  return (
    <Modal open title={isNew ? "New client" : c.name} onClose={onClose}
      footer={<>
        {!isNew && <ConfirmButton label="Delete" confirm="Delete for good" onConfirm={async () => { await act("DELETE", `/clients/${c.id}`, undefined, "Client deleted"); onClose(); }} />}
        {!isNew && <ConfirmButton label="New portal link" confirm="Replace link (old one stops working)" onConfirm={async () => { await act("POST", `/clients/${c.id}/token`, undefined, "New portal link created"); onClose(); }} />}
        <span style={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button kind="primary" busy={busy} onClick={save}>{isNew ? "Add and build site" : "Save"}</Button>
      </>}>
      <div className="stack">
        {isNew && appClients.length > 0 && (
          <Field label="Import from Clients" hint="Fills in name, type, town, phone, languages and notes as the offer.">
            <Select id="s-import" value={picked} onChange={importFrom}
              options={[{ value: "", label: "Choose a client..." }, ...appClients.map((a) => ({ value: a.id, label: `${a.name} · ${a.town}` }))]} />
          </Field>
        )}
        {portal && (
          <div className="box stack-sm">
            <span className="small muted">Client portal link</span>
            <span className="row wrap"><span className="mono small" style={{ wordBreak: "break-all" }}>{portal}</span><CopyButton text={portal} /></span>
            <span className="small muted">Sign-up link</span>
            <span className="row wrap"><span className="mono small">{apiOrigin}/signup</span><CopyButton text={`${apiOrigin}/signup`} /></span>
          </div>
        )}
        {!isNew && (
          <div className="box stack-sm">
            <span className="strong">Website</span>
            <span className="small muted">
              {c.site?.url ? <>Live at <a href={siteUrl(c.site.url)} target="_blank" rel="noreferrer">{siteUrl(c.site.url)}</a>{c.site.kind === "upload" ? ". Uploaded by you." : c.site.kind === "ai" ? ". Designed by the AI." : "."}</> : "No website yet."}
              {" "}Download it, change it on your computer and upload it again, or let the AI rebuild it.
            </span>
            <SiteQrCard client={c} />
            <input ref={zipRef} type="file" accept=".zip,application/zip" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
              toast("Uploading the website…");
              const err = await uploadSiteZip(c.id, f);
              if (err) toast(err); else { toast("New website is live"); onClose(); }
            }} />
            <div className="row wrap">
              {c.site?.url && <Button small onClick={async () => { try { await downloadSiteZip(c.id, c.name); } catch (e) { toast((e as Error).message); } }}>Download site (zip)</Button>}
              <Button small onClick={() => zipRef.current?.click()} title="Needs an index.html at the top of the zip">Upload site (zip)</Button>
              <Button small kind="ghost" onClick={() => void act("POST", `/clients/${c.id}/site`, undefined, "Rebuilding the website")}>Rebuild with AI</Button>
            </div>
          </div>
        )}
        <div className="form-grid">
          <Field label="Business name"><Input id="s-name" value={c.name} onChange={(v) => set("name", v)} /></Field>
          <Field label="Type of business"><Input id="s-kind" value={c.kind} onChange={(v) => set("kind", v)} placeholder="Restaurant, dive school..." /></Field>
          <Field label="Town"><Input id="s-town" value={c.town} onChange={(v) => set("town", v)} /></Field>
          <Field label="Phone"><Input id="s-phone" value={c.phone} onChange={(v) => set("phone", v)} /></Field>
          <Field label="Email"><Input id="s-email" value={c.email} onChange={(v) => set("email", v)} /></Field>
          <Field label="Domain"><Input id="s-domain" value={c.domain} onChange={(v) => set("domain", v)} placeholder="example.com" /></Field>
          <Field label="What they sell" wide><TextArea id="s-offer" rows={3} value={c.offer} onChange={(v) => set("offer", v)} /></Field>
          <Field label="Opening hours"><Input id="s-hours" value={c.hours} onChange={(v) => set("hours", v)} /></Field>
          <Field label="Tone of voice"><Input id="s-tone" value={c.tone} onChange={(v) => set("tone", v)} placeholder="friendly, relaxed" /></Field>
          <Field label="Languages (first is the main one)" wide><LangPicker value={c.languages as Lang[]} onChange={(v) => set("languages", v)} /></Field>
          <Field label="AI for this client" hint="Which AI writes their posts, videos, website and chat, including scheduled work. Auto uses the free ones in order. Only you see this.">
            <Select id="s-ai" value={c.aiProvider ?? ""} onChange={(v) => set("aiProvider", v)} options={[{ value: "", label: "Auto (free, in order)" }, ...data.ai.list.filter((p) => p.key || data.ai.sources[p.id]).map((p) => ({ value: p.id, label: `${p.label}${p.paid ? " (paid)" : ""} only` }))]} />
          </Field>
          <Field label="Example websites" hint={`Links to sites whose look you or the client like, one per line (up to 3). The AI takes inspiration from their layout and style, never their content.${c.profile?.examples?.length ? ` The client also added: ${c.profile.examples.join(", ")}` : ""}`} wide>
            <TextArea id="s-examples" rows={3} value={exText} onChange={(v) => { setExText(v); set("exampleUrls", v.split(/\s*\n\s*/).filter(Boolean)); }} />
          </Field>
          <Field label="Plan" hint="Sets their posts and videos a week. Prices are in Plans & prices." wide>
            <div className="plan-pick" role="radiogroup" aria-label="Plan">
              {(["trial", ...PLAN_IDS] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={planChoice === v} className={"plan-opt" + (planChoice === v ? " on" : "")} onClick={() => choosePlan(v)}>
                  <span className="strong">{v === "trial" ? "Free trial" : offer.plans[v].name}</span>
                  <span className="small muted">{v === "trial" ? `${offer.trialDays} days` : `${eur(offer.plans[v].price)}/mo · ${offer.plans[v].postsPerWeek} posts, ${offer.plans[v].videosPerWeek} videos a week`}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Platforms" wide>
            <div className="chips">
              {PLATFORMS.map((p) => {
                const on = c.platforms.includes(p);
                return <button key={p} type="button" className={"chip" + (on ? " chip-on" : "")} aria-pressed={on} onClick={() => togglePlatform(p)}>{p}</button>;
              })}
            </div>
          </Field>
        </div>
        <hr className="divider" />
        <div className="form-grid">
          <Field label="Autopilot" hint="Posts every day on its own, from the client's briefs or a topic the AI picks.">
            <label className="row"><input type="checkbox" checked={c.autopilot} onChange={(e) => set("autopilot", e.target.checked)} /> <span>{c.autopilot ? "On" : "Off"}</span></label>
          </Field>
          <Field label="Posts per week (7 to 21)" hint="At least one a day.">
            <Input id="s-ppw" type="number" min={7} step={1} value={c.postsPerWeek}
              onChange={(v) => set("postsPerWeek", Math.max(7, Math.min(21, Math.round(Number(v) || 0))))} />
          </Field>
          <Field label="Auto-publish" hint="Off means posts wait for approval as Ready.">
            <label className="row"><input type="checkbox" checked={c.autoPublish} onChange={(e) => set("autoPublish", e.target.checked)} /> <span>{c.autoPublish ? "On" : "Off"}</span></label>
          </Field>
          <Field label="Videos per week (0 to 7)" hint="Autopilot video ads from the client's briefs.">
            <Input id="s-vpw" type="number" min={0} step={1} value={c.videosPerWeek ?? 0}
              onChange={(v) => set("videosPerWeek", Math.max(0, Math.min(7, Math.round(Number(v) || 0))))} />
          </Field>
          <Field label="Video length">
            <Select id="s-vlen" value={String(c.videoSeconds ?? 15)} onChange={(v) => set("videoSeconds", Number(v))}
              options={data.video.lengths.map((s) => ({ value: String(s), label: `${s} seconds` }))} />
          </Field>
          <Field label="Video voice-over" hint={data.video.voices.length ? "System voice, labelled as AI in the video." : "No system voices on this server."}>
            <label className="row"><input type="checkbox" checked={!!c.videoVoice} disabled={!data.video.voices.length} onChange={(e) => set("videoVoice", e.target.checked)} /> <span>{c.videoVoice ? "On" : "Off"}</span></label>
          </Field>
          <Field label="Webhook URL" hint="Publishing also sends the post here (n8n, Make, Zapier...)." wide>
            <Input id="s-hook" value={c.webhookUrl} onChange={(v) => set("webhookUrl", v)} placeholder="https://..." />
          </Field>
        </div>
        <hr className="divider" />
        <AccountsEditor c={c} setC={setC} data={data} act={act} saved={!isNew} />
        {c.site?.error && <p className="small" style={{ color: "var(--bad)" }}>Website: {c.site.error}</p>}
      </div>
    </Modal>
  );
}

// ---- Feed tab ----
export function FeedTab({ data, nameOf, filter, setFilter, act, fixed }: {
  data: StudioData; nameOf: (id: string) => string; filter: string; setFilter: (v: string) => void; act: Act; fixed?: boolean;
}) {
  const [sharing, setSharing] = useState<string>("");
  const [editingPost, setEditingPost] = useState<string>("");
  const shareP = data.posts.find((p) => p.id === sharing);
  const shareC = data.clients.find((c) => c.id === shareP?.clientId);
  const editP = data.posts.find((p) => p.id === editingPost);
  const posts = useMemo(
    () => data.posts.filter((p) => !filter || p.clientId === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.posts, filter],
  );
  return (
    <div className="stack" style={{ marginTop: 14 }}>
      {!fixed && <div style={{ maxWidth: 320 }}>
        <Select id="s-feed-filter" value={filter} onChange={setFilter}
          options={[{ value: "", label: "All clients" }, ...data.clients.map((c) => ({ value: c.id, label: c.name }))]} />
      </div>}
      {!posts.length ? <Empty>No posts yet. Ask for one above, or wait for autopilot.</Empty> : (
        <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>{posts.map((p) => (
          <PostCard key={p.id} p={p} name={nameOf(p.clientId)} act={act} onShare={() => setSharing(p.id)} onEdit={() => setEditingPost(p.id)} />
        ))}</div>
      )}
      {shareP && shareC && <ShareModal kind="post" item={shareP} client={shareC} data={data} act={act} onClose={() => setSharing("")} />}
      {editP && <EditPost p={editP} act={act} onClose={() => setEditingPost("")} />}
    </div>
  );
}

function PostCard({ p, name, act, onShare, onEdit }: { p: Post; name: string; act: Act; onShare: () => void; onEdit: () => void }) {
  const langs = Object.keys(p.captions ?? {});
  const [lang, setLang] = useState(langs[0] ?? "");
  const cur = langs.includes(lang) ? lang : langs[0];
  const hashtags = tagLine(p.hashtags);
  return (
    <div className="box stack" style={{ padding: 0, overflow: "hidden" }}>
      {p.status === "generating" ? (
        <div className="row" style={{ aspectRatio: "1 / 1", justifyContent: "center", background: "var(--surface-2)" }}>
          <span className="muted"><span className="spinner" aria-hidden /> {p.captions ? "Drawing a new image..." : "Writing the caption and drawing the image..."}</span>
        </div>
      ) : p.imageFile ? (
        <img src={mediaUrl(p.imageFile)} alt={p.altText || p.concept || "Post image"} loading="lazy" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
      ) : (
        <div className="row" style={{ aspectRatio: "1 / 1", justifyContent: "center", background: "var(--surface-2)" }}><span className="faint">No image</span></div>
      )}
      <div className="stack" style={{ padding: "0 12px 12px" }}>
        <div className="row wrap between">
          <span className="strong">{name}</span>
          <span className="row wrap"><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>{p.reason && <Badge>{p.reason}</Badge>}</span>
        </div>
        <span className="small faint">{fmtDate(p.createdAt)}{p.publishedAt ? ` · published ${fmtDate(p.publishedAt)}` : ""}</span>
        {p.concept && <span className="small muted">{p.concept}</span>}
        {cur && (
          <div className="stack-sm">
            <div className="row wrap">{langs.map((l) => (
              <button key={l} type="button" className={"chip" + (l === cur ? " chip-on" : "")} aria-pressed={l === cur} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
            ))}</div>
            <div className="pre">{p.captions![cur]}</div>
            <div className="row wrap"><LangTag lang={cur} /><CopyButton text={p.captions![cur] + (hashtags ? "\n\n" + hashtags : "")} /></div>
          </div>
        )}
        {hashtags && <span className="small mono muted">{hashtags}</span>}
        {p.altText && <span className="small"><span className="faint">Image description:</span> {p.altText}</span>}
        {p.cta && <span className="small"><span className="faint">Call to action:</span> {p.cta}</span>}
        {p.model && <span className="small faint mono">{p.model}{p.imageEngine ? ` · ${p.imageEngine}` : ""}</span>}
        {p.imageNote && <span className="small" style={{ color: "var(--warn)" }}>{p.imageNote}</span>}
        {p.publishNote && <span className="small muted">{p.publishNote}</span>}
        {p.error && <span className="small" style={{ color: "var(--bad)" }}>{p.error}</span>}
        <div className="row wrap">
          {p.imageFile && p.status !== "generating" && <Button small kind="primary" onClick={onShare}>Share</Button>}
          {p.captions && p.status !== "generating" && <Button small onClick={onEdit}>Edit text</Button>}
          {p.imagePrompt && p.status !== "generating" && <Button small onClick={() => void act("POST", `/posts/${p.id}/image`, undefined, "Drawing a new image")}>New image</Button>}
          {p.status !== "generating" && <Button small onClick={() => void act("POST", `/posts/${p.id}/again`, undefined, "Making another version")}>Another version</Button>}
          {(p.status === "failed" || p.status === "waiting") && <Button small onClick={() => void act("POST", `/posts/${p.id}/retry`, undefined, "Trying again")}>Retry</Button>}
          {p.status === "ready" && <Button small onClick={() => void act("POST", `/posts/${p.id}/publish`, undefined, "Publishing to the connected accounts")}>Publish</Button>}
          <ConfirmButton label="Delete" confirm="Delete post" onConfirm={() => void act("DELETE", `/posts/${p.id}`, undefined, "Post deleted")} />
        </div>
      </div>
    </div>
  );
}

// ---- Briefs tab ----
function BriefsTab({ data, nameOf, clientId, setClientId, act }: {
  data: StudioData; nameOf: (id: string) => string; clientId: string; setClientId: (v: string) => void; act: Act;
}) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const cid = clientId || data.clients[0]?.id || "";
  const briefs = data.briefs.filter((b) => !clientId || b.clientId === clientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const pickFile = async (f?: File) => {
    if (!f) return setImage("");
    try { setImage(await downscale(f)); } catch (e) { toast(e instanceof Error ? e.message : "Could not use that image"); setFileKey((k) => k + 1); }
  };
  const add = async () => {
    if (!cid) return toast("Add a client first.");
    if (!text.trim()) return toast("Write what to promote first.");
    setBusy(true);
    const r = await act("POST", "/briefs", { clientId: cid, text: text.trim(), ...(image ? { image } : {}) }, "Brief added. Writing the post.");
    setBusy(false);
    if (r !== undefined) { setText(""); setImage(""); setFileKey((k) => k + 1); }
  };

  return (
    <div className="stack" style={{ marginTop: 14 }}>
      <div className="box stack">
        <strong>New brief</strong>
        <div className="form-grid">
          <Field label="Client">
            <Select id="s-brief-client" value={cid} onChange={setClientId} options={data.clients.length ? data.clients.map((c) => ({ value: c.id, label: c.name })) : [{ value: "", label: "No clients" }]} />
          </Field>
          <Field label="Photo (optional)">
            <input key={fileKey} className="input" type="file" accept="image/*" onChange={(e) => void pickFile(e.target.files?.[0])} />
          </Field>
          <Field label="What should the post promote?" wide>
            <TextArea id="s-brief-text" rows={3} value={text} onChange={setText} placeholder="Fresh grilled octopus tonight, 12 euros" />
          </Field>
        </div>
        {image && <img src={image} alt="Selected" style={{ maxHeight: 120, maxWidth: "100%", borderRadius: 6, objectFit: "cover", alignSelf: "flex-start" }} />}
        <div className="row"><Button kind="primary" busy={busy} onClick={add}>Add brief</Button></div>
      </div>

      <Select id="s-brief-filter" value={clientId} onChange={setClientId}
        options={[{ value: "", label: "All clients" }, ...data.clients.map((c) => ({ value: c.id, label: c.name }))]} />

      {!briefs.length ? <Empty>No briefs yet.</Empty> : (
        <div className="stack">{briefs.map((b) => (
          <div key={b.id} className="box row between" style={{ alignItems: "flex-start", opacity: b.archived ? 0.6 : 1 }}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              {b.imageFile && <img src={mediaUrl(b.imageFile)} alt="Brief upload" loading="lazy" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, flex: "none" }} />}
              <div className="stack-sm">
                <span className="row wrap"><span className="strong">{nameOf(b.clientId)}</span>{b.archived && <Badge>archived</Badge>}<span className="small faint">{fmtDate(b.createdAt)}</span></span>
                <span className="pre">{b.text}</span>
                {b.imageDescription && <span className="small faint">Photo: {b.imageDescription}</span>}
              </div>
            </div>
            <Button small kind="ghost" onClick={() => void act("POST", `/briefs/${b.id}/archive`, undefined, b.archived ? "Brief restored" : "Brief archived")}>{b.archived ? "Restore" : "Archive"}</Button>
          </div>
        ))}</div>
      )}
    </div>
  );
}

// ---- Edit a post's text ----
function EditPost({ p, act, onClose }: { p: Post; act: Act; onClose: () => void }) {
  const langs = Object.keys(p.captions ?? {});
  const [lang, setLang] = useState(langs[0] ?? "es");
  const [captions, setCaptions] = useState({ ...p.captions });
  const [short, setShort] = useState({ ...p.short });
  const [tags, setTags] = useState(tagLine(p.hashtags));
  const [alt, setAlt] = useState(p.altText ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await act("POST", `/posts/${p.id}/edit`, { captions, short, altText: alt, hashtags: tags.split(/[\s,]+/).filter(Boolean) }, "Post saved");
    setBusy(false);
    if (r !== undefined) onClose();
  };
  return (
    <Modal open title="Edit post text" onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button kind="primary" busy={busy} onClick={save}>Save</Button></>}>
      <div className="stack">
        {langs.length > 1 && <div className="row wrap">{langs.map((l) => (
          <button key={l} type="button" className={"chip" + (l === lang ? " chip-on" : "")} aria-pressed={l === lang} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
        ))}</div>}
        <Field label="Caption (Instagram, Facebook)"><TextArea id="pe-cap" rows={6} value={captions[lang] ?? ""} onChange={(v) => setCaptions((x) => ({ ...x, [lang]: v.slice(0, 2200) }))} /></Field>
        <Field label={`Short text for X (${(short[lang] ?? "").length}/220)`}><TextArea id="pe-short" rows={3} value={short[lang] ?? ""} onChange={(v) => setShort((x) => ({ ...x, [lang]: v.slice(0, 260) }))} /></Field>
        <Field label="Hashtags"><Input id="pe-tags" value={tags} onChange={setTags} placeholder="#tenerife #canaryislands" /></Field>
        <Field label="Image description (alt text)" hint="Read out by screen readers. Sent with the image to Instagram and X."><TextArea id="pe-alt" rows={2} value={alt} onChange={setAlt} /></Field>
      </div>
    </Modal>
  );
}

// ---- Social accounts for a client ----
const ACCOUNT_HELP: Record<Platform, { title: string; help: string; fields: { k: string; label: string; secret?: boolean; placeholder?: string }[] }> = {
  instagram: {
    title: "Instagram (business or creator account)",
    help: "The Instagram account must be linked to a Facebook Page. Get its ID and a token with instagram_content_publish in Meta's Graph API Explorer. Leave the token empty to use the Facebook token.",
    fields: [{ k: "userId", label: "Instagram account ID", placeholder: "1784..." }, { k: "token", label: "Access token", secret: true }],
  },
  facebook: {
    title: "Facebook Page",
    help: "A long-lived Page access token with pages_manage_posts and pages_read_engagement (Graph API Explorer, then exchange it for a long-lived one).",
    fields: [{ k: "pageId", label: "Page ID" }, { k: "token", label: "Page access token", secret: true }],
  },
  x: {
    title: "X",
    help: "Your X app's API key and secret go in .env (X_API_KEY, X_API_SECRET). Here: the client's access token and secret, with read and write permission.",
    fields: [{ k: "token", label: "Access token", secret: true }, { k: "secret", label: "Access token secret", secret: true }],
  },
  youtube: {
    title: "YouTube (for Shorts)",
    help: "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env, then get a refresh token with the youtube.upload scope (for example in Google's OAuth Playground with your own client).",
    fields: [{ k: "refreshToken", label: "Refresh token", secret: true }],
  },
  // Google is not edited here: the owner connects it in their own portal, and the tokens stay encrypted
  // on the server (server/gbp-auth.mjs). This row only reports whether the connection works.
  google: {
    title: "Google Business Profile",
    help: "Connected from the client's portal (Ficha de Google), not here: the owner signs in with Google and the tokens stay encrypted on your server. Needs GBP_API_ENABLED and the Google OAuth keys in .env.",
    fields: [],
  },
};

export function AccountsEditor({ c, setC, data, act, saved }: {
  c: SClient; setC: (f: (p: SClient) => SClient) => void; data: StudioData; act: Act; saved: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<Record<string, { ok: boolean; name?: string; error?: string }> | null>(null);
  const accounts = (c.accounts ?? {}) as Record<string, Record<string, string>>;
  const setField = (pf: Platform, k: string, v: string) =>
    setC((p) => ({ ...p, accounts: { ...(p.accounts ?? {}), [pf]: { ...((p.accounts as unknown as Record<string, Record<string, string>> | undefined)?.[pf] ?? {}), [k]: v } } as SClient["accounts"] }));
  const runCheck = async () => {
    setChecking(true);
    const r = await act("POST", `/clients/${c.id}/accounts`);
    setChecking(false);
    if (r) setCheck(r as Record<string, { ok: boolean; name?: string; error?: string }>);
  };
  return (
    <div className="stack">
      <div className="stack-sm">
        <strong>Social accounts</strong>
        <span className="small muted">Connect the client's accounts so posts and videos go straight to Instagram, Facebook, X, Google and YouTube Shorts. Tokens stay on your server; only the last 4 characters are shown here.</span>
      </div>
      {(Object.keys(ACCOUNT_HELP) as Platform[]).map((pf) => {
        const h = ACCOUNT_HELP[pf];
        const conn = c.connections?.[pf];
        const res = check?.[pf];
        const appMissing = (pf === "x" && !data.apps.x) || (pf === "youtube" && !data.apps.youtube);
        return (
          <div key={pf} className="box stack-sm">
            <span className="row wrap between">
              <span className="strong">{h.title}</span>
              {conn?.ready ? <Badge tone="good">ready</Badge> : <Badge>not connected</Badge>}
            </span>
            <span className="small faint">{h.help}</span>
            {appMissing && <span className="small" style={{ color: "var(--warn)" }}>{pf === "x" ? "X_API_KEY and X_API_SECRET" : "YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET"} are not set in .env yet.</span>}
            <div className="form-grid">
              {h.fields.map((f) => (
                <Field key={f.k} label={f.label}>
                  <Input id={`acc-${pf}-${f.k}`} type={f.secret ? "password" : "text"} value={accounts[pf]?.[f.k] ?? ""} placeholder={f.placeholder}
                    onChange={(v) => setField(pf, f.k, v)} />
                </Field>
              ))}
            </div>
            {res && (res.ok
              ? <span className="small" style={{ color: "var(--good)" }}>Works: {res.name}</span>
              : <span className="small" style={{ color: conn?.ready ? "var(--bad)" : "var(--ink-3)" }}>{res.error}</span>)}
          </div>
        );
      })}
      <div className="row wrap">
        <Button small disabled={!saved} busy={checking} onClick={() => void runCheck()} title={saved ? "" : "Save the client first"}>Check connections</Button>
        <span className="small faint">{saved ? "Save first if you changed a token." : "Add the client first, then check."}</span>
      </div>
    </div>
  );
}

// ---- AI text providers: keys saved in the dashboard, tried in order ----
export function AiSettingsModal({ s, act, onClose }: { s: AiSettings; act: Act; onClose: () => void }) {
  const [keys, setKeys] = useState<Record<string, string>>(() => Object.fromEntries(s.list.map((p) => [p.id, p.key])));
  const [order, setOrder] = useState(s.order || s.providers.join(","));
  const [models, setModels] = useState<Record<string, string>>(() => Object.fromEntries(s.list.map((p) => [p.id, p.model])));
  const [puter, setPuter] = useState(s.puter);
  const [avail, setAvail] = useState<Record<string, string[]>>({});
  const [availErr, setAvailErr] = useState<Record<string, string>>({});
  // Loads the model list a provider offers for the key typed or saved above (Puter also has an image list).
  const loadModels = async (id: string, kind = "chat") => {
    const k = kind === "image" ? `${id}:image` : id;
    if (avail[k]?.length) return;
    const r = await call<{ models: string[] }>("GET", `/settings/ai/models?p=${id}&kind=${kind}`);
    setAvail((a) => ({ ...a, [k]: r.kind === "ok" ? r.data.models : [] }));
    setAvailErr((e) => ({ ...e, [k]: r.kind === "ok" ? (r.data.models.length ? "" : "No models came back.") : r.kind === "error" ? r.message : r.kind === "auth" ? "Sign in first." : "The server is not reachable." }));
  };
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title="AI providers" onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><Button onClick={onClose}>Close</Button>
        <Button kind="primary" busy={busy} onClick={async () => {
          setBusy(true);
          const r = await act("POST", "/settings/ai", { keys, order, models, puter }, "AI providers saved");
          setBusy(false);
          if (r !== undefined) onClose();
        }}>Save</Button></>}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>Posts, sites and chat use the first provider that has a key. When one hits its limit or fails, the next one answers. One key is enough. Keys stay on your server and override .env.</p>
        {s.list.map((p) => (
          <Field key={p.id} label={`${p.label} API key`} hint={s.sources[p.id] === "env" && !keys[p.id] ? "Using the key from .env. Enter one here to override it." : p.hint}>
            <Input id={`ai-${p.id}`} type="password" value={keys[p.id] ?? ""} onChange={(v) => setKeys({ ...keys, [p.id]: v })} placeholder={s.sources[p.id] === "env" ? "Set in .env" : "API key"} />
            <input id={`ai-model-${p.id}`} className="input" style={{ marginTop: 6 }} list={`ai-models-${p.id}`} value={models[p.id] ?? ""}
              onFocus={() => void loadModels(p.id)} onChange={(e) => setModels({ ...models, [p.id]: e.target.value })}
              placeholder="Model (empty = automatic). Click to list this provider's models" aria-label={`${p.label} model`} />
            <datalist id={`ai-models-${p.id}`}>{(avail[p.id] ?? []).map((m) => <option key={m} value={m} />)}</datalist>
            {availErr[p.id] && <span className="small" style={{ color: "var(--bad)" }}>Could not load models: {availErr[p.id]} (save the key first, then try again)</span>}
          </Field>
        ))}
        <div className="box stack-sm">
          <span className="strong">Puter: pictures, voice and speech recognition</span>
          <span className="small muted">The Puter text model is the Model box in the Puter key field above. Click it to list every model Puter offers.</span>
          <div className="row wrap">
            <Button small onClick={() => {
              // Puter signs you in in this browser, then sends the token to this server's /puter-callback.
              const done = (e: MessageEvent) => {
                if (e.origin !== location.origin || (e.data as { type?: string })?.type !== "puter-connected") return;
                window.removeEventListener("message", done);
                toast("Signed in to Puter");
                void act("GET", "/settings/ai").then(() => onClose());
              };
              window.addEventListener("message", done);
              window.open(`https://puter.com/?action=authme&redirectURL=${encodeURIComponent(`${location.origin}/puter-callback`)}`, "puter-signin", "width=520,height=720");
            }}>{s.sources.puter ? "Sign in with Puter again" : "Sign in with Puter"}</Button>
            <span className="small faint">{s.sources.puter ? "Token saved." : "No developer key needed, it uses your own Puter account."}</span>
          </div>
          <span className="small muted">Once signed in, Puter can also draw post pictures (choose Puter under Images), speak video voice-overs in any language, and turn voice notes from clients into text.</span>
          <div className="form-grid">
            <Field label="Image model" hint="Click to list Puter's image models. Empty = Puter's default">
              <input id="puter-img" className="input" list="puter-image-models" value={puter.imageModel} onFocus={() => void loadModels("puter", "image")} onChange={(e) => setPuter({ ...puter, imageModel: e.target.value })} placeholder="gpt-image-2" />
              <datalist id="puter-image-models">{(avail["puter:image"] ?? []).map((m) => <option key={m} value={m} />)}</datalist>
              {availErr["puter:image"] && <span className="small" style={{ color: "var(--bad)" }}>{availErr["puter:image"]}</span>}
            </Field>
            <Field label="Voice provider" hint="openai (default), elevenlabs, gemini, aws-polly"><Input id="puter-vp" value={puter.voiceProvider} onChange={(v) => setPuter({ ...puter, voiceProvider: v })} placeholder="openai" /></Field>
            <Field label="Voice" hint="Provider's voice id, empty = default"><Input id="puter-voice" value={puter.voice} onChange={(v) => setPuter({ ...puter, voice: v })} placeholder="alloy" /></Field>
          </div>
        </div>
        <Field label="Order tried" hint={`Provider ids separated by commas, first is used first: ${s.list.map((p) => p.id).join(", ")}. Any you leave out go last.`}>
          <Input id="ai-order" value={order} onChange={setOrder} placeholder="groq,google,mistral,..." />
        </Field>
        <span className="small faint">Now using: <span className="mono">{s.providers.join(" / ") || "none (template captions)"}</span></span>
      </div>
    </Modal>
  );
}

// ---- Image engine: free (default), OpenRouter or Google ----
const ENGINE_LABEL = (s: ImageSettings) => {
  if (s.engine.startsWith("openrouter/")) return `Images: OpenRouter ${s.openrouterModels.find((m) => m.id === s.openrouterModel)?.label.split(" (")[0] ?? s.openrouterModel}`;
  if (s.engine.startsWith("google/")) return `Images: Google ${s.googleModels.find((m) => m.id === s.googleModel)?.label ?? ""}`;
  return "Images: free";
};

function ImageSettingsModal({ s, act, onClose }: { s: ImageSettings; act: Act; onClose: () => void }) {
  const [provider, setProvider] = useState<ImageProvider>(s.provider);
  const [orModel, setOrModel] = useState(s.openrouterModel);
  const [key, setKey] = useState(s.googleKey);
  const [gModel, setGModel] = useState(s.googleModel);
  const [size, setSize] = useState(s.googleSize);
  const [fallback, setFallback] = useState(s.fallback);
  const [pexels, setPexels] = useState(s.pexelsKey ?? "");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; model?: string; note?: string; error?: string } | null>(null);
  const save = async () => {
    setBusy(true);
    const r = await act("POST", "/settings/images", { provider, openrouterModel: orModel, googleKey: key, googleModel: gModel, googleSize: size, fallback, pexelsKey: pexels }, "Image settings saved");
    setBusy(false);
    return r !== undefined;
  };
  const test = async () => {
    if (!(await save())) return;
    setBusy(true);
    setCheck((await act("POST", "/settings/images/check")) as typeof check);
    setBusy(false);
  };
  const choices: { id: ImageProvider; title: string; text: string }[] = [
    { id: "free", title: "Free", text: "No key, no cost. One image every 45 seconds, simpler pictures." },
    { id: "openrouter", title: "OpenRouter", text: s.openrouterKey ? "Uses your OpenRouter key. Paid per image (from about 1.5 cents)." : "Needs OPENROUTER_API_KEY in .env." },
    { id: "google", title: "Google", text: "Uses your own Google AI Studio key. Paid per image." },
    { id: "puter", title: "Puter", text: s.puterKey ? "Draws with your Puter account (pick the image model under AI providers)." : "Needs your Puter auth token in AI providers." },
  ];
  return (
    <Modal open title="Image engine" onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><Button onClick={onClose}>Close</Button>
        {provider !== "free" && <Button busy={busy} onClick={() => void test()}>Save and test</Button>}
        <Button kind="primary" busy={busy} onClick={async () => { if (await save()) onClose(); }}>Save</Button></>}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>Draws every post image and video scene. You can switch at any time; posts already made keep their images.</p>
        <div className="stack-sm" role="radiogroup" aria-label="Image engine">
          {choices.map((c) => (
            <label key={c.id} className="box row" style={{ cursor: "pointer", alignItems: "flex-start", borderColor: provider === c.id ? "var(--accent)" : undefined }}>
              <input type="radio" name="img-provider" checked={provider === c.id} onChange={() => { setProvider(c.id); setCheck(null); }} style={{ marginTop: 3 }} />
              <span className="stack-sm"><span className="strong">{c.title}{c.id === "free" && " (default)"}</span><span className="small muted">{c.text}</span></span>
            </label>
          ))}
        </div>
        {provider === "openrouter" && (
          <Field label="OpenRouter image model" hint="Pick one, or type any model id from openrouter.ai/models?output_modalities=image">
            <input id="img-or-model" className="input" list="or-image-models" value={orModel} onChange={(e) => setOrModel(e.target.value)} />
            <datalist id="or-image-models">{s.openrouterModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
          </Field>
        )}
        {provider === "google" && <>
          <Field label="Google API key" hint={s.googleKeyFromEnv && !key ? "Using GOOGLE_API_KEY from .env. Enter a key here to override it." : "Create one at aistudio.google.com/apikey (billing on). Stored on your server only."}>
            <Input id="img-key" type="password" value={key} onChange={setKey} placeholder={s.googleKeyFromEnv ? "Set in .env" : "AIza..."} />
          </Field>
          <div className="form-grid">
            <Field label="Google model"><Select id="img-model" value={gModel} onChange={setGModel} options={s.googleModels.map((m) => ({ value: m.id, label: m.label }))} /></Field>
            <Field label="Resolution"><Select id="img-size" value={size} onChange={(v) => setSize(v as "1K" | "2K")} options={[{ value: "1K", label: "1K" }, { value: "2K", label: "2K (costs more)" }]} /></Field>
          </div>
        </>}
        {provider !== "free" && (
          <label className="row small"><input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} /> If it fails (no credit, quota), use the free service instead of failing the post</label>
        )}
        {check && (check.ok
          ? <span className="small" style={{ color: "var(--good)" }}>Works with {check.model}.{check.note ? ` ${check.note}` : ""}</span>
          : <span className="small" style={{ color: "var(--bad)" }}>{check.error}</span>)}
        <span className="small faint">Now using: <span className="mono">{s.engine}</span></span>
        <Field label="Website photos" hint={s.pexelsKeyFromEnv && !pexels ? "Using PEXELS_API_KEY from .env." : "Client websites use free stock photos (no AI drawing). Without a key they come from Openverse (public domain); add a free key from pexels.com/api for nicer photos."}>
          <Input id="img-pexels" type="password" value={pexels} onChange={setPexels} placeholder={s.pexelsKeyFromEnv ? "Set in .env" : "Pexels API key (optional)"} />
        </Field>
      </div>
    </Modal>
  );
}
