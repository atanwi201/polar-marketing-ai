// Share a post (photo) or a video ad: post straight to the client's connected accounts, or share by
// hand (device share sheet, Instagram, Facebook, X, YouTube) with the caption copied and the file downloaded.
import { useState } from "react";
import { Modal, Button, Badge, toast, fmtDate } from "../core/ui";
import {
  type Act, type Platform, type Post, type Video, type SClient, type StudioData, type ShareResult,
  assetUrl, mediaUrl, download, copyText, fullText, xText, tagLine, fmtSize,
} from "./studio-api";

const LABEL: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", x: "X", youtube: "YouTube Shorts", google: "Google" };
const POST_TARGETS: Platform[] = ["instagram", "facebook", "x", "google"];
const VIDEO_TARGETS: Platform[] = ["instagram", "facebook", "youtube"];

type Props =
  | { kind: "post"; item: Post; client: SClient; data: StudioData; act: Act; onClose: () => void }
  | { kind: "video"; item: Video; client: SClient; data: StudioData; act: Act; onClose: () => void };

export function ShareModal(props: Props) {
  const { kind, item, client, data, act, onClose } = props;
  const langs = kind === "video" ? Object.keys(props.item.renders ?? {}) : Object.keys(item.captions ?? {});
  const [lang, setLang] = useState(langs[0] ?? "es");
  const [busy, setBusy] = useState<Platform | "">("");
  const targets = kind === "video" ? VIDEO_TARGETS : POST_TARGETS;
  const conns = client.connections;
  const render = kind === "video" ? props.item.renders?.[lang] : undefined;
  const file = kind === "video" ? render?.file : props.item.imageFile;
  const shareLink = data.public.reachable && item.shareKey ? `${data.public.url}/p/${item.shareKey}?lang=${lang}` : "";
  const caption = fullText(item, lang);
  const what = kind === "video" ? "video" : "image";

  const direct = async (pf: Platform) => {
    setBusy(pf);
    const r = await act("POST", `/${kind === "video" ? "videos" : "posts"}/${item.id}/share`, { platform: pf, lang });
    setBusy("");
    const res = r as ShareResult | undefined;
    if (res?.ok) toast(`Posted to ${LABEL[pf]}`);
  };

  /** Copy the caption, download the file and open the app, so posting there is paste + pick file. */
  const byHand = async (text: string, open: string, where: string) => {
    if (!file) return;
    await copyText(text, `Caption copied. The ${what} is downloading: add it in ${where} and paste the caption.`);
    download(file);
    window.open(open, "_blank", "noopener");
  };

  const deviceShare = async () => {
    if (!file) return;
    try {
      const blob = await (await fetch(mediaUrl(file))).blob();
      const f = new File([blob], file, { type: blob.type });
      const payload: ShareData = { files: [f], text: caption };
      if (!navigator.canShare?.(payload)) { toast("This browser can't share files. Use the buttons for each app."); return; }
      await navigator.share(payload);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast("Sharing didn't work here. Use the buttons for each app.");
    }
  };

  const shareX = () => {
    if (!file) return;
    const text = xText(item, lang, shareLink ? 24 : 0);
    const u = new URL("https://x.com/intent/post");
    u.searchParams.set("text", text);
    if (shareLink) u.searchParams.set("url", shareLink);
    else { download(file); toast(`The ${what} is downloading. Attach it to the post on X.`); }
    window.open(u.toString(), "_blank", "noopener");
  };

  const shareFacebook = () => {
    if (shareLink) {
      void copyText(caption, "Caption copied: paste it above the link preview.");
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareLink)}`, "_blank", "noopener");
    } else void byHand(caption, "https://www.facebook.com/", "Facebook");
  };

  const shareYoutube = () => {
    if (kind !== "video") return;
    const v = props.item;
    const title = (v.title?.[lang] ?? v.concept ?? "").slice(0, 90) + " #Shorts";
    const desc = [v.description?.[lang] ?? v.captions?.[lang] ?? "", tagLine(v.hashtags), "#Shorts"].filter(Boolean).join("\n\n");
    void byHand(`${title}\n\n${desc}`, "https://www.youtube.com/upload", "YouTube Studio");
  };

  const canDeviceShare = typeof navigator !== "undefined" && "canShare" in navigator;

  return (
    <Modal open title={kind === "video" ? "Share video ad" : "Share post"} onClose={onClose}>
      <div className="stack">
        {langs.length > 1 && (
          <div className="row wrap">{langs.map((l) => (
            <button key={l} type="button" className={"chip" + (l === lang ? " chip-on" : "")} aria-pressed={l === lang} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}</div>
        )}

        <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
          {file && (kind === "video"
            ? <video src={mediaUrl(file)} poster={render ? mediaUrl(render.cover) : undefined} controls playsInline style={{ width: 150, aspectRatio: "9 / 16", borderRadius: 8, background: "#000", flex: "none" }} />
            : <img src={mediaUrl(file)} alt={props.item.altText || props.item.concept || "Post image"} style={{ width: 150, aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 8, flex: "none" }} />)}
          <div className="stack-sm" style={{ minWidth: 0, flex: 1 }}>
            <span className="small muted">Caption for Instagram, Facebook and Google</span>
            <div className="pre small box" style={{ maxHeight: 170, overflow: "auto" }}>{caption || <span className="faint">No caption</span>}</div>
            {kind === "post" && <><span className="small muted">Text for X ({xText(item, lang).length}/280)</span><div className="pre small box">{xText(item, lang)}</div></>}
            {render && <span className="small faint">{render.duration.toFixed(0)} s · 1080×1920 · MP4 · {fmtSize(render.size)}</span>}
          </div>
        </div>

        <div className="stack-sm">
          <strong>Post directly</strong>
          <span className="small muted">Uses the client's connected accounts. Connect them in the client's settings.</span>
          {targets.map((pf) => {
            const c = conns?.[pf];
            const last = item.shares?.[`${pf}:${lang}`];
            return (
              <div key={pf} className="box row wrap between">
                <span className="stack-sm" style={{ minWidth: 0 }}>
                  <span className="row wrap"><span className="strong">{LABEL[pf]}{kind === "video" && pf !== "youtube" ? " Reels" : ""}</span>
                    {c?.ready ? <Badge tone="good">connected</Badge> : <Badge>not connected</Badge>}</span>
                  {!c?.ready && c?.missing && <span className="small faint">{c.missing}</span>}
                  {last?.ok && <span className="small">Posted {fmtDate(last.at)}{last.url && <> · <a href={last.url} target="_blank" rel="noreferrer">open</a></>}</span>}
                  {last?.ok && last.note && <span className="small faint">{last.note}</span>}
                  {last && !last.ok && <span className="small" style={{ color: "var(--bad)" }}>{last.error}</span>}
                </span>
                <Button small kind="primary" disabled={!c?.ready || (pf !== "google" && !file) || !!busy} busy={busy === pf} onClick={() => void direct(pf)}>
                  {last?.ok ? "Post again" : `Post to ${LABEL[pf]}`}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="stack-sm">
          <strong>Share by hand</strong>
          <span className="small muted">Copies the caption and downloads the {what}, then opens the app.</span>
          <div className="row wrap">
            {canDeviceShare && <Button small onClick={() => void deviceShare()}>Share from this device…</Button>}
            <Button small onClick={() => void byHand(caption, "https://www.instagram.com/", "Instagram")}>Instagram</Button>
            <Button small onClick={shareFacebook}>Facebook</Button>
            {kind === "post" && <Button small onClick={shareX}>X</Button>}
            {kind === "video" && <Button small onClick={shareYoutube}>YouTube Shorts</Button>}
          </div>
          <div className="row wrap">
            {file && <a className="btn btn-ghost btn-sm" style={{ textDecoration: "none" }} href={assetUrl(`/media/${file}?download=1`)} download>Download {what}</a>}
            <Button small kind="ghost" onClick={() => void copyText(caption)}>Copy caption</Button>
            {shareLink && <Button small kind="ghost" onClick={() => void copyText(shareLink, "Share link copied")}>Copy share link</Button>}
          </div>
          {!data.public.reachable && (
            <span className="small faint">
              Tip: set <code className="mono">PUBLIC_URL</code> in .env to a public https address for this server (for example a Cloudflare tunnel).
              Then Facebook and X show a link preview with the {what}, and Instagram photos can be posted directly.
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
