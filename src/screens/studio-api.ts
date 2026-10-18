// Types and API helpers shared by the Content Studio screens (see server/index.mjs).
import { toast } from "../core/ui";

export type Platform = "instagram" | "facebook" | "x" | "youtube";
export interface Site {
  status: "building" | "waiting" | "ready" | "failed"; url?: string; path?: string; builtAt?: string; error?: string; models?: unknown;
  step?: string; kind?: "ai" | "template" | "upload"; design?: string; directionName?: string; editedAt?: string; note?: string; languages?: string[];
}
export interface Service { name: string; price: string; description: string }
export interface Profile {
  tagline?: string; story?: string; usps?: string; since?: string; address?: string; mapsUrl?: string; bookingUrl?: string; menuUrl?: string;
  payment?: string; extras?: string; services?: Service[]; social?: Record<string, string>; colors?: { primary?: string; accent?: string };
  style?: "modern" | "warm" | "bold" | "elegant" | "natural"; examples?: string[];
}
export interface Accounts {
  facebook: { pageId: string; token: string };
  instagram: { userId: string; token: string };
  x: { token: string; secret: string };
  youtube: { refreshToken: string };
}
export type Connections = Record<Platform, { ready: boolean; missing?: string }>;
export interface SiteChatMessage { id: string; role: "owner" | "ai"; text: string; at: string; status: "working" | "done" | "failed" }
export interface SClient {
  id: string; token: string; code?: string; name: string; kind: string; town: string; phone: string; email: string; domain: string;
  offer: string; hours: string; tone: string; languages: string[]; platforms: string[]; autopilot: boolean;
  postsPerWeek: number; autoPublish: boolean; webhookUrl: string; siteSlug?: string; site?: Site; createdAt: string;
  source?: string; aiProvider?: string; exampleUrls?: string[];
  accounts?: Accounts; connections?: Connections; videosPerWeek?: number; videoSeconds?: number; videoVoice?: boolean;
  approvalStatus?: "approved" | "pending" | "declined"; approval?: { status: string; at: string };
  usage?: { used: number; cap: number; custom: boolean; nextFreeAt: string | null }; postCap?: number;
  siteChat?: SiteChatMessage[]; siteEdit?: { status: "working" | "idle"; step?: string }; siteVersions?: number;
  plan?: "basic" | "pro" | ""; customPrice?: number | null; profile?: Profile; logoFile?: string; photos?: { file: string; description?: string }[]; marketingConsent?: boolean | { at: string; source: string };
}
export interface Brief { id: string; clientId: string; text: string; createdAt: string; imageFile?: string; imageDescription?: string; archived?: boolean }
export type PostStatus = "generating" | "waiting" | "ready" | "published" | "failed";
export interface ShareResult { platform: Platform; lang: string; at: string; ok: boolean; url?: string; id?: string; error?: string }
type LangText = Record<string, string>;
export interface Post {
  id: string; clientId: string; briefId?: string; createdAt: string; status: PostStatus; reason?: string; concept?: string;
  imagePrompt?: string; captions?: LangText; short?: LangText; altText?: string; hashtags?: string[]; cta?: string; imageFile?: string;
  model?: string; error?: string; publishNote?: string; publishedAt?: string; shareKey?: string; shares?: Record<string, ShareResult>;
  imageEngine?: string; imageNote?: string; kind?: "ai" | "photo"; overlay?: { badge: string; headline: string; subline: string };
}
export interface Scene { imagePrompt: string; text: LangText; imageFile?: string }
export interface Render { file: string; cover: string; duration: number; size: number; voice?: boolean }
export interface Video {
  id: string; clientId: string; text: string; createdAt: string; status: PostStatus; step?: "script" | "images" | "rendering" | ""; stepNote?: string;
  progress?: number; reason?: string; seconds: number; langs: string[]; voice: boolean; concept?: string; scenes?: Scene[];
  endCta?: LangText; voiceover?: LangText; captions?: LangText; title?: LangText; description?: LangText; hashtags?: string[];
  renders?: Record<string, Render>; model?: string; error?: string; publishNote?: string; publishedAt?: string; shareKey?: string;
  shares?: Record<string, ShareResult>; kind?: "clip";
}
export type ImageProvider = "free" | "openrouter" | "google" | "puter";
export interface AiSettings {
  openrouter: boolean; providers: string[]; order: string; puter: { imageModel: string; voiceProvider: string; voice: string };
  sources: Record<string, "saved" | "env" | "">;
  list: { id: string; label: string; hint: string; paid: boolean; key: string; model: string }[];
}
export interface ImageSettings {
  provider: ImageProvider; engine: string; fallback: boolean;
  googleModel: string; googleSize: "1K" | "2K"; googleKey: string; googleKeyFromEnv: boolean; pexelsKey: string; pexelsKeyFromEnv: boolean; googleModels: { id: string; label: string }[];
  openrouterModel: string; openrouterKey: boolean; puterKey: boolean; openrouterModels: { id: string; label: string }[];
}
export interface Message {
  id: string; clientId: string; role: "client" | "assistant" | "owner"; text: string; createdAt: string;
  attachments?: { file: string; kind: "image" | "video" | "audio"; description?: string }[];
  status?: "thinking" | "done" | "failed"; action?: string; postId?: string; videoId?: string; updated?: string[];
  needsOwner?: boolean; seenByOwner?: boolean; model?: string; error?: string;
}
export interface StudioData {
  clients: SClient[]; briefs: Brief[]; posts: Post[]; videos: Video[]; messages: Message[]; ai: AiSettings; images: ImageSettings;
  video: { ffmpeg: boolean; voices: string[]; lengths: number[] };
  public: { url: string; reachable: boolean };
  apps: { x: boolean; youtube: boolean };
  limits?: { postsPerWeek: number };
}

export type Result<T> = { kind: "ok"; data: T } | { kind: "unreachable" } | { kind: "auth" } | { kind: "error"; message: string };
export type Act = (method: string, path: string, body?: unknown, okMsg?: string) => Promise<unknown>;

const TOKEN_KEY = "isla:adminToken";
export const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } };
const AI_KEY = "isla:aiProvider";
/** Which AI provider the dashboard asks the server to use: "" = automatic (free ones, in order). */
export const readAiProvider = () => { try { return localStorage.getItem(AI_KEY) ?? ""; } catch { return ""; } };
export const saveAiProvider = (v: string) => { try { localStorage.setItem(AI_KEY, v); } catch { /* ignore */ } };
export const saveToken = (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } };

// Served by our server (or Vite, which forwards to it): same origin. As a claude.ai artifact: the local server.
export const apiOrigin = /^https?:$/.test(location.protocol) && !/claude/.test(location.hostname) ? location.origin : "http://localhost:8787";
const sameOrigin = apiOrigin === location.origin;
export const assetUrl = (p: string) => (sameOrigin ? p : apiOrigin + p);
export const mediaUrl = (file: string) => assetUrl("/media/" + file);
export const downloadUrl = (file: string) => mediaUrl(file) + "?download=1";
export const siteUrl = (u: string) => (/^https?:/.test(u) ? u : assetUrl(u));

export async function call<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const tok = readToken();
    if (tok) headers["x-admin-token"] = tok;
    const ai = readAiProvider();
    if (ai) headers["x-ai-provider"] = ai;
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

export function downscale(file: File, max = 1600): Promise<string> {
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

// ---- Text per platform (mirrors server/social.mjs textFor) ----
export const tagLine = (tags?: string[]) => (tags ?? []).map((h) => "#" + h.replace(/^#+/, "")).join(" ");
export function fullText(item: { captions?: LangText; hashtags?: string[] }, lang: string) {
  return [item.captions?.[lang] ?? "", tagLine(item.hashtags)].filter(Boolean).join("\n\n");
}
export function xText(item: { captions?: LangText; short?: LangText; hashtags?: string[] }, lang: string, reserve = 0) {
  const max = 280 - reserve;
  let t = (item.short?.[lang] || item.captions?.[lang] || "").trim();
  if (t.length > max) t = t.slice(0, max - 3).replace(/\s+\S*$/, "") + "…";
  for (const tag of tagLine(item.hashtags).split(" ").filter(Boolean).slice(0, 3)) {
    if (t.length + tag.length + 1 <= max) t += (t.includes("#") ? " " : "\n\n") + tag;
  }
  return t;
}

export async function copyText(text: string, okMsg = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return true; }
  catch { toast("Copy was blocked. Select the text and copy it by hand."); return false; }
}

/** Start a file download (the server sends it as an attachment). */
export function download(file: string) {
  const a = document.createElement("a");
  a.href = downloadUrl(file);
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

/** Download a client's live website as a zip. Throws a readable message. */
export async function downloadSiteZip(clientId: string, name: string) {
  const headers: Record<string, string> = {};
  const tok = readToken();
  if (tok) headers["x-admin-token"] = tok;
  const r = await fetch(`/api/studio/clients/${clientId}/site.zip`, { headers });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Download failed (${r.status})`);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url; a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "website"}.zip`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Replace a client's live website with an uploaded zip. Returns an error message, or "" when done. */
export async function uploadSiteZip(clientId: string, file: File): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/zip" };
  const tok = readToken();
  if (tok) headers["x-admin-token"] = tok;
  try {
    const r = await fetch(`/api/studio/clients/${clientId}/site-upload`, { method: "POST", headers, body: file });
    if (r.ok) return "";
    return ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Upload failed (${r.status})`;
  } catch { return "The server is not reachable."; }
}

export interface SiteQr { url: string; studioUrl: string; hasDomain: boolean; svg: string }

/** Download the QR code of a client's website as a PNG. `where`: their own domain or the studio link. */
export async function downloadQrPng(clientId: string, name: string, where: "domain" | "studio") {
  const headers: Record<string, string> = {};
  const tok = readToken();
  if (tok) headers["x-admin-token"] = tok;
  const r = await fetch(`/api/studio/clients/${clientId}/qr.png?where=${where}`, { headers });
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url; a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "website"}-qr.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
