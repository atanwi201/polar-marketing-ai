// Derives the Polar Marketing icon set from the supplied logo (brand/logo/polar-logo-source.png).
// The logo is used as supplied: only resized, never redrawn. Icons sit on a white tile.
// Usage: node scripts/brand-assets.mjs   -> writes brand/logo/* and brand/site.webmanifest
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const BRAND = join(import.meta.dirname, "..", "brand"), OUT = join(BRAND, "logo");
const NAME = JSON.parse(readFileSync(join(BRAND, "brand.json"), "utf8")).name;
const src = await loadImage(readFileSync(join(OUT, "polar-logo-source.png")));

/** Logo scaled to fill a size x size white tile. */
const tile = (px) => {
  const c = createCanvas(px, px), g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.fillStyle = "#fff"; g.fillRect(0, 0, px, px);
  g.drawImage(src, 0, 0, px, px);
  return c.toBuffer("image/png");
};
writeFileSync(join(OUT, "polar-logo.png"), tile(1024));
writeFileSync(join(OUT, "polar-mark.png"), tile(256)); // compact header/app-bar size
writeFileSync(join(OUT, "apple-touch-icon.png"), tile(180));
writeFileSync(join(OUT, "icon-192.png"), tile(192));
writeFileSync(join(OUT, "icon-512.png"), tile(512));
// SVG favicon: the supplied PNG embedded unchanged (resized), so browsers that prefer SVG show the real logo.
writeFileSync(join(OUT, "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><image href="data:image/png;base64,${tile(128).toString("base64")}" width="64" height="64"/></svg>\n`);
// Social preview: logo centred on white, 1200x630.
{ const c = createCanvas(1200, 630), g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 1200, 630); g.imageSmoothingQuality = "high"; g.drawImage(src, 285, 0, 630, 630);
  writeFileSync(join(OUT, "og-image.png"), c.toBuffer("image/png")); }
// favicon.ico: PNG-compressed 16, 32, 48.
const sizes = [16, 32, 48], pngs = sizes.map(tile);
const dir = Buffer.alloc(6 + 16 * sizes.length); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(sizes.length, 4);
let off = dir.length;
sizes.forEach((s, i) => { const o = 6 + 16 * i; dir[o] = s; dir[o + 1] = s; dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(pngs[i].length, o + 8); dir.writeUInt32LE(off, o + 12); off += pngs[i].length; });
writeFileSync(join(OUT, "favicon.ico"), Buffer.concat([dir, ...pngs]));
writeFileSync(join(BRAND, "site.webmanifest"), JSON.stringify({
  name: NAME, short_name: NAME, start_url: "/", display: "standalone", background_color: "#ffffff", theme_color: "#d7ff64",
  icons: [
    { src: "/brand/logo/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/brand/logo/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/brand/logo/favicon.svg", sizes: "any", type: "image/svg+xml" },
  ],
}, null, 2) + "\n");
console.log("wrote", OUT);
