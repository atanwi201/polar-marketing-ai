// Plan 9 · Canarian Makers Online: listings from one Spanish brief, stock sync, ads approvals, customs data, compliance gate, monthly report.
import { useState, useId } from "react";
import {
  Page, Card, Button, Field, Input, TextArea, Select, Form, Tabs, Badge, Stat, Stats, Table, Empty, AiOutput,
  CopyButton, LangPicker, LangTag, ConfirmButton, toast, fmtDate,
} from "../core/ui";
import { useCollection, put, create, remove, now, today } from "../core/store";
import { aiJson, aiText } from "../core/ai";
import { eur, IGIC, PLANS } from "../core/plans";
import { EX, example, dayOffset } from "../core/seed";
import type { Client, Lang, Task } from "../core/types";
import {
  COL, MAKER_LANGS, CHANNELS, CATEGORIES, LABEL_ITEMS, AGENT_FEE, channelById, catById, gate, gateOk, tierOf,
  demoListings, simulateAds, demoSuggestions, acos, shipmentTotals, demoCustomsNotes, simulateSales, demoReport, langList,
  type Product, type Channel, type Category, type Listings, type AdsWeek, type Suggestion, type Shipment, type HsLine, type SalesReport,
} from "./makers-data";

type TabId = "products" | "stock" | "ads" | "shipping" | "compliance" | "report";
const saveProduct = (p: Product, patch: Partial<Product>) => put<Product>(COL.products, { ...p, ...patch });
const isMaker = (c: Client) => c.subs.some((s) => s.plan === "p9") || /maker|winery|bodega|cosmetic|craft|cheese|food/i.test(c.kind);

function isoWeek(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y.getTime()) / 864e5 + 1) / 7)).padStart(2, "0")}`;
}

export default function Screen() {
  const clients = useCollection<Client>("clients");
  const products = useCollection<Product>(COL.products);
  const makers = clients.filter((c) => isMaker(c) || products.some((p) => p.clientId === c.id));
  const [mid, setMid] = useState("");
  const [tab, setTab] = useState<TabId>("products");
  const maker = makers.find((m) => m.id === mid) ?? makers[0];
  const mine = products.filter((p) => p.clientId === maker?.id);
  const tier = tierOf(maker);
  const low = mine.filter((p) => p.stock <= p.lowStock).length;
  const blocked = mine.filter((p) => !gateOk(p)).length;

  return (
    <Page plan="Plan 9 · Canarian Makers Online" title="Makers online"
      intro="Sell Canarian wine, food, aloe cosmetics and crafts beyond the island: listings in five languages from one Spanish brief, synced stock, ad changes for approval and the paperwork the customs agent needs."
      actions={makers.length > 1 && maker ? <Select id="mk-maker" value={maker.id} onChange={setMid} options={makers.map((m) => ({ value: m.id, label: m.name }))} /> : undefined}>
      {!maker ? <Empty>No maker clients yet. Add a producer in Clients & pipeline (kind: winery, cheese, cosmetics, craft).</Empty> : (
        <>
          <Stats>
            <Stat label="Tier" value={tier.name} sub={`${tier.channels} channel${tier.channels > 1 ? "s" : ""}${tier.ads ? " · ads" : ""}${tier.customs ? " · customs agent" : ""}`} />
            <Stat label="Products" value={mine.length} />
            <Stat label="Low stock" value={low} tone={low ? "warn" : undefined} />
            <Stat label="Blocked by compliance" value={blocked} tone={blocked ? "bad" : "good"} />
          </Stats>
          <Tabs<TabId> value={tab} onChange={setTab} tabs={[
            { id: "products", label: "Listings", count: mine.length }, { id: "stock", label: "Stock & prices", count: low || undefined },
            { id: "ads", label: "Ads agent" }, { id: "shipping", label: "Shipping & DUA" },
            { id: "compliance", label: "Compliance", count: blocked || undefined }, { id: "report", label: "Monthly report" },
          ]} />
          {tab === "products" && <ProductsTab maker={maker} products={mine} />}
          {tab === "stock" && <StockTab maker={maker} products={mine} />}
          {tab === "ads" && <AdsTab maker={maker} products={mine} />}
          {tab === "shipping" && <ShippingTab maker={maker} products={mine} />}
          {tab === "compliance" && <ComplianceTab products={mine} />}
          {tab === "report" && <ReportTab maker={maker} products={mine} />}
        </>
      )}
    </Page>
  );
}

function channelCheck(p: Product, ch: Channel, all: Product[], maker: Client): string | null {
  if (p.channels.includes(ch)) return null;
  if (ch === "etsy" && catById(p.category).kind === "alcohol") return "Etsy does not allow alcohol. Use Shopify or Amazon.es.";
  const used = new Set(all.filter((x) => x.id !== p.id).flatMap((x) => x.channels).concat(p.channels));
  const t = tierOf(maker);
  if (!used.has(ch) && used.size >= t.channels) return `${t.name} includes ${t.channels} channel${t.channels > 1 ? "s" : ""}. Upgrade to add ${channelById(ch).name}.`;
  return null;
}

// --- Listings ------------------------------------------------------------------------------------

function ProductsTab({ maker, products }: { maker: Client; products: Product[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const open = products.find((p) => p.id === openId) ?? products[0];
  return (
    <div className="split">
      <div className="stack">
        <Card title="Products" aside={<Button small onClick={() => setAdding(!adding)}>{adding ? "Close" : "New product"}</Button>}>
          {adding && <NewProduct maker={maker} products={products} onCreated={(id) => { setAdding(false); setOpenId(id); }} />}
          <Table rows={products} rowKey={(p) => p.id} onRow={(p) => setOpenId(p.id)} empty="No products yet. Start with the maker's best seller to tourists."
            cols={[
              { label: "Product", render: (p) => <div className="stack-sm"><span className="strong">{p.name}</span><span className="small muted">{catById(p.category).label} · {p.netQty}</span></div> },
              { label: "Channels", render: (p) => <span className="small">{p.channels.map((c) => channelById(c).name).join(", ") || "-"}</span> },
              { label: "Gate", render: (p) => gateOk(p) ? <Badge tone="good">OK</Badge> : <Badge tone="bad">Blocked</Badge> },
            ]} />
        </Card>
      </div>
      {open ? <ProductDetail key={open.id} maker={maker} product={open} all={products} onDeleted={() => setOpenId(null)} /> : <Empty>Open a product to write its listings.</Empty>}
    </div>
  );
}

function NewProduct({ maker, products, onCreated }: { maker: Client; products: Product[]; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ name: "", category: "wine" as Category, brief: "", netQty: "", weight: "", abv: "", stock: "", low: "10", price: "" });
  const submit = async () => {
    if (!f.name.trim() || !Number(f.price)) return toast("Name and price are needed.");
    const used = [...new Set(products.flatMap((p) => p.channels))];
    const first: Channel = used[0] ?? (catById(f.category).kind === "alcohol" ? "shopify" : "etsy");
    const p = await create<Product>(COL.products, {
      clientId: maker.id, name: f.name.trim(), category: f.category, brief: f.brief.trim(), netQty: f.netQty.trim(), weightKg: Number(f.weight) || 0.5,
      abv: Number(f.abv) || undefined, stock: Number(f.stock) || 0, lowStock: Number(f.low) || 0, prices: { [first]: Number(f.price) },
      channels: [first], langs: ["es", "en", "de", "it"], label: [],
    });
    toast("Product added. Complete the compliance gate before listing it.");
    onCreated(p.id);
  };
  return (
    <Form onSubmit={submit}>
      <Field label="Name"><Input id="mk-n-name" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="Tinto Tradicional 2024" /></Field>
      <Field label="Category"><Select<Category> id="mk-n-cat" value={f.category} onChange={(v) => setF({ ...f, category: v })} options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} /></Field>
      <Field label="Net quantity"><Input id="mk-n-net" value={f.netQty} onChange={(v) => setF({ ...f, netQty: v })} placeholder="750 ml" /></Field>
      <Field label="Shipping weight (kg)"><Input id="mk-n-w" type="number" step={0.1} value={f.weight} onChange={(v) => setF({ ...f, weight: v })} /></Field>
      {catById(f.category).kind === "alcohol" && <Field label="Alcohol % vol"><Input id="mk-n-abv" type="number" step={0.5} value={f.abv} onChange={(v) => setF({ ...f, abv: v })} /></Field>}
      <Field label="Price (EUR)"><Input id="mk-n-price" type="number" step={0.1} value={f.price} onChange={(v) => setF({ ...f, price: v })} /></Field>
      <Field label="Stock"><Input id="mk-n-stock" type="number" value={f.stock} onChange={(v) => setF({ ...f, stock: v })} /></Field>
      <Field label="Low-stock alert at"><Input id="mk-n-low" type="number" value={f.low} onChange={(v) => setF({ ...f, low: v })} /></Field>
      <Field label="Spanish brief" wide hint="One brief in the maker's words. The listing agent writes every language and channel from it.">
        <TextArea id="mk-n-brief" rows={3} value={f.brief} onChange={(v) => setF({ ...f, brief: v })} />
      </Field>
      <Button kind="primary" type="submit">Add product</Button>
    </Form>
  );
}

function ProductDetail({ maker, product: p, all, onDeleted }: { maker: Client; product: Product; all: Product[]; onDeleted: () => void }) {
  const [brief, setBrief] = useState(p.brief);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [lang, setLang] = useState<Lang>(p.langs[0] ?? "es");
  const ok = gateOk(p);
  const toggle = async (ch: Channel) => {
    if (p.channels.includes(ch)) return saveProduct(p, { channels: p.channels.filter((c) => c !== ch) });
    const why = channelCheck(p, ch, all, maker);
    if (why) return toast(why);
    const base = p.prices[p.channels[0]] ?? 0;
    await saveProduct(p, { channels: [...p.channels, ch], prices: { ...p.prices, [ch]: p.prices[ch] ?? base } });
  };
  const write = async () => {
    if (!ok) return toast("Blocked by the compliance gate. Fix it in the Compliance tab first.");
    if (!p.channels.length) return toast("Pick at least one channel.");
    setBusy(true);
    const cur = { ...p, brief: brief.trim() };
    const r = await aiJson<Listings>(
      `You are the listing agent for a Canarian producer selling online. Write listings from this one Spanish brief.\n` +
      `Maker: ${maker.name}, ${maker.town}, Tenerife. Product: ${JSON.stringify({ name: p.name, category: catById(p.category).label, netQty: p.netQty, abv: p.abv ?? null, brief: cur.brief })}\n` +
      `Channels and limits: ${p.channels.map((c) => { const x = channelById(c); return `${c} (${x.name}): title max ${x.titleMax} chars, description max ${x.descMax}, up to ${x.kwMax} keywords of max ${x.kwLen} chars`; }).join("; ")}.\n` +
      `Languages: ${langList(p.langs)}. Native search terms buyers in each country use, not translations. Never invent awards, health claims or ingredients not in the brief. ${catById(p.category).kind === "cosmetic" ? "No medical claims (EU cosmetics rules)." : ""}${catById(p.category).kind === "alcohol" ? " Alcohol: no health or performance claims." : ""}\n` +
      `JSON shape: {${p.channels.map((c) => `"${c}": {${p.langs.map((l) => `"${l}": {"title": string, "description": string, "keywords": string[]}`).join(", ")}}`).join(", ")}}`,
      () => demoListings(cur, maker, p.channels),
      { tier: "complex" },
    );
    setBusy(false); setError(r.error);
    await saveProduct(p, { brief: cur.brief, listings: r.data, listingsLive: r.live });
  };
  const markListed = async (ch: Channel) => {
    if (!ok) return toast("Blocked by the compliance gate.");
    await saveProduct(p, { listed: { ...p.listed, [ch]: now() } });
    toast(`Marked as listed on ${channelById(ch).name} (${channelById(ch).name} not connected yet).`);
  };

  return (
    <div className="stack">
      <Card title={p.name} aside={<>
        {ok ? <Badge tone="good">Compliance OK</Badge> : <Badge tone="bad">Blocked</Badge>}
        <ConfirmButton label="Delete" confirm="Delete product" onConfirm={() => { void remove(COL.products, p.id); onDeleted(); }} />
      </>}>
        {!ok && <div className="banner"><span>Listing and shipping are blocked: {gate(p).filter((g) => !g.ok).map((g) => g.label).join("; ")}.</span></div>}
        <div className="chips">
          {CHANNELS.map((c) => <button key={c.id} type="button" className={"chip" + (p.channels.includes(c.id) ? " chip-on" : "")} aria-pressed={p.channels.includes(c.id)} onClick={() => toggle(c.id)}>{c.name}</button>)}
        </div>
        <LangPicker value={p.langs} onChange={(v) => saveProduct(p, { langs: v })} options={MAKER_LANGS} />
        <Field label="Spanish brief"><TextArea id="mk-brief" rows={3} value={brief} onChange={setBrief} /></Field>
        <div className="row wrap">
          <Button kind="primary" busy={busy} disabled={!ok} onClick={write}>{p.listings ? "Rewrite listings" : "Write listings"} ({p.channels.length} × {p.langs.length})</Button>
          {brief !== p.brief && <Button small onClick={() => saveProduct(p, { brief: brief.trim() })}>Save brief</Button>}
          {p.listings && <Badge tone={p.listingsLive ? "accent" : "neutral"}>{p.listingsLive ? "AI draft" : "Demo draft"}</Badge>}
        </div>
        {error && <p className="small" style={{ color: "var(--warn)" }}>{error}</p>}
      </Card>
      {!p.listings ? <Empty>No listings yet.</Empty> : (
        <>
          <div className="chips">{p.langs.map((l) => <button key={l} type="button" className={"chip" + (lang === l ? " chip-on" : "")} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}</div>
          {p.channels.map((ch) => {
            const rule = channelById(ch);
            const t = p.listings?.[ch]?.[lang];
            return (
              <Card key={ch} title={rule.name} aside={p.listed?.[ch] ? <Badge tone="good">Listed {fmtDate(p.listed[ch])}</Badge> : <Button small disabled={!ok || !t} onClick={() => markListed(ch)}>Mark listed</Button>}>
                {!t ? <Empty>No {lang.toUpperCase()} text for {rule.name}. Rewrite listings to add it.</Empty> : (
                  <>
                    <div className="row between"><span className="strong">{t.title}</span><Badge tone={t.title.length > rule.titleMax ? "bad" : "good"}>{t.title.length}/{rule.titleMax}</Badge></div>
                    <AiOutput live={p.listingsLive} text={t.description} title={`Description · ${t.description.length}/${rule.descMax}`} />
                    <div className="row wrap">
                      {t.keywords.map((k) => <Badge key={k} tone={k.length > rule.kwLen ? "bad" : "neutral"}>{k}</Badge>)}
                      <span className="small faint">{t.keywords.length}/{rule.kwMax} {ch === "etsy" ? "tags" : "keywords"}</span>
                    </div>
                    <div className="row"><CopyButton text={`${t.title}\n\n${t.description}\n\n${t.keywords.join(", ")}`} label="Copy listing" /><span className="small faint">{rule.note}</span></div>
                  </>
                )}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

// --- Stock & prices ------------------------------------------------------------------------------

function NumCell({ value, onSave, step }: { value: number; onSave: (n: number) => void; step?: number }) {
  const id = useId();
  const [v, setV] = useState(String(value));
  const dirty = Number(v) !== value;
  return (
    <span className="row" style={{ minWidth: 110 }}>
      <Input id={"mk-num-" + id} type="number" step={step} value={v} onChange={setV} />
      {dirty && <Button small onClick={() => onSave(Number(v) || 0)}>Save</Button>}
    </span>
  );
}

function StockTab({ maker, products }: { maker: Client; products: Product[] }) {
  const low = products.filter((p) => p.stock <= p.lowStock);
  const stale = products.filter((p) => !p.lastSync || (p.stockChangedAt && p.stockChangedAt > p.lastSync));
  const syncAll = async () => {
    for (const p of products) await saveProduct(p, { lastSync: now() });
    toast("Marked as synced to Shopify, Etsy and Amazon.es (not connected yet; n8n would push these).");
  };
  const restock = async () => {
    for (const p of low) await put<Task>("tasks", { id: `${p.id}-restock`, createdAt: now(), title: `Restock ${p.name} (${p.stock} left) · ${maker.name}`, module: "makers", clientId: maker.id, due: dayOffset(2), done: false });
    toast(`${low.length} restock task(s) added to Today.`);
  };
  return (
    <>
      {low.length > 0 && (
        <div className="banner">
          <span><span className="strong">Low stock:</span> {low.map((p) => `${p.name} (${p.stock} left, alert at ${p.lowStock})`).join("; ")}</span>
          <Button small onClick={restock}>Add restock tasks</Button>
        </div>
      )}
      <Card title="One stock figure, every channel" aside={<>
        <span className="small muted">{stale.length ? `${stale.length} not synced` : "All synced"}</span>
        <Button kind="primary" small onClick={syncAll} disabled={!products.length}>Sync all channels</Button>
      </>}>
        <Table rows={products} rowKey={(p) => p.id} empty="No products yet."
          cols={[
            { label: "Product", render: (p) => <div className="stack-sm"><span className="strong">{p.name}</span>{p.stock <= p.lowStock && <Badge tone="warn">Low</Badge>}</div> },
            { label: "Stock", render: (p) => <NumCell value={p.stock} onSave={(n) => saveProduct(p, { stock: n, stockChangedAt: now() })} /> },
            { label: "Alert at", render: (p) => <NumCell value={p.lowStock} onSave={(n) => saveProduct(p, { lowStock: n })} /> },
            ...CHANNELS.map((c) => ({
              label: `${c.name} €`, render: (p: Product) => p.channels.includes(c.id)
                ? <NumCell step={0.1} value={p.prices[c.id] ?? 0} onSave={(n) => saveProduct(p, { prices: { ...p.prices, [c.id]: n }, stockChangedAt: now() })} />
                : <span className="faint small">not sold</span>,
            })),
            { label: "Sync", render: (p) => p.lastSync && !(p.stockChangedAt && p.stockChangedAt > p.lastSync) ? <span className="small muted">{fmtDate(p.lastSync)}</span> : <Badge tone="warn">pending</Badge> },
          ]} />
        <p className="small faint">Consumer prices per channel include marketplace fees. Amazon.es and Etsy prices are often set 5 to 10% above the own shop.</p>
      </Card>
    </>
  );
}

// --- Ads -----------------------------------------------------------------------------------------

function AdsTab({ maker, products }: { maker: Client; products: Product[] }) {
  const tier = tierOf(maker);
  const weeks = useCollection<AdsWeek>(COL.ads).filter((w) => w.clientId === maker.id).sort((a, b) => b.week.localeCompare(a.week));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const w = weeks[0];
  if (!tier.ads) return <Empty>Ads management is part of Growth and Pro. Starter covers one channel and listing upkeep.</Empty>;

  const pull = async () => {
    const week = isoWeek();
    const rows = simulateAds(products.filter(gateOk), week);
    if (!rows.length) return toast("No compliant products on Amazon.es or Shopify to advertise.");
    setBusy(true);
    const r = await aiJson<{ suggestions: Omit<Suggestion, "id" | "status">[] }>(
      `You are the ads agent for ${maker.name}, a Canarian producer. Weekly Amazon Ads and Google Shopping data per keyword (EUR): ${JSON.stringify(rows)}\n` +
      `Target ACoS 35%. Propose at most 6 changes: raise or lower bids (give current and proposed bid), add negative keywords for spend with no sales, pause waste, or add one new keyword. Short reason with the numbers.\n` +
      `JSON shape: {"suggestions": [{"channel": "Amazon Ads" | "Google Shopping", "action": "raise bid" | "lower bid" | "add keyword" | "add negative" | "pause", "target": string, "current": number | null, "proposed": number | null, "reason": string}]}`,
      () => ({ suggestions: demoSuggestions(rows) }),
    );
    setBusy(false); setError(r.error);
    const suggestions: Suggestion[] = r.data.suggestions.map((s, i) => ({ ...s, current: s.current ?? undefined, proposed: s.proposed ?? undefined, id: `s${i}`, status: "pending" }));
    await put<AdsWeek>(COL.ads, { id: `${maker.id}-${week}`, createdAt: now(), clientId: maker.id, week, rows, suggestions, live: r.live });
    await put<Task>("tasks", { id: `${maker.id}-${week}-ads`, createdAt: now(), title: `Approve ${suggestions.length} ad changes for ${maker.name}`, module: "makers", clientId: maker.id, due: today(), done: false });
  };
  const decide = async (s: Suggestion, status: Suggestion["status"]) => {
    if (!w) return;
    const suggestions = w.suggestions.map((x) => (x.id === s.id ? { ...x, status } : x));
    await put<AdsWeek>(COL.ads, { ...w, suggestions });
    if (status === "approved") toast(`Approved. Apply it in ${s.channel} (not connected yet).`);
    if (suggestions.every((x) => x.status !== "pending")) await put<Task>("tasks", { id: `${maker.id}-${w.week}-ads`, createdAt: now(), title: `Approve ad changes for ${maker.name}`, module: "makers", clientId: maker.id, done: true });
  };
  const spend = w?.rows.reduce((s, r) => s + r.spend, 0) ?? 0;
  const sales = w?.rows.reduce((s, r) => s + r.sales, 0) ?? 0;

  return (
    <>
      <Card title="Weekly ad review" aside={<Button kind="primary" busy={busy} onClick={pull}>Pull {isoWeek()} data and propose</Button>}>
        <p className="small muted">Ad data is simulated until Amazon Ads and Google Ads are connected. Nothing changes in the ad accounts: you approve, then apply.</p>
        {error && <p className="small" style={{ color: "var(--warn)" }}>{error}</p>}
      </Card>
      {!w ? <Empty>No ad review yet this week.</Empty> : (
        <>
          <Stats>
            <Stat label="Spend" value={eur(Math.round(spend))} sub={w.week} />
            <Stat label="Ad sales" value={eur(Math.round(sales))} />
            <Stat label="ACoS" value={sales ? `${Math.round((spend / sales) * 100)}%` : "-"} tone={sales && spend / sales <= 0.35 ? "good" : "warn"} sub="Target 35%" />
            <Stat label="Pending" value={w.suggestions.filter((s) => s.status === "pending").length} tone="accent" />
          </Stats>
          <div className="grid-2">
            <Card title="Proposed changes" aside={<Badge tone={w.live ? "accent" : "neutral"}>{w.live ? "AI draft" : "Demo draft"}</Badge>}>
              {w.suggestions.map((s) => (
                <div key={s.id} className="box stack-sm">
                  <div className="row between wrap">
                    <span className="row"><Badge tone="info">{s.action}</Badge><span className="strong mono small">{s.target}</span></span>
                    <span className="small muted">{s.channel}</span>
                  </div>
                  {s.current != null && s.proposed != null && <span className="small">Bid {eur(s.current)} to {eur(s.proposed)}</span>}
                  <span className="small muted">{s.reason}</span>
                  {s.status === "pending" ? (
                    <div className="row"><Button small kind="primary" onClick={() => decide(s, "approved")}>Approve</Button><Button small kind="ghost" onClick={() => decide(s, "rejected")}>Reject</Button></div>
                  ) : <Badge tone={s.status === "approved" ? "good" : "neutral"}>{s.status}</Badge>}
                </div>
              ))}
            </Card>
            <Card title="Keywords this week">
              <Table rows={w.rows} rowKey={(r) => r.channel + r.keyword} cols={[
                { label: "Keyword", render: (r) => <div className="stack-sm"><span className="mono small">{r.keyword}</span><span className="small faint">{r.channel}</span></div> },
                { label: "Clicks", num: true, render: (r) => r.clicks },
                { label: "Spend", num: true, render: (r) => eur(r.spend) },
                { label: "Sales", num: true, render: (r) => eur(r.sales) },
                { label: "ACoS", num: true, render: (r) => { const a = acos(r); return <Badge tone={a <= 0.35 ? "good" : a === Infinity ? "bad" : "warn"}>{a === Infinity ? "no sales" : `${Math.round(a * 100)}%`}</Badge>; } },
              ]} />
            </Card>
          </div>
        </>
      )}
    </>
  );
}

// --- Shipping and customs ------------------------------------------------------------------------

function ShippingTab({ maker, products }: { maker: Client; products: Product[] }) {
  const ships = useCollection<Shipment>(COL.ships).filter((s) => s.clientId === maker.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = ships.find((s) => s.id === openId) ?? ships[0];
  const newShipment = async () => {
    const s = await create<Shipment>(COL.ships, {
      clientId: maker.id, ref: `DUA-${today().slice(2, 7).replace("-", "")}-${String(ships.length + 1).padStart(2, "0")}`,
      destination: "mainland", country: "Spain (mainland)", consignee: "", address: "", incoterm: "DAP", consolidated: true, packages: 1, lines: [], status: "draft",
    });
    setOpenId(s.id);
  };
  return (
    <div className="split">
      <Card title="Shipments" aside={<Button small kind="primary" onClick={newShipment}>New shipment</Button>}>
        <p className="small muted">Prepares the commercial invoice and packing list the partner customs agent needs for each DUA. The agent files it; this app sends nothing.</p>
        <Table rows={ships} rowKey={(s) => s.id} onRow={(s) => setOpenId(s.id)} empty="No shipments yet."
          cols={[
            { label: "Ref", render: (s) => <div className="stack-sm"><span className="mono small">{s.ref}</span><span className="small muted">{s.consignee || "No consignee"}</span></div> },
            { label: "To", render: (s) => s.destination === "mainland" ? "Mainland" : s.country },
            { label: "Status", render: (s) => <Badge tone={s.status === "sent" ? "good" : s.status === "ready" ? "info" : "neutral"}>{s.status}</Badge> },
          ]} />
      </Card>
      {open ? <ShipmentDetail key={open.id} maker={maker} ship={open} products={products} onDeleted={() => setOpenId(null)} /> : <Empty>Open or start a shipment.</Empty>}
    </div>
  );
}

function ShipmentDetail({ maker, ship: s, products, onDeleted }: { maker: Client; ship: Shipment; products: Product[]; onDeleted: () => void }) {
  const tier = tierOf(maker);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [add, setAdd] = useState({ productId: products.find(gateOk)?.id ?? "", qty: "12" });
  const [f, setF] = useState({ consignee: s.consignee, address: s.address, country: s.country });
  const t = shipmentTotals(s, products);
  const saveShip = (patch: Partial<Shipment>) => put<Shipment>(COL.ships, { ...s, ...patch, status: patch.status ?? (s.status === "sent" ? "sent" : "draft") });
  const locked = s.status === "sent";

  const addLine = async () => {
    const p = products.find((x) => x.id === add.productId);
    if (!p) return toast("Pick a product.");
    if (!gateOk(p)) return toast(`${p.name} is blocked by the compliance gate and cannot ship.`);
    const qty = Number(add.qty) || 0;
    if (qty <= 0) return toast("Quantity must be above 0.");
    if (qty > p.stock) return toast(`Only ${p.stock} in stock.`);
    await saveShip({ lines: [...s.lines.filter((l) => l.productId !== p.id), { productId: p.id, qty }], hs: undefined, notes: undefined });
  };
  const prepare = async () => {
    if (!s.lines.length) return toast("Add at least one line.");
    if (!s.consignee.trim() || !s.address.trim()) return toast("Add the consignee and address.");
    setBusy(true);
    const r = await aiJson<{ hs: HsLine[]; notes: string[] }>(
      `Prepare customs data for a shipment from Tenerife (Canary Islands, outside the EU VAT area) for the partner customs agent who files the DUA.\n` +
      `Seller: ${maker.name}, ${maker.town}. Destination: ${s.destination === "mainland" ? "mainland Spain" : s.country} (${s.incoterm}${s.consolidated ? ", consolidated pallet" : ""}).\n` +
      `Lines: ${JSON.stringify(t.lines.map((l) => ({ productId: l.productId, name: l.product?.name, category: l.product ? catById(l.product.category).label : "", netQty: l.product?.netQty, abv: l.product?.abv ?? null, qty: l.qty, valueEUR: l.value, grossKg: l.gross })))}\n` +
      `1) Suggest a 6-digit HS code per line with a short description and confidence (high/medium/low); the agent confirms. 2) Notes for the agent: IGIC on the export invoice, import VAT at destination, excise if alcohol, incoterm consequence, and warn if the agent fee (~${eur(t.fee)}) is over 15% of the value.\n` +
      `JSON shape: {"hs": [{"productId": string, "code": string, "description": string, "confidence": "high" | "medium" | "low"}], "notes": string[]}`,
      () => demoCustomsNotes(s, products),
    );
    setBusy(false); setError(r.error);
    await saveShip({ hs: r.data.hs, notes: r.data.notes, live: r.live, status: "ready" });
  };
  const send = async () => {
    if (!tier.customs) return toast("Customs-agent coordination is part of Pro. Copy the data and send it yourself.");
    await saveShip({ status: "sent", sentAt: now() });
    toast("Marked as sent to the customs agent (email not connected yet).");
  };

  const hsFor = (id: string) => s.hs?.find((h) => h.productId === id);
  const docText = [
    `COMMERCIAL INVOICE ${s.ref} · ${fmtDate(s.createdAt)}`,
    `Seller: ${maker.name}, ${maker.town}, Tenerife, Canary Islands (ES) · NIF: [seller NIF]`,
    `Buyer/consignee: ${s.consignee}, ${s.address}, ${s.destination === "mainland" ? "Spain (mainland)" : s.country}`,
    `Incoterm: ${s.incoterm} · Currency: EUR · Origin: Canary Islands, Spain · Reason: sale`,
    ...t.lines.map((l) => `${l.qty} x ${l.product?.name ?? "?"} (${l.product?.netQty ?? ""}) · HS ${hsFor(l.productId)?.code ?? "?"} · ${eur(l.unit)} = ${eur(l.value)} · ${l.gross.toFixed(1)} kg gross`),
    `Total value: ${eur(t.value)} · IGIC 0% (exempt export) · Gross ${t.gross.toFixed(1)} kg · Net ${t.net.toFixed(1)} kg`,
    "",
    `PACKING LIST · ${s.packages} package(s)${s.consolidated ? " on consolidated pallet" : ""}`,
    ...t.lines.map((l) => `${l.product?.name ?? "?"}: ${l.qty} units, ${l.net.toFixed(1)} kg net, ${l.gross.toFixed(1)} kg gross`),
    "",
    "NOTES FOR THE AGENT",
    ...(s.notes ?? []).map((n) => `- ${n}`),
  ].join("\n");

  return (
    <div className="stack">
      <Card title={<span className="mono">{s.ref}</span>} aside={<>
        <Badge tone={s.status === "sent" ? "good" : s.status === "ready" ? "info" : "neutral"}>{s.status}{s.sentAt ? ` ${fmtDate(s.sentAt)}` : ""}</Badge>
        <ConfirmButton label="Delete" confirm="Delete shipment" onConfirm={() => { void remove(COL.ships, s.id); onDeleted(); }} />
      </>}>
        <div className="form-grid">
          <Field label="Destination"><Select<Shipment["destination"]> id="mk-s-dest" value={s.destination} onChange={(v) => saveShip({ destination: v, country: v === "mainland" ? "Spain (mainland)" : "Germany" })}
            options={[{ value: "mainland", label: "Mainland Spain" }, { value: "eu", label: "Other EU country" }]} /></Field>
          {s.destination === "eu" && <Field label="Country"><Select id="mk-s-country" value={s.country} onChange={(v) => saveShip({ country: v })} options={["Germany", "Netherlands", "Italy", "France", "Sweden", "Belgium", "Austria"]} /></Field>}
          <Field label="Incoterm"><Select<Shipment["incoterm"]> id="mk-s-inc" value={s.incoterm} onChange={(v) => saveShip({ incoterm: v })} options={["DAP", "DDP", "EXW"]} /></Field>
          <Field label="Packages"><Input id="mk-s-pk" type="number" min={1} value={s.packages} onChange={(v) => saveShip({ packages: Math.max(1, Number(v) || 1) })} /></Field>
          <Field label="Consignee"><Input id="mk-s-con" value={f.consignee} onChange={(v) => setF({ ...f, consignee: v })} /></Field>
          <Field label="Address"><Input id="mk-s-addr" value={f.address} onChange={(v) => setF({ ...f, address: v })} /></Field>
          {(f.consignee !== s.consignee || f.address !== s.address) && <Button small onClick={() => saveShip({ consignee: f.consignee.trim(), address: f.address.trim() })}>Save consignee</Button>}
          <label className="row small field-wide"><input type="checkbox" checked={s.consolidated} onChange={(e) => saveShip({ consolidated: e.target.checked })} />Consolidated pallet with other makers (shares one DUA, about {eur(AGENT_FEE.consolidatedShare)} instead of {eur(AGENT_FEE.single)})</label>
        </div>
      </Card>
      <Card title="Lines">
        {!locked && (
          <div className="form-grid">
            <Field label="Product"><Select id="mk-s-prod" value={add.productId} onChange={(v) => setAdd({ ...add, productId: v })}
              options={products.length ? products.map((p) => ({ value: p.id, label: `${p.name}${gateOk(p) ? "" : " (blocked)"}` })) : [{ value: "", label: "No products" }]} /></Field>
            <Field label="Units"><Input id="mk-s-qty" type="number" min={1} value={add.qty} onChange={(v) => setAdd({ ...add, qty: v })} /></Field>
            <Button onClick={addLine}>Add line</Button>
          </div>
        )}
        <Table rows={t.lines} rowKey={(l) => l.productId} empty="No lines yet." cols={[
          { label: "Product", render: (l) => <div className="stack-sm"><span className="strong">{l.product?.name ?? "Removed product"}</span><span className="small muted">{l.product?.netQty}</span></div> },
          { label: "HS code", render: (l) => { const h = hsFor(l.productId); return h ? <span className="stack-sm"><span className="mono">{h.code}</span><Badge tone={h.confidence === "high" ? "good" : h.confidence === "medium" ? "warn" : "bad"}>{h.confidence}</Badge></span> : <span className="faint small">after prepare</span>; } },
          { label: "Units", num: true, render: (l) => l.qty },
          { label: "Unit value", num: true, render: (l) => locked ? eur(l.unit) : <NumCell step={0.1} value={l.unit} onSave={(n) => saveShip({ lines: s.lines.map((x) => (x.productId === l.productId ? { ...x, unit: n } : x)) })} /> },
          { label: "Value", num: true, render: (l) => eur(l.value) },
          { label: "Gross kg", num: true, render: (l) => l.gross.toFixed(1) },
          { label: "", render: (l) => !locked && <Button small kind="ghost" onClick={() => saveShip({ lines: s.lines.filter((x) => x.productId !== l.productId) })}>Remove</Button> },
        ]} />
        <div className="row wrap small">
          <span className="strong">Total {eur(t.value)}</span><span>Gross {t.gross.toFixed(1)} kg</span><span>Net {t.net.toFixed(1)} kg</span>
          <span>Agent fee about {eur(t.fee)}</span>
          {t.value > 0 && <Badge tone={t.feeShare > 0.15 ? "bad" : "good"}>Fee {Math.round(t.feeShare * 100)}% of value</Badge>}
        </div>
        {t.value > 0 && t.feeShare > 0.15 && <p className="small" style={{ color: "var(--bad)" }}>Customs cost eats the margin on this shipment. Add units or wait for the next consolidated pallet.</p>}
        <p className="small faint">Unit value defaults to the own-shop price; set the wholesale price for B2B orders.</p>
      </Card>
      <Card title="Customs data for the agent" aside={<>
        <Button kind="primary" busy={busy} disabled={locked} onClick={prepare}>{s.hs ? "Prepare again" : "Prepare invoice and packing list"}</Button>
        <Button disabled={s.status !== "ready"} onClick={send} title={tier.customs ? undefined : "Pro tier"}>Send to customs agent</Button>
      </>}>
        {error && <p className="small" style={{ color: "var(--warn)" }}>{error}</p>}
        {!s.hs ? <Empty>Prepare to get HS code suggestions, IGIC and VAT notes and the documents.</Empty> : (
          <>
            <div className="stack-sm">{(s.notes ?? []).map((n, i) => <span key={i} className="small">{i + 1}. {n}</span>)}</div>
            <AiOutput title="Commercial invoice and packing list" live={s.live} mono text={docText} />
            {!tier.customs && <p className="small muted">{tier.name}: copy this and send it to the agent yourself. Pro includes coordination with the partner agent.</p>}
          </>
        )}
      </Card>
    </div>
  );
}

// --- Compliance ----------------------------------------------------------------------------------

function ComplianceTab({ products }: { products: Product[] }) {
  if (!products.length) return <Empty>No products yet.</Empty>;
  return (
    <>
      <Card title="Compliance gate">
        <p className="small muted">Only producers who are already compliant are onboarded. A product with any open item cannot get listings, be marked listed or ship. Registrations stay the maker's responsibility; this checks they exist.</p>
      </Card>
      <div className="grid-2">{products.map((p) => <GateCard key={p.id} product={p} />)}</div>
    </>
  );
}

function GateCard({ product: p }: { product: Product }) {
  const kind = catById(p.category).kind;
  const items = gate(p);
  const [f, setF] = useState({ rgseaa: p.sanitaryReg ?? "", cae: p.exciseCae ?? "", cpnp: p.cpnp ?? "", abv: p.abv ? String(p.abv) : "" });
  const dirty = f.rgseaa !== (p.sanitaryReg ?? "") || f.cae !== (p.exciseCae ?? "") || f.cpnp !== (p.cpnp ?? "") || f.abv !== (p.abv ? String(p.abv) : "");
  return (
    <Card title={p.name} aside={gateOk(p) ? <Badge tone="good">OK</Badge> : <Badge tone="bad">{items.filter((i) => !i.ok).length} open</Badge>}>
      <span className="small muted">{catById(p.category).label}</span>
      <div className="form-grid">
        {(kind === "food" || kind === "alcohol") && <Field label="RGSEAA no."><Input id={`mk-g-rg-${p.id}`} value={f.rgseaa} onChange={(v) => setF({ ...f, rgseaa: v })} placeholder="30.012345/TF" /></Field>}
        {kind === "alcohol" && <Field label="Excise CAE"><Input id={`mk-g-cae-${p.id}`} value={f.cae} onChange={(v) => setF({ ...f, cae: v })} placeholder="ES00038V..." /></Field>}
        {kind === "alcohol" && <Field label="Alcohol % vol"><Input id={`mk-g-abv-${p.id}`} type="number" step={0.5} value={f.abv} onChange={(v) => setF({ ...f, abv: v })} /></Field>}
        {kind === "cosmetic" && <Field label="CPNP ref. and responsible person" wide><Input id={`mk-g-cpnp-${p.id}`} value={f.cpnp} onChange={(v) => setF({ ...f, cpnp: v })} /></Field>}
      </div>
      {dirty && <div className="row"><Button small onClick={() => saveProduct(p, { sanitaryReg: f.rgseaa.trim() || undefined, exciseCae: f.cae.trim() || undefined, cpnp: f.cpnp.trim() || undefined, abv: Number(f.abv) || undefined }).then(() => toast("Saved."))}>Save registrations</Button></div>}
      <div className="stack-sm">
        {LABEL_ITEMS[kind].map((l) => (
          <label key={l.id} className="row small">
            <input type="checkbox" checked={p.label.includes(l.id)} onChange={(e) => saveProduct(p, { label: e.target.checked ? [...p.label, l.id] : p.label.filter((x) => x !== l.id) })} />
            {l.label}
          </label>
        ))}
      </div>
      {items.filter((i) => !i.ok && !i.id.startsWith("label-")).map((i) => <span key={i.id} className="small" style={{ color: "var(--bad)" }}>{i.label}</span>)}
    </Card>
  );
}

// --- Report --------------------------------------------------------------------------------------

function ReportTab({ maker, products }: { maker: Client; products: Product[] }) {
  const reports = useCollection<SalesReport>(COL.reports).filter((r) => r.clientId === maker.id).sort((a, b) => b.month.localeCompare(a.month));
  const ads = useCollection<AdsWeek>(COL.ads).filter((w) => w.clientId === maker.id);
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<string>();
  const [error, setError] = useState<string>();
  const rep = reports.find((r) => r.id === sel) ?? reports[0];
  const month = today().slice(0, 7);
  const plan = PLANS.find((p) => p.id === "p9")!;
  const tierPrice = maker.subs.find((s) => s.plan === "p9")?.price;

  const build = async () => {
    const rows = simulateSales(products.filter((p) => p.listed && Object.keys(p.listed).length).length ? products.filter((p) => p.listed) : products, month);
    const weekly = ads.length ? ads.reduce((s, w) => s + w.rows.reduce((x, r) => x + r.spend, 0), 0) / ads.length : 0;
    const base = { id: `${maker.id}-${month}`, createdAt: now(), clientId: maker.id, month, rows, adSpend: Math.round(weekly * 4.3) };
    await put<SalesReport>(COL.reports, base);
    setSel(base.id);
    toast("Simulated order data loaded (Shopify, Etsy and Amazon not connected yet).");
  };
  const summarise = async () => {
    if (!rep) return;
    setBusy(true); setStream("");
    const low = products.filter((p) => p.stock <= p.lowStock).map((p) => p.name);
    const r = await aiText(
      `Write the one-page monthly sales report for ${maker.name}, a Canarian producer in ${maker.town}. Spanish-speaking owner, but write in plain English for now. Under 180 words.\n` +
      `Sales by product and channel (EUR): ${JSON.stringify(rep.rows)}\nAd spend: ${eur(rep.adSpend)}\nLow stock: ${JSON.stringify(low)}\n` +
      `Sections: headline numbers, by channel, best seller, then exactly 3 numbered next actions. Review requests only to buyers who opted in. No invented numbers.`,
      () => demoReport(maker, rep, low),
      { onText: setStream },
    );
    setBusy(false); setStream(undefined); setError(r.error);
    await put<SalesReport>(COL.reports, { ...rep, summary: r.data, live: r.live });
  };
  const rev = rep?.rows.reduce((s, r) => s + r.revenue, 0) ?? 0;
  const units = rep?.rows.reduce((s, r) => s + r.units, 0) ?? 0;

  return (
    <>
      <Card title="Monthly sales report" aside={<>
        {reports.length > 1 && <Select id="mk-rep" value={rep?.id ?? ""} onChange={setSel} options={reports.map((r) => ({ value: r.id, label: r.month }))} />}
        <Button kind="primary" onClick={build} disabled={!products.length}>Pull {month} sales</Button>
      </>}>
        <p className="small muted">Sales figures are simulated until the shop and marketplace accounts are connected. Fee: {tierPrice ? `${eur(tierPrice)}/mo + 7% IGIC = ${eur(tierPrice * (1 + IGIC))}` : `pilot; paid tiers from ${eur(plan.tiers[0].price)}/mo`} · setup {eur(200)} to {eur(400)} once.</p>
      </Card>
      {!rep ? <Empty>No report yet.</Empty> : (
        <>
          <Stats>
            <Stat label="Sales" value={eur(Math.round(rev))} sub={rep.month} tone="good" />
            <Stat label="Units" value={units} />
            <Stat label="Ad spend" value={eur(rep.adSpend)} sub={rev ? `${Math.round((rep.adSpend / rev) * 100)}% of sales` : undefined} />
            <Stat label="Channels" value={new Set(rep.rows.map((r) => r.channel)).size} />
          </Stats>
          <div className="grid-2">
            <Card title="By product and channel">
              <Table rows={[...rep.rows].sort((a, b) => b.revenue - a.revenue)} rowKey={(r) => r.productId + r.channel} cols={[
                { label: "Product", render: (r) => r.name },
                { label: "Channel", render: (r) => channelById(r.channel).name },
                { label: "Units", num: true, render: (r) => r.units },
                { label: "Sales", num: true, render: (r) => eur(r.revenue) },
              ]} />
            </Card>
            <Card title="Summary and next actions" aside={<Button small busy={busy} onClick={summarise}>{rep.summary ? "Rewrite" : "Write summary"}</Button>}>
              {error && <p className="small" style={{ color: "var(--warn)" }}>{error}</p>}
              {stream != null ? <AiOutput text={stream || "Writing..."} live /> : rep.summary ? <AiOutput title={`Report ${rep.month}`} text={rep.summary} live={rep.live} /> : <Empty>Write the summary that goes in the one-page PDF.</Empty>}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

// --- Seed ----------------------------------------------------------------------------------------

export async function seed(): Promise<void> {
  const aloe: Client = example("ex-makers-c-aloe", {
    name: "Aloe Teide Natural", kind: "Cosmetics maker", town: "Güímar", contact: "Nayra González", phone: "+34 922 000 110", email: "hola@aloeteide.es",
    stage: "paid", subs: [{ plan: "p9", tier: "Pro", price: 500, setup: 300, startedAt: dayOffset(-70) }], consents: [],
    languages: ["es", "en", "de", "it"], notes: "Organic aloe farm shop. Sells to German and Italian tourists; wants repeat orders online.",
  }) as Client;
  await put("clients", aloe);

  const bodega = { id: EX.bodega, name: "Bodega Las Lajas", town: "Tacoronte" } as Client;
  const allLabels = (c: Category) => LABEL_ITEMS[catById(c).kind].map((l) => l.id);
  const mk = (id: string, p: Omit<Product, "id" | "createdAt">, maker: Client, withListings = true): Product => {
    const rec = example(id, p) as Product;
    if (withListings) { rec.listings = demoListings(rec, maker, rec.channels); rec.listingsLive = false; }
    return rec;
  };
  const products: Product[] = [
    mk("ex-makers-p1", {
      clientId: EX.bodega, name: "Tinto Tradicional 2024", category: "wine", netQty: "750 ml", weightKg: 1.4, abv: 13, stock: 140, lowStock: 24,
      brief: "Tinto joven de listán negro y negramoll, DO Tacoronte-Acentejo. Viñedos a 600 m sobre el mar, vendimia a mano. Afrutado, ideal con carne de cabra y queso curado.",
      prices: { shopify: 14.5, amazon: 15.9 }, channels: ["shopify", "amazon"], langs: ["es", "en", "de", "it"],
      sanitaryReg: "30.014572/TF", exciseCae: "ES00038V0021B", label: allLabels("wine"), listed: { shopify: dayOffset(-12) }, lastSync: dayOffset(-1),
    }, bodega),
    mk("ex-makers-p2", {
      clientId: EX.bodega, name: "Malvasía Dulce", category: "wine", netQty: "500 ml", weightKg: 1.0, abv: 14.5, stock: 9, lowStock: 12,
      brief: "Malvasía aromática dulce, vendimia tardía. Botella de 50 cl. Para postres y quesos azules.",
      prices: { shopify: 22, amazon: 23.9 }, channels: ["shopify", "amazon"], langs: ["es", "en", "de", "it"],
      sanitaryReg: "30.014572/TF", exciseCae: "ES00038V0021B", label: ["abv", "lot", "net", "operator"], lastSync: dayOffset(-1),
    }, bodega, false),
    mk("ex-makers-p3", {
      clientId: EX.bodega, name: "Mojo Rojo Picón de la Bodega", category: "mojo", netQty: "200 g", weightKg: 0.35, stock: 60, lowStock: 15,
      brief: "Mojo rojo picón hecho en la bodega con pimienta palmera, ajo, comino y aceite de oliva. Sin conservantes.",
      prices: { shopify: 5.9 }, channels: ["shopify"], langs: ["es", "en", "de", "it"],
      sanitaryReg: "30.014572/TF", label: ["ingredients", "allergen", "date", "net", "operator"], lastSync: dayOffset(-1),
    }, bodega, false),
    mk("ex-makers-p4", {
      clientId: aloe.id, name: "Gel Puro de Aloe Vera 99%", category: "cosmetic", netQty: "200 ml", weightKg: 0.28, stock: 320, lowStock: 40,
      brief: "Gel de aloe vera 99% de hoja fresca de nuestra finca en Güímar. Prensado en frío, sin alcohol ni perfume. Para después del sol.",
      prices: { etsy: 16.9, shopify: 15.9 }, channels: ["etsy", "shopify"], langs: ["es", "en", "de", "it", "fr"],
      cpnp: "CPNP 3897214 · RP: Aloe Teide Natural SL, Güímar", label: allLabels("cosmetic"), listed: { etsy: dayOffset(-40), shopify: dayOffset(-40) }, lastSync: dayOffset(0),
    }, aloe),
    mk("ex-makers-p5", {
      clientId: aloe.id, name: "Jabón de Aloe y Gofio", category: "cosmetic", netQty: "100 g", weightKg: 0.14, stock: 18, lowStock: 20,
      brief: "Jabón artesanal en frío con aloe de la finca y gofio de millo como exfoliante suave. Cortado a mano.",
      prices: { etsy: 7.5, shopify: 6.9 }, channels: ["etsy", "shopify"], langs: ["es", "en", "de", "it"],
      label: ["inci", "batch", "function"], stockChangedAt: dayOffset(0), lastSync: dayOffset(-3),
    }, aloe, false),
  ];
  for (const p of products) await put(COL.products, p);

  const week = isoWeek();
  const rows = simulateAds([products[3]], week);
  await put(COL.ads, example(`${aloe.id}-${week}`, { clientId: aloe.id, week, rows, suggestions: demoSuggestions(rows), live: false }));
  await put<Task>("tasks", example(`${aloe.id}-${week}-ads`, { title: "Approve this week's ad changes for Aloe Teide Natural", module: "makers", clientId: aloe.id, due: dayOffset(0), done: false }) as Task);
  await put<Task>("tasks", example("ex-makers-restock", { title: "Restock Malvasía Dulce (9 left) · Bodega Las Lajas", module: "makers", clientId: EX.bodega, due: dayOffset(2), done: false }) as Task);

  const s1: Shipment = example("ex-makers-s1", {
    clientId: EX.bodega, ref: "DUA-2610-01", destination: "mainland", country: "Spain (mainland)", consignee: "Vinoteca La Despensa SL",
    address: "Calle de Sueca 21, 46006 Valencia", incoterm: "DAP", consolidated: true, packages: 6, lines: [{ productId: "ex-makers-p1", qty: 36, unit: 8.9 }], status: "ready",
  }) as Shipment;
  Object.assign(s1, demoCustomsNotes(s1, products), { live: false });
  const s2: Shipment = example("ex-makers-s2", {
    clientId: aloe.id, ref: "DUA-2610-02", destination: "eu", country: "Germany", consignee: "Naturkosmetik Elbe GmbH",
    address: "Ottenser Hauptstraße 10, 22765 Hamburg", incoterm: "DAP", consolidated: false, packages: 2, lines: [{ productId: "ex-makers-p4", qty: 48, unit: 9.5 }], status: "sent", sentAt: dayOffset(-4),
  }) as Shipment;
  Object.assign(s2, demoCustomsNotes(s2, products), { live: false });
  await put(COL.ships, s1);
  await put(COL.ships, s2);

  const prevMonth = dayOffset(-30).slice(0, 7);
  const sales = simulateSales(products.filter((p) => p.clientId === aloe.id), prevMonth);
  const rep = { month: prevMonth, rows: sales, adSpend: 182 };
  await put(COL.reports, example("ex-makers-r1", { clientId: aloe.id, ...rep, summary: demoReport(aloe, rep, ["Jabón de Aloe y Gofio"]), live: false }));
}
