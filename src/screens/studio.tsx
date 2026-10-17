import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Page, Card, Button, Badge, Table, Tabs, Modal, Field, Input, TextArea, Select, LangPicker, LangTag,
  ConfirmButton, CopyButton, Stats, Stat, Empty, fmtDate, toast, type Tone,
} from "../core/ui";
import { useCollection } from "../core/store";
import type { Client as AppClient, Lang } from "../core/types";

// ---- Types (see studio API contract) ----
interface Site { status: "building" | "ready" | "failed"; url?: string; path?: string; builtAt?: string; error?: string; models?: unknown }
interface SClient {
  id: string; token: string; name: string; kind: string; town: string; phone: string; email: string; domain: string;
  offer: string; hours: string; tone: string; languages: string[]; platforms: string[]; autopilot: boolean;
  postsPerWeek: number; autoPublish: boolean; webhookUrl: string; siteSlug?: string; site?: Site; createdAt: string;
  source?: string; marketingConsent?: boolean;
}
interface Brief { id: string; clientId: string; text: string; createdAt: string; imageFile?: string; imageDescription?: string; archived?: boolean }
type PostStatus = "generating" | "ready" | "published" | "failed";
interface Post {
  id: string; clientId: string; briefId?: string; createdAt: string; status: PostStatus; reason?: string; concept?: string;
  imagePrompt?: string; captions?: Record<string, string>; hashtags?: string[]; cta?: string; imageFile?: string;
  model?: string; error?: string; publishNote?: string; publishedAt?: string;
}
interface StudioData { clients: SClient[]; briefs: Brief[]; posts: Post[]; ai: { openrouter: boolean }; images: string }

type Result<T> = { kind: "ok"; data: T } | { kind: "unreachable" } | { kind: "auth" } | { kind: "error"; message: string };

// ---- API helpers ----
const TOKEN_KEY = "isla:adminToken";
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } };
const saveToken = (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } };

const apiOrigin = /:8787$/.test(location.origin) ? location.origin : "http://localhost:8787";
const sameOrigin = apiOrigin === location.origin;
const assetUrl = (p: string) => (sameOrigin ? p : apiOrigin + p);
const mediaUrl = (file: string) => assetUrl("/media/" + file);
const siteUrl = (u: string) => (/^https?:/.test(u) ? u : assetUrl(u));

async function call<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const tok = readToken();
    if (tok) headers["x-admin-token"] = tok;
    const res = await fetch("/api/studio" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401) return { kind: "auth" };
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { return { kind: "unreachable" }; }
    if (!res.ok) {
      const m = (json as { error?: string } | null)?.error;
      return { kind: "error", message: m ?? `Request failed (${res.status})` };
    }
    return { kind: "ok", data: json as T };
  } catch {
    return { kind: "unreachable" };
  }
}

const PLATFORMS = ["instagram", "facebook", "google", "tiktok", "linkedin"];
const STATUS_TONE: Record<PostStatus, Tone> = { generating: "info", ready: "warn", published: "good", failed: "bad" };
const SITE_TONE: Record<string, Tone> = { building: "info", ready: "good", failed: "bad" };

const blankClient = (): SClient => ({
  id: "", token: "", name: "", kind: "", town: "", phone: "", email: "", domain: "", offer: "", hours: "", tone: "friendly, warm, simple",
  languages: ["es", "en"], platforms: ["instagram", "facebook"], autopilot: true, postsPerWeek: 3, autoPublish: false,
  webhookUrl: "", createdAt: "",
});

const isBusy = (d: StudioData | null) =>
  !!d && (d.posts.some((p) => p.status === "generating") || d.clients.some((c) => c.site?.status === "building"));

const weekAgo = () => Date.now() - 7 * 24 * 3600 * 1000;

function downscale(file: File, max = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Could not read the file"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not a usable image"));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        const ctx = cv.getContext("2d");
        if (!ctx) return reject(new Error("Canvas is not available"));
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

// ---- Screen ----
export default function Studio() {
  const [data, setData] = useState<StudioData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unreachable" | "auth">("loading");
  const [tab, setTab] = useState<"clients" | "feed" | "briefs">("clients");
  const [editing, setEditing] = useState<SClient | null>(null);
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
  const generating = data.posts.filter((p) => p.status === "generating").length;
  const live = data.clients.filter((c) => c.site?.status === "ready").length;

  return (
    <Page title="Content Studio" plan="Autopilot"
      intro="Clients get a website and fresh posts with a new image every time. Autopilot keeps posting while you do other things."
      actions={<>
        <Badge tone={data.ai.openrouter ? "accent" : "warn"}>{data.ai.openrouter ? "AI: OpenRouter free models" : "AI: template captions (no key)"}</Badge>
        <Badge>Images: Pollinations (free)</Badge>
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
          { id: "briefs", label: "Briefs", count: data.briefs.length },
        ]} />
        {tab === "clients" && <ClientsTab data={data} onEdit={(c) => setEditing(structuredClone(c))} />}
        {tab === "feed" && <FeedTab data={data} nameOf={nameOf} filter={feedClient} setFilter={setFeedClient} act={act} />}
        {tab === "briefs" && <BriefsTab data={data} nameOf={nameOf} clientId={briefClient} setClientId={setBriefClient} act={act} />}
      </Card>

      {editing && <ClientEditor client={editing} onClose={() => setEditing(null)} act={act} />}
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
          <div className="row wrap"><a className="mono" href="http://localhost:8787/signup" target="_blank" rel="noreferrer">http://localhost:8787/signup</a><CopyButton text="http://localhost:8787/signup" /></div>
        </div>
        <div className="row"><Button kind="primary" onClick={onRetry}>Try again</Button></div>
      </div>
    </Card>
  );
}

function TokenCard({ onSaved }: { onSaved: () => void }) {
  const [t, setT] = useState(readToken());
  return (
    <Card title="Admin token needed">
      <div className="stack">
        <p className="muted">This server asks for an admin token. Enter the ADMIN_TOKEN value from your .env file. It is kept in this browser only.</p>
        <Field label="Admin token"><Input id="studio-token" type="password" value={t} onChange={setT} /></Field>
        <div className="row"><Button kind="primary" onClick={() => { saveToken(t.trim()); onSaved(); }}>Save and continue</Button></div>
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
        { label: "Autopilot", render: (c) => c.autopilot && c.postsPerWeek > 0 ? <Badge tone="accent">{c.postsPerWeek} / week</Badge> : <span className="faint">Off</span> },
        { label: "Last post", render: (c) => { const d = lastPost(c.id); return d ? fmtDate(d) : <span className="faint">None</span>; } },
      ]} />
  );
}

// ---- Client editor ----
type Act = (method: string, path: string, body?: unknown, okMsg?: string) => Promise<unknown>;

function ClientEditor({ client, onClose, act }: { client: SClient; onClose: () => void; act: Act }) {
  const [c, setC] = useState<SClient>(client);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState("");
  const appClients = useCollection<AppClient>("clients");
  const isNew = !client.id;
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

  const save = async () => {
    if (!c.name.trim()) return toast("Give the business a name first.");
    setBusy(true);
    const { site: _s, token: _t, createdAt: _c, id, ...rest } = c;
    const payload = isNew ? { ...rest, buildSite: true } : { id, ...rest };
    const r = await act("POST", "/clients", payload, isNew ? "Client added. Building the website." : "Client saved");
    setBusy(false);
    if (r !== undefined) onClose();
  };
  const togglePlatform = (p: string) => set("platforms", c.platforms.includes(p) ? c.platforms.filter((x) => x !== p) : [...c.platforms, p]);

  return (
    <Modal open title={isNew ? "New client" : c.name} onClose={onClose}
      footer={<>
        {!isNew && <ConfirmButton label="Delete" confirm="Delete for good" onConfirm={async () => { await act("DELETE", `/clients/${c.id}`, undefined, "Client deleted"); onClose(); }} />}
        {!isNew && <Button small kind="ghost" onClick={() => void act("POST", `/clients/${c.id}/site`, undefined, "Rebuilding the website")}>Rebuild website</Button>}
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
          <Field label="Autopilot" hint="Posts on its own from the client's briefs.">
            <label className="row"><input type="checkbox" checked={c.autopilot} onChange={(e) => set("autopilot", e.target.checked)} /> <span>{c.autopilot ? "On" : "Off"}</span></label>
          </Field>
          <Field label="Posts per week (0 to 14)">
            <Input id="s-ppw" type="number" min={0} step={1} value={c.postsPerWeek}
              onChange={(v) => set("postsPerWeek", Math.max(0, Math.min(14, Math.round(Number(v) || 0))))} />
          </Field>
          <Field label="Auto-publish" hint="Off means posts wait for approval as Ready.">
            <label className="row"><input type="checkbox" checked={c.autoPublish} onChange={(e) => set("autoPublish", e.target.checked)} /> <span>{c.autoPublish ? "On" : "Off"}</span></label>
          </Field>
          <Field label="Webhook URL" hint="Publishing sends the post here. n8n, Make or Zapier can pick it up and post to Instagram or Facebook." wide>
            <Input id="s-hook" value={c.webhookUrl} onChange={(v) => set("webhookUrl", v)} placeholder="https://..." />
          </Field>
        </div>
        {c.site?.error && <p className="small" style={{ color: "var(--bad)" }}>Website: {c.site.error}</p>}
      </div>
    </Modal>
  );
}

// ---- Feed tab ----
function FeedTab({ data, nameOf, filter, setFilter, act }: {
  data: StudioData; nameOf: (id: string) => string; filter: string; setFilter: (v: string) => void; act: Act;
}) {
  const posts = useMemo(
    () => data.posts.filter((p) => !filter || p.clientId === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.posts, filter],
  );
  return (
    <div className="stack" style={{ marginTop: 14 }}>
      <div style={{ maxWidth: 320 }}>
        <Select id="s-feed-filter" value={filter} onChange={setFilter}
          options={[{ value: "", label: "All clients" }, ...data.clients.map((c) => ({ value: c.id, label: c.name }))]} />
      </div>
      {!posts.length ? <Empty>No posts yet. Add a brief, or wait for autopilot.</Empty> : (
        <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>{posts.map((p) => <PostCard key={p.id} p={p} name={nameOf(p.clientId)} act={act} />)}</div>
      )}
    </div>
  );
}

function PostCard({ p, name, act }: { p: Post; name: string; act: Act }) {
  const langs = Object.keys(p.captions ?? {});
  const [lang, setLang] = useState(langs[0] ?? "");
  const cur = langs.includes(lang) ? lang : langs[0];
  const hashtags = (p.hashtags ?? []).map((h) => (h.startsWith("#") ? h : "#" + h)).join(" ");
  return (
    <div className="box stack" style={{ padding: 0, overflow: "hidden" }}>
      {p.status === "generating" ? (
        <div className="row" style={{ aspectRatio: "1 / 1", justifyContent: "center", background: "var(--surface-2)" }}>
          <span className="muted"><span className="spinner" aria-hidden /> Drawing the image...</span>
        </div>
      ) : p.imageFile ? (
        <img src={mediaUrl(p.imageFile)} alt={p.concept ?? "Post image"} loading="lazy" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
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
        {p.cta && <span className="small"><span className="faint">Call to action:</span> {p.cta}</span>}
        {p.model && <span className="small faint mono">{p.model}</span>}
        {p.publishNote && <span className="small muted">{p.publishNote}</span>}
        {p.error && <span className="small" style={{ color: "var(--bad)" }}>{p.error}</span>}
        <div className="row wrap">
          {p.status !== "generating" && <Button small onClick={() => void act("POST", `/posts/${p.id}/again`, undefined, "Making another version")}>Another version</Button>}
          {p.status === "failed" && <Button small onClick={() => void act("POST", `/posts/${p.id}/retry`, undefined, "Trying again")}>Retry</Button>}
          {p.status === "ready" && <Button small kind="primary" onClick={() => void act("POST", `/posts/${p.id}/publish`, undefined, "Published")}>Publish</Button>}
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
