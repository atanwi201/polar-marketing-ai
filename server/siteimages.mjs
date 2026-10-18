// The art director for client websites: free models place images badly (stretched, cropped through
// the subject, the same photo three times, a logo as a giant yellow square). So the server decides:
// it cleans the logo, finds each photo's subject, crops every picture to the exact frame its section
// needs, and assigns each image to one place on the page. The model only lays the tags out.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const canvasLib = () => import("@napi-rs/canvas");

// ---------- Logo ----------

/**
 * Make the logo web-ready: if it sits on a plain background (a JPG on a white or yellow square),
 * remove that background so only the mark remains, then trim the margins. Returns its size and
 * whether it now has a transparent background.
 */
export async function cleanLogo(src, out, { max = 640 } = {}) {
  const { createCanvas, loadImage } = await canvasLib();
  const img = await loadImage(src);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width * k)), H = Math.max(1, Math.round(img.height * k));
  const cv = createCanvas(W, H), ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H);
  const px = data.data;
  const at = (x, y) => (y * W + x) * 4;

  // Background = the colour of all four corners, when they agree.
  const corner = (cx, cy) => {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = cy; y < cy + 6 && y < H; y++) for (let x = cx; x < cx + 6 && x < W; x++) { const i = at(x, y); r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3]; n++; }
    return [r / n, g / n, b / n, a / n];
  };
  const cs = [corner(0, 0), corner(Math.max(0, W - 6), 0), corner(0, Math.max(0, H - 6)), corner(Math.max(0, W - 6), Math.max(0, H - 6))];
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const alreadyClear = cs.every((c) => c[3] < 40);
  const plain = !alreadyClear && cs.every((c) => c[3] > 200 && dist(c, cs[0]) < 30);
  let bg = null;
  if (plain) {
    bg = [0, 1, 2].map((j) => cs.reduce((s, c) => s + c[j], 0) / 4);
    // Flood-fill from the edges so only the outer background goes (a white "O" inside the logo stays).
    const HARD = 34, SOFT = 64;
    const seen = new Uint8Array(W * H), stack = [];
    for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
    while (stack.length) {
      const p = stack.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      const i = p * 4, d = dist([px[i], px[i + 1], px[i + 2]], bg);
      if (d >= SOFT) continue;
      px[i + 3] = d < HARD ? 0 : Math.round(px[i + 3] * (d - HARD) / (SOFT - HARD)); // soft edge
      if (d >= HARD) continue; // edge pixels stop the fill
      const x = p % W, y = (p / W) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < W - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - W);
      if (y < H - 1) stack.push(p + W);
    }
    ctx.putImageData(data, 0, 0);
  }
  // Trim to the visible mark, with a little breathing room.
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[at(x, y) + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; } // nothing visible: keep it all
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const outCv = createCanvas(w, h);
  outCv.getContext("2d").drawImage(cv, x0, y0, w, h, 0, 0, w, h);
  await writeFile(out, outCv.toBuffer("image/png"));
  const hex = bg ? "#" + bg.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") : "";
  return { w, h, transparent: plain || alreadyClear, removedBackground: hex };
}

// ---------- Photos ----------

/**
 * Where the subject is (0..1 from the top-left) and how bright the picture is. The subject is the
 * centre of the detail (edges), pulled a little towards the middle, which is how a designer crops.
 */
export async function analysePhoto(src) {
  const { createCanvas, loadImage } = await canvasLib();
  const img = await loadImage(src);
  const N = 48;
  const cv = createCanvas(N, N), ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0, N, N);
  const px = ctx.getImageData(0, 0, N, N).data;
  const lum = new Float32Array(N * N);
  let sum = 0;
  for (let i = 0; i < N * N; i++) { lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]; sum += lum[i]; }
  let ex = 0, ey = 0, e = 0;
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const gx = lum[y * N + x + 1] - lum[y * N + x - 1], gy = lum[(y + 1) * N + x] - lum[(y - 1) * N + x];
    const m = Math.hypot(gx, gy);
    const w = m * m;
    ex += w * x; ey += w * y; e += w;
  }
  const fx = e ? ex / e / (N - 1) : 0.5, fy = e ? ey / e / (N - 1) : 0.5;
  return {
    w: img.width, h: img.height,
    focus: { x: 0.5 + (fx - 0.5) * 0.7, y: 0.45 + (fy - 0.45) * 0.7 },
    brightness: sum / (N * N) / 255,
  };
}

/** The frames a page uses: each image is cropped to exactly one of these. */
export const FRAMES = {
  wide: { ratio: 16 / 9, w: 1920, label: "16:9" },
  card: { ratio: 4 / 3, w: 1200, label: "4:3" },
  square: { ratio: 1, w: 1000, label: "1:1" },
  tall: { ratio: 4 / 5, w: 960, label: "4:5" },
};

/** Crop `src` to a frame around its subject and save it. Returns the size and where the subject is in the crop. */
export async function cropTo(src, out, frame, focus = { x: 0.5, y: 0.5 }) {
  const { createCanvas, loadImage } = await canvasLib();
  const img = await loadImage(src);
  const { ratio } = FRAMES[frame];
  let cw = img.width, ch = Math.round(cw / ratio);
  if (ch > img.height) { ch = img.height; cw = Math.round(ch * ratio); }
  const cx = Math.min(Math.max(focus.x * img.width - cw / 2, 0), img.width - cw);
  const cy = Math.min(Math.max(focus.y * img.height - ch / 2, 0), img.height - ch);
  const w = Math.min(FRAMES[frame].w, cw), h = Math.round(w / ratio);
  const cv = createCanvas(w, h);
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, cx, cy, cw, ch, 0, 0, w, h);
  await writeFile(out, cv.toBuffer("image/jpeg", 82));
  const fx = Math.round(((focus.x * img.width - cx) / cw) * 100), fy = Math.round(((focus.y * img.height - cy) / ch) * 100);
  return { w, h, position: `${Math.min(100, Math.max(0, fx))}% ${Math.min(100, Math.max(0, fy))}%` };
}

// ---------- The plan ----------

const norm = (s = "") => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Give every image one job on the page. `pics` are prepared images ({ id, kind: photo|stock|ai,
 * w, h, brightness, service? }). Real photos come first; each image is used once.
 */
export function planImages(pics, services = []) {
  const used = new Set();
  const free = () => pics.filter((p) => !used.has(p));
  const take = (...preds) => { for (const ok of preds) { const p = free().find(ok); if (p) { used.add(p); return p; } } return null; };
  const landscape = (p) => p.w >= p.h * 1.15;
  const goodLight = (p) => p.brightness > 0.18 && p.brightness < 0.85;
  const big = (p) => p.w >= 1100;
  // Hero: the best wide real photo, else a wide stock photo that isn't for a product.
  const hero = take(
    (p) => p.kind === "photo" && landscape(p) && goodLight(p) && big(p),
    (p) => p.kind === "photo" && landscape(p),
    (p) => p.kind === "stock" && !p.service && landscape(p),
    (p) => p.kind === "photo" && big(p),
    (p) => !p.service,
    () => true,
  );
  // One picture per product or service, when we have one made for it.
  const serviceImages = [];
  for (const s of services.slice(0, 6)) {
    const p = take((x) => x.service && norm(x.service) === norm(s.name));
    if (p) serviceImages.push({ service: s.name, pic: p });
  }
  const about = take((p) => p.kind === "photo", (p) => !p.service);
  const gallery = free().filter((p) => !p.service || p.kind === "photo").sort((a, b) => (a.kind === "photo" ? 0 : 1) - (b.kind === "photo" ? 0 : 1)).slice(0, 7);
  gallery.forEach((p) => used.add(p));
  return {
    hero: hero && { pic: hero, frame: "wide" },
    about: about && { pic: about, frame: "tall" },
    services: serviceImages.map((x) => ({ ...x, frame: "card" })),
    // A gallery reads best with one feature picture and the rest in one shape.
    gallery: gallery.map((pic, i) => ({ pic, frame: gallery.length >= 4 && i === 0 ? "tall" : "square" })),
  };
}

/** Crop every planned image to its frame. Returns the slots with their final files. */
export async function renderPlan(plan, dir) {
  const slots = [];
  const one = async (slot, role) => {
    if (!slot) return null;
    const file = `images/${slot.pic.id}-${slot.frame}.jpg`;
    const size = await cropTo(slot.pic.src, join(dir, file), slot.frame, slot.pic.focus);
    const out = { role, file, frame: slot.frame, ...size, kind: slot.pic.kind, desc: slot.pic.desc, service: slot.service };
    slots.push(out);
    return out;
  };
  const hero = await one(plan.hero, "hero");
  const about = await one(plan.about, "about");
  const services = [];
  for (const s of plan.services) services.push(await one(s, "service"));
  const gallery = [];
  for (const g of plan.gallery) gallery.push(await one(g, "gallery"));
  return { hero, about, services: services.filter(Boolean), gallery: gallery.filter(Boolean), slots };
}

/** The exact tag the model must use for a slot. */
export const imgTag = (s, { eager = false } = {}) =>
  `<img src="${s.file}" width="${s.w}" height="${s.h}" alt="" style="object-fit:cover;object-position:${s.position}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'}>`;

// ---------- After the model ----------

/**
 * Repair what the model did with the images: true width/height on every planned picture, and no
 * picture twice (a repeat is swapped for one the page doesn't show yet, in the same frame if possible).
 */
export function fixPageImages(html, slots) {
  const byFile = new Map(slots.map((s) => [s.file, s]));
  const used = new Set();
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    const file = src.replace(/^(\.\.\/)+/, "");
    if (/logo\.png$/.test(file)) return tag;
    let slot = byFile.get(file);
    if (!slot) return tag;
    if (used.has(file)) {
      const spare = slots.find((s) => !used.has(s.file) && s.frame === slot.frame) ?? slots.find((s) => !used.has(s.file) && s.role !== "hero");
      if (!spare) return tag;
      tag = tag.replace(src, src.replace(file, spare.file)).replace(/object-position:[^;"']*/i, `object-position:${spare.position}`);
      slot = spare;
    }
    used.add(slot.file);
    const set = (t, attr, v) => (new RegExp(`\\s${attr}\\s*=`, "i").test(t) ? t.replace(new RegExp(`\\s${attr}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i"), ` ${attr}="${v}"`) : t.replace(/<img\b/i, `<img ${attr}="${v}"`));
    return set(set(tag, "width", slot.w), "height", slot.h);
  });
}

/** CSS that keeps pictures and the logo looking right whatever the model wrote (added after its CSS). */
export const IMAGE_CSS = `<style>
img{max-width:100%}
img[src$="logo.png"]{object-fit:contain;background:none}
header img[src$="logo.png"],nav img[src$="logo.png"]{height:clamp(38px,4.6vw,54px)!important;width:auto!important;max-width:min(230px,46vw)!important;max-height:none!important;padding:0!important;border:0!important;box-shadow:none!important}
footer img[src$="logo.png"]{height:auto!important;width:auto!important;max-height:84px!important;max-width:240px!important}
</style>`;
