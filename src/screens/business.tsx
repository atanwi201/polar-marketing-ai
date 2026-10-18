// One business, everything about it: overview, its conversation with the assistant, posts, videos,
// website, plan and billing, social accounts and details. Opened from Businesses (#business/<id>).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Page, Card, Button, Badge, Tabs, Field, Input, TextArea, Select, LangPicker, ConfirmButton, Empty, CopyButton, fmtDate, toast } from "../core/ui";
import { useCollection, put, remove } from "../core/store";
import { useRoute, navigate } from "../core/nav";
import { useOffer } from "../core/offer";
import { STAGE_LABEL, planLabel, clientMonthly, trialDaysLeft, withIgic } from "../core/biz";
import { eur, TOWNS } from "../core/plans";
import { syncFromStudio, pushPlanToStudio } from "../core/studio-sync";
import { call, apiOrigin, mediaUrl, siteUrl, downscale, type StudioData, type SClient, type Message, type Act, type Profile, type Service } from "./studio-api";
import { FeedTab, AccountsEditor, SiteQrCard } from "./studio";
import { VideosTab } from "./studio-videos";
import { LoyaltyPanel } from "./loyalty";
import { PlanPicker, ConsentEditor, STAGE_TONE } from "./clients";
import { invTotal } from "./billing";
import type { Client, Invoice, Lang } from "../core/types";

type Tab = "overview" | "chat" | "posts" | "videos" | "website" | "loyalty" | "plan" | "accounts" | "details";
const TABS: Tab[] = ["overview", "chat", "posts", "videos", "website", "loyalty", "plan", "accounts", "details"];
const PLATFORMS = ["instagram", "facebook", "x", "youtube", "google", "tiktok", "linkedin"];

export const initials = (n: string) => {
  const w = String(n || "").split(/\s+/).filter((x) => x.length > 2);
  return ((w[0] ?? "?")[0] + ((w[1] ?? w[0] ?? "")[0] ?? "")).toUpperCase();
};

export default function Business() {
  const route = useRoute();
  const [, id, tabParam] = route.split("/");
  const clients = useCollection<Client>("clients");
  const invoices = useCollection<Invoice>("invoices");
  const offer = useOffer();
  // A business is found by its own id, or by its studio id (links from the studio side).
  const client = clients.find((c) => c.id === id) ?? clients.find((c) => c.studioId === id || `s-${c.studioId}` === id);
  const [data, setData] = useState<StudioData | null>(null);
  const [synced, setSynced] = useState(false);
  const [tab, setTabState] = useState<Tab>(TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "overview");
  const setTab = (t: Tab) => { setTabState(t); history.replaceState(null, "", `#business/${id}/${t}`); };

  const load = useCallback(async () => { const d = await syncFromStudio(); setData(d); setSynced(true); return d; }, []);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await load();
      if (!alive) return;
      const busy = !!d && (d.posts.some((p) => p.status === "generating") || d.videos.some((v) => v.status === "generating") || d.messages.some((m) => m.status === "thinking") || d.clients.some((c) => c.siteEdit?.status === "working" || c.site?.status === "building"));
      timer = setTimeout(tick, busy ? 3500 : 15000);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [load]);

  const act: Act = useCallback(async (method, path, body, okMsg) => {
    const r = await call<unknown>(method, path, body);
    if (r.kind === "ok") { if (okMsg) toast(okMsg); await load(); return r.data; }
    toast(r.kind === "error" ? r.message : r.kind === "auth" ? "The studio needs your admin token: open Content Studio once." : "The studio server isn't running (npm run dev).");
    return undefined;
  }, [load]);

  if (!client && !synced) return <Page title="Loading…"><Card><p className="muted"><span className="spinner" aria-hidden /> Opening the business…</p></Card></Page>;
  if (!client) {
    return (
      <Page title="Business not found">
        <Card><div className="stack"><p className="muted">This business may have been deleted.</p><div className="row"><Button onClick={() => navigate("clients")}>Back to Businesses</Button></div></div></Card>
      </Page>
    );
  }

  const sc = data?.clients.find((x) => x.id === client.studioId);
  const posts = sc ? data!.posts.filter((p) => p.clientId === sc.id) : [];
  const videos = sc ? data!.videos.filter((v) => v.clientId === sc.id) : [];
  const messages = sc ? data!.messages.filter((m) => m.clientId === sc.id) : [];
  const flagged = messages.filter((m) => m.needsOwner && !m.seenByOwner);
  const portal = sc?.token ? `${apiOrigin}/portal/${sc.token}` : "";
  const left = trialDaysLeft(client, offer);

  const needsStudio = (content: ReactNode) => (sc ? content : <StartAutopilot client={client} data={data} offer={offer} act={act} />);

  return (
    <Page title={client.name} intro={<span className="row wrap">
        <button type="button" className="link-btn" onClick={() => navigate("clients")}>← Businesses</button>
        <span className="faint">{[client.kind, client.town].filter(Boolean).join(" · ")}</span>
      </span>}
      actions={<>
        <Badge tone={STAGE_TONE[client.stage]}>{STAGE_LABEL[client.stage]}{left != null ? ` · ${left > 0 ? `${left} days left` : "ended"}` : ""}</Badge>
        {portal && <a className="btn btn-secondary" href={portal} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Open their dashboard</a>}
        {sc?.site?.url && sc.site.status === "ready" && <a className="btn btn-ghost" href={siteUrl(sc.site.url)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Website</a>}
      </>}>
      {sc && sc.approvalStatus && sc.approvalStatus !== "approved" && <ApprovalBanner sc={sc} act={act} />}
      <Card>
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: "overview", label: "Overview" },
          { id: "chat", label: "Conversation", count: flagged.length || undefined },
          { id: "posts", label: "Posts", count: posts.length },
          { id: "videos", label: "Videos", count: videos.length },
          { id: "website", label: "Website" },
          { id: "loyalty", label: "Loyalty" },
          { id: "plan", label: "Plan & billing" },
          { id: "accounts", label: "Social accounts" },
          { id: "details", label: "Details" },
        ]} />
        <div style={{ marginTop: 16 }}>
          {tab === "overview" && <Overview client={client} sc={sc} data={data} offer={offer} posts={posts} videos={videos} messages={messages} flagged={flagged.length} portal={portal} setTab={setTab} act={act} />}
          {tab === "chat" && needsStudio(<Chat sc={sc!} messages={messages} data={data!} act={act} />)}
          {tab === "posts" && needsStudio(<><AskPost sc={sc!} act={act} /><FeedTab data={data!} nameOf={() => client.name} filter={sc?.id ?? ""} setFilter={() => {}} act={act} fixed /></>)}
          {tab === "videos" && needsStudio(<VideosTab data={data!} nameOf={() => client.name} act={act} clientId={sc?.id} />)}
          {tab === "website" && needsStudio(<Website sc={sc!} act={act} />)}
          {tab === "loyalty" && needsStudio(<LoyaltyPanel clientId={sc!.id} clientName={client.name} />)}
          {tab === "plan" && <PlanTab client={client} invoices={invoices.filter((i) => i.clientId === client.id)} />}
          {tab === "accounts" && needsStudio(<Accounts sc={sc!} data={data!} act={act} />)}
          {tab === "details" && <Details client={client} sc={sc} act={act} />}
        </div>
      </Card>
    </Page>
  );
}

// ---------- Overview ----------

function Overview({ client, sc, data, offer, posts, videos, messages, flagged, portal, setTab, act }: {
  client: Client; sc?: SClient; data: StudioData | null; offer: ReturnType<typeof useOffer>; posts: StudioData["posts"]; videos: StudioData["videos"];
  messages: Message[]; flagged: number; portal: string; setTab: (t: Tab) => void; act: Act;
}) {
  const month = new Date().toISOString().slice(0, 7);
  const ready = posts.filter((p) => p.status === "ready" || p.status === "published");
  const recent = [...posts].filter((p) => p.imageFile).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const lastMsgs = messages.filter((m) => m.text).slice(-3);
  return (
    <div className="stack">
      {!sc && <StartAutopilot client={client} data={data} offer={offer} act={act} />}
      <div className="biz-stats">
        <button type="button" className="biz-stat" onClick={() => setTab("plan")}>
          <span className="biz-stat-label">Plan</span>
          <span className="biz-stat-value">{planLabel(client, offer)}</span>
          <span className="small muted">{client.stage === "paid" && client.plan ? `${eur(Math.round(clientMonthly(client, offer)))} a month` : client.stage === "pilot" ? "Not paying yet" : "No plan"}</span>
        </button>
        <button type="button" className="biz-stat" onClick={() => setTab("website")}>
          <span className="biz-stat-label">Website</span>
          <span className="biz-stat-value">{sc?.site ? { ready: "Live", building: "Being built", waiting: "Being built", failed: "Not built" }[sc.site.status] : "None"}</span>
          <span className="small muted">{sc?.site?.builtAt ? `Updated ${fmtDate(sc.site.builtAt)}` : "Built when the autopilot starts"}</span>
        </button>
        <button type="button" className="biz-stat" onClick={() => setTab("posts")}>
          <span className="biz-stat-label">Posts</span>
          <span className="biz-stat-value">{ready.length}</span>
          <span className="small muted">{posts.filter((p) => p.createdAt.startsWith(month)).length} this month · {sc?.autopilot ? `${sc.postsPerWeek} a week on autopilot` : "autopilot off"}</span>
        </button>
        <button type="button" className="biz-stat" onClick={() => setTab("chat")}>
          <span className="biz-stat-label">Conversation</span>
          <span className="biz-stat-value" style={flagged ? { color: "var(--bad)" } : undefined}>{flagged ? `${flagged} need${flagged === 1 ? "s" : ""} you` : messages.filter((m) => m.role === "client").length}</span>
          <span className="small muted">{flagged ? "Questions only you can answer" : "messages from the business"}</span>
        </button>
      </div>

      {sc && (
        <div className="row wrap">
          <Button kind="primary" onClick={() => setTab("posts")}>Make a post</Button>
          <Button onClick={() => setTab("videos")}>Make a video</Button>
          <Button onClick={() => setTab("chat")}>Write to them</Button>
          {portal && <CopyButton text={portal} label="Copy their dashboard link" />}
        </div>
      )}

      {sc?.usage && <WeeklyLimit sc={sc} act={act} />}

      {sc?.code && (
        <div className="box row wrap" style={{ justifyContent: "space-between" }}>
          <div className="stack-sm">
            <span className="small muted">Their access code</span>
            <span className="access-code">{sc.code}</span>
            <span className="small faint">They type it on the home page ({apiOrigin.replace(/^https?:\/\//, "")}) to open their dashboard.</span>
          </div>
          <span className="row wrap">
            <CopyButton text={sc.code} label="Copy code" />
            <CopyButton text={`Hola ${client.name}: entra en tu panel de Isla Autopilot en ${apiOrigin}/ con tu código ${sc.code}`} label="Copy message for them" />
          </span>
        </div>
      )}

      {sc && (
        <div className="grid-2">
          <div className="stack-sm">
            <span className="row between"><strong>Latest posts</strong><button type="button" className="link-btn" onClick={() => setTab("posts")}>All posts</button></span>
            {recent.length ? (
              <div className="thumbs">{recent.map((p) => (
                <button key={p.id} type="button" className="thumb-btn" onClick={() => setTab("posts")} title={p.concept}>
                  <img src={mediaUrl(p.imageFile!)} alt={p.altText || p.concept || "Post"} loading="lazy" />
                </button>
              ))}</div>
            ) : <Empty>No posts yet.</Empty>}
            {videos.some((v) => v.renders) && (() => { const n = videos.filter((v) => v.renders).length; return <span className="small muted">{n} video{n === 1 ? "" : "s"} ready · <button type="button" className="link-btn" onClick={() => setTab("videos")}>see videos</button></span>; })()}
          </div>
          <div className="stack-sm">
            <span className="row between"><strong>Latest messages</strong><button type="button" className="link-btn" onClick={() => setTab("chat")}>Open conversation</button></span>
            {lastMsgs.length ? lastMsgs.map((m) => (
              <div key={m.id} className="box stack-sm">
                <span className="small faint">{m.role === "client" ? client.name : m.role === "owner" ? "You" : "Assistant"} · {fmtDate(m.createdAt)}</span>
                <span className="small">{m.text.slice(0, 160)}{m.text.length > 160 ? "…" : ""}</span>
              </div>
            )) : <Empty>No messages yet. The business can chat with the assistant from their dashboard.</Empty>}
          </div>
        </div>
      )}

      <div className="stack-sm small muted">
        <span>{[client.contact, client.phone, client.email].filter(Boolean).join(" · ") || "No contact details yet"} · <button type="button" className="link-btn" onClick={() => setTab("details")}>edit</button></span>
        {client.notes && <span className="pre">{client.notes}</span>}
      </div>
    </div>
  );
}

// ---------- Start the autopilot for a lead ----------

function StartAutopilot({ client, data, offer, act }: { client: Client; data: StudioData | null; offer: ReturnType<typeof useOffer>; act: Act }) {
  const [busy, setBusy] = useState(false);
  if (!data) return <div className="banner"><span>The studio server isn't running, so posts, videos and the website can't be shown. Start it with <code className="mono">npm run dev</code>.</span></div>;
  const start = async () => {
    setBusy(true);
    const plan = offer.plans[client.plan ?? "basic"];
    const r = (await act("POST", "/clients", {
      name: client.name, kind: client.kind, town: client.town, phone: client.phone, email: client.email ?? "", offer: client.notes ?? "",
      languages: client.languages, platforms: ["instagram", "facebook"], tone: "friendly, warm, simple", autopilot: true,
      postsPerWeek: plan.postsPerWeek, videosPerWeek: plan.videosPerWeek, autoPublish: false, webhookUrl: "", hours: "", domain: "",
      plan: client.stage === "paid" && client.plan ? client.plan : "", customPrice: client.customPrice ?? null, buildSite: true,
    }, "Autopilot started: building their website and first posts.")) as SClient | undefined;
    if (r?.id) await put<Client>("clients", { ...client, studioId: r.id, stage: client.stage === "lead" ? "pilot" : client.stage, trialStart: client.stage === "lead" ? new Date().toISOString().slice(0, 10) : client.trialStart });
    setBusy(false);
  };
  return (
    <div className="box stack">
      <strong>{client.name} isn't on the autopilot yet</strong>
      <span className="small muted">Start it to build their website, make posts and videos, and give them their own dashboard with the AI assistant. {client.stage === "lead" ? "They move to a free trial." : ""} Add what they sell in Details first for better results.</span>
      <div className="row"><Button kind="primary" busy={busy} onClick={start}>Start autopilot</Button></div>
    </div>
  );
}

// ---------- Conversation ----------

function Chat({ sc, messages, data, act }: { sc: SClient; messages: Message[]; data: StudioData; act: Act }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const unseen = messages.some((m) => !m.seenByOwner);
  useEffect(() => { if (unseen) void act("POST", `/clients/${sc.id}/messages/seen`); }, [unseen, sc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const r = await act("POST", `/clients/${sc.id}/messages`, { text: text.trim() }, "Sent. They'll see it in their dashboard.");
    setBusy(false);
    if (r !== undefined) setText("");
  };
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>What {sc.name} wrote to the assistant in their dashboard, and what it did. Messages it couldn't handle are marked. Your replies show up for them as "Your team".</p>
      <div className="owner-chat">
        {!messages.length && <Empty>No messages yet.</Empty>}
        {messages.map((m) => {
          const post = m.postId ? data.posts.find((p) => p.id === m.postId) : undefined;
          const video = m.videoId ? data.videos.find((v) => v.id === m.videoId) : undefined;
          const cover = video ? Object.values(video.renders ?? {})[0]?.cover : undefined;
          return (
            <div key={m.id} className={"oc-msg oc-" + m.role}>
              <span className="small faint">{m.role === "client" ? sc.name : m.role === "owner" ? "You" : "Assistant"} · {fmtDate(m.createdAt)} {new Date(m.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
              {(m.attachments ?? []).length > 0 && (
                <div className="row wrap">{m.attachments!.map((a) => a.kind === "audio"
                  ? <audio key={a.file} src={mediaUrl(a.file)} controls preload="none" />
                  : a.kind === "video"
                  ? <video key={a.file} src={mediaUrl(a.file)} className="oc-att" controls preload="metadata" />
                  : <img key={a.file} src={mediaUrl(a.file)} className="oc-att" alt={a.description || "Attached photo"} />)}</div>
              )}
              {m.status === "thinking" ? <span className="oc-bubble muted"><span className="spinner" aria-hidden /> Thinking…</span> : m.text && <span className="oc-bubble pre">{m.text}</span>}
              <span className="row wrap">
                {m.needsOwner && <Badge tone={m.seenByOwner ? "neutral" : "bad"}>needs you</Badge>}
                {m.action && m.role === "assistant" && <Badge>{{ media_post: "post from their photo/video", ai_post: "post with AI image", video_ad: "video ad", update_info: `updated ${m.updated?.join(", ") || "details"}`, answer: "answered" }[m.action] ?? m.action}</Badge>}
                {post?.imageFile && <img src={mediaUrl(post.imageFile)} alt="" className="oc-result" />}
                {cover && <img src={mediaUrl(cover)} alt="" className="oc-result" />}
                {(post?.status === "generating" || video?.status === "generating") && <span className="small muted"><span className="spinner" aria-hidden /> making it…</span>}
              </span>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="stack-sm">
        <TextArea id="oc-text" rows={2} value={text} onChange={setText} placeholder={`Write to ${sc.name}…`} />
        <div className="row"><Button kind="primary" busy={busy} disabled={!text.trim()} onClick={send}>Send as your team</Button></div>
      </div>
    </div>
  );
}

// ---------- Posts: ask for one ----------

function AskPost({ sc, act }: { sc: SClient; act: Act }) {
  const [text, setText] = useState("");
  const [image, setImage] = useState("");
  const [key, setKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!text.trim()) return toast("Write what the post should promote.");
    setBusy(true);
    const r = await act("POST", "/briefs", { clientId: sc.id, text: text.trim(), ...(image ? { image } : {}) }, "Making the post: text and a new image.");
    setBusy(false);
    if (r !== undefined) { setText(""); setImage(""); setKey((k) => k + 1); }
  };
  return (
    <div className="box stack-sm" style={{ marginBottom: 14 }}>
      <strong>Make a post for {sc.name}</strong>
      <div className="form-grid top">
        <Field label="What should it promote?" wide><TextArea id="ap-text" rows={2} value={text} onChange={setText} placeholder="Plátanos de Canarias a 1,50 €/kg esta semana" /></Field>
        <Field label="Photo (optional)" hint="Used as a reference for the new image.">
          <input key={key} className="input" type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImage(await downscale(f)); }} />
        </Field>
      </div>
      <div className="row"><Button kind="primary" busy={busy} onClick={go}>Make post</Button></div>
    </div>
  );
}

// ---------- Website ----------

const STYLE_OPTS: { value: NonNullable<Profile["style"]>; label: string }[] = [
  { value: "modern", label: "Modern: clean and minimal" }, { value: "warm", label: "Warm: friendly and welcoming" },
  { value: "bold", label: "Bold: bright colours, energetic" }, { value: "elegant", label: "Elegant: premium and refined" },
  { value: "natural", label: "Natural: fresh, green and light" },
];
const SOCIALS = [["instagram", "Instagram"], ["facebook", "Facebook"], ["tiktok", "TikTok"], ["google", "Google Maps"], ["tripadvisor", "Tripadvisor"]] as const;
const STEP_LABEL = (step?: string) => !step ? "" : step === "images" ? "Preparing the logo, photos and pictures" : step === "design" ? "The AI is designing the page" : step.startsWith("translating:") ? `Translating to ${step.split(":")[1].toUpperCase()}` : "Writing the page";

/** Read an image file as a data URL, scaled down (PNG keeps a logo's transparency). */
function readImage(file: File, max: number, type: "image/png" | "image/jpeg"): Promise<string> {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      const ctx = cv.getContext("2d")!;
      if (type === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); }
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url); ok(cv.toDataURL(type, 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error("That file isn't an image")); };
    img.src = url;
  });
}

/** New sign-ups wait here until you approve them. */
function ApprovalBanner({ sc, act }: { sc: SClient; act: Act }) {
  const pending = sc.approvalStatus === "pending";
  return (
    <div className="box approval-banner">
      <div className="stack-sm">
        <span className="strong">{pending ? "Waiting for your approval" : "Declined"}</span>
        <span className="small muted">{pending
          ? `Signed up ${sc.approval?.at ? fmtDate(sc.approval.at) : "recently"}. Check their details below. Until you approve, they can only fill in their information: no website, posts, videos or assistant.`
          : "They can't use the assistant, posts or videos. Approve them to turn everything on."}</span>
      </div>
      <span className="row wrap">
        <Button kind="primary" onClick={() => void act("POST", `/clients/${sc.id}/approve`, undefined, "Approved. Their website and first post are being made.")}>Approve</Button>
        {pending && <ConfirmButton label="Decline" confirm="Decline this business" onConfirm={() => void act("POST", `/clients/${sc.id}/decline`, undefined, "Declined")} />}
      </span>
    </div>
  );
}

/** How many posts and videos this business has had this week, and its limit. */
function WeeklyLimit({ sc, act }: { sc: SClient; act: Act }) {
  const u = sc.usage!;
  const [own, setOwn] = useState(u.custom);
  const [n, setN] = useState(String(u.cap));
  useEffect(() => { setOwn(u.custom); setN(String(u.cap)); }, [u.custom, u.cap]);
  const full = u.used >= u.cap;
  const save = () => void act("POST", `/clients/${sc.id}/cap`, { postCap: own ? Number(n) : null }, own ? "Limit saved for this business" : "Using your default limit");
  return (
    <div className="box stack-sm">
      <div className="row wrap between">
        <span className="stack-sm">
          <span className="small muted">Posts and videos this week</span>
          <span className="strong" style={{ fontSize: "1.25rem" }}>{u.used} of {u.cap}{full && <Badge tone="warn">Limit reached</Badge>}</span>
          {full && u.nextFreeAt && <span className="small faint">One more can be made {fmtDate(u.nextFreeAt)}. What you make yourself isn't limited.</span>}
        </span>
        <span className="row wrap">
          <label className="row small"><input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} /> Own limit</label>
          {own && <Input id="cap-n" type="number" min={0} step={1} value={n} onChange={setN} />}
          <Button small onClick={save} disabled={own === u.custom && (!own || String(u.cap) === n)}>Save</Button>
        </span>
      </div>
    </div>
  );
}

const SITE_IDEAS = ["Make the logo bigger", "Use darker, more elegant colours", "Change the main title to…", "Put a different photo in the hero", "Make the product cards show prices bigger", "Add a section about home delivery"];
const editStep = (st?: string) => (st?.startsWith("editing:") ? `Changing the ${st.slice(8).toUpperCase()} version` : "Working");

/** Chat with the AI to change the website, next to a live preview. */
function SiteChat({ sc, act }: { sc: SClient; act: Act }) {
  const [text, setText] = useState("");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [reload, setReload] = useState(0);
  const working = sc.siteEdit?.status === "working";
  const msgs = sc.siteChat ?? [];
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setReload((k) => k + 1), [sc.site?.editedAt, sc.site?.builtAt]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [msgs.length, working]);
  const send = async (m: string) => {
    const msg = m.trim();
    if (!msg || working) return;
    if ((await act("POST", `/clients/${sc.id}/site-chat`, { message: msg })) !== undefined) setText("");
  };
  return (
    <div className="sitechat">
      <div className="sitechat-preview">
        <div className="row between">
          <span className="strong">Live preview</span>
          <span className="seg-mini" role="group" aria-label="Preview size">
            {(["desktop", "phone"] as const).map((d) => <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)}>{d === "desktop" ? "Desktop" : "Phone"}</button>)}
          </span>
        </div>
        <div className={"sitechat-frame " + device}>
          <iframe key={reload} src={siteUrl(sc.site!.url!) + "?v=" + reload} title={`${sc.name} website preview`} />
        </div>
      </div>
      <div className="sitechat-panel">
        <div className="stack-sm">
          <span className="strong">Change it with AI</span>
          <span className="small muted">Ask for any change in your own words. It edits this website (every language) in about a minute, and you can undo.</span>
        </div>
        <div className="sitechat-msgs" ref={list} aria-live="polite">
          {!msgs.length && <div className="sitechat-ideas">{SITE_IDEAS.map((i) => <button key={i} type="button" className="chip" onClick={() => setText(i.replace("…", " "))}>{i}</button>)}</div>}
          {msgs.map((m) => (
            <div key={m.id} className={`sc-msg ${m.role}${m.status === "failed" ? " failed" : ""}`}>{m.text}</div>
          ))}
          {working && <div className="sc-msg ai"><span className="spinner" aria-hidden /> {editStep(sc.siteEdit?.step)}…</div>}
        </div>
        <div className="sitechat-input">
          <TextArea id="sc-text" rows={2} value={text} onChange={setText} placeholder="e.g. Make the hero title shorter and the buttons green" />
          <div className="row between">
            <Button small kind="ghost" disabled={working || !sc.siteVersions} onClick={() => void act("POST", `/clients/${sc.id}/site-undo`, undefined, "Last change undone")}>Undo last change</Button>
            <Button small kind="primary" busy={working} disabled={!text.trim()} onClick={() => void send(text)}>Send</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Website({ sc, act }: { sc: SClient; act: Act }) {
  const [domain, setDomain] = useState(sc.domain ?? "");
  const [p, setP] = useState<Profile>(() => structuredClone(sc.profile ?? {}));
  const [offer, setOffer] = useState(sc.offer ?? "");
  const [hours, setHours] = useState(sc.hours ?? "");
  const [logo, setLogo] = useState<string>("");
  const [removeLogo, setRemoveLogo] = useState(false);
  const [newPhotos, setNewPhotos] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [useLogoColors, setUseLogoColors] = useState(!sc.profile?.colors?.primary);
  const [busy, setBusy] = useState("");
  useEffect(() => { setP(structuredClone(sc.profile ?? {})); setOffer(sc.offer ?? ""); setHours(sc.hours ?? ""); }, [sc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const site = sc.site;
  const badDomain = !!domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain.replace(/^https?:\/\//, "").replace(/\/$/, ""));
  const services = p.services?.length ? p.services : [{ name: "", price: "", description: "" }];
  const setSvc = (i: number, k: keyof Service, val: string) => setP((x) => ({ ...x, services: services.map((s, j) => (j === i ? { ...s, [k]: val } : s)) }));
  const photos = (sc.photos ?? []).filter((x) => !removed.includes(x.file));
  const logoSrc = logo || (!removeLogo && sc.logoFile ? mediaUrl(sc.logoFile) : "");

  const save = async (newDesign: boolean) => {
    setBusy(newDesign ? "new" : "save");
    const r = await act("POST", `/clients/${sc.id}/profile`, {
      profile: { ...p, services: services.filter((s) => s.name.trim()), colors: useLogoColors ? { primary: "", accent: "" } : p.colors },
      offer, hours, ...(logo ? { logo } : {}), removeLogo: removeLogo && !logo, photos: newPhotos, removePhotos: removed, newDesign,
    }, newDesign ? "Saved. The AI is designing a new website (a few minutes)." : "Saved. Updating the website with the same design (a few minutes).");
    setBusy("");
    if (r !== undefined) { setLogo(""); setRemoveLogo(false); setNewPhotos([]); setRemoved([]); }
  };

  return (
    <div className="stack">
      <div className="box stack-sm">
        <div className="row wrap between">
          <span className="row wrap">
            <Badge tone={site?.status === "ready" ? "good" : (site?.status === "building" || site?.status === "waiting") ? "info" : "bad"}>{site ? { ready: "Live", building: "Being built", waiting: "Being built", failed: "Not built" }[site.status] : "No website"}</Badge>
            {site?.kind && <Badge tone={site.kind === "ai" ? "accent" : "neutral"}>{site.kind === "ai" ? "AI design" : "Template"}</Badge>}
            {site?.status === "building" && <span className="small muted"><span className="spinner" aria-hidden /> {STEP_LABEL(site.step)}…</span>}
            {site?.builtAt && site.status !== "building" && <span className="small muted">Last built {fmtDate(site.builtAt)}</span>}
          </span>
          {site?.url && (
            <span className="row wrap">
              <a className="btn btn-primary btn-sm" href={siteUrl(site.url)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Open website</a>
              <CopyButton text={siteUrl(site.url)} label="Copy link" />
            </span>
          )}
        </div>
        {site?.status === "ready" && site.url && <SiteQrCard client={sc} />}
        {site?.design && <span className="small faint">Design: {site.directionName ? <strong>{site.directionName}</strong> : null}{site.directionName ? " · " : ""}{site.design}</span>}
        {site?.note && <span className="small" style={{ color: "var(--warn)" }}>{site.note}</span>}
        {site?.error && <span className="small" style={{ color: "var(--bad)" }}>{site.error}</span>}
        <div className="row wrap">
          <Button small disabled={site?.status === "building"} onClick={() => void act("POST", `/clients/${sc.id}/site`, {}, "Updating the website with the same design")}>Update website</Button>
          <Button small kind="ghost" disabled={site?.status === "building"} onClick={() => void act("POST", `/clients/${sc.id}/site`, { newDesign: true }, "The AI is designing a new website")}>New AI design</Button>
        </div>
      </div>

      {site?.status === "ready" && site.url && site.kind === "ai" && <SiteChat sc={sc} act={act} />}

      <div className="form-grid top">
        <Field label="Their own domain" hint={badDomain ? "That doesn't look like a domain: it needs an ending such as .com or .es." : "Optional, e.g. fruterialagomera.com. Used for links, Google and social previews."}>
          <Input id="ws-domain" value={domain} onChange={setDomain} placeholder="minegocio.es" />
        </Field>
        <Field label=" "><Button disabled={badDomain} onClick={() => void act("POST", "/clients", { id: sc.id, domain: domain.trim() }, "Domain saved. Press Update website to use it.")}>Save domain</Button></Field>
      </div>

      <hr className="divider" />
      <h3>Brand</h3>
      <div className="row wrap" style={{ alignItems: "center", gap: 14 }}>
        <span className="logo-prev" style={logoSrc ? { backgroundImage: `url("${logoSrc}")` } : undefined}>{logoSrc ? "" : "No logo"}</span>
        <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
          {logoSrc ? "Change logo" : "Upload logo"}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (f) { try { setLogo(await readImage(f, 800, f.type === "image/jpeg" ? "image/jpeg" : "image/png")); setRemoveLogo(false); } catch (err) { toast((err as Error).message); } }
          }} />
        </label>
        {logoSrc && <Button small kind="ghost" onClick={() => { setLogo(""); setRemoveLogo(true); }}>Remove</Button>}
      </div>
      <div className="form-grid top">
        <Field label="Slogan"><Input id="ws-tag" value={p.tagline ?? ""} onChange={(v) => setP({ ...p, tagline: v.slice(0, 140) })} /></Field>
        <Field label="Style"><Select id="ws-style" value={p.style ?? "modern"} onChange={(v) => setP({ ...p, style: v })} options={STYLE_OPTS} /></Field>
        <Field label="Colours">
          <label className="row small"><input type="checkbox" checked={useLogoColors} onChange={(e) => setUseLogoColors(e.target.checked)} /> Use the logo's colours</label>
          {!useLogoColors && (
            <span className="row">
              <input type="color" aria-label="Main colour" value={p.colors?.primary || "#2f6b3b"} onChange={(e) => setP({ ...p, colors: { ...p.colors, primary: e.target.value } })} />
              <input type="color" aria-label="Accent colour" value={p.colors?.accent || "#e3b23c"} onChange={(e) => setP({ ...p, colors: { ...p.colors, accent: e.target.value } })} />
            </span>
          )}
        </Field>
      </div>

      <hr className="divider" />
      <h3>What they offer</h3>
      <div className="form-grid top">
        <Field label="Description (the AI writes from this)" wide><TextArea id="ws-offer" rows={3} value={offer} onChange={setOffer} /></Field>
      </div>
      <div className="stack-sm">
        <span className="small strong">Products and services with prices</span>
        {services.map((s, i) => (
          <div key={i} className="svc-row">
            <Input id={`ws-s${i}-n`} value={s.name} onChange={(v) => setSvc(i, "name", v.slice(0, 80))} placeholder="Name" />
            <Input id={`ws-s${i}-p`} value={s.price} onChange={(v) => setSvc(i, "price", v.slice(0, 40))} placeholder="Price, e.g. 1,50 €/kg" />
            <Input id={`ws-s${i}-d`} value={s.description} onChange={(v) => setSvc(i, "description", v.slice(0, 300))} placeholder="Short description (optional)" />
            <Button small kind="ghost" onClick={() => setP({ ...p, services: services.filter((_, j) => j !== i) })}>Remove</Button>
          </div>
        ))}
        <span><Button small disabled={services.length >= 12} onClick={() => setP({ ...p, services: [...services, { name: "", price: "", description: "" }] })}>Add product or service</Button></span>
      </div>
      <div className="form-grid top">
        <Field label="What makes them special" wide><TextArea id="ws-usps" rows={2} value={p.usps ?? ""} onChange={(v) => setP({ ...p, usps: v.slice(0, 900) })} /></Field>
        <Field label="Their story" wide><TextArea id="ws-story" rows={3} value={p.story ?? ""} onChange={(v) => setP({ ...p, story: v.slice(0, 1500) })} /></Field>
        <Field label="Since (year)"><Input id="ws-since" value={p.since ?? ""} onChange={(v) => setP({ ...p, since: v.slice(0, 40) })} /></Field>
      </div>

      <hr className="divider" />
      <h3>Where and when</h3>
      <div className="form-grid top">
        <Field label="Address" wide><Input id="ws-addr" value={p.address ?? ""} onChange={(v) => setP({ ...p, address: v.slice(0, 200) })} /></Field>
        <Field label="Opening hours" wide><Input id="ws-hours" value={hours} onChange={setHours} /></Field>
        <Field label="Booking link"><Input id="ws-book" value={p.bookingUrl ?? ""} onChange={(v) => setP({ ...p, bookingUrl: v })} placeholder="https://" /></Field>
        <Field label="Menu or catalogue link"><Input id="ws-menu" value={p.menuUrl ?? ""} onChange={(v) => setP({ ...p, menuUrl: v })} placeholder="https://" /></Field>
        {SOCIALS.map(([k, label]) => (
          <Field key={k} label={label}><Input id={`ws-soc-${k}`} value={p.social?.[k] ?? ""} onChange={(v) => setP({ ...p, social: { ...p.social, [k]: v } })} placeholder="https://" /></Field>
        ))}
        <Field label="Payment methods"><Input id="ws-pay" value={p.payment ?? ""} onChange={(v) => setP({ ...p, payment: v.slice(0, 200) })} /></Field>
        <Field label="Other useful details" wide><Input id="ws-extra" value={p.extras ?? ""} onChange={(v) => setP({ ...p, extras: v.slice(0, 900) })} placeholder="Parking, delivery, accessible, languages…" /></Field>
      </div>

      <hr className="divider" />
      <h3>Photos</h3>
      <div className="thumbs">
        {photos.map((ph) => (
          <span key={ph.file} className="thumb-btn" style={{ position: "relative" }} title={ph.description}>
            <img src={mediaUrl(ph.file)} alt={ph.description || "Photo"} />
            <button type="button" className="thumb-x" aria-label="Remove photo" onClick={() => setRemoved((r) => [...r, ph.file])}>×</button>
          </span>
        ))}
        {newPhotos.map((d, i) => (
          <span key={i} className="thumb-btn" style={{ position: "relative" }}>
            <img src={d} alt="New photo" />
            <button type="button" className="thumb-x" aria-label="Remove photo" onClick={() => setNewPhotos((x) => x.filter((_, j) => j !== i))}>×</button>
          </span>
        ))}
      </div>
      <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer", alignSelf: "flex-start" }}>
        Add photos
        <input type="file" accept="image/*" multiple hidden onChange={async (e) => {
          const files = [...(e.target.files ?? [])]; e.target.value = "";
          const room = 12 - photos.length - newPhotos.length;
          const out: string[] = [];
          for (const f of files.slice(0, Math.max(0, room))) { try { out.push(await readImage(f, 1600, "image/jpeg")); } catch { /* skip */ } }
          setNewPhotos((x) => [...x, ...out]);
        }} />
      </label>

      <div className="row wrap" style={{ marginTop: 6 }}>
        <Button kind="primary" busy={busy === "save"} disabled={!!busy} onClick={() => void save(false)}>Save and update website</Button>
        <Button busy={busy === "new"} disabled={!!busy} onClick={() => void save(true)}>Save with a new AI design</Button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>The business can fill all of this in themselves from their dashboard (Web › Complete your website), or send their logo in the chat.</p>
    </div>
  );
}

// ---------- Plan & billing ----------

function PlanTab({ client, invoices }: { client: Client; invoices: Invoice[] }) {
  const offer = useOffer();
  const [c, setC] = useState(client);
  const [busy, setBusy] = useState(false);
  useEffect(() => setC(client), [client.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(c) !== JSON.stringify(client);
  const save = async () => {
    if (c.stage === "paid" && !c.plan) return toast("Pick a plan for a paying business.");
    setBusy(true);
    await put("clients", c);
    if (c.studioId) await pushPlanToStudio(c, offer);
    setBusy(false);
    toast("Plan saved");
  };
  const paid = invoices.filter((i) => i.status === "paid").reduce((n, i) => n + invTotal(i), 0);
  return (
    <div className="stack">
      <PlanPicker c={c} offer={offer} onChange={(patch) => setC((x) => ({ ...x, ...patch }))} />
      <div className="row"><Button kind="primary" busy={busy} disabled={!dirty} onClick={save}>{dirty ? "Save plan" : "Saved"}</Button>
        {c.stage === "paid" && c.plan && <span className="small muted">{eur(Math.round(clientMonthly(c, offer)))} a month · {eur(withIgic(clientMonthly(c, offer)))} with IGIC</span>}</div>
      <hr className="divider" />
      <div className="row between wrap"><h3>Invoices</h3><span className="small muted">{eur(Math.round(paid))} paid so far</span></div>
      {invoices.length ? (
        <div className="stack-sm">{[...invoices].sort((a, b) => b.number.localeCompare(a.number)).map((i) => (
          <div key={i.id} className="box row between wrap">
            <span className="row wrap"><span className="mono">{i.number}</span><span className="small muted">{fmtDate(i.date)}</span></span>
            <span className="row wrap"><span className="tabular">{eur(invTotal(i))}</span><Badge tone={i.status === "paid" ? "good" : i.status === "sent" ? "warn" : "neutral"}>{i.status}</Badge></span>
          </div>
        ))}</div>
      ) : <Empty>No invoices yet. Create them each month in Billing.</Empty>}
      <div className="row"><Button small kind="ghost" onClick={() => navigate("billing")}>Go to billing</Button></div>
    </div>
  );
}

// ---------- Social accounts ----------

function Accounts({ sc, data, act }: { sc: SClient; data: StudioData; act: Act }) {
  const [c, setC] = useState<SClient>(sc);
  const [busy, setBusy] = useState(false);
  useEffect(() => setC(sc), [sc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const togglePlatform = (p: string) => setC((x) => ({ ...x, platforms: x.platforms.includes(p) ? x.platforms.filter((y) => y !== p) : [...x.platforms, p] }));
  return (
    <div className="stack">
      <Field label="Where they post">
        <div className="chips">{PLATFORMS.map((p) => {
          const on = c.platforms.includes(p);
          return <button key={p} type="button" className={"chip" + (on ? " chip-on" : "")} aria-pressed={on} onClick={() => togglePlatform(p)}>{p}</button>;
        })}</div>
      </Field>
      <label className="row small"><input type="checkbox" checked={c.autoPublish} onChange={(e) => setC({ ...c, autoPublish: e.target.checked })} /> Publish new posts straight to their connected accounts (otherwise they wait for you as Ready)</label>
      <AccountsEditor c={c} setC={setC} data={data} act={act} saved />
      <div className="row"><Button kind="primary" busy={busy} onClick={async () => {
        setBusy(true);
        await act("POST", "/clients", { id: c.id, accounts: c.accounts, platforms: c.platforms, autoPublish: c.autoPublish }, "Social accounts saved");
        setBusy(false);
      }}>Save social accounts</Button></div>
    </div>
  );
}

// ---------- Details ----------

function Details({ client, sc, act }: { client: Client; sc?: SClient; act: Act }) {
  const [c, setC] = useState(client);
  const [s, setS] = useState<SClient | undefined>(sc);
  const [busy, setBusy] = useState(false);
  useEffect(() => setC(client), [client.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setS(sc), [sc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof Client>(k: K, v: Client[K]) => setC((x) => ({ ...x, [k]: v }));
  const setSt = <K extends keyof SClient>(k: K, v: SClient[K]) => setS((x) => (x ? { ...x, [k]: v } : x));
  const save = async () => {
    if (!c.name.trim()) return toast("Give the business a name.");
    setBusy(true);
    await put("clients", c);
    if (s) {
      await act("POST", "/clients", {
        id: s.id, name: c.name, kind: c.kind, town: c.town, phone: c.phone, email: c.email ?? "", languages: c.languages,
        offer: s.offer, hours: s.hours, tone: s.tone, autopilot: s.autopilot, postsPerWeek: s.postsPerWeek, videosPerWeek: s.videosPerWeek, webhookUrl: s.webhookUrl,
      });
    }
    setBusy(false);
    toast("Saved");
  };
  return (
    <div className="stack">
      <div className="form-grid top">
        <Field label="Business name"><Input id="bd-name" value={c.name} onChange={(v) => set("name", v)} /></Field>
        <Field label="Type of business"><Input id="bd-kind" value={c.kind} onChange={(v) => set("kind", v)} /></Field>
        <Field label="Town"><Select id="bd-town" value={c.town} onChange={(v) => set("town", v)} options={TOWNS.includes(c.town) ? TOWNS : [c.town, ...TOWNS]} /></Field>
        <Field label="Contact person"><Input id="bd-contact" value={c.contact} onChange={(v) => set("contact", v)} /></Field>
        <Field label="Phone / WhatsApp"><Input id="bd-phone" value={c.phone} onChange={(v) => set("phone", v)} /></Field>
        <Field label="Email"><Input id="bd-email" value={c.email ?? ""} onChange={(v) => set("email", v)} /></Field>
        <Field label="Customer languages (first is the main one)" wide><LangPicker value={c.languages} onChange={(v) => set("languages", v as Lang[])} /></Field>
        {s && <>
          <Field label="What they sell (the AI writes from this)" wide><TextArea id="bd-offer" rows={3} value={s.offer} onChange={(v) => setSt("offer", v)} /></Field>
          <Field label="Opening hours"><Input id="bd-hours" value={s.hours} onChange={(v) => setSt("hours", v)} /></Field>
          <Field label="Tone of voice"><Input id="bd-tone" value={s.tone} onChange={(v) => setSt("tone", v)} /></Field>
          <Field label="Autopilot" hint="Makes posts on its own from their requests.">
            <label className="row"><input type="checkbox" checked={s.autopilot} onChange={(e) => setSt("autopilot", e.target.checked)} /> {s.autopilot ? "On" : "Off"}</label>
          </Field>
          <Field label="Posts a week"><Input id="bd-ppw" type="number" min={0} step={1} value={s.postsPerWeek} onChange={(v) => setSt("postsPerWeek", Math.max(0, Math.min(14, Math.round(Number(v) || 0))))} /></Field>
          <Field label="Video ads a week"><Input id="bd-vpw" type="number" min={0} step={1} value={s.videosPerWeek ?? 0} onChange={(v) => setSt("videosPerWeek", Math.max(0, Math.min(7, Math.round(Number(v) || 0))))} /></Field>
          <Field label="Webhook (optional)" hint="n8n, Make or Zapier can receive every published post." wide><Input id="bd-hook" value={s.webhookUrl} onChange={(v) => setSt("webhookUrl", v)} placeholder="https://..." /></Field>
        </>}
        <Field label="Your notes" wide><TextArea id="bd-notes" rows={2} value={c.notes ?? ""} onChange={(v) => set("notes", v)} /></Field>
      </div>
      <div className="row"><Button kind="primary" busy={busy} onClick={save}>Save details</Button></div>
      <hr className="divider" />
      <ConsentEditor consents={c.consents} onChange={(v) => set("consents", v)} />
      <hr className="divider" />
      <div className="row wrap">
        {s && <ConfirmButton label="New dashboard link and code" confirm="Replace them (the old link and code stop working)" onConfirm={() => void act("POST", `/clients/${s.id}/token`, undefined, "New dashboard link and code made. Send them the new code.")} />}
        <ConfirmButton label="Delete this business" confirm={s ? "Delete business, website and posts" : "Delete business"} onConfirm={async () => {
          if (s) await act("DELETE", `/clients/${s.id}`, undefined);
          await remove("clients", client.id);
          toast("Business deleted");
          navigate("clients");
        }} />
      </div>
    </div>
  );
}
