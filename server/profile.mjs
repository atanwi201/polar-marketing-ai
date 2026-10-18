// Everything a business tells us for its website: brand (logo, slogan, colours, style), what it
// offers (products and services with prices, what makes it special, its story), where and when
// (address, hours, links, social accounts) and its own photos. Kept on client.profile,
// client.logoFile and client.photos.
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { id, MEDIA_DIR } from "./store.mjs";

export const STYLES = ["modern", "warm", "bold", "elegant", "natural"];
export const SOCIAL = ["instagram", "facebook", "tiktok", "google", "tripadvisor", "youtube", "website"];
const TEXT = { tagline: 140, story: 1500, usps: 900, address: 200, mapsUrl: 600, bookingUrl: 600, menuUrl: 600, payment: 200, extras: 900, team: 600, since: 40 };
export const MAX_PHOTOS = 12;
export const MAX_SERVICES = 12;

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : undefined);
const url = (v) => {
  const s = str(v, 600);
  if (!s) return s === "" ? "" : undefined;
  const u = /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname.includes(".") ? x.href : undefined; } catch { return undefined; }
};
const hex = (v) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : v === "" ? "" : undefined);

/** Merge the profile fields from a form or the assistant into client.profile (only valid values). */
export function applyProfile(client, body = {}) {
  const p = { ...(client.profile ?? {}) };
  for (const [k, n] of Object.entries(TEXT)) {
    const v = k.endsWith("Url") ? url(body[k]) : str(body[k], n);
    if (v !== undefined) p[k] = v;
  }
  if (Array.isArray(body.services)) {
    p.services = body.services
      .map((s) => ({ name: str(s?.name, 80) ?? "", price: str(s?.price, 40) ?? "", description: str(s?.description, 300) ?? "" }))
      .filter((s) => s.name).slice(0, MAX_SERVICES);
  }
  if (body.social && typeof body.social === "object") {
    p.social = { ...(p.social ?? {}) };
    for (const k of SOCIAL) { const v = url(body.social[k]); if (v !== undefined) p.social[k] = v; }
  }
  if (body.colors && typeof body.colors === "object") {
    p.colors = { ...(p.colors ?? {}) };
    for (const k of ["primary", "accent"]) { const v = hex(body.colors[k]); if (v !== undefined) p.colors[k] = v; }
  }
  if (STYLES.includes(body.style)) p.style = body.style;
  client.profile = p;
  // A few fields live on the client itself (the studio and the AI use them everywhere).
  if (str(body.hours, 300) !== undefined) client.hours = str(body.hours, 300);
  if (str(body.offer, 2000)) client.offer = str(body.offer, 2000);
  return p;
}

/** Save a data-URL image (JPEG, PNG or WebP, max 8 MB). Returns the media file name. */
export async function saveDataImage(dataUrl, prefix = "up") {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl ?? "");
  if (!m) throw Object.assign(new Error("Upload a JPEG, PNG or WebP image"), { status: 400 });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8e6) throw Object.assign(new Error("Image is over 8 MB"), { status: 413 });
  const file = `${prefix}-${id()}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  await writeFile(join(MEDIA_DIR, file), buf);
  return file;
}

/** New logo, new photos (data URLs or uploaded files), photos removed. */
export async function applyImages(client, { logo, logoFile, photos = [], photoFiles = [], removePhotos = [] } = {}) {
  if (logo || logoFile) {
    const old = client.logoFile;
    client.logoFile = logoFile ?? (await saveDataImage(logo, "logo"));
    if (old && old !== client.logoFile && old.startsWith("logo-")) await unlink(join(MEDIA_DIR, old)).catch(() => {});
  }
  const list = (client.photos ?? []).filter((p) => !removePhotos.includes(p.file));
  for (const f of photoFiles) if (list.length < MAX_PHOTOS && !list.some((p) => p.file === f)) list.push({ file: f });
  for (const d of photos) if (list.length < MAX_PHOTOS) list.push({ file: await saveDataImage(d, "photo") });
  client.photos = list;
}

/** What's still missing for a great website (shown to the business as a checklist). */
export function missingProfile(c) {
  const p = c.profile ?? {};
  const out = [];
  if (!c.logoFile) out.push("logo");
  if ((c.photos ?? []).length < 3) out.push("photos");
  if (!p.services?.length) out.push("services");
  if (!p.address) out.push("address");
  if (!c.hours) out.push("hours");
  if (!p.story && !p.usps) out.push("story");
  if (!Object.values(p.social ?? {}).some(Boolean)) out.push("social");
  return out;
}

/** The profile as the business's dashboard and the studio see it. */
export const profileView = (c) => ({
  profile: c.profile ?? {}, hours: c.hours ?? "", offer: c.offer ?? "", logoFile: c.logoFile ?? "",
  photos: (c.photos ?? []).map((p) => p.file), missing: missingProfile(c),
});
