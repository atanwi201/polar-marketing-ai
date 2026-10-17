// Review inbox across clients, manual import and the owner-approval queue.
import { useMemo, useState } from "react";
import { create, put, now, today } from "../core/store";
import {
  Button, Card, ClientPicker, Empty, Field, Input, LangTag, Modal, Select, TextArea, Badge, CopyButton, toast, fmtDate, Tabs,
} from "../core/ui";
import type { Client } from "../core/types";
import { COL, guessLang, langName, parsePasted, firstName, type Review } from "./reviews-data";
import { Stars, StatusBadge, draftAndRoute, settingsFor, useSettings, closeTask } from "./reviews-shared";

type Filter = "all" | "new" | "auto-posted" | "awaiting-owner" | "done";

export function Inbox(props: { reviews: Review[]; clients: Client[]; clientId: string }) {
  const settings = useSettings();
  const [filter, setFilter] = useState<Filter>("all");
  const [lang, setLang] = useState("all");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const byId = useMemo(() => new Map(props.clients.map((c) => [c.id, c])), [props.clients]);

  const scoped = props.reviews.filter((r) => !props.clientId || r.clientId === props.clientId);
  const langs = [...new Set(scoped.map((r) => r.lang))].sort();
  const rows = scoped
    .filter((r) => filter === "all" || (filter === "done" ? r.status === "posted" || r.status === "rejected" : r.status === filter))
    .filter((r) => lang === "all" || r.lang === lang)
    .sort((a, b) => (a.status === "new" ? -1 : 0) - (b.status === "new" ? -1 : 0) || b.date.localeCompare(a.date));
  const pending = scoped.filter((r) => r.status === "new");

  async function draft(r: Review) {
    setBusy(r.id);
    try { const c = byId.get(r.clientId); await draftAndRoute(r, c, settingsFor(c, settings)); }
    finally { setBusy(""); }
  }
  async function draftAll() {
    setBusy("all");
    try {
      for (const r of pending) { const c = byId.get(r.clientId); await draftAndRoute(r, c, settingsFor(c, settings)); }
      toast(`${pending.length} replies drafted and routed.`);
    } finally { setBusy(""); }
  }

  return (
    <div className="stack">
      <div className="row wrap between">
        <div className="row wrap">
          <Select id="rv-filter" value={filter} onChange={setFilter} options={[
            { value: "all", label: "All reviews" }, { value: "new", label: "Needs reply" }, { value: "auto-posted", label: "Auto-posted" },
            { value: "awaiting-owner", label: "Waiting for owner" }, { value: "done", label: "Approved or rejected" },
          ]} />
          <Select id="rv-lang" value={lang} onChange={setLang} options={[{ value: "all", label: "Any language" }, ...langs.map((l) => ({ value: l, label: langName(l) }))]} />
        </div>
        <div className="row wrap">
          <Button onClick={() => setAdding(true)}>Add or paste reviews</Button>
          <Button kind="primary" disabled={!pending.length} busy={busy === "all"} onClick={draftAll}>
            Draft and route {pending.length || ""} new
          </Button>
        </div>
      </div>
      <p className="small faint">
        The AI detects each reviewer's language and drafts a reply in it. 4 and 5 star replies post on their own. 1 to 3 star replies always go to the owner first.
      </p>
      {rows.length === 0 ? (
        <Empty action={<Button kind="primary" onClick={() => setAdding(true)}>Add or paste reviews</Button>}>
          {scoped.length ? "No reviews match these filters." : "No reviews yet. Paste them from the Google profile until the API is connected."}
        </Empty>
      ) : (
        rows.map((r) => <ReviewCard key={r.id} r={r} client={byId.get(r.clientId)} busy={busy === r.id || busy === "all"} onDraft={() => draft(r)} />)
      )}
      <AddReviews open={adding} onClose={() => setAdding(false)} clients={props.clients} defaultClient={props.clientId} />
    </div>
  );
}

function ReviewCard(props: { r: Review; client?: Client; busy: boolean; onDraft: () => void }) {
  const { r } = props;
  const [showEs, setShowEs] = useState(false);
  return (
    <Card>
      <div className="row wrap between">
        <div className="row wrap">
          <Stars n={r.rating} />
          <span className="strong">{r.reviewer}</span>
          <LangTag lang={r.lang} />
          <span className="small faint">{props.client?.name ?? "Unknown client"} · {fmtDate(r.date)}</span>
        </div>
        <StatusBadge s={r.status} />
      </div>
      <p>{r.text}</p>
      {r.reply ? (
        <div className="ai-out">
          <div className="ai-out-head">
            <span className="row wrap">
              <strong>Reply in {langName(r.lang)}</strong>
              <Badge tone={r.live ? "accent" : "neutral"}>{r.live ? "AI draft" : "Demo draft"}</Badge>
              {r.topics?.length ? <span className="small faint">Topics: {r.topics.join(", ")}</span> : null}
            </span>
            <span className="row wrap">
              {r.replyEs && r.lang !== "es" && <Button small kind="ghost" onClick={() => setShowEs(!showEs)}>{showEs ? "Hide Spanish" : "Spanish for owner"}</Button>}
              <CopyButton text={r.reply} />
            </span>
          </div>
          <div className="ai-out-body">{r.reply}</div>
          {showEs && <div className="ai-out-body muted small"><span className="strong">ES: </span>{r.replyEs}</div>}
        </div>
      ) : null}
      <div className="row wrap between">
        <span className="small faint">
          {r.status === "auto-posted" && r.postedAt && `Auto-posted ${fmtDate(r.postedAt)} (simulated: copy into Google until the API is connected)`}
          {r.status === "awaiting-owner" && r.sentToOwnerAt && `Sent to owner on WhatsApp ${fmtDate(r.sentToOwnerAt)} (simulated)`}
          {r.status === "posted" && r.postedAt && `Owner approved · posted ${fmtDate(r.postedAt)} (simulated)`}
          {r.status === "rejected" && `Owner rejected${r.rejectReason ? `: ${r.rejectReason}` : ""}`}
          {r.status === "new" && (r.rating <= 3 ? "Low rating: the reply will need owner approval." : "High rating: the reply will auto-post.")}
        </span>
        <div className="row">
          {r.status === "new" && <Button small kind="primary" busy={props.busy} onClick={props.onDraft}>Draft reply</Button>}
          {r.status === "rejected" && <Button small busy={props.busy} onClick={props.onDraft}>Redraft</Button>}
        </div>
      </div>
    </Card>
  );
}

function AddReviews(props: { open: boolean; onClose: () => void; clients: Client[]; defaultClient: string }) {
  const [mode, setMode] = useState<"paste" | "one">("paste");
  const [clientId, setClientId] = useState(props.defaultClient || props.clients[0]?.id || "");
  const [raw, setRaw] = useState("");
  const [one, setOne] = useState({ reviewer: "", rating: "5", text: "", date: today() });
  const parsed = useMemo(() => parsePasted(raw), [raw]);

  async function save() {
    if (!clientId) return toast("Pick a client first.");
    const items = mode === "paste" ? parsed.map((p) => ({ ...p, date: today() })) : one.text.trim() ? [{ reviewer: one.reviewer || "Google user", rating: Number(one.rating), text: one.text.trim(), date: one.date }] : [];
    if (!items.length) return toast("Nothing to add yet.");
    for (const it of items)
      await create<Review>(COL.reviews, { clientId, ...it, source: mode === "paste" ? "pasted" : "manual", lang: guessLang(it.text), status: "new" });
    toast(`${items.length} review${items.length > 1 ? "s" : ""} added to the inbox.`);
    setRaw(""); setOne({ reviewer: "", rating: "5", text: "", date: today() });
    props.onClose();
  }

  return (
    <Modal open={props.open} onClose={props.onClose} title="Add reviews"
      footer={<><Button kind="ghost" onClick={props.onClose}>Cancel</Button><Button kind="primary" onClick={save}>
        {mode === "paste" ? `Add ${parsed.length || ""} reviews` : "Add review"}</Button></>}>
      <Field label="Client"><ClientPicker id="rv-add-client" clients={props.clients} value={clientId} onChange={setClientId} /></Field>
      <Tabs value={mode} onChange={setMode} tabs={[{ id: "paste", label: "Paste several" }, { id: "one", label: "Type one" }]} />
      {mode === "paste" ? (
        <>
          <Field label="Pasted reviews" hint="One review per block, blank line between. First line: name and rating (5/5, 4 stars or ★★★★). Then the text.">
            <TextArea id="rv-paste" rows={9} value={raw} onChange={setRaw}
              placeholder={"Klaus W. · 2/5\nWir haben 50 Minuten auf das Essen gewartet.\n\nSarah P. ★★★★★\nBest seafood on the promenade!"} />
          </Field>
          {parsed.length > 0 && (
            <div className="stack-sm">
              <span className="small strong">Preview</span>
              {parsed.map((p, i) => (
                <div key={i} className="row wrap small"><Stars n={p.rating} /><span className="strong">{p.reviewer}</span><LangTag lang={guessLang(p.text)} /><span className="muted">{p.text.slice(0, 70)}{p.text.length > 70 ? "…" : ""}</span></div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="form-grid">
          <Field label="Reviewer"><Input id="rv-one-name" value={one.reviewer} onChange={(v) => setOne({ ...one, reviewer: v })} placeholder="Giulia R." /></Field>
          <Field label="Rating"><Select id="rv-one-rating" value={one.rating} onChange={(v) => setOne({ ...one, rating: v })} options={["5", "4", "3", "2", "1"]} /></Field>
          <Field label="Date"><Input id="rv-one-date" type="date" value={one.date} onChange={(v) => setOne({ ...one, date: v })} /></Field>
          <Field label="Review text" wide><TextArea id="rv-one-text" value={one.text} onChange={(v) => setOne({ ...one, text: v })} /></Field>
        </div>
      )}
    </Modal>
  );
}

export function Approvals(props: { reviews: Review[]; clients: Client[]; clientId: string }) {
  const queue = props.reviews.filter((r) => r.status === "awaiting-owner" && (!props.clientId || r.clientId === props.clientId));
  const byId = new Map(props.clients.map((c) => [c.id, c]));
  if (!queue.length)
    return <Empty>No replies waiting for an owner. 1 to 3 star replies land here after drafting, and the owner gets them on WhatsApp.</Empty>;
  return <div className="stack">{queue.map((r) => <ApprovalCard key={r.id} r={r} client={byId.get(r.clientId)} />)}</div>;
}

function ApprovalCard(props: { r: Review; client?: Client }) {
  const { r, client } = props;
  const settings = useSettings();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.reply ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const s = settingsFor(client, settings);
  const waText = [
    `Hola ${firstName(client?.contact ?? "")}, nueva reseña de ${r.rating} estrellas en Google para ${client?.name ?? "tu negocio"}.`,
    `${r.reviewer} (${langName(r.lang).toLowerCase()}): "${r.text.slice(0, 160)}${r.text.length > 160 ? "…" : ""}"`,
    "",
    `Respuesta propuesta (traducida): ${r.replyEs ?? r.reply ?? ""}`,
    "",
    "Responde 1 para publicar, 2 para cambiarla o 3 para no responder.",
  ].join("\n");

  async function approve() {
    setBusy(true);
    await put(COL.reviews, { ...r, reply: text, status: "posted" as const, postedAt: now() });
    await closeTask(r.taskId);
    toast("Approved. Marked as posted (Google not connected yet).");
  }
  async function reject() {
    await put(COL.reviews, { ...r, status: "rejected" as const, rejectReason: reason.trim() || undefined });
    await closeTask(r.taskId);
    toast("Rejected. Nothing will be posted.");
  }
  async function redraft() {
    setBusy(true);
    try { const out = await draftAndRoute({ ...r, status: "new" }, client, s); setText(out.reply ?? ""); }
    finally { setBusy(false); }
  }

  return (
    <Card title={<span className="row wrap"><Stars n={r.rating} />{r.reviewer}<LangTag lang={r.lang} /></span>}
      aside={<span className="small faint">{client?.name} · {fmtDate(r.date)}</span>}>
      <div className="grid-2">
        <div className="stack">
          <div className="box"><span className="small faint">Review</span><p>{r.text}</p></div>
          <Field label={`Proposed reply in ${langName(r.lang)}`}>
            {editing ? <TextArea id={"ap-" + r.id} rows={7} value={text} onChange={setText} /> : <div className="box pre">{text}</div>}
          </Field>
          {r.replyEs && r.lang !== "es" && <p className="small muted"><span className="strong">ES: </span>{r.replyEs}</p>}
          <div className="row wrap">
            <Button kind="primary" busy={busy} onClick={approve}>Approve and post</Button>
            <Button onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}</Button>
            <Button kind="ghost" busy={busy} onClick={redraft}>Redraft</Button>
            {!rejecting && <Button kind="ghost" onClick={() => setRejecting(true)}>Reject</Button>}
          </div>
          {rejecting && (
            <div className="row wrap">
              <Input id={"rj-" + r.id} value={reason} onChange={setReason} placeholder="Reason (optional): owner will call the guest" />
              <Button small kind="danger" onClick={reject}>Reject reply</Button>
              <Button small kind="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
            </div>
          )}
        </div>
        <div className="stack-sm">
          <span className="small strong">WhatsApp to owner {s.ownerWhatsapp && <span className="faint mono">{s.ownerWhatsapp}</span>}</span>
          <div className="chat" style={{ minHeight: 0 }}>
            <div className="bubble bubble-out">{waText}<div className="bubble-meta">Sent {r.sentToOwnerAt ? fmtDate(r.sentToOwnerAt) : ""} · simulated</div></div>
          </div>
          <p className="small faint">WhatsApp Cloud API is not connected, so nothing was really sent. Copy this message to the owner by hand, then record the answer here.</p>
          <div><CopyButton text={waText} label="Copy WhatsApp message" /></div>
        </div>
      </div>
    </Card>
  );
}
