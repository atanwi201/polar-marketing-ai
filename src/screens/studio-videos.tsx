// Videos tab: short vertical video ads (Reels, Facebook, YouTube Shorts) made by the studio server.
import { useMemo, useState } from "react";
import { Button, Badge, Modal, Field, Input, TextArea, Select, ConfirmButton, Empty, fmtDate, toast, type Tone } from "../core/ui";
import { type Act, type StudioData, type Video, type SClient, mediaUrl, downscale, tagLine, fmtSize } from "./studio-api";
import { ShareModal } from "./studio-share";

const STATUS_TONE: Record<Video["status"], Tone> = { generating: "info", waiting: "info", ready: "warn", published: "good", failed: "bad" };
const STEP: Record<string, string> = { script: "Writing the script", images: "Drawing the scenes", rendering: "Rendering the video" };
const LANG_LABEL: Record<string, string> = { es: "Spanish", en: "English", de: "German", it: "Italian", nl: "Dutch", sv: "Swedish", fr: "French" };

export function VideosTab({ data, nameOf, act, clientId }: { data: StudioData; nameOf: (id: string) => string; act: Act; clientId?: string }) {
  const [picked, setFilter] = useState("");
  const filter = clientId ?? picked;
  const [sharing, setSharing] = useState<Video | null>(null);
  const [editing, setEditing] = useState<Video | null>(null);
  const videos = useMemo(
    () => data.videos.filter((v) => !filter || v.clientId === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.videos, filter],
  );
  const clientOf = (id: string) => data.clients.find((c) => c.id === id);
  const live = (v: Video | null) => (v ? data.videos.find((x) => x.id === v.id) ?? null : null);

  return (
    <div className="stack" style={{ marginTop: 14 }}>
      <NewVideo data={data} act={act} fixedClient={clientId} />
      {!clientId && <div style={{ maxWidth: 320 }}>
        <Select id="s-video-filter" value={filter} onChange={setFilter}
          options={[{ value: "", label: "All clients" }, ...data.clients.map((c) => ({ value: c.id, label: c.name }))]} />
      </div>}
      {!videos.length ? <Empty>No videos yet. Describe what to promote above and the studio makes a 9:16 video ad.</Empty> : (
        <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
          {videos.map((v) => <VideoCard key={v.id} v={v} name={nameOf(v.clientId)} act={act} onShare={() => setSharing(v)} onEdit={() => setEditing(v)} />)}
        </div>
      )}
      {sharing && live(sharing) && clientOf(sharing.clientId) && (
        <ShareModal kind="video" item={live(sharing)!} client={clientOf(sharing.clientId)!} data={data} act={act} onClose={() => setSharing(null)} />
      )}
      {editing && live(editing) && <EditVideo v={live(editing)!} client={clientOf(editing.clientId)} data={data} act={act} onClose={() => setEditing(null)} />}
    </div>
  );
}

function NewVideo({ data, act, fixedClient }: { data: StudioData; act: Act; fixedClient?: string }) {
  const [picked, setClientId] = useState("");
  const clientId = fixedClient ?? picked;
  const cid = clientId || data.clients[0]?.id || "";
  const client = data.clients.find((c) => c.id === cid);
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState("15");
  const [langs, setLangs] = useState<string[] | null>(null);
  const [voice, setVoice] = useState(false);
  const [image, setImage] = useState("");
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const clientLangs = client?.languages?.length ? client.languages : ["es"];
  const chosen = (langs ?? clientLangs.slice(0, 1)).filter((l) => clientLangs.includes(l));
  const briefs = data.briefs.filter((b) => b.clientId === cid && !b.archived).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  const voiceOk = chosen.every((l) => data.video.voices.includes(l));

  const pickFile = async (f?: File) => {
    if (!f) return setImage("");
    try { setImage(await downscale(f)); } catch (e) { toast(e instanceof Error ? e.message : "Could not use that image"); setFileKey((k) => k + 1); }
  };
  const make = async () => {
    if (!cid) return toast("Add a client first.");
    if (text.trim().length < 3) return toast("Write what the video should promote.");
    if (!chosen.length) return toast("Pick at least one language.");
    setBusy(true);
    const r = await act("POST", "/videos", { clientId: cid, text: text.trim(), seconds: Number(seconds), langs: chosen, voice: voice && voiceOk, ...(image ? { image } : {}) },
      "Making the video. It takes a few minutes.");
    setBusy(false);
    if (r !== undefined) { setText(""); setImage(""); setFileKey((k) => k + 1); }
  };

  if (!data.video.ffmpeg) {
    return (
      <div className="box stack-sm">
        <strong>Video ads need ffmpeg on the server</strong>
        <span className="small muted">Install it, then restart the server: <code className="mono">brew install ffmpeg</code> on macOS, <code className="mono">sudo apt install ffmpeg</code> on Linux. Also run <code className="mono">npm install</code>.</span>
      </div>
    );
  }
  return (
    <div className="box stack">
      <div className="stack-sm">
        <strong>New video ad</strong>
        <span className="small muted">Vertical 9:16 MP4 for Instagram Reels, Facebook Reels and YouTube Shorts. The AI writes the script, draws a new image per scene and adds the text on screen.</span>
      </div>
      <div className="form-grid">
        {!fixedClient && <Field label="Client">
          <Select id="v-client" value={cid} onChange={(v) => { setClientId(v); setLangs(null); }}
            options={data.clients.length ? data.clients.map((c) => ({ value: c.id, label: c.name })) : [{ value: "", label: "No clients" }]} />
        </Field>}
        <Field label="Length">
          <Select id="v-len" value={seconds} onChange={setSeconds} options={data.video.lengths.map((s) => ({ value: String(s), label: `${s} seconds` }))} />
        </Field>
        <Field label="Photo (optional)" hint="Used as reference only, every scene is a new image.">
          <input key={fileKey} className="input" type="file" accept="image/*" onChange={(e) => void pickFile(e.target.files?.[0])} />
        </Field>
        <Field label="What should the video promote?" wide>
          <TextArea id="v-text" rows={3} value={text} onChange={setText} placeholder="Cheap Canary bananas this week at our stall in Mercado de África" />
        </Field>
      </div>
      {briefs.length > 0 && (
        <div className="row wrap"><span className="small faint">From a brief:</span>{briefs.map((b) => (
          <button key={b.id} type="button" className="chip" onClick={() => setText(b.text)} title={b.text}>{b.text.slice(0, 40)}{b.text.length > 40 ? "…" : ""}</button>
        ))}</div>
      )}
      <div className="row wrap">
        <span className="small muted">One video per language:</span>
        {clientLangs.map((l) => {
          const on = chosen.includes(l);
          return <button key={l} type="button" className={"chip" + (on ? " chip-on" : "")} aria-pressed={on}
            onClick={() => setLangs(on ? chosen.filter((x) => x !== l) : [...chosen, l])}>{l.toUpperCase()}</button>;
        })}
        <label className="row small" style={{ marginLeft: 12 }} title={voiceOk ? "" : "No system voice for one of these languages on this server"}>
          <input type="checkbox" checked={voice && voiceOk} disabled={!voiceOk} onChange={(e) => setVoice(e.target.checked)} /> Voice-over{!voiceOk && " (not available)"}
        </label>
      </div>
      {image && <img src={image} alt="Selected reference" style={{ maxHeight: 110, maxWidth: "100%", borderRadius: 6, objectFit: "cover", alignSelf: "flex-start" }} />}
      <div className="row"><Button kind="primary" busy={busy} onClick={make}>Make video</Button></div>
    </div>
  );
}

function VideoCard({ v, name, act, onShare, onEdit }: { v: Video; name: string; act: Act; onShare: () => void; onEdit: () => void }) {
  const langs = Object.keys(v.renders ?? {});
  const [lang, setLang] = useState(langs[0] ?? "");
  const cur = langs.includes(lang) ? lang : langs[0];
  const r = cur ? v.renders![cur] : undefined;
  return (
    <div className="box stack" style={{ padding: 0, overflow: "hidden" }}>
      {v.status === "generating" ? (
        <div className="stack" style={{ aspectRatio: "9 / 16", maxHeight: 440, justifyContent: "center", alignItems: "center", background: "var(--surface-2)", padding: 20, textAlign: "center" }}>
          <span className="muted"><span className="spinner" aria-hidden /> {STEP[v.step ?? ""] ?? "Starting"}{v.stepNote ? ` · ${v.stepNote}` : ""}</span>
          <div style={{ width: "80%", height: 6, borderRadius: 3, background: "var(--line)" }} role="progressbar" aria-valuenow={v.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${v.progress ?? 0}%`, height: "100%", borderRadius: 3, background: "var(--accent)", transition: "width .4s" }} />
          </div>
          <span className="small faint">Images come from a free service, so this can take a few minutes.</span>
        </div>
      ) : r ? (
        <video key={r.file} src={mediaUrl(r.file)} poster={mediaUrl(r.cover)} controls playsInline preload="none"
          style={{ width: "100%", aspectRatio: "9 / 16", maxHeight: 440, background: "#000", display: "block", objectFit: "contain" }} />
      ) : (
        <div className="row" style={{ aspectRatio: "9 / 16", maxHeight: 440, justifyContent: "center", background: "var(--surface-2)" }}><span className="faint">No video</span></div>
      )}
      <div className="stack" style={{ padding: "0 12px 12px" }}>
        <div className="row wrap between">
          <span className="strong">{name}</span>
          <span className="row wrap"><Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge><Badge>{v.seconds} s</Badge>{v.voice && <Badge>voice</Badge>}</span>
        </div>
        <span className="small faint">{fmtDate(v.createdAt)}{v.publishedAt ? ` · published ${fmtDate(v.publishedAt)}` : ""}{r ? ` · ${fmtSize(r.size)}` : ""}</span>
        {v.concept && <span className="small muted">{v.concept}</span>}
        {langs.length > 1 && (
          <div className="row wrap">{langs.map((l) => (
            <button key={l} type="button" className={"chip" + (l === cur ? " chip-on" : "")} aria-pressed={l === cur} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}</div>
        )}
        {cur && v.title?.[cur] && <span className="small"><span className="faint">YouTube title:</span> {v.title[cur]}</span>}
        {cur && v.captions?.[cur] && <div className="pre small" style={{ maxHeight: 120, overflow: "auto" }}>{v.captions[cur]}</div>}
        {v.hashtags?.length ? <span className="small mono muted">{tagLine(v.hashtags)}</span> : null}
        {v.model && <span className="small faint mono">{v.model}</span>}
        {v.publishNote && <span className="small muted">{v.publishNote}</span>}
        {v.error && <span className="small" style={{ color: "var(--bad)" }}>{v.error}</span>}
        <div className="row wrap">
          {r && <Button small kind="primary" onClick={onShare}>Share</Button>}
          {v.status === "ready" && <Button small onClick={() => void act("POST", `/videos/${v.id}/publish`, undefined, "Publishing to the connected accounts")}>Publish</Button>}
          {v.status !== "generating" && v.scenes && <Button small onClick={onEdit}>Edit text</Button>}
          {v.status !== "generating" && <Button small onClick={() => void act("POST", `/videos/${v.id}/again`, undefined, "Making another version")}>Another version</Button>}
          {v.status === "failed" && <Button small onClick={() => void act("POST", `/videos/${v.id}/retry`, undefined, "Trying again")}>Retry</Button>}
          <ConfirmButton label="Delete" confirm="Delete video" onConfirm={() => void act("DELETE", `/videos/${v.id}`, undefined, "Video deleted")} />
        </div>
      </div>
    </div>
  );
}

function EditVideo({ v, client, data, act, onClose }: { v: Video; client?: SClient; data: StudioData; act: Act; onClose: () => void }) {
  const clientLangs = client?.languages?.length ? client.languages : v.langs;
  const [langs, setLangs] = useState<string[]>(v.langs);
  const [lang, setLang] = useState(v.langs[0]);
  const [scenes, setScenes] = useState(() => (v.scenes ?? []).map((s) => ({ ...s.text })));
  const [endCta, setEndCta] = useState({ ...v.endCta });
  const [captions, setCaptions] = useState({ ...v.captions });
  const [title, setTitle] = useState({ ...v.title });
  const [voice, setVoice] = useState(v.voice);
  const [busy, setBusy] = useState(false);
  const voiceOk = langs.every((l) => data.video.voices.includes(l));
  const newLangs = langs.filter((l) => !v.langs.includes(l));

  const save = async (render: boolean) => {
    setBusy(true);
    const r = await act("POST", `/videos/${v.id}/edit`, {
      scenes: scenes.map((text) => ({ text })), endCta, captions, title, langs, voice: voice && voiceOk, render,
    }, render ? "Saved. Rendering again with the same images." : "Saved");
    setBusy(false);
    if (r !== undefined) onClose();
  };
  const setScene = (i: number, val: string) => setScenes((p) => p.map((s, k) => (k === i ? { ...s, [lang]: val } : s)));

  return (
    <Modal open title="Edit video text" onClose={onClose}
      footer={<>
        <span style={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button busy={busy} onClick={() => void save(false)}>Save captions only</Button>
        <Button kind="primary" busy={busy} onClick={() => void save(true)}>Save and render again</Button>
      </>}>
      <div className="stack">
        <div className="row wrap">
          <span className="small muted">Languages:</span>
          {clientLangs.map((l) => {
            const on = langs.includes(l);
            return <button key={l} type="button" className={"chip" + (on ? " chip-on" : "")} aria-pressed={on}
              onClick={() => { const next = on ? langs.filter((x) => x !== l) : [...langs, l]; if (next.length) { setLangs(next); if (!next.includes(lang)) setLang(next[0]); } }}>{l.toUpperCase()}</button>;
          })}
          <label className="row small" style={{ marginLeft: 12 }}>
            <input type="checkbox" checked={voice && voiceOk} disabled={!voiceOk} onChange={(e) => setVoice(e.target.checked)} /> Voice-over
          </label>
        </div>
        {newLangs.length > 0 && <span className="small muted">New languages ({newLangs.map((l) => LANG_LABEL[l] ?? l).join(", ")}) get their text written by the AI when you render; the images stay the same.</span>}
        <div className="row wrap">{langs.filter((l) => v.langs.includes(l)).map((l) => (
          <button key={l} type="button" className={"chip" + (l === lang ? " chip-on" : "")} aria-pressed={l === lang} onClick={() => setLang(l)}>Edit {l.toUpperCase()}</button>
        ))}</div>
        {v.langs.includes(lang) && <>
          {scenes.map((s, i) => (
            <Field key={i} label={i === 0 ? "Scene 1 (hook)" : `Scene ${i + 1}`}>
              <div className="row">
                {v.scenes?.[i]?.imageFile && <img src={mediaUrl(v.scenes[i].imageFile!)} alt="" style={{ width: 36, height: 64, objectFit: "cover", borderRadius: 4, flex: "none" }} />}
                <Input id={`ve-s${i}`} value={s[lang] ?? ""} onChange={(val) => setScene(i, val.slice(0, 80))} />
              </div>
            </Field>
          ))}
          <Field label="End card call to action"><Input id="ve-cta" value={endCta[lang] ?? ""} onChange={(val) => setEndCta((p) => ({ ...p, [lang]: val.slice(0, 60) }))} /></Field>
          <Field label="YouTube Shorts title"><Input id="ve-title" value={title[lang] ?? ""} onChange={(val) => setTitle((p) => ({ ...p, [lang]: val.slice(0, 90) }))} /></Field>
          <Field label="Caption (Reels and Facebook)"><TextArea id="ve-cap" rows={4} value={captions[lang] ?? ""} onChange={(val) => setCaptions((p) => ({ ...p, [lang]: val }))} /></Field>
        </>}
      </div>
    </Modal>
  );
}
