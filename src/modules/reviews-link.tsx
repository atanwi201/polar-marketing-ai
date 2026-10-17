// Client setup (brand voice, owner WhatsApp, review link) and the review-request QR + WhatsApp link generator.
import { useMemo, useState } from "react";
import { create, put } from "../core/store";
import { dayOffset } from "../core/seed";
import { Badge, Button, Card, CopyButton, Empty, Field, Input, Select, TextArea, LangTag, fmtDate, toast } from "../core/ui";
import type { Client, Task } from "../core/types";
import { COL, langName, p1Tier, type ReviewSettings } from "./reviews-data";
import { settingsFor, useSettings } from "./reviews-shared";
import { qrMatrix, qrPath } from "./reviews-qr";

const REQUEST: Record<string, (name: string, link: string) => string> = {
  es: (n, l) => `¡Gracias por visitarnos en ${n}! ¿Nos cuentas qué tal en una reseña de Google? Nos ayuda mucho: ${l}`,
  en: (n, l) => `Thanks for visiting ${n}! Would you tell us how it went in a Google review? It really helps a small local business: ${l}`,
  de: (n, l) => `Danke für Ihren Besuch bei ${n}! Erzählen Sie uns in einer Google-Bewertung, wie es war? Das hilft uns als kleinem Betrieb sehr: ${l}`,
  it: (n, l) => `Grazie per essere venuti da ${n}! Ci raccontate com'è andata con una recensione su Google? Per una piccola attività locale conta molto: ${l}`,
  nl: (n, l) => `Bedankt voor je bezoek aan ${n}! Wil je in een Google-review vertellen hoe het was? Dat helpt een klein lokaal bedrijf enorm: ${l}`,
  fr: (n, l) => `Merci de votre visite chez ${n} ! Vous nous dites comment ça s'est passé dans un avis Google ? Cela aide beaucoup une petite entreprise locale : ${l}`,
  sv: (n, l) => `Tack för besöket hos ${n}! Berätta gärna hur det var i en Google-recension. Det hjälper ett litet lokalt företag mycket: ${l}`,
};
const STAND: Record<string, string> = {
  es: "¿Qué tal todo? Cuéntalo en Google", en: "How was it? Tell us on Google", de: "Wie war es? Bewerten Sie uns auf Google",
  it: "Com'è andata? Diccelo su Google", nl: "Hoe was het? Laat een review achter", fr: "C'était comment ? Dites-le sur Google", sv: "Hur var det? Berätta på Google",
};

const digits = (s: string) => s.replace(/\D/g, "");
export const reviewLink = (s: Pick<ReviewSettings, "reviewUrl" | "placeId">) =>
  s.reviewUrl.trim() || (s.placeId.trim() ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(s.placeId.trim())}` : "");

export function QrSvg(props: { text: string; size?: number; label: string }) {
  const res = useMemo(() => {
    try { const m = qrMatrix(props.text, "M"); return { n: m.length + 8, d: qrPath(m, 4) }; }
    catch (e) { return { error: (e as Error).message }; }
  }, [props.text]);
  if ("error" in res) return <Empty>{res.error}</Empty>;
  // A QR code must print dark on light in both themes, so these two fills are fixed on purpose.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${res.n} ${res.n}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${res.d}" fill="#000"/></svg>`;
  return (
    <div className="stack-sm" style={{ alignItems: "center" }}>
      <div role="img" aria-label={props.label} style={{ width: props.size ?? 200, height: props.size ?? 200 }} dangerouslySetInnerHTML={{ __html: svg }} />
      <CopyButton text={svg} label="Copy SVG for print" />
    </div>
  );
}

export function LinkTab(props: { client?: Client }) {
  const c = props.client;
  const all = useSettings();
  if (!c) return <Empty>Pick a client at the top of the page.</Empty>;
  const s = settingsFor(c, all);
  return (
    <div className="stack">
      <SetupCard key={c.id + s.id} client={c} s={s} />
      <QrCard key={"q" + c.id} client={c} s={s} />
    </div>
  );
}

function SetupCard(props: { client: Client; s: ReviewSettings }) {
  const { client: c } = props;
  const [s, setS] = useState(props.s);
  const pro = p1Tier(c) === "Pro";
  const nextRefresh = s.lastPhotoRefresh ? new Date(new Date(s.lastPhotoRefresh).getTime() + 90 * 864e5).toISOString().slice(0, 10) : "";
  const save = async () => { await put(COL.settings, { ...s, clientId: c.id }); toast("Client setup saved."); };
  return (
    <Card title={`Client setup · ${c.name}`} aside={<Badge tone="accent">{p1Tier(c) ?? "No plan"}</Badge>}>
      <div className="form-grid">
        <Field label="Brand voice for replies and posts" wide><TextArea id="st-voice" rows={2} value={s.voice} onChange={(v) => setS({ ...s, voice: v })} /></Field>
        <Field label="Reply sign-off"><Input id="st-sign" value={s.signoff} onChange={(v) => setS({ ...s, signoff: v })} /></Field>
        <Field label="Owner WhatsApp (gets 1-3 star approvals)"><Input id="st-wa" value={s.ownerWhatsapp} onChange={(v) => setS({ ...s, ownerWhatsapp: v })} /></Field>
        <Field label="Google Place ID" hint="From Google's Place ID finder"><Input id="st-place" value={s.placeId} onChange={(v) => setS({ ...s, placeId: v })} placeholder="ChIJ..." /></Field>
        <Field label="Or the short review link" hint="Profile > Ask for reviews > copy link"><Input id="st-url" value={s.reviewUrl} onChange={(v) => setS({ ...s, reviewUrl: v })} placeholder="https://g.page/r/.../review" /></Field>
        <Field label="Last photo refresh"><Input id="st-photo" type="date" value={s.lastPhotoRefresh ?? ""} onChange={(v) => setS({ ...s, lastPhotoRefresh: v || undefined })} /></Field>
      </div>
      <div className="row wrap between">
        <span className="small muted">
          {pro ? (nextRefresh ? `Pro includes a quarterly photo refresh. Next one due ${fmtDate(nextRefresh)}.` : "Pro includes a quarterly photo refresh. Set the last date.") : "Quarterly photo refresh comes with Pro."}
        </span>
        <div className="row wrap">
          {pro && <Button small onClick={async () => {
            await create<Task>("tasks", { title: `Photo refresh visit: ${c.name} (${c.town})`, module: "reviews", clientId: c.id, due: nextRefresh || dayOffset(7), done: false });
            toast("Photo refresh added to Today.");
          }}>Add photo refresh task</Button>}
          <Button kind="primary" onClick={save}>Save setup</Button>
        </div>
      </div>
    </Card>
  );
}

function QrCard(props: { client: Client; s: ReviewSettings }) {
  const c = props.client;
  const link = reviewLink(props.s);
  const langs = ["es", ...c.languages.filter((l) => l !== "es")];
  const [lang, setLang] = useState(langs.includes("en") ? "en" : langs[0]);
  const [guest, setGuest] = useState("");
  const [target, setTarget] = useState<"review" | "whatsapp">("review");
  const msg = (REQUEST[lang] ?? REQUEST.en)(c.name, link || "[review link]");
  const waGuest = `https://wa.me/${digits(guest)}?text=${encodeURIComponent(msg)}`;
  const waBusiness = `https://wa.me/${digits(c.phone)}?text=${encodeURIComponent(lang === "es" ? `Hola ${c.name}, quiero dejar mi opinión.` : `Hi ${c.name}, I'd like to leave feedback.`)}`;
  const qrText = target === "review" ? link : waBusiness;

  return (
    <div className="grid-2">
      <Card title="WhatsApp review request">
        <div className="form-grid">
          <Field label="Language">
            <Select id="qr-lang" value={lang} onChange={setLang} options={langs.map((l) => ({ value: l, label: langName(l) }))} />
          </Field>
          <Field label="Guest number (optional)" hint="Leave empty to choose the contact in WhatsApp"><Input id="qr-guest" value={guest} onChange={setGuest} placeholder="+49 151 ..." /></Field>
        </div>
        {!link && <p className="small" style={{ color: "var(--warn)" }}>Add the Place ID or review link in the setup above. The message shows a placeholder until then.</p>}
        <div className="box pre">{msg}</div>
        <div className="stack-sm">
          <span className="field-label">wa.me link</span>
          <div className="box mono small" style={{ overflowWrap: "anywhere" }}>{waGuest}</div>
          <div className="row wrap">
            <CopyButton text={waGuest} label="Copy link" />
            <CopyButton text={msg} label="Copy message" />
            <a className="btn btn-sm btn-ghost" href={waGuest} target="_blank" rel="noreferrer">Open in WhatsApp</a>
          </div>
        </div>
        <p className="small faint">
          Ask every guest, not only the happy ones: Google bans review gating and rewards for reviews. Send WhatsApp requests only to guests who gave
          you their number for this visit, never as a marketing blast.
        </p>
      </Card>
      <Card title="Table and counter QR">
        <Select id="qr-target" value={target} onChange={setTarget} options={[
          { value: "review", label: "Opens the Google review form" },
          { value: "whatsapp", label: "Opens a WhatsApp chat with the business" },
        ]} />
        {qrText ? (
          <div className="box stack" style={{ alignItems: "center", background: "var(--surface)", textAlign: "center" }}>
            <h3>{c.name}</h3>
            <QrSvg text={qrText} label={`QR code for ${target === "review" ? "the Google review form" : "WhatsApp"}`} />
            <div className="stack-sm">
              {langs.slice(0, 4).map((l) => <span key={l} className="small"><LangTag lang={l} /> {STAND[l] ?? STAND.en}</span>)}
            </div>
          </div>
        ) : <Empty>Add the Place ID or review link in the setup above to make the review QR.</Empty>}
        <p className="small faint mono" style={{ overflowWrap: "anywhere" }}>{qrText}</p>
        <p className="small faint">Real QR code (error correction M). Copy the SVG into a print shop file for table stands; it stays sharp at any size. Test-scan it with a phone before printing.</p>
      </Card>
    </div>
  );
}
