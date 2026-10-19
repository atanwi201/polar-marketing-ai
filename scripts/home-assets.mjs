// Builds the landing page's example images and Reel (brand/home/): free public-domain (CC0) photos from
// Openverse, turned into posts by the app's own renderer, so the page shows exactly what the product makes.
// Run: node scripts/home-assets.mjs   (needs ffmpeg; no AI key)
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { searchStock, downloadPhoto } from "../server/stock.mjs";
import { analysePhoto, cropTo } from "../server/siteimages.mjs";
import { composeOfferImage, composeOfferVideo } from "../server/overlay.mjs";

const run = promisify(execFile);
// Openverse can be slow; give it more time than the site builder does.
const slowFetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(90e3) });
const OUT = join(import.meta.dirname, "..", "brand", "home");
const TMP = join(OUT, ".work");
const BAD = /^(art|painting|watercolou?r|vintage|drawing|illustration|engraving|poster|book|text|person|people|man|woman|human|face|adult|child|girl|boy|portrait|crowd)$/i;
const PEOPLE = /\b(man|men|woman|women|girl|boy|people|person|portrait|child|kid|lady|guy|couple|selfie|model|painting|drawing|illustration|vintage)\b/i;

const ITEMS = [
  { id: "boat", q: ["sailboat sunset", "sailing boat sea", "boat sunset"], post: { badge: "Este viernes", headline: "Paseo en barco al atardecer", subline: "2 horas · bebidas incluidas", brand: "Excursiones del Sur · Los Cristianos" } },
  { id: "cafe", q: ["latte art", "cappuccino", "coffee cup"], post: { badge: "Nuevo", headline: "Café de especialidad", subline: "Desayuno completo 4,50 €", brand: "Café La Plaza · La Laguna" } },
  { id: "fish", q: ["grilled fish", "fish dish", "seafood plate"], post: { badge: "Hoy", headline: "Pescado del día", subline: "A la plancha 16 €", brand: "Tasca El Puerto · Puerto de la Cruz" } },
  { id: "surf", q: ["surfboard beach", "surfboards", "surfing wave"], post: { badge: "Plazas libres", headline: "Clases de surf", subline: "Desde 25 € · todos los niveles", brand: "Escuela de surf · El Médano" } },
  { id: "fruit", q: ["papaya fruit", "cut papaya", "tropical fruit"], must: /papaya|fruit/i, post: { badge: "Hoy", headline: "Papaya fresca", subline: "2 €/kg", brand: "Frutería del Mercado · Santa Cruz" } },
  { id: "site", q: ["sailboat sunset", "sailing boat sea"], wide: true }, // the same trip as the post: one example business throughout
  { id: "dolphin", q: ["dolphins swimming", "bottlenose dolphin", "dolphin ocean", "dolphins"], must: /dolphin/i, wide: true, reel: { badge: "Plazas hoy", headline: "Avistamiento de delfines", subline: "Salidas diarias · 2 h", brand: "Excursiones del Sur" } },
];

async function photo(item) {
  for (const q of item.q) {
    let found = [];
    try { found = await searchStock(q, { wide: !!item.wide, fetchImpl: slowFetch }); } catch (e) { console.warn(q, e.message); continue; }
    for (const p of found.filter((x) => !PEOPLE.test(x.title) && !(x.tags ?? []).some((t) => BAD.test(t)) && (!item.must || item.must.test(`${x.title} ${(x.tags ?? []).join(" ")}`)) && !/street|sign|park\b|road|avenue|rally|protest|politic|parade|crowd|con [A-Z]/.test(x.title)).slice(0, 6)) {
      try {
        const buf = await downloadPhoto(p.url, { fetchImpl: slowFetch });
        const file = join(TMP, `${item.id}.jpg`);
        await writeFile(file, buf);
        const a = await analysePhoto(file);
        if (a.w < 900) continue;
        console.log(item.id, "←", q, "|", p.title, "|", p.source, `${a.w}x${a.h}`);
        return { file, a, credit: `${p.title} (${p.source}, CC0) ${p.url}` };
      } catch (e) { console.warn("skip", e.message); }
    }
  }
  throw new Error(`No photo for ${item.id}`);
}

await mkdir(TMP, { recursive: true });
const credits = [];
// ONLY=fruit,site rebuilds just those (the others are kept).
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
for (const item of ITEMS) {
  if (only && !only.has(item.id)) continue;
  const { file, a, credit } = await photo(item);
  credits.push(`- ${item.id}: ${credit}`);
  if (item.post) {
    const crop = join(TMP, `${item.id}-45.jpg`);
    await cropTo(file, crop, "tall", a.focus);
    await composeOfferImage({ src: crop, out: join(TMP, `${item.id}-post.jpg`), ...item.post });
    // 720x900 keeps the page light; the original renderer draws at 1080x1350.
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", join(TMP, `${item.id}-post.jpg`), "-vf", "scale=720:-2", "-q:v", "4", join(OUT, `post-${item.id}.jpg`)]);
  }
  if (item.id === "site") {
    const r = await cropTo(file, join(TMP, "site-wide.jpg"), "wide", a.focus);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", join(TMP, "site-wide.jpg"), "-vf", "scale=1200:-2", "-q:v", "4", join(OUT, "site-hero.jpg")]);
    console.log("site", r.w, r.h);
  }
  if (item.reel) {
    // A slow push-in on the photo becomes the clip; the app's Reel renderer writes the offer on top.
    const src = join(TMP, "dolphin-src.mp4"), reel = join(TMP, "dolphin-reel.mp4"), cover = join(TMP, "dolphin-cover.jpg");
    await run("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", file, "-vf",
      "scale=1080*2:1920*2:force_original_aspect_ratio=increase,crop=1080*2:1920*2,zoompan=z='min(zoom+0.0009,1.18)':d=240:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,format=yuv420p",
      "-t", "8", "-c:v", "libx264", "-crf", "20", src]);
    await composeOfferVideo({ src, out: reel, cover, ...item.reel });
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", reel, "-vf", "scale=540:-2", "-an", "-c:v", "libx264", "-crf", "27", "-preset", "slow", "-movflags", "+faststart", join(OUT, "reel-dolphin.mp4")]);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", "2.5", "-i", reel, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", join(OUT, "reel-dolphin.jpg")]);
  }
}
if (!only) await writeFile(join(OUT, "CREDITS.md"), `# Landing page photos\n\nPublic-domain (CC0) photos found through Openverse; no attribution is required. Example posts are drawn by the app's own renderer (server/overlay.mjs). Business names in the examples are fictional.\n\n${credits.join("\n")}\n`);
await rm(TMP, { recursive: true, force: true });
if (only) console.log(credits.join("\n"));
console.log("done");
