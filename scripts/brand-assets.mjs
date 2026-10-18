// Draws the Crier logo (mark + hand-drawn wordmark, light and dark) and derives the favicon set from it.
// Usage: node scripts/brand-assets.mjs   -> writes brand/logo/* and brand/site.webmanifest
// The wordmark is drawn as strokes (no font needed). It spells "Crier"; if the product is renamed,
// redraw it here. In-app headers show the mark plus the live name from brand/brand.json.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const OUT = join(import.meta.dirname, "..", "brand", "logo");
const NAME = JSON.parse((await import("node:fs")).readFileSync(join(OUT, "..", "brand.json"), "utf8")).name;
mkdirSync(OUT, { recursive: true });

const C = { basalt: "#0e1316", basaltDk: "#1c2a2e", teal: "#007c89", tealDk: "#3dd6d0", sun: "#ffb400", sunDk: "#ffc53d", ink: "#0e1316", inkDk: "#edf3f3" };
const f = (n) => +n.toFixed(2);
// Arc open to the right around (cx,cy): a "C" that is also a signal radiating from the sun.
const arc = (cx, cy, r, half) => { // half = half-opening in degrees, measured from the right-hand axis
  const a = (half * Math.PI) / 180;
  const x = f(cx + r * Math.cos(a)), y1 = f(cy - r * Math.sin(a)), y2 = f(cy + r * Math.sin(a));
  return `M${x} ${y1}A${r} ${r} 0 1 0 ${x} ${y2}`;
};

/** The mark on a 64 grid: basalt tile, two teal arcs, one sun dot. */
const mark = (dark, { tile = true } = {}) => {
  const bg = dark ? C.basaltDk : C.basalt, line = C.tealDk, dot = dark ? C.sunDk : C.sun;
  return `${tile ? `<rect width="64" height="64" rx="15" fill="${bg}"/>` : ""}<g fill="none" stroke="${line}" stroke-width="5.6" stroke-linecap="round"><path d="${arc(38, 32, 11, 52)}"/><path d="${arc(38, 32, 21, 44)}"/></g><circle cx="38" cy="32" r="5.2" fill="${dot}"/>`;
};

/** Wordmark "Crier" on the same 64 grid, x from 80. Strokes match the mark. */
const word = (dark) => {
  const ink = dark ? C.inkDk : C.ink, dot = dark ? C.sunDk : C.sun;
  const a = (50 * Math.PI) / 180, cx = 98, cy = 32, r = 16;
  const cx0 = f(cx + r * Math.cos(a)), cy1 = f(cy - r * Math.sin(a)), cy2 = f(cy + r * Math.sin(a));
  const R = (x) => `M${x} 48V26M${x} 36Q${x} 26 ${x + 10} 26`;
  const ex = 171, ey = 37, er = 11, ea = (38 * Math.PI) / 180;
  return `<g fill="none" stroke="${ink}" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round">
<path d="M${cx0} ${cy1}A${r} ${r} 0 1 0 ${cx0} ${cy2}"/><path d="${R(123)}"/><path d="M149 48V26"/>
<path d="M${ex - er} ${ey}H${ex + er}A${er} ${er} 0 1 0 ${f(ex + er * Math.cos(ea))} ${f(ey + er * Math.sin(ea))}"/><path d="${R(194)}"/></g>
<circle cx="149" cy="16.5" r="3.9" fill="${dot}"/>`;
};

const svg = (w, body, extra = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 64" width="${w * 2}" height="128"${extra}>${body}</svg>\n`;
const files = {
  "crier-mark.svg": svg(64, mark(false), ` role="img" aria-label="${NAME}"`),
  "crier-mark-dark.svg": svg(64, mark(true), ` role="img" aria-label="${NAME}"`),
  "crier-logo-light.svg": svg(214, mark(false) + word(false), ` role="img" aria-label="${NAME}"`),
  "crier-logo-dark.svg": svg(214, mark(true) + word(true), ` role="img" aria-label="${NAME}"`),
};
// Favicon: bolder, tighter mark that holds up at 16px, and it follows the browser theme.
const fav = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>.t{fill:${C.basalt}}.l{stroke:${C.tealDk}}.d{fill:${C.sun}}@media(prefers-color-scheme:dark){.t{fill:${C.basaltDk}}}</style><rect class="t" width="64" height="64" rx="15"/><g class="l" fill="none" stroke-width="7" stroke-linecap="round"><path d="${arc(39, 32, 10, 56)}"/><path d="${arc(39, 32, 21, 46)}"/></g><circle class="d" cx="39" cy="32" r="6"/></svg>\n`;
files["favicon.svg"] = fav;
const favFlat = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect fill="${C.basalt}" width="64" height="64" rx="15"/><g stroke="${C.tealDk}" fill="none" stroke-width="7" stroke-linecap="round"><path d="${arc(39, 32, 10, 56)}"/><path d="${arc(39, 32, 21, 46)}"/></g><circle fill="${C.sun}" cx="39" cy="32" r="6"/></svg>`;
// Maskable/app icon: full-bleed tile (the OS rounds it), mark kept inside the safe zone.
const full = (s) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${s}" height="${s}"><rect width="64" height="64" fill="${C.basalt}"/><g transform="translate(32 32) scale(.82) translate(-32 -32)">${mark(false, { tile: false })}</g></svg>`;
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630"><rect width="1200" height="630" fill="${C.basalt}"/><g transform="translate(160 177) scale(3.4)">${mark(true, { tile: false })}${word(true)}</g></svg>`;

for (const [n, s] of Object.entries(files)) writeFileSync(join(OUT, n), s);

const png = async (s, px, name, flat) => {
  const img = await loadImage(Buffer.from(s));
  const c = createCanvas(px, flat ? px : px), g = c.getContext("2d");
  g.drawImage(img, 0, 0, px, flat ? px : px);
  const b = c.toBuffer("image/png"); if (name) writeFileSync(join(OUT, name), b); return b;
};
const rounded = favFlat; // rounded tile for small PNG/ICO sizes
await png(full(512), 180, "apple-touch-icon.png"); // iOS rounds it itself, so no transparent corners
await png(full(512), 192, "icon-192.png");
await png(full(512), 512, "icon-512.png");
await png(og, 1200, null);
{ const img = await loadImage(Buffer.from(og)); const c = createCanvas(1200, 630); c.getContext("2d").drawImage(img, 0, 0, 1200, 630); writeFileSync(join(OUT, "og-image.png"), c.toBuffer("image/png")); }
// favicon.ico: PNG-compressed 16, 32, 48.
const sizes = [16, 32, 48], pngs = [];
for (const s of sizes) pngs.push(await png(rounded, s, null));
const dir = Buffer.alloc(6 + 16 * sizes.length); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(sizes.length, 4);
let off = dir.length;
sizes.forEach((s, i) => { const o = 6 + 16 * i; dir[o] = s; dir[o + 1] = s; dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(pngs[i].length, o + 8); dir.writeUInt32LE(off, o + 12); off += pngs[i].length; });
writeFileSync(join(OUT, "favicon.ico"), Buffer.concat([dir, ...pngs]));
writeFileSync(join(OUT, "..", "site.webmanifest"), JSON.stringify({
  name: NAME, short_name: NAME, start_url: "/", display: "standalone", background_color: C.basalt, theme_color: C.basalt,
  icons: [
    { src: "/brand/logo/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "/brand/logo/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    { src: "/brand/logo/favicon.svg", sizes: "any", type: "image/svg+xml" },
  ],
}, null, 2) + "\n");
console.log("wrote", OUT);
