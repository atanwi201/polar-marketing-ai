// Menu tab for one business: turn the digital menu on, pick its languages, share the public link and QR.
// The client edits the items from their own portal; this view is read-only for the menu content.
// Server side: server/menu-routes.mjs (owner scope /api/studio/menu).
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, Button, Badge, Empty, toast } from "../core/ui";
import { mcall, merr, MENU_LANGS, type MenuConfig, type MenuData, type MenuLang } from "./menu-api";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: MenuData };

export function MenuPanel({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [s, setS] = useState<Load>({ state: "loading" });
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    void mcall<MenuData>("GET", `?clientId=${encodeURIComponent(clientId)}`).then((r) => {
      if (n !== seq.current) return;
      setS(r.kind === "ok" ? { state: "ok", data: r.data } : { state: "error", message: merr(r) });
    });
  }, [clientId]);
  useEffect(() => { load(); return () => { seq.current++; }; }, [load]);

  if (s.state === "loading") return <div className="loy-skel-wrap" aria-busy="true" aria-label="Loading"><div className="loy-skel" style={{ height: 120 }} /><div className="loy-skel" style={{ height: 200 }} /></div>;
  if (s.state === "error") return <Empty action={<Button onClick={load}>Try again</Button>}>{s.message}</Empty>;
  const { config, categories } = s.data;
  return (
    <div className="stack">
      <SetupCard clientId={clientId} clientName={clientName} config={config} onSaved={(c) => { setS({ state: "ok", data: { ...s.data, config: c } }); load(); }} />
      {config.enabled && <ShareCard config={config} />}
      {config.enabled && <Summary categories={categories} />}
    </div>
  );
}

function SetupCard({ clientId, clientName, config, onSaved }: { clientId: string; clientName: string; config: MenuConfig; onSaved: (c: MenuConfig) => void }) {
  const [langs, setLangs] = useState<MenuLang[]>(config.languages ?? ["es", "en"]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setLangs(config.languages ?? ["es", "en"]); }, [config]);
  const dirty = JSON.stringify(langs) !== JSON.stringify(config.languages ?? ["es", "en"]);

  const put = async (body: unknown, okMsg: string) => {
    setSaving(true); setErr("");
    const r = await mcall<MenuConfig>("PUT", `/config?clientId=${encodeURIComponent(clientId)}`, body);
    setSaving(false);
    if (r.kind !== "ok") { const m = merr(r); setErr(m); toast(m); return; }
    onSaved(r.data); toast(okMsg);
  };
  const toggle = () => void put({ enabled: !config.enabled }, config.enabled ? "Menu is off." : "Menu is on.");
  const save = () => void put({ languages: langs }, "Menu settings saved.");
  // The first selected language is the default one, so keep the order in which they were ticked.
  const flip = (l: MenuLang) => setLangs((a) => (a.includes(l) ? (a.length > 1 ? a.filter((x) => x !== l) : a) : [...a, l]));

  return (
    <Card title="Digital menu" aside={<Badge tone={config.enabled ? "good" : "neutral"}>{config.enabled ? "On" : "Off"}</Badge>}>
      <div className="stack">
        <div className="loy-box">
          <label className="row"><input type="checkbox" checked={config.enabled} disabled={saving} onChange={toggle} />
            <span className="strong">Turn on the digital menu for {clientName}</span></label>
          <p className="small muted">When on, the client sees a Menu section in their portal where they build their categories and dishes. Customers open it from a public link or QR code, and it appears as a Menu button on their website and loyalty card.</p>
        </div>

        <div className="stack-sm">
          <span className="field-label">Languages</span>
          <div className="row wrap">
            {MENU_LANGS.map((l) => (
              <label className="row" key={l.id}><input type="checkbox" checked={langs.includes(l.id)} disabled={saving} onChange={() => flip(l.id)} /><span>{l.label}</span></label>
            ))}
          </div>
          <span className="small faint">The first language ticked is the default. Texts missing in another language fall back to it.</span>
        </div>

        {err && <p className="small" role="alert" style={{ color: "var(--bad, #c0392b)" }}>{err}</p>}
        <div className="row wrap">
          <Button kind="primary" busy={saving} disabled={!dirty} onClick={save}>Save settings</Button>
          {dirty && <Button kind="ghost" onClick={() => { setLangs(config.languages ?? ["es", "en"]); setErr(""); }}>Discard changes</Button>}
          {!dirty && <span className="small faint">All changes saved.</span>}
        </div>
      </div>
    </Card>
  );
}

function ShareCard({ config }: { config: MenuConfig }) {
  const url = config.url ?? "";
  if (!url) return null;
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast("Link copied."); } catch { toast("Could not copy. Select the link and copy it."); } };
  return (
    <Card title="Public link">
      <div className="stack">
        <div className="row wrap">
          <a href={url} target="_blank" rel="noreferrer" className="strong" style={{ wordBreak: "break-all" }}>{url}</a>
          <Button small onClick={() => void copy()}>Copy link</Button>
        </div>
        <div className="row wrap">
          <img src={`${url}/qr.svg`} alt="QR code for the menu" width={140} height={140} style={{ background: "#fff", padding: 8, borderRadius: 8 }} />
          <div className="stack-sm">
            <a className="btn btn-secondary" href={`${url}/qr.png?download=1`} style={{ textDecoration: "none" }}>Download QR (PNG)</a>
            <a className="btn btn-ghost" href={`${url}/qr.svg?download=1`} style={{ textDecoration: "none" }}>Download QR (SVG)</a>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Summary({ categories }: { categories: MenuData["categories"] }) {
  const nm = (m: Record<string, string | undefined>) => m.en || m.es || Object.values(m).find(Boolean) || "Untitled";
  const total = categories.reduce((n, c) => n + c.items.length, 0);
  const avail = categories.reduce((n, c) => n + c.items.filter((i) => i.available).length, 0);
  return (
    <Card title="Menu contents" aside={<span className="small muted">{categories.length} categor{categories.length === 1 ? "y" : "ies"} · {total} item{total === 1 ? "" : "s"} · {avail} available</span>}>
      {categories.length === 0 ? <Empty>The client has not added any dishes yet. They build the menu from their portal.</Empty> : (
        <div className="stack-sm">
          {categories.map((c) => (
            <div className="row between" key={c.id}>
              <span>{nm(c.name)}</span>
              <span className="small muted">{c.items.length} item{c.items.length === 1 ? "" : "s"}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
