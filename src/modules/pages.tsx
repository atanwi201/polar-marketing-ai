// Plan 3 · Multilingual Activity Pages: matrix -> writer -> QA -> sitemap -> rankings, plus the free audit lead magnet.
import { useState } from "react";
import { BRAND } from "../core/brand";
import {
  Page, Card, Button, Field, Input, TextArea, Select, Form, Tabs, Badge, Stat, Stats, Table, Empty, AiOutput,
  LangPicker, LangTag, ClientPicker, ConfirmButton, toast, fmtDate, type Tone,
} from "../core/ui";
import { useCollection, put, create, remove, now, today } from "../core/store";
import { aiJson, aiText } from "../core/ai";
import { eur, LANGS, TOWNS } from "../core/plans";
import { EX, example, dayOffset } from "../core/seed";
import type { Client, Lang, Task } from "../core/types";
import {
  COL, AUDIT_LANGS, SPOTS, SEASONS, THIN_WORDS, tierOf, comboKey, pageCount, hreflangTags, sitemapXml, schemaFor, pagePath,
  demoPage, localQa, demoFactCheck, simulateRanks, demoAudit, demoSummary,
  type Project, type Activity, type SitePage, type PageLang, type Issue, type RankReport, type Audit, type AuditResult, type PageStatus,
} from "./pages-data";

type TabId = "matrix" | "writer" | "qa" | "sitemap" | "rankings" | "audit";
const statusTone: Record<PageStatus, Tone> = { draft: "neutral", flagged: "bad", approved: "info", published: "good" };
const sevTone: Record<Issue["severity"], Tone> = { high: "bad", medium: "warn", low: "neutral" };
const ALL_LANGS = Object.keys(LANGS) as Lang[];
const saveProject = (p: Project, patch: Partial<Project>) => put<Project>(COL.projects, { ...p, ...patch });
const savePage = (p: SitePage, patch: Partial<SitePage>) => put<SitePage>(COL.pages, { ...p, ...patch });

export default function Screen() {
  const projects = useCollection<Project>(COL.projects);
  const pages = useCollection<SitePage>(COL.pages);
  const clients = useCollection<Client>("clients");
  const [tab, setTab] = useState<TabId>("matrix");
  const [pid, setPid] = useState("");
  const [openPage, setOpenPage] = useState<string | null>(null);
  const project = projects.find((p) => p.id === pid) ?? projects[0];
  const client = clients.find((c) => c.id === project?.clientId);
  const sitePages = pages.filter((p) => p.projectId === project?.id);
  const flagged = sitePages.filter((p) => p.status === "flagged").length;

  return (
    <Page plan="Plan 3 · Multilingual Activity Pages" title="Activity pages"
      intro="One page per activity, location and language, written from the operator's own data, checked by a QA agent and capped per site so Google never sees thin, mass-made pages."
      actions={project && projects.length > 1 ? (
        <Select id="pg-proj" value={project.id} onChange={(v) => { setPid(v); setOpenPage(null); }} options={projects.map((p) => ({ value: p.id, label: p.brand }))} />
      ) : undefined}>
      <Tabs<TabId> value={tab} onChange={setTab} tabs={[
        { id: "matrix", label: "Matrix" }, { id: "writer", label: "Pages", count: sitePages.length }, { id: "qa", label: "QA", count: flagged || undefined },
        { id: "sitemap", label: "Sitemap" }, { id: "rankings", label: "Rankings" }, { id: "audit", label: "Free audit" },
      ]} />
      {tab === "audit" ? <AuditTab /> : !project ? <NewProject clients={clients} onCreated={setPid} /> : (
        <>
          {tab === "matrix" && <MatrixTab project={project} client={client} generated={sitePages.length} />}
          {tab === "writer" && <WriterTab project={project} client={client} pages={sitePages} openId={openPage} setOpenId={setOpenPage} />}
          {tab === "qa" && <QaTab project={project} pages={sitePages} onOpen={(id) => { setOpenPage(id); setTab("writer"); }} />}
          {tab === "sitemap" && <SitemapTab project={project} pages={sitePages} />}
          {tab === "rankings" && <RankingsTab project={project} client={client} pages={sitePages} />}
        </>
      )}
      {tab === "matrix" && project && <NewProjectCard clients={clients} onCreated={setPid} />}
    </Page>
  );
}

// --- Projects ------------------------------------------------------------------------------------

function NewProjectForm({ clients, onCreated }: { clients: Client[]; onCreated: (id: string) => void }) {
  const [picked, setClientId] = useState("");
  const clientId = picked || (clients.find((c) => c.subs.some((s) => s.plan === "p3"))?.id ?? clients[0]?.id ?? "");
  const [domain, setDomain] = useState("");
  const c = clients.find((x) => x.id === clientId);
  if (!clients.length) return <Empty>Add a client first, then build their site.</Empty>;
  return (
    <Form onSubmit={async () => {
      if (!c) return toast("Pick a client.");
      const p = await create<Project>(COL.projects, {
        clientId, brand: c.name, domain: domain.trim() || slugDomain(c.name), bookingUrl: `https://${domain.trim() || slugDomain(c.name)}/book`,
        whatsapp: c.phone, activities: [], locations: [c.town], localFacts: {}, langs: (["es", "en", "de"] as Lang[]), excluded: [], seasonal: false,
      });
      toast("Site project created. Add activities next."); setDomain(""); onCreated(p.id);
    }}>
      <Field label="Client"><ClientPicker id="pg-np-client" clients={clients} value={clientId} onChange={setClientId} /></Field>
      <Field label="Domain"><Input id="pg-np-domain" value={domain} onChange={setDomain} placeholder="mytours-tenerife.com" /></Field>
      <Button kind="primary" type="submit">Create site</Button>
    </Form>
  );
}
const slugDomain = (n: string) => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "") + "-tenerife.com";

function NewProject(props: { clients: Client[]; onCreated: (id: string) => void }) {
  return <Card title="Start a site"><p className="small muted">Each site belongs to one operator. Starter sites get 30 pages in 3 languages.</p><NewProjectForm {...props} /></Card>;
}
function NewProjectCard(props: { clients: Client[]; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return open ? <Card title="Another site" aside={<Button small kind="ghost" onClick={() => setOpen(false)}>Close</Button>}><NewProjectForm {...props} onCreated={(id) => { setOpen(false); props.onCreated(id); }} /></Card>
    : <div className="row"><Button small kind="ghost" onClick={() => setOpen(true)}>Add another site</Button></div>;
}

// --- Matrix --------------------------------------------------------------------------------------

function MatrixTab({ project, client, generated }: { project: Project; client?: Client; generated: number }) {
  const tier = tierOf(client);
  const count = pageCount(project);
  const over = count.total > tier.pages;
  const langOver = project.langs.length > tier.langs;
  const [act, setAct] = useState<{ name: string; price: string; duration: string; facts: string }>({ name: "", price: "", duration: "", facts: "" });
  const [spot, setSpot] = useState("");
  const allLocs = [...new Set([...TOWNS, ...SPOTS, ...project.locations])];

  const addActivity = async () => {
    if (!act.name.trim() || !Number(act.price)) return toast("Name and price are needed.");
    if (project.activities.some((a) => a.name === act.name.trim())) return toast("That activity is already there.");
    await saveProject(project, { activities: [...project.activities, { name: act.name.trim(), price: Number(act.price), duration: act.duration.trim(), facts: act.facts.trim() }] });
    setAct({ name: "", price: "", duration: "", facts: "" });
  };
  const toggleLoc = (l: string) => saveProject(project, { locations: project.locations.includes(l) ? project.locations.filter((x) => x !== l) : [...project.locations, l] });
  const toggleCombo = (a: string, l: string) => {
    const k = comboKey(a, l);
    return saveProject(project, { excluded: project.excluded.includes(k) ? project.excluded.filter((x) => x !== k) : [...project.excluded, k] });
  };

  return (
    <>
      <Stats>
        <Stat label="Pages planned" value={`${count.total} / ${tier.pages}`} tone={over ? "bad" : "good"} sub={`${tier.name} cap`} />
        <Stat label="Languages" value={`${project.langs.length} / ${tier.langs}`} tone={langOver ? "bad" : undefined} />
        <Stat label="Combinations" value={count.combos} sub={`${project.activities.length} activities × ${project.locations.length} locations`} />
        <Stat label="Written" value={generated} sub="activity × location pages" tone="accent" />
      </Stats>
      <div className="bar"><span style={{ width: `${Math.min(100, (count.total / tier.pages) * 100)}%`, background: over ? "var(--bad)" : undefined }} /></div>
      {(over || langOver) && (
        <div className="banner">
          <span>{over ? `${count.total} pages is over the ${tier.name} cap of ${tier.pages}. ` : ""}{langOver ? `${project.langs.length} languages; this tier includes ${tier.langs}. ` : ""}Untick combinations that make no sense or upgrade. The cap protects the site from thin-content penalties.</span>
        </div>
      )}
      <div className="grid-2">
        <Card title="Activities (client data)" aside={<span className="small muted">The QA agent checks every page against this</span>}>
          <Table rows={project.activities} rowKey={(a) => a.name} empty="No activities yet. Add what the operator sells, with real prices."
            cols={[
              { label: "Activity", render: (a) => <div className="stack-sm"><span className="strong">{a.name}</span><span className="small muted">{a.facts}</span></div> },
              { label: "Price", num: true, render: (a) => eur(a.price) },
              { label: "Duration", render: (a) => a.duration },
              { label: "", render: (a) => <ConfirmButton label="Remove" confirm="Remove" onConfirm={() => saveProject(project, { activities: project.activities.filter((x) => x.name !== a.name) })} /> },
            ]} />
          <Form onSubmit={addActivity}>
            <Field label="Activity"><Input id="pg-a-name" value={act.name} onChange={(v) => setAct({ ...act, name: v })} placeholder="Whale watching" /></Field>
            <Field label="Price (EUR)"><Input id="pg-a-price" type="number" min={0} value={act.price} onChange={(v) => setAct({ ...act, price: v })} /></Field>
            <Field label="Duration"><Input id="pg-a-dur" value={act.duration} onChange={(v) => setAct({ ...act, duration: v })} placeholder="3 hours" /></Field>
            <Field label="Facts" wide hint="Only what is true: what is included, ages, group size."><Input id="pg-a-facts" value={act.facts} onChange={(v) => setAct({ ...act, facts: v })} /></Field>
            <Button type="submit">Add activity</Button>
          </Form>
        </Card>
        <Card title="Locations and languages">
          <div className="chips">
            {allLocs.map((l) => <button key={l} type="button" className={"chip" + (project.locations.includes(l) ? " chip-on" : "")} aria-pressed={project.locations.includes(l)} onClick={() => toggleLoc(l)}>{l}</button>)}
          </div>
          <div className="row"><Input id="pg-spot" value={spot} onChange={setSpot} placeholder="Other spot, e.g. Playa de Ajabo" />
            <Button small onClick={() => { if (spot.trim()) { void toggleLoc(spot.trim()); setSpot(""); } }}>Add</Button></div>
          <hr className="divider" />
          <span className="small strong">Unique local fact per location</span>
          {project.locations.map((l) => <LocalFact key={l} project={project} location={l} />)}
          <hr className="divider" />
          <Field label={`Languages (${tier.name}: up to ${tier.langs})`}><LangPicker value={project.langs} onChange={(v) => saveProject(project, { langs: v })} options={ALL_LANGS} /></Field>
        </Card>
      </div>
      <Card title="Activity × location matrix" aside={
        <label className="row small"><input type="checkbox" checked={project.seasonal} disabled={!tier.seasonal}
          onChange={(e) => saveProject(project, { seasonal: e.target.checked })} />Seasonal pages ({SEASONS.join(", ")}){!tier.seasonal && " · Pro"}</label>}>
        {!project.activities.length || !project.locations.length ? <Empty>Add at least one activity and one location.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Activity</th>{project.locations.map((l) => <th key={l} className="num">{l}</th>)}</tr></thead>
              <tbody>
                {project.activities.map((a) => (
                  <tr key={a.name}><td className="strong">{a.name}</td>
                    {project.locations.map((l) => {
                      const on = !project.excluded.includes(comboKey(a.name, l));
                      return <td key={l} className="num"><input type="checkbox" aria-label={`${a.name} in ${l}`} checked={on} onChange={() => toggleCombo(a.name, l)} /></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">{count.combos} combinations{count.seasonal ? ` + ${count.seasonal} seasonal` : ""} × {project.langs.length} languages = {count.total} pages.</p>
      </Card>
      <Card title="Site settings">
        <div className="form-grid">
          <SettingField project={project} k="brand" label="Brand" />
          <SettingField project={project} k="domain" label="Domain" />
          <SettingField project={project} k="bookingUrl" label="Booking button URL" />
          <SettingField project={project} k="whatsapp" label="WhatsApp number" />
        </div>
        <p className="small faint">Builder: Astro on Cloudflare Pages (not connected here). Pages are marked as published; nothing is deployed from this app.</p>
      </Card>
    </>
  );
}

function SettingField({ project, k, label }: { project: Project; k: "brand" | "domain" | "bookingUrl" | "whatsapp"; label: string }) {
  const [v, setV] = useState(project[k]);
  return <Field label={label}><div className="row"><Input id={`pg-set-${k}`} value={v} onChange={setV} />{v !== project[k] && <Button small onClick={() => saveProject(project, { [k]: v.trim() })}>Save</Button>}</div></Field>;
}
function LocalFact({ project, location }: { project: Project; location: string }) {
  const saved = project.localFacts[location] ?? "";
  const [v, setV] = useState(saved);
  return (
    <Field label={location} hint={saved ? undefined : "Missing: pages here will be flagged as thin-content risk"}>
      <div className="row"><Input id={`pg-lf-${location}`} value={v} onChange={setV} placeholder="A detail only a local knows" />
        {v !== saved && <Button small onClick={() => saveProject(project, { localFacts: { ...project.localFacts, [location]: v.trim() } })}>Save</Button>}</div>
    </Field>
  );
}

// --- Writer --------------------------------------------------------------------------------------

function WriterTab({ project, client, pages, openId, setOpenId }: { project: Project; client?: Client; pages: SitePage[]; openId: string | null; setOpenId: (id: string | null) => void }) {
  const tier = tierOf(client);
  const combos = project.activities.flatMap((a) => project.locations.filter((l) => !project.excluded.includes(comboKey(a.name, l))).map((l) => ({ a, l })));
  const [sel, setSel] = useState(combos[0] ? comboKey(combos[0].a.name, combos[0].l) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const open = pages.find((p) => p.id === openId);
  const used = pages.reduce((s, p) => s + Object.keys(p.content).length, 0);
  const exists = pages.find((p) => comboKey(p.activity, p.location) === sel);

  const write = async (existing?: SitePage) => {
    const [an, loc] = (existing ? comboKey(existing.activity, existing.location) : sel).split("|");
    const a = project.activities.find((x) => x.name === an);
    if (!a || !loc) return toast("Pick a combination from the matrix.");
    if (!existing && used + project.langs.length > tier.pages) return toast(`This would pass the ${tier.pages}-page cap of ${tier.name}.`);
    setBusy(true);
    const r = await aiJson<{ content: Partial<Record<Lang, PageLang>> }>(
      `Write one SEO landing page for a Tenerife activity, in each language below. Native-quality, written for travellers from each country, not translated word for word.\n` +
      `Business: ${project.brand}, site ${project.domain}, booking ${project.bookingUrl}, WhatsApp ${project.whatsapp}.\n` +
      `Activity (client data, the only source of facts): ${JSON.stringify(a)}\nLocation: ${loc}, Tenerife. Local fact from the client: ${project.localFacts[loc] ?? "none given; do not invent one"}.\n` +
      `Rules: never invent prices, distances, pickups or guarantees. Price must be ${eur(a.price)}. Body 250 to 450 words in Markdown with ## subheadings, a booking/WhatsApp call to action, no ranking promises.\n` +
      `Title max 60 characters, meta description max 155, slug lowercase ASCII with hyphens, 3 to 5 FAQ items.\n` +
      `Languages: ${project.langs.map((l) => `${LANGS[l]} (${l})`).join(", ")}.\n` +
      `JSON shape: {"content": {${project.langs.map((l) => `"${l}": {"slug": string, "title": string, "meta": string, "h1": string, "body": string, "faq": [{"q": string, "a": string}]}`).join(", ")}}}`,
      () => ({ content: demoPage(project, a, loc, project.langs).content }),
      { tier: "complex" },
    );
    setBusy(false); setError(r.error);
    const schema = schemaFor(project, a, loc, r.data.content);
    if (existing) {
      await savePage(existing, { content: r.data.content, schema, live: r.live, status: "draft", qa: undefined, refreshedAt: now() });
      toast("Page refreshed. Run QA again before publishing.");
    } else {
      const pg = await create<SitePage>(COL.pages, { projectId: project.id, clientId: project.clientId, activity: a.name, location: loc, content: r.data.content, schema, live: r.live, status: "draft" });
      setOpenId(pg.id);
    }
  };

  return (
    <div className="split">
      <div className="stack">
        <Card title="Write a page">
          <Field label="Activity × location">
            <Select id="pg-combo" value={sel} onChange={setSel} options={combos.length ? combos.map(({ a, l }) => ({ value: comboKey(a.name, l), label: `${a.name} · ${l}` })) : [{ value: "", label: "No combinations in the matrix" }]} />
          </Field>
          <div className="row wrap">{project.langs.map((l) => <LangTag key={l} lang={l} />)}</div>
          <p className="small muted">{used} of {tier.pages} language pages used.</p>
          {exists ? <Button onClick={() => setOpenId(exists.id)}>Open existing page</Button>
            : <Button kind="primary" busy={busy} disabled={!combos.length} onClick={() => write()}>Write page in {project.langs.length} languages</Button>}
          {error && <p className="small" style={{ color: "var(--warn)" }}>{error}</p>}
        </Card>
        <Card title="Pages">
          <Table rows={pages} rowKey={(p) => p.id} onRow={(p) => setOpenId(p.id)} empty="No pages yet."
            cols={[
              { label: "Page", render: (p) => <div className="stack-sm"><span className="strong">{p.activity}</span><span className="small muted">{p.location}</span></div> },
              { label: "Status", render: (p) => <Badge tone={statusTone[p.status]}>{p.status}</Badge> },
              { label: "Issues", num: true, render: (p) => p.qa ? p.qa.issues.length : <span className="faint">-</span> },
            ]} />
        </Card>
      </div>
      {open ? <PageView page={open} project={project} pages={pages} refreshAllowed={tier.refresh} busy={busy} onRewrite={() => write(open)} onClose={() => setOpenId(null)} />
        : <Empty>Open a page to see every language, the schema and hreflang tags.</Empty>}
    </div>
  );
}

async function runQa(pg: SitePage, project: Project, pages: SitePage[]): Promise<Issue[]> {
  const local = localQa(pg, project, pages.filter((p) => p.id !== pg.id));
  const act = project.activities.find((a) => a.name === pg.activity);
  const r = await aiJson<{ issues: Issue[] }>(
    `You are a QA agent for multilingual activity pages. Compare the page text with the client's data and list every claim that is not supported or conflicts (prices, durations, ages, pickups, inclusions, guarantees, ranking promises).\n` +
    `Client data: ${JSON.stringify(act ?? null)}\nLocal fact: ${project.localFacts[pg.location] ?? "none"}\nPage: ${JSON.stringify(pg.content)}\n` +
    `JSON shape: {"issues": [{"lang": "es" | "en" | ..., "severity": "high" | "medium" | "low", "kind": "fact" | "price", "text": string}]} . Empty list if all is fine.`,
    () => ({ issues: demoFactCheck(pg, project) }),
    { tier: "quick" },
  );
  return [...local, ...(r.data.issues ?? [])];
}

async function applyQa(pg: SitePage, issues: Issue[]) {
  const high = issues.some((i) => i.severity === "high");
  const status: PageStatus = high ? "flagged" : pg.status === "flagged" ? "draft" : pg.status;
  await savePage(pg, { qa: { issues, at: now(), live: false }, status });
  const taskId = `${pg.id}-qa`;
  await put<Task>("tasks", { id: taskId, createdAt: now(), title: `Review flagged page: ${pg.activity} · ${pg.location}`, module: "pages", clientId: pg.clientId, due: today(), done: !high });
}

function PageView({ page, project, pages, refreshAllowed, busy, onRewrite, onClose }: {
  page: SitePage; project: Project; pages: SitePage[]; refreshAllowed: boolean; busy: boolean; onRewrite: () => void; onClose: () => void;
}) {
  const langs = Object.keys(page.content) as Lang[];
  const [lang, setLang] = useState<Lang>(langs[0] ?? "es");
  const [checking, setChecking] = useState(false);
  const c = page.content[lang] ?? page.content[langs[0]];
  const high = page.qa?.issues.filter((i) => i.severity === "high") ?? [];
  const age = (Date.now() - new Date(page.refreshedAt ?? page.createdAt).getTime()) / 864e5;
  const qa = async () => { setChecking(true); const issues = await runQa(page, project, pages); setChecking(false); await applyQa(page, issues); toast(issues.length ? `${issues.length} issue(s) found.` : "No issues found."); };
  if (!c) return <Empty>This page has no content.</Empty>;
  return (
    <Card title={`${page.activity} · ${page.location}`} aside={<>
      <Badge tone={statusTone[page.status]}>{page.status}</Badge>
      <Button small kind="ghost" onClick={onClose}>Close</Button>
    </>}>
      <div className="row wrap">
        <Button small busy={checking} onClick={qa}>Run QA</Button>
        <Button small kind="primary" disabled={!page.qa || high.length > 0 || page.status === "published"}
          title={!page.qa ? "Run QA first" : high.length ? "Fix high-severity issues first" : undefined}
          onClick={() => savePage(page, { status: "approved" }).then(() => toast("Approved."))}>Approve</Button>
        <Button small disabled={page.status !== "approved"} onClick={() => savePage(page, { status: "published", publishedAt: now() }).then(() => toast("Marked as published (Cloudflare Pages not connected yet)."))}>Publish</Button>
        <Button small kind="ghost" busy={busy} disabled={!refreshAllowed && page.status === "published"} onClick={onRewrite}
          title={refreshAllowed ? "Monthly refresh" : "Monthly refresh is part of Growth and Pro"}>{refreshAllowed && age > 30 ? "Refresh (due)" : "Rewrite"}</Button>
        <ConfirmButton label="Delete" confirm="Delete page" onConfirm={() => { void remove(COL.pages, page.id); onClose(); }} />
      </div>
      <div className="chips">{langs.map((l) => <button key={l} type="button" className={"chip" + (l === lang ? " chip-on" : "")} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}</div>
      {page.qa && page.qa.issues.length > 0 && (
        <div className="stack-sm">
          {page.qa.issues.filter((i) => !i.lang || i.lang === lang).map((i, n) => (
            <div key={n} className="row small"><Badge tone={sevTone[i.severity]}>{i.kind}</Badge><span>{i.lang ? `${i.lang.toUpperCase()}: ` : ""}{i.text}</span></div>
          ))}
        </div>
      )}
      <div className="box stack-sm">
        <span className="small faint mono">https://{project.domain}{pagePath(lang, c.slug)}</span>
        <span className="strong" style={{ color: "var(--accent)" }}>{c.title}</span>
        <span className="small muted">{c.meta}</span>
        <span className="row small faint"><span>Title {c.title.length}/60</span><span>Meta {c.meta.length}/155</span><span>Body {c.body.split(/\s+/).filter(Boolean).length} words (min {THIN_WORDS})</span></span>
      </div>
      <AiOutput title={`H1: ${c.h1}`} live={page.live} text={c.body} />
      <div className="stack-sm">
        <span className="small strong">FAQ</span>
        {c.faq.map((f, i) => <div key={i} className="box small"><span className="strong">{f.q}</span><br />{f.a}</div>)}
      </div>
      <AiOutput title="JSON-LD schema" live={page.live} mono text={`<script type="application/ld+json">\n${page.schema}\n</script>`} />
      <AiOutput title="hreflang tags" live={page.live} mono text={hreflangTags(project.domain, page.content)} />
    </Card>
  );
}

// --- QA queue ------------------------------------------------------------------------------------

function QaTab({ project, pages, onOpen }: { project: Project; pages: SitePage[]; onOpen: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const rows = pages.flatMap((p) => (p.qa?.issues ?? []).map((i, n) => ({ ...i, page: p, key: `${p.id}-${n}` })))
    .sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity));
  const unchecked = pages.filter((p) => !p.qa).length;
  const runAll = async () => {
    setBusy(true);
    for (const p of pages) await applyQa(p, await runQa(p, project, pages));
    setBusy(false); toast(`Checked ${pages.length} pages.`);
  };
  return (
    <>
      <Stats>
        <Stat label="High" value={rows.filter((r) => r.severity === "high").length} tone="bad" sub="Prices or facts that conflict" />
        <Stat label="Duplicate or thin" value={rows.filter((r) => r.kind === "duplicate" || r.kind === "thin").length} tone="warn" />
        <Stat label="Not checked" value={unchecked} />
      </Stats>
      <Card title="Flagged for human QA" aside={<Button kind="primary" busy={busy} disabled={!pages.length} onClick={runAll}>Check all pages</Button>}>
        <p className="small muted">The QA agent compares every page with the client's prices, durations and facts, and flags near-duplicate or thin pages. You review what it flags (about 4 h a week).</p>
        <Table rows={rows} rowKey={(r) => r.key} onRow={(r) => onOpen(r.page.id)} empty={pages.length ? "No open issues. Run the check after every rewrite." : "No pages yet."}
          cols={[
            { label: "Severity", render: (r) => <Badge tone={sevTone[r.severity]}>{r.severity}</Badge> },
            { label: "Page", render: (r) => <span className="small"><span className="strong">{r.page.activity}</span> · {r.page.location}</span> },
            { label: "Lang", render: (r) => r.lang ? <LangTag lang={r.lang} /> : "" },
            { label: "Kind", render: (r) => r.kind },
            { label: "Issue", render: (r) => <span className="small">{r.text}</span> },
          ]} />
      </Card>
    </>
  );
}

// --- Sitemap -------------------------------------------------------------------------------------

function SitemapTab({ project, pages }: { project: Project; pages: SitePage[] }) {
  const [drafts, setDrafts] = useState(false);
  const inc = pages.filter((p) => drafts || p.status === "approved" || p.status === "published");
  const urls = inc.reduce((s, p) => s + Object.keys(p.content).length, 0);
  return (
    <Card title="sitemap.xml" aside={<label className="row small"><input type="checkbox" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} />Include drafts and flagged</label>}>
      <p className="small muted">{urls} URLs from {inc.length} pages, each with hreflang alternates. Served at https://{project.domain}/sitemap.xml and listed in robots.txt.</p>
      {inc.length ? <AiOutput live={false} mono title="Preview" text={sitemapXml(project, inc)} />
        : <Empty>No approved pages yet. Approve pages after QA, or include drafts to preview.</Empty>}
      <AiOutput live={false} mono title="robots.txt" text={`User-agent: *\nAllow: /\n\nSitemap: https://${project.domain}/sitemap.xml`} />
    </Card>
  );
}

// --- Rankings ------------------------------------------------------------------------------------

function RankingsTab({ project, client, pages }: { project: Project; client?: Client; pages: SitePage[] }) {
  const reports = useCollection<RankReport>(COL.reports).filter((r) => r.projectId === project.id).sort((a, b) => b.month.localeCompare(a.month));
  const [sel, setSel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<string>();
  const [error, setError] = useState<string>();
  const tier = tierOf(client);
  const rep = reports.find((r) => r.id === sel) ?? reports[0];
  const month = today().slice(0, 7);
  const live = pages.filter((p) => p.status === "published");

  const build = async () => {
    if (!live.length) return toast("Publish at least one page first.");
    const prevMonth = dayOffset(-31).slice(0, 7);
    const rows = simulateRanks(live, month);
    const prevRows = simulateRanks(live, prevMonth);
    const prev = { clicks: Math.round(prevRows.reduce((s, r) => s + r.clicks, 0) * 0.8), impressions: Math.round(prevRows.reduce((s, r) => s + r.impressions, 0) * 0.85) };
    const existing = reports.find((r) => r.month === month);
    const r = await put<RankReport>(COL.reports, { id: existing?.id ?? `${project.id}-${month}`, createdAt: now(), projectId: project.id, clientId: project.clientId, month, rows, prev });
    setSel(r.id);
    toast("Simulated Search Console data loaded (Search Console not connected yet).");
  };
  const summarise = async () => {
    if (!rep) return;
    setBusy(true); setStream("");
    const res = await aiText(
      `Write a one-page monthly search report for ${project.brand} (${project.domain}), a Tenerife activity operator. Plain English, short paragraphs, under 200 words.\n` +
      `Data (Google Search Console, per page and language): ${JSON.stringify(rep.rows)}\nLast month totals: ${JSON.stringify(rep.prev)}\n` +
      `Cover: totals and change, top 3 pages, pages ranked 8 to 15 that are close to page one and what to improve, which language performs best. ` +
      `End with one line saying rankings change and are never guaranteed. Do not mention bookings or revenue unless in the data.`,
      () => demoSummary(project, rep.rows, rep.prev),
      { onText: setStream },
    );
    setBusy(false); setError(res.error); setStream(undefined);
    await put<RankReport>(COL.reports, { ...rep, summary: res.data, live: res.live });
  };

  const clicks = rep?.rows.reduce((s, r) => s + r.clicks, 0) ?? 0;
  const impr = rep?.rows.reduce((s, r) => s + r.impressions, 0) ?? 0;
  const avgPos = rep?.rows.length ? rep.rows.reduce((s, r) => s + r.position, 0) / rep.rows.length : 0;
  return (
    <>
      <Card title="Monthly ranking report" aside={<>
        {reports.length > 1 && <Select id="pg-rep" value={rep?.id ?? ""} onChange={setSel} options={reports.map((r) => ({ value: r.id, label: r.month }))} />}
        <Button kind="primary" onClick={build}>Pull {month} data</Button>
      </>}>
        <p className="small muted">{tier.report ? "Included in Pro." : `Part of Pro. On ${tier.name} use it as a sales and pilot proof tool.`} Numbers are simulated until Search Console is connected. SEO takes 3 to 6 months; sell the Google profile and booking button as month-one wins.</p>
      </Card>
      {!rep ? <Empty>No report yet. Publish pages, then pull this month's data.</Empty> : (
        <>
          <Stats>
            <Stat label="Clicks" value={clicks} sub={`${rep.prev.clicks} last month`} tone={clicks >= rep.prev.clicks ? "good" : "warn"} />
            <Stat label="Impressions" value={impr.toLocaleString("en-GB")} sub={`${rep.prev.impressions.toLocaleString("en-GB")} last month`} />
            <Stat label="Avg. position" value={avgPos.toFixed(1)} />
            <Stat label="Pages tracked" value={rep.rows.length} />
          </Stats>
          <div className="grid-2">
            <Card title={`Pages · ${rep.month}`}>
              <Table rows={[...rep.rows].sort((a, b) => b.clicks - a.clicks)} rowKey={(r) => r.path} cols={[
                { label: "Page", render: (r) => <span className="mono small">{r.path}</span> },
                { label: "Clicks", num: true, render: (r) => r.clicks },
                { label: "Impr.", num: true, render: (r) => r.impressions },
                { label: "Pos.", num: true, render: (r) => <Badge tone={r.position <= 10 ? "good" : r.position <= 20 ? "warn" : "neutral"}>{r.position}</Badge> },
              ]} />
            </Card>
            <Card title="Summary for the client" aside={<Button small busy={busy} onClick={summarise}>{rep.summary ? "Rewrite" : "Write summary"}</Button>}>
              {error && <p className="small" style={{ color: "var(--warn)" }}>{error}</p>}
              {stream != null ? <AiOutput text={stream || "Writing..."} live /> : rep.summary ? <AiOutput text={rep.summary} live={rep.live} title={`Report ${rep.month}`} /> : <Empty>Write the one-page summary that goes in the monthly PDF.</Empty>}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

// --- Free audit ----------------------------------------------------------------------------------

function AuditTab() {
  const audits = useCollection<Audit>(COL.audits);
  const [openId, setOpenId] = useState<string | null>(null);
  const [f, setF] = useState({ business: "", activity: "", town: "Los Cristianos", site: "", currentLangs: ["es", "en"] as Lang[], contact: "", channel: "whatsapp" as Audit["channel"], consentSource: "QR at harbour kiosk", consent: false });
  const open = audits.find((a) => a.id === openId);
  const submit = async () => {
    if (!f.business.trim() || !f.activity.trim()) return toast("Business and activity are needed.");
    if (!f.contact.trim()) return toast("Add the contact they gave.");
    if (!f.consent) return toast("Record that they asked for the audit. No consent, no message (LSSI).");
    const a = await create<Audit>(COL.audits, { business: f.business.trim(), activity: f.activity.trim(), town: f.town, site: f.site.trim(), currentLangs: f.currentLangs, contact: f.contact.trim(), channel: f.channel, consentSource: f.consentSource, consentAt: now() });
    setF({ ...f, business: "", activity: "", site: "", contact: "", consent: false });
    setOpenId(a.id);
  };
  return (
    <div className="split">
      <div className="stack">
        <Card title="Your activity in 5 languages">
          <p className="small muted">Free audit requested from the site form or a QR code. It shows which languages a guest searches in and where the operator is missing.</p>
          <Form onSubmit={submit}>
            <Field label="Business"><Input id="pg-au-b" value={f.business} onChange={(v) => setF({ ...f, business: v })} /></Field>
            <Field label="Main activity"><Input id="pg-au-a" value={f.activity} onChange={(v) => setF({ ...f, activity: v })} placeholder="Kayak and snorkel" /></Field>
            <Field label="Town"><Select id="pg-au-t" value={f.town} onChange={(v) => setF({ ...f, town: v })} options={TOWNS} /></Field>
            <Field label="Current website"><Input id="pg-au-s" value={f.site} onChange={(v) => setF({ ...f, site: v })} placeholder="optional" /></Field>
            <Field label="Languages on the site now" wide><LangPicker value={f.currentLangs} onChange={(v) => setF({ ...f, currentLangs: v })} options={AUDIT_LANGS} /></Field>
            <Field label="Send by"><Select<Audit["channel"]> id="pg-au-ch" value={f.channel} onChange={(v) => setF({ ...f, channel: v })} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }]} /></Field>
            <Field label={f.channel === "email" ? "Email" : "WhatsApp number"}><Input id="pg-au-c" value={f.contact} onChange={(v) => setF({ ...f, contact: v })} /></Field>
            <Field label="Request came from"><Select id="pg-au-src" value={f.consentSource} onChange={(v) => setF({ ...f, consentSource: v })} options={["QR at harbour kiosk", "Site form", "In person, asked for it"]} /></Field>
            <label className="field-wide row small"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />They asked for this audit and agreed to receive it by {f.channel === "email" ? "email" : "WhatsApp"}.</label>
            <Button kind="primary" type="submit">Save request</Button>
          </Form>
        </Card>
        <Card title="Requests">
          <Table rows={audits} rowKey={(a) => a.id} onRow={(a) => setOpenId(a.id)} empty="No audit requests yet. Put the QR code on the harbour kiosks."
            cols={[
              { label: "Business", render: (a) => <div className="stack-sm"><span className="strong">{a.business}</span><span className="small muted">{a.activity} · {a.town}</span></div> },
              { label: "Score", num: true, render: (a) => a.result ? a.result.score : <Badge>new</Badge> },
            ]} />
        </Card>
      </div>
      {open ? <AuditView audit={open} onClose={() => setOpenId(null)} /> : <Empty>Open a request to run its audit.</Empty>}
    </div>
  );
}

function AuditView({ audit, onClose }: { audit: Audit; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msgBusy, setMsgBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; live: boolean }>();
  const [error, setError] = useState<string>();
  const r = audit.result;
  const run = async () => {
    setBusy(true);
    const res = await aiJson<AuditResult>(
      `Run a free "Your activity in 5 languages" audit for a Tenerife operator.\nOperator: ${JSON.stringify({ business: audit.business, activity: audit.activity, town: audit.town, site: audit.site || null, currentLanguages: audit.currentLangs })}\n` +
      `For ES, EN, DE, NL, IT give the main search keyword a tourist would type and an estimated monthly search volume (label as estimate). List missing languages, 4 quick wins (direct booking button, Google profile, missing languages, local pages), a score 0-100 and a sample page title per language. Never promise rankings.\n` +
      `JSON shape: {"score": number, "missingLangs": string[], "demand": [{"lang": string, "keyword": string, "monthly": number}], "quickWins": string[], "sampleTitles": {"es": string, "en": string, "de": string, "nl": string, "it": string}}`,
      () => demoAudit(audit),
    );
    setBusy(false); setError(res.error);
    await put<Audit>(COL.audits, { ...audit, result: res.data, live: res.live });
  };
  const draftMsg = async () => {
    if (!r) return;
    setMsgBusy(true);
    const res = await aiText(
      `Write a short ${audit.channel === "email" ? "email" : "WhatsApp message"} in Spanish to ${audit.business}, who asked for this audit (${audit.consentSource}). Summarise the score ${r.score}/100, missing languages ${r.missingLangs.join(", ")}, and the top 2 quick wins. Offer a free 60-day pilot. No pressure, no ranking promises, under 90 words.`,
      () => `Hola, soy de ${BRAND}. Aquí tienes la auditoría que pediste para ${audit.business}: ${r.score}/100. ${r.missingLangs.length ? `Ahora mismo no tienes páginas en ${r.missingLangs.map((l) => LANGS[l].toLowerCase()).join(", ")}, y esos turistas buscan en su idioma.` : "Ya cubres los cinco idiomas principales."} Dos mejoras rápidas: botón de reserva directa y WhatsApp en cada página, y completar tu ficha de Google en ${audit.town}. Si te interesa, hacemos un piloto gratis de 60 días. Sin compromiso.`,
    );
    setMsgBusy(false); setMsg({ text: res.data, live: res.live });
  };
  const followUp = async () => {
    await put<Task>("tasks", { id: `${audit.id}-follow`, createdAt: now(), title: `Follow up audit: ${audit.business} (${audit.town})`, module: "pages", due: dayOffset(3), done: false });
    await put<Audit>(COL.audits, { ...audit, followUp: dayOffset(3) });
    toast("Follow-up added to Today.");
  };
  return (
    <Card title={audit.business} aside={<Button small kind="ghost" onClick={onClose}>Close</Button>}>
      <div className="row wrap small muted">
        <span>{audit.activity} · {audit.town}</span><span>{audit.site || "No website"}</span>
        <Badge tone="good">Opt-in: {audit.consentSource}, {fmtDate(audit.consentAt)}</Badge>
      </div>
      <div className="row wrap">
        <Button kind="primary" busy={busy} onClick={run}>{r ? "Run again" : "Run audit"}</Button>
        {r && <Button busy={msgBusy} onClick={draftMsg}>Draft {audit.channel === "email" ? "email" : "WhatsApp"} reply</Button>}
        {r && <Button kind="ghost" onClick={followUp} disabled={!!audit.followUp}>{audit.followUp ? `Follow-up ${fmtDate(audit.followUp)}` : "Add follow-up"}</Button>}
      </div>
      {error && <p className="small" style={{ color: "var(--warn)" }}>{error}</p>}
      {!r ? <Empty>Not run yet.</Empty> : (
        <>
          <Stats>
            <Stat label="Score" value={`${r.score}/100`} tone={r.score >= 70 ? "good" : r.score >= 40 ? "warn" : "bad"} />
            <Stat label="Missing languages" value={r.missingLangs.length} sub={r.missingLangs.map((l) => l.toUpperCase()).join(" ") || "None"} />
          </Stats>
          <Table rows={r.demand} rowKey={(d) => d.lang} cols={[
            { label: "Lang", render: (d) => <LangTag lang={d.lang} /> },
            { label: "Search", render: (d) => <span className="mono small">{d.keyword}</span> },
            { label: "Est. monthly", num: true, render: (d) => d.monthly.toLocaleString("en-GB") },
            { label: "Covered", render: (d) => audit.currentLangs.includes(d.lang) ? <Badge tone="good">yes</Badge> : <Badge tone="bad">no</Badge> },
          ]} />
          <p className="small faint">Volumes are estimates (keyword data service not connected).</p>
          <div className="stack-sm">{r.quickWins.map((w, i) => <span key={i} className="small">{i + 1}. {w}</span>)}</div>
          <div className="stack-sm"><span className="small strong">Sample page titles</span>
            {(Object.entries(r.sampleTitles) as [Lang, string][]).map(([l, t]) => <span key={l} className="row small"><LangTag lang={l} />{t}</span>)}</div>
          {msg && <AiOutput title="Reply draft (send it yourself)" text={msg.text} live={msg.live} />}
        </>
      )}
    </Card>
  );
}

// --- Seed ----------------------------------------------------------------------------------------

export async function seed(): Promise<void> {
  const acts: Activity[] = [
    { name: "Discover Scuba Diving", price: 69, duration: "3 hours", facts: "Pool briefing, then one shallow sea dive to 6 m with an instructor. All equipment included. Minimum age 10." },
    { name: "PADI Open Water course", price: 420, duration: "4 days", facts: "Theory online, 4 confined-water sessions and 4 open-water dives. Certification fee included." },
    { name: "Guided boat dive", price: 55, duration: "2.5 hours", facts: "For certified divers. Maximum 6 divers per guide. Tank and weights included, full kit rental extra." },
  ];
  const project = example("ex-pages-p1", {
    clientId: EX.dive, brand: "Azul Profundo Dive Centre", domain: "azulprofundo-tenerife.com", bookingUrl: "https://azulprofundo-tenerife.com/book",
    whatsapp: "+34 922 000 103", activities: acts, locations: ["Puerto de la Cruz", "Punta del Hidalgo", "Los Gigantes"],
    localFacts: {
      "Puerto de la Cruz": "Shore dives start from the old fishing harbour, next to Plaza del Charco; turtles are often seen at 8 m.",
      "Punta del Hidalgo": "Lava arches and swim-throughs at 12 to 18 m; best on calm south-wind days.",
    },
    langs: ["es", "en", "de"] as Lang[], excluded: [comboKey("PADI Open Water course", "Los Gigantes")], seasonal: false,
  }) as Project;
  await put(COL.projects, project);

  const mk = (id: string, a: Activity, loc: string, status: PageStatus, extra: Partial<SitePage> = {}): SitePage => {
    const d = demoPage(project, a, loc, project.langs);
    return example(id, { projectId: project.id, clientId: EX.dive, activity: a.name, location: loc, content: d.content, schema: d.schema, live: false, status, ...extra }) as SitePage;
  };
  const g1 = mk("ex-pages-g1", acts[0], "Puerto de la Cruz", "published", { publishedAt: dayOffset(-24) });
  const g2 = mk("ex-pages-g2", acts[0], "Punta del Hidalgo", "approved");
  const g3 = mk("ex-pages-g3", acts[2], "Los Gigantes", "draft");
  const de = g3.content.de!;
  g3.content.de = { ...de, body: de.body.replace("55 €", "65 €").replace(/Der Preis beträgt [^.]+\./, "Der Preis beträgt 65 € pro Person, mit Hotelabholung.") };
  const g4 = mk("ex-pages-g4", acts[1], "Puerto de la Cruz", "published", { publishedAt: dayOffset(-20) });
  const all = [g1, g2, g3, g4];
  for (const pg of all) {
    const issues = [...localQa(pg, project, all.filter((x) => x.id !== pg.id)), ...demoFactCheck(pg, project)];
    pg.qa = { issues, at: dayOffset(-1), live: false };
    if (issues.some((i) => i.severity === "high")) pg.status = "flagged";
    await put(COL.pages, pg);
  }
  await put<Task>("tasks", example("ex-pages-g3-qa", { title: "Review flagged page: Guided boat dive · Los Gigantes (price and pickup in DE)", module: "pages", clientId: EX.dive, due: dayOffset(0), done: false }) as Task);

  const prevMonth = dayOffset(-30).slice(0, 7);
  const pub = [g1, g4];
  const rows = simulateRanks(pub, prevMonth);
  const prev = { clicks: 31, impressions: 1840 };
  await put(COL.reports, example("ex-pages-r1", { projectId: project.id, clientId: EX.dive, month: prevMonth, rows, prev, summary: demoSummary(project, rows, prev), live: false }));

  const a1 = { business: "Teno Kayak Tours", activity: "Kayak and snorkel", town: "Los Gigantes", site: "tenokayak.es", currentLangs: ["es", "en"] as Lang[] };
  await put(COL.audits, example("ex-pages-a1", { ...a1, contact: "+34 600 112 233", channel: "whatsapp", consentSource: "QR at harbour kiosk", consentAt: dayOffset(-3), result: demoAudit(a1), live: false }));
  await put(COL.audits, example("ex-pages-a2", { business: "Abades Surf Camp", activity: "Surf lessons", town: "Güímar", site: "", currentLangs: ["es"] as Lang[], contact: "hola@abadessurf.es", channel: "email", consentSource: "Site form", consentAt: dayOffset(-1) }));
}
