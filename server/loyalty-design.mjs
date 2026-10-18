// AI design of a loyalty card: palette, font, layout, texts, stamp icon and the card pictures.
// The free text model proposes, everything is validated and repaired here (WCAG contrast, hex
// colours, enums, lengths), and without AI a deterministic design comes from the brand colours.
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { MEDIA_DIR, now } from "./store.mjs";
import { complete as realComplete, aiKey as realAiKey } from "./openrouter.mjs";
import { generateImage as realGenerateImage } from "./images.mjs";

export const FONT_STYLES = ["modern", "serif", "rounded", "mono"];
export const LAYOUTS = ["stripe", "minimal", "full"];
export const STRIP_SIZE = [1125, 432];
export const BACKGROUND_SIZE = [1080, 1440];
const MIN_CONTRAST = 4.5;

// ---------- colour maths ----------

const HEX = /^#[0-9a-f]{6}$/i;
export const hex = (v) => {
  if (typeof v !== "string") return "";
  let s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = "#" + [...s.slice(1)].map((c) => c + c).join("");
  return HEX.test(s) ? s : "";
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => { const [x, y] = [rgb(a), rgb(b)]; return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
export function luminance(h) {
  const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Nudge `fg` towards white or black (whichever reads better on `bg`) until it passes `min`. */
export function ensureContrast(fg, bg, min = MIN_CONTRAST) {
  fg = hex(fg) || "#ffffff";
  if (contrast(fg, bg) >= min) return fg;
  const target = contrast("#ffffff", bg) >= contrast("#000000", bg) ? "#ffffff" : "#000000";
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}
const isDark = (h) => luminance(h) < 0.4;

function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
function hueOf(h) {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const k = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (k * 60 + 360) % 360;
}

// ---------- business kind -> look ----------

const KINDS = [
  [/caf[eé]|coffee|bar\b|bakery|panader|pasteler|brunch|t[eé]\b/i, "☕", 28],
  [/pizz/i, "🍕", 12],
  [/helad|ice.?cream|gelat/i, "🍦", 330],
  [/restaur|tapas|grill|bistro|food|comida/i, "🍽", 8],
  [/barber|pelu|hair|salon|salón/i, "✂", 215],
  [/beauty|nail|u[ñn]as|spa|massage|masaj|est[eé]tic/i, "✨", 320],
  [/gym|fit|yoga|sport|deport|surf|dive|buce/i, "💪", 200],
  [/flor|flower|garden|jard|plant/i, "🌸", 140],
  [/tienda|shop|store|boutique|fruter|market|mercado|super/i, "🛍", 150],
  [/hotel|apart|hostel|villa/i, "🌴", 190],
];
const kindLook = (client) => {
  const text = [client?.kind, client?.name].filter(Boolean).join(" ");
  const m = KINDS.find(([re]) => re.test(text));
  if (m) return { icon: m[1], hue: m[2] };
  let h = 0;
  for (const ch of text || "x") h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { icon: "⭐", hue: h };
};

// ---------- text / emoji ----------

const clean = (v, n, fallback = "") => {
  const s = typeof v === "string" ? v.replace(/[–—]/g, "-").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return (s || fallback).slice(0, n).trim();
};
const seg = typeof Intl?.Segmenter === "function" ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
const graphemes = (s) => (seg ? [...seg.segment(s)].map((x) => x.segment) : [...s]);
/** One emoji or symbol character (first grapheme), else the fallback. */
export function icon(v, fallback) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return fallback;
  const g = graphemes(s)[0];
  if (/^[\p{L}\p{N}]$/u.test(g) && g.length === 1 && /[a-z0-9]/i.test(g)) return fallback; // plain letters and digits are not icons
  return g.length > 12 ? fallback : g;
}
const safeFile = (v) => (typeof v === "string" && /^[\w][\w.-]{0,119}$/.test(v) ? v : "");

// ---------- defaults and validation ----------

const TYPE_TITLE = { stamps: "Loyalty card", points: "Rewards card", custom: "Club card" };

/** A palette from one base colour: dark card with light text (or the reverse for pale brand colours). */
function paletteFrom(base, accent) {
  base = hex(base) || "#1f3a5f";
  let bg = base;
  if (luminance(bg) > 0.55) bg = mix(bg, "#000000", 0.55); // pale brand colour: a deep version reads better
  const fg = isDark(bg) ? "#ffffff" : "#111111";
  const acc = hex(accent) || hslToHex((hueOf(base) + 40) % 360, 0.75, isDark(bg) ? 0.65 : 0.4);
  return { background: bg, foreground: fg, label: ensureContrast(mix(fg, bg, 0.25), bg), accent: ensureContrast(acc, bg, 3) };
}

/** Brand colours from the profile, else the client's logo, else null (the caller falls back to the kind). */
export async function brandColors(client) {
  const c = client?.profile?.colors ?? {};
  if (hex(c.primary)) return { primary: hex(c.primary), accent: hex(c.accent) };
  if (client?.logoFile) {
    try {
      const { logoPalette } = await import("./aisite.mjs");
      const p = await logoPalette(join(MEDIA_DIR, client.logoFile));
      if (p?.primary) return { primary: p.primary, accent: p.accent || "" };
    } catch { /* no logo colours: the kind decides */ }
  }
  return null;
}

/** Deterministic design with no AI. `kind` is the programme type (stamps, points, custom). `brand` as from brandColors. */
export function defaultDesign(client = {}, kind = "stamps", brand = null) {
  const look = kindLook(client);
  const c = client.profile?.colors ?? {};
  // No brand colours known: fall back to Polar black + lime (the validators below keep contrast correct).
  const hasBrand = !!(brand?.primary || hex(c.primary));
  const base = brand?.primary || hex(c.primary) || "#111111";
  const pal = paletteFrom(base, brand?.accent || hex(c.accent) || (hasBrand ? "" : "#d7ff64"));
  const name = clean(client.name, 28, "Loyalty");
  return {
    prompt: "", ...pal, fontStyle: client.profile?.style === "elegant" ? "serif" : client.profile?.style === "warm" ? "rounded" : "modern",
    layout: "minimal", cardTitle: name, tagline: clean(TYPE_TITLE[kind] ?? TYPE_TITLE.stamps, 60),
    stampIcon: look.icon, stampEmptyIcon: "○", logoFile: safeFile(client.logoFile), stripFile: "", backgroundFile: "",
    generatedBy: { model: "default", at: now() },
  };
}

/** Validate and repair a Design (AI output or a manual edit): every field ends up valid. */
export function normalizeDesign(raw, client = {}, base) {
  raw = raw && typeof raw === "object" ? raw : {};
  const d = base ?? defaultDesign(client);
  const background = hex(raw.background) || d.background;
  const accentRaw = hex(raw.accent) || d.accent;
  const fgRaw = hex(raw.foreground) || (hex(raw.background) ? (isDark(background) ? "#ffffff" : "#111111") : d.foreground);
  const foreground = ensureContrast(fgRaw, background);
  const labelRaw = hex(raw.label) || mix(foreground, background, 0.25);
  const layout = LAYOUTS.includes(raw.layout) ? raw.layout : d.layout;
  const out = {
    prompt: clean(raw.prompt ?? d.prompt, 600),
    background, foreground, label: ensureContrast(labelRaw, background), accent: ensureContrast(accentRaw, background, 3),
    fontStyle: FONT_STYLES.includes(raw.fontStyle) ? raw.fontStyle : d.fontStyle,
    layout,
    cardTitle: clean(raw.cardTitle, 28, d.cardTitle),
    tagline: clean(raw.tagline, 60, d.tagline),
    stampIcon: icon(raw.stampIcon, d.stampIcon),
    stampEmptyIcon: icon(raw.stampEmptyIcon, d.stampEmptyIcon || "○"),
    logoFile: "logoFile" in raw ? safeFile(raw.logoFile) : d.logoFile,
    stripFile: "stripFile" in raw ? safeFile(raw.stripFile) : d.stripFile,
    backgroundFile: "backgroundFile" in raw ? safeFile(raw.backgroundFile) : d.backgroundFile,
    generatedBy: raw.generatedBy && typeof raw.generatedBy === "object"
      ? { model: clean(raw.generatedBy.model, 80, "manual"), at: clean(raw.generatedBy.at, 40, now()) } : d.generatedBy,
  };
  // A layout that needs a picture it doesn't have falls back to flat colour.
  if ((out.layout === "stripe" && !out.stripFile) || (out.layout === "full" && !out.backgroundFile)) out.layout = "minimal";
  return out;
}

// ---------- the AI part ----------

const KEEP_GROUPS = {
  palette: ["background", "foreground", "label", "accent"], colors: ["background", "foreground", "label", "accent"],
  text: ["cardTitle", "tagline"], texts: ["cardTitle", "tagline"], icons: ["stampIcon", "stampEmptyIcon"],
  images: ["stripFile", "backgroundFile"], image: ["stripFile", "backgroundFile"], font: ["fontStyle"],
};
const FIELDS = ["background", "foreground", "label", "accent", "fontStyle", "layout", "cardTitle", "tagline", "stampIcon", "stampEmptyIcon", "logoFile", "stripFile", "backgroundFile"];
export function keptFields(keep) {
  const set = new Set();
  for (const k of Array.isArray(keep) ? keep : []) for (const f of KEEP_GROUPS[k] ?? (FIELDS.includes(k) ? [k] : [])) set.add(f);
  return set;
}

const SYSTEM = "You are a brand designer for small local businesses. You design loyalty cards that look like real Apple Wallet passes. Reply with one JSON object only.";

function designPromptText(client, kind, prompt, base) {
  const p = client.profile ?? {};
  return [
    `Business: ${client.name} (${client.kind || "local business"}, ${client.town || "Tenerife"}).${p.tagline ? ` Slogan: ${p.tagline}.` : ""}${p.style ? ` Brand style: ${p.style}.` : ""}`,
    p.colors?.primary ? `Brand colours: ${p.colors.primary}${p.colors.accent ? `, ${p.colors.accent}` : ""}.` : base.fromBrand ? `Brand colour from the logo: ${base.primary}.` : "",
    `Card type: ${kind === "points" ? "points with tiers" : kind === "custom" ? "stamps plus points and tiers" : "stamp card (collect stamps for a reward)"}.`,
    `The owner asks: """${prompt || "A card that fits my brand"}"""`,
    `Return JSON exactly in this shape: {"background": "#rrggbb" (card colour), "foreground": "#rrggbb" (main text, strong contrast on background), "label": "#rrggbb" (small caption text, readable on background), "accent": "#rrggbb" (stamps and highlights), "fontStyle": "modern"|"serif"|"rounded"|"mono", "layout": "stripe" (banner picture under the header) | "full" (picture behind everything) | "minimal" (flat colour), "cardTitle": string (max 28 chars, usually the business name), "tagline": string (max 60 chars, in the language of the business, no em-dashes), "stampIcon": one emoji for a collected stamp, "stampEmptyIcon": one character for an empty slot, "imagePrompt": string (English, 25-50 words, a photographic or illustrated scene for the card picture that fits the business and the colours; no text, no letters, no logos, no people's faces), "fullImage": boolean (true only if layout is "full")}`,
  ].filter(Boolean).join("\n");
}

async function askModel({ client, kind, prompt, base, deps }) {
  const key = deps.aiKey();
  if (!key) return null;
  try {
    const out = await deps.complete({ key, system: SYSTEM, prompt: designPromptText(client, kind, prompt, base), json: true, tier: "default" });
    const j = out?.json;
    return j && typeof j === "object" && !Array.isArray(j) ? { json: j, model: out.model || "ai" } : null;
  } catch (e) {
    console.warn("Loyalty design: the AI could not answer, using the default look:", e.message);
    return null;
  }
}

// ---------- pictures ----------

/** Cover-fit the generated picture to size and tint it with the card colour so text stays readable. */
async function finish(buf, [w, h], bg, alpha, bottomFade) {
  let canvas;
  try { canvas = await import("@napi-rs/canvas"); } catch { return buf; }
  try {
    const img = await canvas.loadImage(buf);
    const k = Math.max(w / img.width, h / img.height);
    const cv = canvas.createCanvas(w, h), ctx = cv.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
    ctx.globalAlpha = alpha; ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    if (bottomFade) { // blend into the card colour at the bottom of the stripe
      const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
      g.addColorStop(0, bg + "00"); g.addColorStop(1, bg + "99");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    return cv.toBuffer("image/png");
  } catch {
    return buf;
  }
}

async function drawImage({ deps, prompt, size, file, bg, alpha, fade }) {
  const raw = join(MEDIA_DIR, file.replace(/\.png$/, "-raw.jpg"));
  try {
    await deps.generateImage(prompt, raw, { size, forceFree: true, attempts: 2, fetchImpl: deps.fetchImpl });
    const { readFile } = await import("node:fs/promises");
    await writeFile(join(MEDIA_DIR, file), await finish(await readFile(raw), size, bg, alpha, fade));
    return file;
  } catch (e) {
    console.warn("Loyalty design: picture failed, using flat colour:", e.message);
    return "";
  } finally {
    await unlink(raw).catch(() => {});
  }
}

const NO_TEXT = " Wide composition, soft natural light, no text, no letters, no logos, no watermark, no faces.";
const imageText = (v, client) => clean(v, 500) || `${client.kind || "local shop"} atmosphere in ${client.town || "Tenerife"}, warm and inviting, ${client.name}`;

// ---------- entry point ----------

/**
 * Generate a new Design for a programme. Keeps the fields named in `keep` from program.design
 * (e.g. ["logoFile","palette"]). Never throws for AI or image trouble: it degrades to the
 * deterministic design with flat colour. `deps` swaps complete/generateImage/aiKey in tests.
 */
export async function designProgram(program, client, { prompt = "", keep = [], deps: d = {} } = {}) {
  const deps = { complete: realComplete, generateImage: realGenerateImage, aiKey: realAiKey, ...d };
  const old = program?.design ?? {};
  const kept = keptFields(keep);
  prompt = clean(prompt, 600);
  const brand = await brandColors(client);
  const base = { ...(brand ?? {}), fromBrand: !!brand };
  const fallback = defaultDesign(client, program?.type, brand);
  const ai = await askModel({ client, kind: program?.type, prompt, base: { ...base, primary: brand?.primary }, deps });
  const raw = { ...(ai?.json ?? {}) };
  // Honoured fields come from the existing design, not from the model.
  for (const f of kept) if (f in old) raw[f] = old[f];
  const design = normalizeDesign({ ...raw, prompt, logoFile: kept.has("logoFile") ? old.logoFile : client?.logoFile ?? "", stripFile: "", backgroundFile: "" }, client, fallback);
  design.prompt = prompt;
  design.generatedBy = { model: ai?.model ?? "default", at: now() };

  // Pictures (free engine). Kept pictures stay; a layout without a picture falls back to minimal.
  const wantLayout = ai ? (LAYOUTS.includes(ai.json.layout) ? ai.json.layout : "stripe") : "minimal";
  const layout = kept.has("layout") && LAYOUTS.includes(old.layout) ? old.layout : wantLayout;
  const stamp = String(program?.id ?? "x").replace(/[^\w-]/g, "").slice(0, 24) || "x";
  const tag = Date.now().toString(36);
  const idea = imageText(ai?.json?.imagePrompt, client) + NO_TEXT;
  if (kept.has("stripFile") && old.stripFile) design.stripFile = safeFile(old.stripFile);
  if (kept.has("backgroundFile") && old.backgroundFile) design.backgroundFile = safeFile(old.backgroundFile);
  if (layout === "stripe" && !design.stripFile && ai) {
    design.stripFile = await drawImage({ deps, prompt: idea, size: STRIP_SIZE, file: `loy-${stamp}-strip-${tag}.png`, bg: design.background, alpha: 0.18, fade: true });
  } else if (layout === "full" && !design.backgroundFile && ai) {
    design.backgroundFile = await drawImage({ deps, prompt: idea, size: BACKGROUND_SIZE, file: `loy-${stamp}-bg-${tag}.png`, bg: design.background, alpha: 0.55, fade: false });
  }
  design.layout = layout === "stripe" && design.stripFile ? "stripe" : layout === "full" && design.backgroundFile ? "full" : "minimal";
  // Replaced pictures are removed (only ours: loy-<id>-...).
  for (const f of ["stripFile", "backgroundFile"]) {
    const prev = old[f];
    if (prev && prev !== design[f] && prev.startsWith("loy-")) await unlink(join(MEDIA_DIR, prev)).catch(() => {});
  }
  return normalizeDesign(design, client, fallback);
}
