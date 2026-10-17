// Plan 4 · Multilingual Listing Kits: intake -> features -> portal copy -> reel -> posts -> compliance -> delivery.
import { useState, type ChangeEvent } from "react";
import {
  Page, Card, Button, Field, Input, TextArea, Select, Form, Tabs, Badge, Stat, Stats, Table, Empty, AiOutput,
  CopyButton, LangPicker, LangTag, ClientPicker, ConfirmButton, toast, fmtDate, type Tone,
} from "../core/ui";
import { useCollection, put, create, remove, now, getAll } from "../core/store";
import { aiJson, aiText } from "../core/ai";
import { eur, IGIC, TOWNS, PLANS, LANGS } from "../core/plans";
import { EX, example, dayOffset } from "../core/seed";
import type { Client, Lang, Task } from "../core/types";
import {
  COL, KIT_LANGS, DEFAULT_LANGS, TYPES, ENERGY, MUSIC, PORTALS, KNOWN_FEATURES, QA_ITEMS, VV_RE,
  portalById, portalsFor, tierOf, thisMonth, demoCopy, demoShorten, demoExtraction, demoReel, demoPosts,
  kitFacts, langNames, compliance,
  type Kit, type Kind, type KitStatus, type PortalId, type Photo, type Copy, type Reel, type SocialPost, type Extraction,
} from "./listings-data";

const STATUSES: { id: KitStatus; label: string }[] = [
  { id: "draft", label: "Draft" }, { id: "qa", label: "QA" }, { id: "signoff", label: "Client sign-off" }, { id: "delivered", label: "Delivered" },
];
const statusTone: Record<KitStatus, Tone> = { draft: "neutral", qa: "info", signoff: "warn", delivered: "good" };
const statusLabel = (s: KitStatus) => STATUSES.find((x) => x.id === s)!.label;
const save = (k: Kit, patch: Partial<Kit>) => put<Kit>(COL, { ...k, ...patch });

type TabId = "kits" | "new" | "limits" | "quota";

export default function Screen() {
  const kits = useCollection<Kit>(COL);
  const clients = useCollection<Client>("clients");
  const [tab, setTab] = useState<TabId>("kits");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = kits.find((k) => k.id === openId);

  return (
    <Page plan="Plan 4 · Multilingual Listing Kits" title="Listing kits"
      intro="Turn an agent's photos and voice note into portal-ready copy in five languages, a captioned reel and two posts. Nothing goes out without QA, compliance and client sign-off.">
      <Tabs<TabId> value={tab} onChange={(t) => { setTab(t); setOpenId(null); }} tabs={[
        { id: "kits", label: "Kits", count: kits.length }, { id: "new", label: "New kit" },
        { id: "limits", label: "Portal limits" }, { id: "quota", label: "Quotas" },
      ]} />
      {tab === "kits" && (open
        ? <KitDetail kit={open} client={clients.find((c) => c.id === open.clientId)} onBack={() => setOpenId(null)} />
        : <KitList kits={kits} clients={clients} onOpen={setOpenId} onNew={() => setTab("new")} />)}
      {tab === "new" && <NewKit clients={clients} kits={kits} onCreated={(id) => { setTab("kits"); setOpenId(id); }} />}
      {tab === "limits" && <Limits />}
      {tab === "quota" && <Quotas clients={clients} kits={kits} />}
    </Page>
  );
}

// --- List ----------------------------------------------------------------------------------------

function KitList(props: { kits: Kit[]; clients: Client[]; onOpen: (id: string) => void; onNew: () => void }) {
  const { kits, clients } = props;
  const name = (id: string) => clients.find((c) => c.id === id)?.name ?? "Unknown client";
  const month = thisMonth();
  const blocked = kits.filter((k) => k.status !== "delivered" && compliance(k, false).some((c) => !c.ok && (c.id === "energy" || c.id === "vv"))).length;
  return (
    <>
      <Stats>
        <Stat label="Draft" value={kits.filter((k) => k.status === "draft").length} />
        <Stat label="In QA" value={kits.filter((k) => k.status === "qa").length} tone="accent" />
        <Stat label="Waiting on client" value={kits.filter((k) => k.status === "signoff").length} tone="warn" />
        <Stat label="Delivered this month" value={kits.filter((k) => k.status === "delivered" && k.month === month).length} tone="good" />
        <Stat label="Compliance blocks" value={blocked} tone={blocked ? "bad" : undefined} sub="Missing certificate or VV number" />
      </Stats>
      <Card title="All kits">
        <Table rows={kits} rowKey={(k) => k.id} onRow={(k) => props.onOpen(k.id)}
          empty={<Empty action={<Button kind="primary" onClick={props.onNew}>Start a kit</Button>}>No kits yet. Start one from an agent's photos and voice note.</Empty>}
          cols={[
            { label: "Ref", render: (k) => <span className="mono">{k.ref}</span> },
            { label: "Property", render: (k) => <div className="stack-sm"><span className="strong">{k.type} · {k.town}</span><span className="small muted">{name(k.clientId)}</span></div> },
            { label: "Type", render: (k) => <Badge tone={k.kind === "sale" ? "info" : "accent"}>{k.kind === "sale" ? "Sale" : "Holiday rental"}</Badge> },
            { label: "Price", num: true, render: (k) => k.kind === "sale" ? eur(k.price) : `${eur(k.price)}/night` },
            { label: "Languages", render: (k) => <span className="row wrap">{k.langs.map((l) => <LangTag key={l} lang={l} />)}</span> },
            { label: "Status", render: (k) => <Badge tone={statusTone[k.status]}>{statusLabel(k.status)}</Badge> },
            { label: "Month", render: (k) => <span className="small muted">{k.month}</span> },
          ]} />
      </Card>
    </>
  );
}

// --- Intake --------------------------------------------------------------------------------------

async function makeThumb(file: File): Promise<string | undefined> {
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("load")); img.src = url; });
    const s = 96 / Math.max(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return c.toDataURL("image/jpeg", 0.6);
  } catch { return undefined; }
}
const MAX_PHOTOS = 20;
async function readPhotos(e: ChangeEvent<HTMLInputElement>, have: Photo[]): Promise<Photo[]> {
  const files = [...(e.target.files ?? [])].filter((f) => f.type.startsWith("image/"));
  e.target.value = "";
  const room = MAX_PHOTOS - have.length;
  if (files.length > room) toast(`Kept the first ${room} photos. A kit holds ${MAX_PHOTOS}.`);
  const out: Photo[] = [];
  for (const f of files.slice(0, Math.max(0, room))) out.push({ name: f.name, thumb: await makeThumb(f) });
  return [...have, ...out];
}

function PhotoStrip(props: { photos: Photo[]; order?: string[]; onRemove?: (name: string) => void }) {
  const list = props.order ? props.order.map((n) => props.photos.find((p) => p.name === n)).filter((p): p is Photo => !!p) : props.photos;
  if (!list.length) return <p className="small faint">No photos yet.</p>;
  return (
    <div className="row wrap">
      {list.map((p, i) => (
        <div key={p.name} className="stack-sm" style={{ width: 84 }}>
          {p.thumb
            ? <img src={p.thumb} alt={p.name} style={{ width: 84, height: 60, objectFit: "cover", borderRadius: 4 }} />
            : <div className="box small faint" style={{ width: 84, height: 60 }}>No preview</div>}
          <span className="small faint mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>{i + 1}. {p.name}</span>
          {props.onRemove && <Button small kind="ghost" onClick={() => props.onRemove!(p.name)}>Remove</Button>}
        </div>
      ))}
    </div>
  );
}

interface Draft {
  clientId: string; kind: Kind; type: string; town: string; price: string; beds: string; baths: string; m2: string;
  features: string; transcript: string; energyRating: string; energyCertNo: string; vvNumber: string; langs: Lang[]; photos: Photo[];
}
const blank = (clientId: string): Draft => ({
  clientId, kind: "sale", type: "Apartment", town: "Costa Adeje", price: "", beds: "2", baths: "1", m2: "",
  features: "", transcript: "", energyRating: "", energyCertNo: "", vvNumber: "", langs: DEFAULT_LANGS, photos: [],
});

function NewKit(props: { clients: Client[]; kits: Kit[]; onCreated: (id: string) => void }) {
  const first = props.clients.find((c) => c.subs.some((s) => s.plan === "p4")) ?? props.clients[0];
  const [draft, setD] = useState<Draft>(() => blank(first?.id ?? ""));
  const d: Draft = { ...draft, clientId: draft.clientId || first?.id || "" };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, clientId: x.clientId || first?.id || "", [k]: v }));
  const client = props.clients.find((c) => c.id === d.clientId);
  const tier = tierOf(client);
  const used = props.kits.filter((k) => k.clientId === d.clientId && k.month === thisMonth()).length;
  const full = used >= tier.cap;

  if (!props.clients.length) return <Empty>Add a client first (Clients & pipeline), then start a kit for them.</Empty>;

  const submit = async () => {
    if (!d.clientId) return toast("Pick a client.");
    if (full) return toast(`${client?.name} has used ${used} of ${tier.cap} kits this month.`);
    if (!Number(d.price)) return toast("Add the price.");
    if (!d.langs.length) return toast("Pick at least one language.");
    const n = props.kits.filter((k) => k.clientId === d.clientId).length + 1;
    const prefix = (client?.name ?? "KIT").split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase();
    const k = await create<Kit>(COL, {
      clientId: d.clientId, ref: `${prefix}-${String(n).padStart(3, "0")}`, kind: d.kind, type: d.type, town: d.town,
      price: Number(d.price), beds: Number(d.beds) || 0, baths: Number(d.baths) || 0, m2: Number(d.m2) || 0,
      features: d.features.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean),
      photos: d.photos, transcript: d.transcript.trim(),
      energyRating: d.kind === "sale" ? d.energyRating || undefined : undefined,
      energyCertNo: d.kind === "sale" ? d.energyCertNo.trim() || undefined : undefined,
      vvNumber: d.kind === "holiday" ? d.vvNumber.trim().toUpperCase() || undefined : undefined,
      langs: d.langs, portals: portalsFor(d.kind), status: "draft", qa: [], month: thisMonth(),
    });
    toast(`Kit ${k.ref} created. Run feature extraction next.`);
    setD(blank(d.clientId));
    props.onCreated(k.id);
  };

  return (
    <div className="split">
      <Card title="Quota">
        <Field label="Client"><ClientPicker id="lk-client" clients={props.clients} value={d.clientId} onChange={(v) => set("clientId", v)} /></Field>
        <div className="stack-sm">
          <div className="row between"><span className="strong">{tier.tier}</span><span className="small muted">{used} / {tier.cap} this month</span></div>
          <div className="bar"><span style={{ width: `${tier.cap ? Math.min(100, (used / tier.cap) * 100) : 100}%` }} /></div>
          {full && <p className="small" style={{ color: "var(--bad)" }}>Quota used. Upgrade the tier or wait for next month.</p>}
          {!tier.reels && tier.cap > 0 && <p className="small muted">This tier includes copy and posts, no reels.</p>}
        </div>
        <p className="small muted">Intake normally arrives from the shared Drive folder or form. Fill it here by hand when the agent sends it on WhatsApp.</p>
      </Card>
      <Card title="Property intake">
        <Form onSubmit={submit}>
          <Field label="Listing"><Select<Kind> id="lk-kind" value={d.kind} onChange={(v) => set("kind", v)} options={[{ value: "sale", label: "For sale" }, { value: "holiday", label: "Holiday rental (VV)" }]} /></Field>
          <Field label="Type"><Select id="lk-type" value={d.type} onChange={(v) => set("type", v)} options={TYPES} /></Field>
          <Field label="Town"><Select id="lk-town" value={d.town} onChange={(v) => set("town", v)} options={TOWNS} /></Field>
          <Field label={d.kind === "sale" ? "Price (EUR)" : "Price per night (EUR)"}><Input id="lk-price" type="number" min={0} value={d.price} onChange={(v) => set("price", v)} /></Field>
          <Field label="Bedrooms"><Input id="lk-beds" type="number" min={0} value={d.beds} onChange={(v) => set("beds", v)} /></Field>
          <Field label="Bathrooms"><Input id="lk-baths" type="number" min={0} value={d.baths} onChange={(v) => set("baths", v)} /></Field>
          <Field label="Built m²"><Input id="lk-m2" type="number" min={0} value={d.m2} onChange={(v) => set("m2", v)} /></Field>
          {d.kind === "sale" ? (
            <>
              <Field label="Energy rating"><Select id="lk-er" value={d.energyRating} onChange={(v) => set("energyRating", v)} options={[{ value: "", label: "Not yet" }, ...ENERGY]} /></Field>
              <Field label="Energy certificate no." hint="Required before delivery"><Input id="lk-ec" value={d.energyCertNo} onChange={(v) => set("energyCertNo", v)} placeholder="CEE-38-2026-..." /></Field>
            </>
          ) : (
            <Field label="VV registration no." hint="Required before delivery"><Input id="lk-vv" value={d.vvNumber} onChange={(v) => set("vvNumber", v)} placeholder="VV-38-4-0012345" /></Field>
          )}
          <Field label="Features" wide hint={`Comma separated. Known: ${KNOWN_FEATURES.join(", ")}`}>
            <Input id="lk-feat" value={d.features} onChange={(v) => set("features", v)} placeholder="sea view, terrace, communal pool" />
          </Field>
          <Field label="Voice-note transcript" wide hint="Paste the transcript of the agent's voice note. The vision agent reads it with the photo names.">
            <TextArea id="lk-tr" rows={4} value={d.transcript} onChange={(v) => set("transcript", v)} placeholder="Tercera planta, orientación sur, terraza grande con vistas al mar..." />
          </Field>
          <Field label="Photos" wide hint={`Up to ${MAX_PHOTOS}. Only file names and small thumbnails are kept.`}>
            <input className="input" type="file" accept="image/*" multiple onChange={async (e) => set("photos", await readPhotos(e, d.photos))} />
          </Field>
          <div className="field-wide"><PhotoStrip photos={d.photos} onRemove={(n) => set("photos", d.photos.filter((p) => p.name !== n))} /></div>
          <Field label="Languages" wide><LangPicker value={d.langs} onChange={(v) => set("langs", v)} options={KIT_LANGS} /></Field>
          <div className="field-wide row"><Button kind="primary" type="submit" disabled={full}>Create kit</Button></div>
        </Form>
      </Card>
    </div>
  );
}

// --- Detail --------------------------------------------------------------------------------------

type DetailTab = "intake" | "copy" | "reel" | "social" | "deliver";

function KitDetail(props: { kit: Kit; client?: Client; onBack: () => void }) {
  const { kit, client } = props;
  const tier = tierOf(client);
  const [tab, setTab] = useState<DetailTab>("intake");
  const idx = STATUSES.findIndex((s) => s.id === kit.status);
  return (
    <>
      <Card title={<span className="row wrap"><span className="mono">{kit.ref}</span> {kit.type} · {kit.town}</span>}
        aside={<>
          <Button small kind="ghost" onClick={props.onBack}>All kits</Button>
          <ConfirmButton label="Delete" confirm="Delete kit" onConfirm={async () => { await remove(COL, kit.id); props.onBack(); toast("Kit deleted."); }} />
        </>}>
        <div className="row wrap">
          {STATUSES.map((s, i) => <Badge key={s.id} tone={i < idx ? "good" : i === idx ? statusTone[s.id] : "neutral"}>{i + 1}. {s.label}</Badge>)}
        </div>
        <div className="row wrap small muted">
          <span>{client?.name ?? "Unknown client"} · {tier.tier}</span>
          <span>{kit.kind === "sale" ? eur(kit.price) : `${eur(kit.price)} per night`}</span>
          <span>{kit.beds} bed · {kit.baths} bath · {kit.m2} m²</span>
          <span>{kit.kind === "sale" ? `Energy ${kit.energyRating ?? "missing"}` : kit.vvNumber ?? "VV number missing"}</span>
        </div>
      </Card>
      <Tabs<DetailTab> value={tab} onChange={setTab} tabs={[
        { id: "intake", label: "Intake & features" }, { id: "copy", label: "Portal copy" },
        { id: "reel", label: "Reel" }, { id: "social", label: "Social posts", count: kit.posts?.length },
        { id: "deliver", label: "Compliance & delivery" },
      ]} />
      {tab === "intake" && <IntakeTab kit={kit} />}
      {tab === "copy" && <CopyTab kit={kit} />}
      {tab === "reel" && <ReelTab kit={kit} reels={tier.reels} branded={tier.branded} />}
      {tab === "social" && <SocialTab kit={kit} />}
      {tab === "deliver" && <DeliverTab kit={kit} client={client} reels={tier.reels} />}
    </>
  );
}

function IntakeTab({ kit }: { kit: Kit }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [feat, setFeat] = useState(kit.features.join(", "));
  const ex = kit.extraction;

  const run = async () => {
    setBusy(true);
    const r = await aiJson<Omit<Extraction, "live" | "at">>(
      `You are the vision agent for a property listing kit. You cannot see the photos, only their file names, plus the agent's voice-note transcript.\n` +
      `Facts: ${kitFacts(kit)}\nPhoto file names: ${JSON.stringify(kit.photos.map((p) => p.name))}\n` +
      `1) List features clearly supported by the transcript or photo names, in lowercase English, preferring: ${KNOWN_FEATURES.join(", ")}.\n` +
      `2) Order the photo names for a listing: best exterior/view first, then living, kitchen, bedrooms, bathrooms, rest.\n` +
      `3) One sentence on what to lead with. 4) List facts that are missing before copy can be written (energy certificate for sales, VV number for holiday rentals, floor, orientation, photo count).\n` +
      `JSON shape: {"features": string[], "photoOrder": string[], "highlights": string, "missing": string[]}`,
      () => demoExtraction(kit),
    );
    setBusy(false); setError(r.error);
    await save(kit, { extraction: { ...r.data, live: r.live, at: now() } });
  };

  return (
    <div className="grid-2">
      <Card title="Photos and voice note" aside={
        <label className="btn btn-secondary btn-sm">Add photos
          <input type="file" accept="image/*" multiple hidden onChange={async (e) => save(kit, { photos: await readPhotos(e, kit.photos) })} />
        </label>}>
        <PhotoStrip photos={kit.photos} order={ex?.photoOrder?.length === kit.photos.length ? ex.photoOrder : undefined}
          onRemove={(n) => save(kit, { photos: kit.photos.filter((p) => p.name !== n) })} />
        <div className="box small pre">{kit.transcript || "No transcript yet."}</div>
        <Field label="Features on the fact sheet" hint="Comma separated. These drive every text.">
          <Input id="lk-feat-edit" value={feat} onChange={setFeat} />
        </Field>
        <div className="row"><Button small onClick={() => save(kit, { features: feat.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean) }).then(() => toast("Features saved."))}>Save features</Button></div>
      </Card>
      <Card title="Feature extraction" aside={<Button kind="primary" small busy={busy} onClick={run}>{ex ? "Run again" : "Extract features"}</Button>}>
        {!ex && <Empty>Reads the voice note and photo names, orders the photos and lists what is missing.</Empty>}
        {ex && (
          <div className="stack">
            <div className="row"><Badge tone={ex.live ? "accent" : "neutral"}>{ex.live ? "AI draft" : "Demo draft"}</Badge><span className="small faint">{fmtDate(ex.at)}</span></div>
            {error && <p className="small" style={{ color: "var(--warn)" }}>{error}</p>}
            <div className="stack-sm"><span className="small strong">Features found</span>
              <div className="row wrap">{ex.features.map((f) => <Badge key={f} tone={kit.features.includes(f) ? "good" : "info"}>{f}</Badge>)}</div>
            </div>
            <p className="small">{ex.highlights}</p>
            {ex.missing.length > 0 && <div className="stack-sm"><span className="small strong">Missing</span>
              {ex.missing.map((m) => <span key={m} className="small" style={{ color: "var(--warn)" }}>{m}</span>)}</div>}
            <div className="row wrap">
              <Button small onClick={async () => { const f = [...new Set([...kit.features, ...ex.features])]; setFeat(f.join(", ")); await save(kit, { features: f }); toast("Features added to the fact sheet."); }}>Add features to fact sheet</Button>
              <Button small kind="ghost" onClick={async () => {
                const ordered = ex.photoOrder.map((n) => kit.photos.find((p) => p.name === n)).filter((p): p is Photo => !!p);
                const rest = kit.photos.filter((p) => !ex.photoOrder.includes(p.name));
                await save(kit, { photos: [...ordered, ...rest] }); toast("Photo order applied.");
              }}>Apply photo order</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function CopyTab({ kit }: { kit: Kit }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const portals = kit.portals.map(portalById);

  const generate = async () => {
    if (kit.kind === "sale" && !kit.energyRating) toast("Energy rating missing. Copy will leave it out and delivery stays blocked.");
    if (kit.kind === "holiday" && !kit.vvNumber) toast("VV number missing. Delivery stays blocked until it is added.");
    setBusy(true);
    const r = await aiJson<Copy>(
      `Write property listing descriptions for each portal and language.\nFacts (use only these, never invent a feature, distance or price): ${kitFacts(kit)}\n` +
      `Portals with hard character limits (count every character including spaces; stay under 90% of the limit):\n` +
      portals.map((p) => `- ${p.id}: ${p.name}, max ${p.limit} characters, ${p.style}`).join("\n") +
      `\nLanguages: ${langNames(kit.langs)}. Native-quality copy written for buyers or guests from each country, not literal translation.\n` +
      (kit.kind === "holiday" ? `Every description must contain the registration number ${kit.vvNumber ?? "(missing: leave a placeholder [VV])"} as Canary law requires.\n` : `State the energy rating ${kit.energyRating ?? "(missing: leave a placeholder [ENERGY])"}.\n`) +
      `JSON shape: {${portals.map((p) => `"${p.id}": {${kit.langs.map((l) => `"${l}": string`).join(", ")}}`).join(", ")}}`,
      () => demoCopy(kit, kit.portals, kit.langs),
      { tier: "complex" },
    );
    setBusy(false); setError(r.error);
    await save(kit, { copy: r.data, copyLive: r.live });
  };

  const togglePortal = (id: PortalId) =>
    save(kit, { portals: kit.portals.includes(id) ? kit.portals.filter((p) => p !== id) : [...kit.portals, id] });

  return (
    <>
      <Card title="Portals and languages" aside={<Button kind="primary" busy={busy} onClick={generate}>{kit.copy ? "Rewrite all" : "Write all descriptions"}</Button>}>
        <div className="chips">
          {PORTALS.map((p) => {
            const on = kit.portals.includes(p.id);
            return <button key={p.id} type="button" className={"chip" + (on ? " chip-on" : "")} aria-pressed={on} onClick={() => togglePortal(p.id)}>{p.name} · {p.limit}</button>;
          })}
        </div>
        <LangPicker value={kit.langs} onChange={(v) => save(kit, { langs: v })} options={KIT_LANGS} />
        <p className="small muted">{kit.portals.length * kit.langs.length} texts. Limits are characters for the description field.</p>
        {kit.copy && <div className="row"><Badge tone={kit.copyLive ? "accent" : "neutral"}>{kit.copyLive ? "AI draft" : "Demo draft"}</Badge>{error && <span className="small" style={{ color: "var(--warn)" }}>{error}</span>}</div>}
      </Card>
      {!kit.copy && <Empty>No descriptions yet. Write all of them in one go, then fix any text that runs over a limit.</Empty>}
      {kit.copy && portals.map((p) => (
        <Card key={p.id} title={p.name} aside={<span className="small muted">Limit {p.limit} characters</span>}>
          <div className="grid-2">
            {kit.langs.map((l) => <CopyEditor key={l} kit={kit} portal={p.id} lang={l} />)}
          </div>
        </Card>
      ))}
    </>
  );
}

function CopyEditor({ kit, portal, lang }: { kit: Kit; portal: PortalId; lang: Lang }) {
  const saved = kit.copy?.[portal]?.[lang] ?? "";
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);
  const limit = portalById(portal).limit;
  const over = text.length > limit;
  const dirty = text !== saved;
  const persist = (t: string) => save(kit, { copy: { ...kit.copy, [portal]: { ...(kit.copy?.[portal] ?? {}), [lang]: t } } });

  const shorten = async () => {
    setBusy(true);
    const keep = kit.kind === "holiday" ? kit.vvNumber : undefined;
    const r = await aiText(
      `Shorten this ${LANGS[lang]} ${portalById(portal).name} property description to under ${Math.floor(limit * 0.9)} characters. ` +
      `Keep the price, rooms and ${keep ? `the registration number ${keep}` : "the energy rating"}. Do not add facts. Reply with the text only.\n\n${text}`,
      () => demoShorten(text, limit, keep),
    );
    setBusy(false); setText(r.data.trim()); await persist(r.data.trim());
    toast(`Shortened to ${r.data.trim().length} characters.`);
  };

  return (
    <div className="stack-sm">
      <div className="row between">
        <LangTag lang={lang} />
        <span className="row">
          <Badge tone={over ? "bad" : text.length > limit * 0.9 ? "warn" : "good"}>{text.length} / {limit}</Badge>
          {over && <Button small busy={busy} onClick={shorten}>Shorten</Button>}
          {dirty && <Button small kind="primary" onClick={() => persist(text).then(() => toast("Saved."))}>Save</Button>}
          <CopyButton text={text} />
        </span>
      </div>
      <TextArea id={`lk-${portal}-${lang}`} rows={portal === "airbnb" ? 5 : 8} value={text} onChange={setText} />
      {over && <span className="small" style={{ color: "var(--bad)" }}>{text.length - limit} characters over the {portalById(portal).name} limit. The portal will cut or reject it.</span>}
    </div>
  );
}

function ReelTab({ kit, reels, branded }: { kit: Kit; reels: boolean; branded: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<Lang>(kit.langs[0] ?? "es");
  const reel = kit.reel;
  if (!reels) return <Empty>This client's tier has no reels. The Agent and Agency tiers include one reel per kit.</Empty>;

  const generate = async (template: Reel["template"]) => {
    setBusy(true);
    const order = kit.extraction?.photoOrder?.length ? kit.extraction.photoOrder : kit.photos.map((p) => p.name);
    const r = await aiJson<{ scenes: Reel["scenes"]; music: string }>(
      `Write a 15 to 20 second vertical property reel script for Creatomate. Facts: ${kitFacts(kit)}\n` +
      `Use these photos in this order (max 6): ${JSON.stringify(order.slice(0, 6))}. One scene per photo, 2 to 3 seconds each.\n` +
      `Each scene gets a short on-screen caption (max 40 characters) in: ${langNames(kit.langs)}. First scene: type and town. Last scene: price. No voiceover.\n` +
      `Pick background music from: ${MUSIC.join(", ")}.\n` +
      `JSON shape: {"scenes": [{"seconds": number, "photo": string, "caption": {${kit.langs.map((l) => `"${l}": string`).join(", ")}}}], "music": string}`,
      () => { const d = demoReel(kit, template); return { scenes: d.scenes, music: d.music }; },
    );
    setBusy(false); setError(r.error);
    await save(kit, { reel: { ...r.data, template, render: "none", live: r.live } });
  };

  const render = async () => {
    if (!reel) return;
    await save(kit, { reel: { ...reel, render: "rendering" } });
    setTimeout(() => {
      const cur = getAll<Kit>(COL).find((x) => x.id === kit.id) ?? kit;
      if (cur.reel) void put<Kit>(COL, { ...cur, reel: { ...cur.reel, render: "rendered", renderedAt: now() } });
      toast(`Simulated ${kit.langs.length} renders. Creatomate is not connected, so no video file exists yet.`);
    }, 2200);
  };

  const total = reel?.scenes.reduce((s, x) => s + x.seconds, 0) ?? 0;
  return (
    <div className="split">
      <Card title="Reel setup">
        <Field label="Template" hint={branded ? "Agency tier: agency logo and colours" : "Branded templates come with the Agency tier"}>
          <Select<Reel["template"]> id="lk-tpl" value={reel?.template ?? "clean"} onChange={(v) => reel ? save(kit, { reel: { ...reel, template: v } }) : generate(v)}
            options={[{ value: "clean", label: "Clean (captions only)" }, ...(branded ? [{ value: "branded" as const, label: "Branded agency template" }] : [])]} />
        </Field>
        <div className="row wrap">
          <Button kind="primary" busy={busy} onClick={() => generate(reel?.template ?? "clean")}>{reel ? "Rewrite script" : "Write reel script"}</Button>
          {reel && <Button onClick={render} disabled={reel.render === "rendering"} busy={reel.render === "rendering"}>{reel.render === "rendered" ? "Render again" : "Render reels"}</Button>}
        </div>
        {reel && (
          <div className="stack-sm small">
            <span>Length {total.toFixed(1)} s · {reel.scenes.length} scenes · {reel.music}</span>
            <span>Render: <Badge tone={reel.render === "rendered" ? "good" : reel.render === "rendering" ? "info" : "neutral"}>{reel.render === "none" ? "Not rendered" : reel.render === "rendering" ? "Rendering (simulated)" : `Rendered ${fmtDate(reel.renderedAt)} (simulated)`}</Badge></span>
            <span className="faint">One 9:16 render per language. No AI voice or avatar is used; if one is added, label it as AI-generated (EU AI Act).</span>
          </div>
        )}
      </Card>
      <Card title="Script and captions" aside={reel && <Badge tone={reel.live ? "accent" : "neutral"}>{reel.live ? "AI draft" : "Demo draft"}</Badge>}>
        {error && <p className="small" style={{ color: "var(--warn)" }}>{error}</p>}
        {!reel ? <Empty>No script yet. It uses the photo order from feature extraction.</Empty> : (
          <>
            <div className="chips">{kit.langs.map((l) => <button key={l} type="button" className={"chip" + (view === l ? " chip-on" : "")} onClick={() => setView(l)}>{l.toUpperCase()}</button>)}</div>
            <Table rows={reel.scenes.map((s, i) => ({ ...s, i }))} rowKey={(s) => String(s.i)} cols={[
              { label: "#", render: (s) => s.i + 1, width: "32px" },
              { label: "Shot", render: (s) => { const p = kit.photos.find((x) => x.name === s.photo); return <span className="row">{p?.thumb && <img src={p.thumb} alt="" style={{ width: 40, height: 30, objectFit: "cover", borderRadius: 3 }} />}<span className="mono small">{s.photo}</span></span>; } },
              { label: "Sec", num: true, render: (s) => s.seconds },
              { label: `Caption (${view.toUpperCase()})`, render: (s) => <span className={(s.caption[view]?.length ?? 0) > 40 ? "strong" : ""}>{s.caption[view] ?? <span className="faint">missing</span>}</span> },
            ]} />
          </>
        )}
      </Card>
    </div>
  );
}

function SocialTab({ kit }: { kit: Kit }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const generate = async () => {
    setBusy(true);
    const r = await aiJson<{ posts: SocialPost[] }>(
      `Write 2 social posts for this property: one Instagram (hook first line, short lines) and one Facebook (a bit longer, call to action).\n` +
      `Facts: ${kitFacts(kit)}\nLanguages: ${langNames(kit.langs)}.${kit.kind === "holiday" ? ` Include the registration number ${kit.vvNumber ?? "[VV]"}.` : ""} Never invent facts. 5 to 8 hashtags per post.\n` +
      `JSON shape: {"posts": [{"platform": "Instagram" | "Facebook", "text": {${kit.langs.map((l) => `"${l}": string`).join(", ")}}, "hashtags": string[]}]}`,
      () => ({ posts: demoPosts(kit) }),
    );
    setBusy(false); setError(r.error);
    await save(kit, { posts: r.data.posts.slice(0, 2), postsLive: r.live });
  };
  const schedule = async (i: number) => {
    if (!kit.signedOffAt) return toast("Wait for client sign-off before scheduling.");
    const posts = (kit.posts ?? []).map((p, j) => (j === i ? { ...p, scheduled: now() } : p));
    await save(kit, { posts });
    toast("Marked as scheduled (Metricool not connected yet).");
  };
  return (
    <>
      <Card title="Two posts per kit" aside={<Button kind="primary" busy={busy} onClick={generate}>{kit.posts?.length ? "Rewrite posts" : "Write posts"}</Button>}>
        <p className="small muted">Scheduled to the client's Instagram and Facebook through Metricool after sign-off.</p>
        {error && <p className="small" style={{ color: "var(--warn)" }}>{error}</p>}
      </Card>
      {!kit.posts?.length && <Empty>No posts yet.</Empty>}
      <div className="grid-2">
        {kit.posts?.map((p, i) => (
          <Card key={i} title={p.platform} aside={<>
            {p.scheduled ? <Badge tone="good">Scheduled {fmtDate(p.scheduled)}</Badge> : <Button small onClick={() => schedule(i)}>Schedule</Button>}
          </>}>
            {kit.langs.map((l) => p.text[l] && (
              <AiOutput key={l} title={l.toUpperCase()} live={kit.postsLive} text={`${p.text[l]}\n\n${p.hashtags.join(" ")}`} />
            ))}
          </Card>
        ))}
      </div>
    </>
  );
}

function DeliverTab({ kit, client, reels }: { kit: Kit; client?: Client; reels: boolean }) {
  const checks = compliance(kit, reels);
  const blockers = checks.filter((c) => c.blocking && !c.ok);
  const preDelivery = blockers.filter((c) => c.id !== "signoff");
  const qaDone = QA_ITEMS.filter((q) => reels || q.id !== "reel").every((q) => kit.qa.includes(q.id));
  const [energy, setEnergy] = useState({ r: kit.energyRating ?? "", n: kit.energyCertNo ?? "" });
  const [vv, setVv] = useState(kit.vvNumber ?? "");
  const taskId = `${kit.id}-signoff`;

  const toQa = async () => {
    if (!kit.copy) return toast("Write the portal copy first.");
    await save(kit, { status: "qa" }); toast("Moved to QA.");
  };
  const toSignoff = async () => {
    if (!qaDone) return toast("Tick every QA item first.");
    await save(kit, { status: "signoff", sentForSignoff: now() });
    await put<Task>("tasks", { id: taskId, createdAt: now(), title: `Get sign-off from ${client?.name ?? "client"} on kit ${kit.ref}`, module: "listings", clientId: kit.clientId, due: dayOffset(2), done: false });
    toast("Marked as sent for sign-off. Send the preview to the client yourself; nothing was sent.");
  };
  const signedOff = async () => {
    await save(kit, { signedOffAt: now() });
    await put<Task>("tasks", { id: taskId, createdAt: now(), title: `Get sign-off from ${client?.name ?? "client"} on kit ${kit.ref}`, module: "listings", clientId: kit.clientId, done: true });
    toast("Client sign-off recorded.");
  };
  const deliver = async () => {
    if (blockers.length) return toast(`Blocked: ${blockers.map((b) => b.label).join(", ")}.`);
    await save(kit, { status: "delivered", deliveredAt: now() });
    toast("Marked as delivered. Nothing was published to the portals.");
  };

  const bundle = [
    `${kit.ref} · ${kit.type} · ${kit.town}`,
    ...kit.portals.flatMap((po) => kit.langs.map((l) => `\n## ${portalById(po).name} · ${l.toUpperCase()}\n${kit.copy?.[po]?.[l] ?? "(missing)"}`)),
    ...(kit.posts ?? []).flatMap((p) => kit.langs.map((l) => `\n## ${p.platform} · ${l.toUpperCase()}\n${p.text[l] ?? ""}\n${p.hashtags.join(" ")}`)),
  ].join("\n");

  return (
    <div className="grid-2">
      <Card title="Compliance check" aside={<Badge tone={preDelivery.length ? "bad" : "good"}>{preDelivery.length ? `${preDelivery.length} blocking` : "Clear"}</Badge>}>
        {checks.map((c) => (
          <div key={c.id} className="row between">
            <div className="stack-sm"><span className="strong small">{c.label}</span>{c.detail && <span className="small muted">{c.detail}</span>}</div>
            <Badge tone={c.ok ? "good" : c.blocking ? "bad" : "warn"}>{c.ok ? "OK" : c.blocking ? "Blocks delivery" : "Open"}</Badge>
          </div>
        ))}
        <hr className="divider" />
        {kit.kind === "sale" ? (
          <div className="form-grid">
            <Field label="Energy rating"><Select id="lk-d-er" value={energy.r} onChange={(v) => setEnergy({ ...energy, r: v })} options={[{ value: "", label: "Not yet" }, ...ENERGY]} /></Field>
            <Field label="Certificate no."><Input id="lk-d-ec" value={energy.n} onChange={(v) => setEnergy({ ...energy, n: v })} /></Field>
            <Button small onClick={() => save(kit, { energyRating: energy.r || undefined, energyCertNo: energy.n.trim() || undefined }).then(() => toast("Energy certificate saved."))}>Save</Button>
          </div>
        ) : (
          <div className="form-grid">
            <Field label="VV registration no." hint={vv && !VV_RE.test(vv.toUpperCase()) ? "Format VV-38-n-nnnnnnn" : undefined}><Input id="lk-d-vv" value={vv} onChange={setVv} /></Field>
            <Button small onClick={() => save(kit, { vvNumber: vv.trim().toUpperCase() || undefined }).then(() => toast("VV number saved. Rewrite the copy if it was missing."))}>Save</Button>
          </div>
        )}
        <p className="small faint">The 2025 Canary holiday-rental law: every holiday-rental advert shows its registration number. Sale adverts show the energy rating.</p>
      </Card>
      <Card title="QA and sign-off" aside={<Badge tone={statusTone[kit.status]}>{statusLabel(kit.status)}</Badge>}>
        <div className="stack-sm">
          {QA_ITEMS.filter((q) => reels || q.id !== "reel").map((q) => (
            <label key={q.id} className="row small">
              <input type="checkbox" checked={kit.qa.includes(q.id)} disabled={kit.status === "draft" || kit.status === "delivered"}
                onChange={(e) => save(kit, { qa: e.target.checked ? [...kit.qa, q.id] : kit.qa.filter((x) => x !== q.id) })} />
              {q.label}
            </label>
          ))}
          {kit.status === "draft" && <span className="small faint">Move the kit to QA to tick these.</span>}
        </div>
        <div className="row wrap">
          {kit.status === "draft" && <Button kind="primary" onClick={toQa}>Send to QA</Button>}
          {kit.status === "qa" && <Button kind="primary" onClick={toSignoff} disabled={!qaDone}>QA passed: ask client to sign off</Button>}
          {kit.status === "signoff" && !kit.signedOffAt && <Button kind="primary" onClick={signedOff}>Client signed off</Button>}
          {kit.status === "signoff" && <Button kind="primary" onClick={deliver} disabled={blockers.length > 0}>Deliver kit</Button>}
          {kit.status !== "draft" && kit.status !== "delivered" && <Button kind="ghost" onClick={() => save(kit, { status: "draft", signedOffAt: undefined })}>Back to draft</Button>}
        </div>
        {kit.status === "signoff" && blockers.length > 0 && <p className="small" style={{ color: "var(--bad)" }}>Delivery blocked: {blockers.map((b) => b.label).join("; ")}.</p>}
        <div className="stack-sm small muted">
          {kit.sentForSignoff && <span>Sent for sign-off {fmtDate(kit.sentForSignoff)}</span>}
          {kit.signedOffAt && <span>Signed off {fmtDate(kit.signedOffAt)}</span>}
          {kit.deliveredAt && <span>Delivered {fmtDate(kit.deliveredAt)}</span>}
        </div>
        <div className="row"><CopyButton text={bundle} label="Copy full kit text" /></div>
      </Card>
    </div>
  );
}

// --- Limits and quotas ----------------------------------------------------------------------------

function Limits() {
  const [portal, setPortal] = useState<PortalId>("airbnb");
  const [text, setText] = useState("");
  const p = portalById(portal);
  return (
    <div className="split">
      <Card title="Live counter">
        <Field label="Portal"><Select<PortalId> id="lk-lim-p" value={portal} onChange={setPortal} options={PORTALS.map((x) => ({ value: x.id, label: x.name }))} /></Field>
        <TextArea id="lk-lim-t" rows={8} value={text} onChange={setText} placeholder="Paste a description to check it." />
        <div className="row between">
          <Badge tone={text.length > p.limit ? "bad" : text.length > p.limit * 0.9 ? "warn" : "good"}>{text.length} / {p.limit}</Badge>
          {text.length > p.limit && <span className="small" style={{ color: "var(--bad)" }}>{text.length - p.limit} over</span>}
        </div>
        <div className="bar"><span style={{ width: `${Math.min(100, (text.length / p.limit) * 100)}%`, background: text.length > p.limit ? "var(--bad)" : undefined }} /></div>
      </Card>
      <Card title="Portal character limits">
        <Table rows={PORTALS} rowKey={(x) => x.id} cols={[
          { label: "Portal", render: (x) => <span className="strong">{x.name}</span> },
          { label: "Used for", render: (x) => x.kinds.map((k) => k === "sale" ? "Sales" : "Holiday rentals").join(", ") },
          { label: "Limit", num: true, render: (x) => `${x.limit.toLocaleString("en-GB")} chars` },
          { label: "Style", render: (x) => <span className="small muted">{x.style}</span> },
        ]} />
        <p className="small faint">Working limits for the description field. Portals change them; check each season and update this table.</p>
      </Card>
    </div>
  );
}

function Quotas({ clients, kits }: { clients: Client[]; kits: Kit[] }) {
  const month = thisMonth();
  const plan = PLANS.find((p) => p.id === "p4")!;
  const rows = clients.filter((c) => c.subs.some((s) => s.plan === "p4") || kits.some((k) => k.clientId === c.id));
  return (
    <>
      <div className="grid-3">
        {plan.tiers.map((t) => (
          <Card key={t.name} title={t.name} aside={<span className="strong">{eur(t.price)}/mo</span>}>
            <p className="small">{t.detail}</p>
            <p className="small muted">{eur(t.price * (1 + IGIC))} with 7% IGIC</p>
          </Card>
        ))}
      </div>
      <Card title={`Kits used in ${month}`}>
        <Table rows={rows} rowKey={(c) => c.id} empty="No Listing Kits clients yet. Offer a free pilot of 3 kits to one agency." cols={[
          { label: "Client", render: (c) => <span className="strong">{c.name}</span> },
          { label: "Tier", render: (c) => tierOf(c).tier },
          { label: "Used", render: (c) => {
            const t = tierOf(c); const u = kits.filter((k) => k.clientId === c.id && k.month === month).length;
            return <div className="stack-sm" style={{ minWidth: 140 }}><span className="small">{u} / {t.cap}</span><div className="bar"><span style={{ width: `${t.cap ? Math.min(100, (u / t.cap) * 100) : 100}%`, background: u >= t.cap ? "var(--warn)" : undefined }} /></div></div>;
          } },
          { label: "Delivered", num: true, render: (c) => kits.filter((k) => k.clientId === c.id && k.month === month && k.status === "delivered").length },
          { label: "Languages", render: (c) => <span className="row wrap">{c.languages.map((l) => <LangTag key={l} lang={l} />)}</span> },
        ]} />
      </Card>
    </>
  );
}

// --- Seed ----------------------------------------------------------------------------------------

export async function seed(): Promise<void> {
  const month = thisMonth();
  const prev = dayOffset(-35).slice(0, 7);
  const photos = (names: string[]): Photo[] => names.map((name) => ({ name }));
  const base = (id: string, k: Omit<Kit, "id" | "createdAt" | "portals" | "qa"> & { qa?: string[] }): Kit =>
    example(id, { portals: portalsFor(k.kind), qa: [], ...k }) as Kit;

  const k1 = base("ex-listings-k1", {
    clientId: EX.casa, ref: "CSI-041", kind: "sale", type: "Penthouse", town: "Costa Adeje", price: 465000, beds: 2, baths: 2, m2: 98,
    features: ["sea view", "terrace", "solarium", "communal pool", "parking", "lift"],
    photos: photos(["terraza-vistas.jpg", "salon.jpg", "cocina.jpg", "dormitorio-1.jpg", "dormitorio-2.jpg", "bano.jpg", "solarium.jpg", "piscina.jpg", "garaje.jpg"]),
    transcript: "Ático en San Eugenio Alto, cuarta y última planta con ascensor. Orientación suroeste, terraza de 40 metros con vistas al mar y a La Gomera, solárium privado arriba. Piscina comunitaria, plaza de garaje y trastero no, garaje sí. Vendedores sueco, flexibles en fechas.",
    energyRating: "E", energyCertNo: "CEE-38-2026-004417", langs: ["es", "en", "de", "nl", "sv"], status: "delivered",
    qa: QA_ITEMS.map((q) => q.id), sentForSignoff: dayOffset(-6), signedOffAt: dayOffset(-5), deliveredAt: dayOffset(-4), month,
  });
  k1.copy = demoCopy(k1, k1.portals, k1.langs); k1.copyLive = false;
  k1.extraction = { ...demoExtraction(k1), live: false, at: dayOffset(-8) };
  k1.reel = { ...demoReel(k1, "clean"), render: "rendered", renderedAt: dayOffset(-5) };
  k1.posts = demoPosts(k1).map((p) => ({ ...p, scheduled: dayOffset(-3) }));

  const k2 = base("ex-listings-k2", {
    clientId: EX.casa, ref: "CSI-042", kind: "holiday", type: "Apartment", town: "Los Cristianos", price: 95, beds: 1, baths: 1, m2: 52,
    features: ["sea view", "terrace", "communal pool", "air conditioning", "fibre wifi", "walk to beach", "furnished"],
    photos: photos(["vista-mar.jpg", "salon.jpg", "cocina.jpg", "dormitorio.jpg", "bano.jpg", "piscina.jpg"]),
    transcript: "Apartment in Edificio Bahía, second floor, south facing, five minutes walk to Playa de Los Cristianos. Fibre wifi 600 Mb, aire acondicionado in bedroom. Registered as vivienda vacacional.",
    vvNumber: "VV-38-4-0091234", langs: ["es", "en", "de", "nl", "sv"], status: "signoff",
    qa: ["facts", "features", "langs", "photos", "reel"], sentForSignoff: dayOffset(-1), month,
  });
  k2.copy = demoCopy(k2, k2.portals, k2.langs);
  // The DE Airbnb text was pasted from the long Idealista version: over the 500 limit, so delivery is blocked until it is shortened.
  k2.copy.airbnb = { ...k2.copy.airbnb, de: `${k2.copy.idealista?.de ?? ""}\nDie Wohnung liegt im zweiten Stock mit Südausrichtung, fünf Gehminuten vom Strand Playa de Los Cristianos. Glasfaser mit 600 Mb und Klimaanlage im Schlafzimmer.` };
  k2.extraction = { ...demoExtraction(k2), live: false, at: dayOffset(-2) };
  k2.reel = { ...demoReel(k2, "clean"), render: "rendered", renderedAt: dayOffset(-1) };
  k2.posts = demoPosts(k2);

  const k3 = base("ex-listings-k3", {
    clientId: EX.casa, ref: "CSI-043", kind: "sale", type: "Villa", town: "Los Gigantes", price: 890000, beds: 4, baths: 3, m2: 240,
    features: ["sea view", "private pool", "garden", "terrace", "parking", "air conditioning"],
    photos: photos(["fachada.jpg", "piscina-privada.jpg", "jardin.jpg", "salon.jpg", "cocina.jpg", "dormitorio-principal.jpg", "bano-suite.jpg", "acantilados-vista.jpg"]),
    transcript: "Villa above Los Gigantes with a view of the cliffs. Private heated pool, garden, double garage. Owner is still waiting for the energy certificate from the técnico.",
    langs: ["es", "en", "de", "nl", "sv"], status: "qa", qa: ["facts", "photos"], month,
  });
  k3.copy = demoCopy(k3, k3.portals, k3.langs);
  k3.extraction = { ...demoExtraction(k3), live: false, at: dayOffset(-1) };

  const k4 = base("ex-listings-k4", {
    clientId: EX.casa, ref: "CSI-044", kind: "sale", type: "Townhouse", town: "Puerto de la Cruz", price: 289000, beds: 3, baths: 2, m2: 135,
    features: [], photos: photos(["exterior.jpg", "salon.jpg", "terraza.jpg", "cocina.jpg"]),
    transcript: "Adosado en La Paz, Puerto de la Cruz. Tres dormitorios, dos baños, terraza con vistas al Teide y al mar, garaje privado, reformado en 2022. Planta baja más dos.",
    energyRating: "D", energyCertNo: "CEE-38-2026-005102", langs: ["es", "en", "de", "nl", "sv"], status: "draft", month,
  });

  const k0 = base("ex-listings-k0", {
    clientId: EX.casa, ref: "CSI-038", kind: "sale", type: "Apartment", town: "Playa de las Américas", price: 238000, beds: 1, baths: 1, m2: 61,
    features: ["terrace", "communal pool", "walk to beach"], photos: photos(["terraza.jpg", "salon.jpg"]),
    transcript: "Apartamento en complejo con piscina, a 300 m de la playa.", energyRating: "F", energyCertNo: "CEE-38-2026-003300",
    langs: ["es", "en", "de", "nl", "sv"], status: "delivered", qa: QA_ITEMS.map((q) => q.id), signedOffAt: dayOffset(-38), deliveredAt: dayOffset(-37), month: prev,
  });
  k0.copy = demoCopy(k0, k0.portals, k0.langs);

  for (const k of [k0, k1, k2, k3, k4]) await put(COL, k);
  await put<Task>("tasks", example("ex-listings-k2-signoff", { title: "Get sign-off from Casa Sur Inmobiliaria on kit CSI-042", module: "listings", clientId: EX.casa, due: dayOffset(1), done: false }) as Task);
  await put<Task>("tasks", example("ex-listings-t2", { title: "Chase energy certificate for villa CSI-043 (Los Gigantes)", module: "listings", clientId: EX.casa, due: dayOffset(2), done: false }) as Task);
}
