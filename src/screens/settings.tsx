import { useState, useRef } from "react";
import { AiSettingsModal } from "./studio";
import { call, type AiSettings } from "./studio-api";
import { BRAND } from "../core/brand";
import { Page, Card, Button, Badge, Table, Field, Input, TextArea, ConfirmButton, toast } from "../core/ui";
import { useCollection, put, remove, getAll, collections, storeReady, useBackend, now } from "../core/store";
import { useAiMode, useAiProvider } from "../core/ai";
import { navigate } from "../core/nav";
import { useOffer } from "../core/offer";
import { eur } from "../core/plans";
import { seedCore } from "../core/seed";
import { MODULE_SEEDS } from "../modules";
import type { Rec } from "../core/types";

interface Business extends Rec { name: string; nif: string; address: string; iban: string; phone: string }
const BLANK: Business = { id: "business", createdAt: "", name: "", nif: "", address: "", iban: "", phone: "" };

interface UiPrefs extends Rec { showTools: boolean }

/** Display preferences: whether the extra tools show in the menu. */
export function useUiPrefs(): UiPrefs {
  return useCollection<UiPrefs>("settings").find((s) => s.id === "ui") ?? { id: "ui", createdAt: "", showTools: false };
}

export function useBusiness(): Business {
  return useCollection<Business>("settings").find((s) => s.id === "business") ?? BLANK;
}

/** All collections the app uses, so export and wipe cover modules that haven't been opened yet. */
const KNOWN = ["clients", "visits", "invoices", "tasks", "settings"];

export async function loadExamples() {
  await storeReady;
  await seedCore();
  for (const s of MODULE_SEEDS) await s();
}

async function allCollections() {
  await storeReady;
  return [...new Set([...KNOWN, ...collections()])];
}

const INTEGRATIONS = [
  { name: "Google Business Profile API", for: "Maps & Reviews: read reviews, post replies and updates", note: "Apply in week 1; approval can be slow." },
  { name: "WhatsApp Cloud API (Meta)", for: "WhatsApp Receptionist, owner approvals, Retention Flows", note: "Needs a Meta Business account and a number." },
  { name: "Instagram Graph API", for: "Receptionist DMs, Video Ads scheduling" },
  { name: "OpenAI, Gemini, Perplexity APIs", for: "AI Visibility checks on each assistant" },
  { name: "DataForSEO", for: "Google AI Overviews, keyword research for Activity Pages" },
  { name: "ElevenLabs + Creatomate", for: "Voiceovers and video renders" },
  { name: "Metricool or Buffer", for: "Social scheduling" },
  { name: "Shopify, Etsy, Amazon.es", for: "Makers Online listings and stock" },
  { name: "Brevo or Klaviyo", for: "Retention email to opted-in customers" },
  { name: "Stripe", for: "Card payment links on invoices" },
  { name: "FareHarbor, Bokun or Google Calendar", for: "Live availability for bookings" },
];

/** Change the admin password used on the landing page (only when a server is running). */
function PasswordCard() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setErr("");
    if (next.length < 8) return setErr("Use at least 8 characters.");
    setBusy(true);
    try {
      const r = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ current: cur, next }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.error ?? "Couldn't change the password.");
      else { setCur(""); setNext(""); toast("Password changed"); }
    } catch { setErr("Can't reach the server."); }
    setBusy(false);
  };
  return (
    <Card title="Admin password" aside={<Button small kind="primary" busy={busy} onClick={() => void save()}>Change password</Button>}>
      <div className="stack-sm">
        <p className="small muted" style={{ margin: 0 }}>You type it on the home page to open this dashboard. Changing it signs out every other browser.</p>
        <div className="form-grid">
          <Field label="Current password"><Input id="pw-cur" type="password" value={cur} onChange={setCur} /></Field>
          <Field label="New password" hint="At least 8 characters."><Input id="pw-new" type="password" value={next} onChange={setNext} /></Field>
        </div>
        {err && <span className="small" style={{ color: "var(--bad)" }}>{err}</span>}
      </div>
    </Card>
  );
}

export default function Settings() {
  const [aiKeys, setAiKeys] = useState<AiSettings | null>(null);
  const biz = useBusiness();
  const [b, setB] = useState<Business>(biz);
  const backend = useBackend();
  const ai = useAiMode();
  const { provider, model } = useAiProvider();
  const prefs = useUiPrefs();
  const offer = useOffer();
  const [busy, setBusy] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const set = (k: keyof Business, v: string) => setB({ ...b, [k]: v });

  const wipe = async (onlyExamples: boolean) => {
    setBusy(onlyExamples ? "examples" : "all");
    for (const col of await allCollections()) {
      for (const r of getAll(col)) if (!onlyExamples || r.example) await remove(col, r.id);
    }
    setBusy("");
    toast(onlyExamples ? "Example data removed" : "All data deleted");
  };

  const exportJson = async () => {
    const data: Record<string, Rec[]> = {};
    for (const col of await allCollections()) data[col] = getAll(col);
    const text = JSON.stringify({ exportedAt: now(), data }, null, 1);
    try { await navigator.clipboard.writeText(text); toast("Backup copied to the clipboard. Paste it into a file to keep it."); }
    catch { toast("Copy was blocked by the browser."); }
  };

  const importJson = async (f: File) => {
    try {
      const { data } = JSON.parse(await f.text()) as { data: Record<string, Rec[]> };
      let n = 0;
      for (const [col, rows] of Object.entries(data)) for (const r of rows) { await put(col, r); n++; }
      toast(`Imported ${n} records`);
    } catch { toast(`That file isn't a ${BRAND} backup.`); }
  };

  return (
    <Page title="Settings" intro="Your business details, connected services and data.">
      <div className="grid-2">
        <Card title="Your business" aside={<Button kind="primary" small onClick={async () => { await put("settings", { ...b, id: "business", createdAt: b.createdAt || now() }); toast("Saved"); }}>Save</Button>}>
          <div className="form-grid">
            <Field label="Trading name"><Input id="b-name" value={b.name} onChange={(v) => set("name", v)} placeholder="Your name, autónomo" /></Field>
            <Field label="NIF"><Input id="b-nif" value={b.nif} onChange={(v) => set("nif", v)} /></Field>
            <Field label="Phone"><Input id="b-phone" value={b.phone} onChange={(v) => set("phone", v)} /></Field>
            <Field label="IBAN"><Input id="b-iban" value={b.iban} onChange={(v) => set("iban", v)} /></Field>
            <Field label="Address" wide><TextArea id="b-addr" rows={2} value={b.address} onChange={(v) => set("address", v)} /></Field>
          </div>
        </Card>
        <Card title="Getting set up">
          <ul className="stack small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Register as autónomo with Hacienda (form 036/037) and Seguridad Social (RETA). Tarifa plana is about €80/month for 12 months.</li>
            <li>Watch for the next Canary "cuota cero" call, which refunds those contributions. The 2026 call closed on 15 October.</li>
            <li>Invoices carry 7% IGIC, not IVA. Billing handles this.</li>
            <li>A gestoría (about €40 to €80/month) files the quarterly returns.</li>
          </ul>
          <p className="small faint">Estimates from the business plan. Confirm with a gestoría.</p>
        </Card>
      </div>

      <Card title="Connected services" aside={<Badge tone={ai === "live" ? "good" : "warn"}>{ai === "live" ? "AI on" : "AI in demo mode"}</Badge>}>
        <div className="box small stack-sm">
          <span className="strong">AI writing</span>
          <span className="muted">
            {provider === "claude" ? "Claude, through claude.ai."
              : provider === "openrouter" ? `OpenRouter free models, picked and rotated automatically${model ? `. Last answer from ${model}` : ""}.`
              : "Demo output. Run the app locally with an OPENROUTER_API_KEY in .env to use free OpenRouter models, or open it on claude.ai to use Claude."}
          </span>
          <div className="row">
            <Button small onClick={async () => {
              const r = await call<AiSettings>("GET", "/settings/ai");
              if (r.kind === "ok") setAiKeys(r.data);
              else toast(r.kind === "auth" ? "Open Content Studio and enter your admin token first." : "The studio server is not reachable.");
            }}>Add Groq, Mistral or OpenRouter keys</Button>
          </div>
        </div>
        {aiKeys && <AiSettingsModal s={aiKeys} onClose={() => setAiKeys(null)}
          act={async (m, path, body, ok) => { const r = await call<AiSettings>(m, path, body); if (r.kind === "ok") { if (ok) toast(ok); setAiKeys(r.data); return r.data; } toast(r.kind === "error" ? r.message : "Could not save."); return undefined; }} />}
        <p className="small muted">The services below aren't connected yet, so those features are simulated and never send anything.</p>
        <Table rows={INTEGRATIONS} rowKey={(i) => i.name}
          cols={[
            { label: "Service", render: (i) => <span className="strong">{i.name}</span> },
            { label: "Used for", render: (i) => <div className="stack-sm"><span>{i.for}</span>{i.note && <span className="small faint">{i.note}</span>}</div> },
            { label: "Status", render: () => <Badge>Not connected</Badge> },
          ]} />
      </Card>

      <div className="grid-2">
        <Card title="Plans and prices" aside={<Button small kind="primary" onClick={() => navigate("plans")}>Edit prices</Button>}>
          <div className="row wrap">
            {(["basic", "pro"] as const).map((id) => <Badge key={id} tone="accent">{offer.plans[id].name} {eur(offer.plans[id].price)}/mo</Badge>)}
            <Badge>Free trial {offer.trialDays} days</Badge>
          </div>
          <p className="small muted">You sell two plans. Change names, prices and what's included in Plans & prices. Monthly, excl. 7% IGIC.</p>
        </Card>
        <Card title="Menu">
          <label className="row" style={{ alignItems: "flex-start" }}>
            <input type="checkbox" checked={prefs.showTools} style={{ marginTop: 3 }}
              onChange={(e) => void put("settings", { ...prefs, id: "ui", createdAt: prefs.createdAt || now(), showTools: e.target.checked })} />
            <span className="stack-sm"><span className="strong">Show the extra tools</span>
              <span className="small muted">Maps & Reviews, AI Visibility, WhatsApp Receptionist, Listing Kits and six more. They were separate services before the two plans; they're hidden to keep the menu simple.</span></span>
          </label>
        </Card>
      </div>

      <PasswordCard />

      <Card title="Data" aside={<span className="small muted">{backend === "cloud" ? "Saved to your claude.ai workspace" : "Saved in this browser only"}</span>}>
        <div className="row wrap">
          <Button busy={busy === "load"} onClick={async () => { setBusy("load"); await loadExamples(); setBusy(""); toast("Example data loaded"); }}>Load example data</Button>
          <ConfirmButton label="Remove example data" confirm="Remove examples" onConfirm={() => wipe(true)} />
          <Button onClick={exportJson}>Copy backup</Button>
          <Button onClick={() => file.current?.click()}>Restore from file</Button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <ConfirmButton label="Delete everything" confirm="Delete all data" kind="ghost" onConfirm={() => wipe(false)} />
        </div>
      </Card>
    </Page>
  );
}
