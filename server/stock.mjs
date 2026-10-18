// Free stock photos for client websites. Pexels when there's a key (best quality, free at
// pexels.com/api); otherwise Openverse, which needs no key and returns only public-domain (CC0)
// photographs, so nothing needs a credit line.
import { complete, aiKey } from "./openrouter.mjs";

const KEY = aiKey;
const OPENVERSE = () => (process.env.OPENVERSE_URL ?? "https://api.openverse.org").replace(/\/$/, "");
const PEXELS = () => (process.env.PEXELS_URL ?? "https://api.pexels.com").replace(/\/$/, "");
let pexelsSetting = () => "";
export function configureStock(getter) { pexelsSetting = getter; }
export const pexelsKey = () => pexelsSetting() || process.env.PEXELS_API_KEY || "";

/**
 * English search terms for stock photos of this business (the AI translates and picks them):
 * { queries: general ones, hero first; services: { "<product name>": "<query>" } }.
 */
export async function stockQueries(client, { fetchImpl = fetch } = {}) {
  const prof = client.profile ?? {};
  const services = (prof.services ?? []).map((s) => s.name).filter(Boolean).slice(0, 6);
  const fallback = { queries: [client.kind, client.offer].filter(Boolean).map((s) => String(s).slice(0, 60)), services: Object.fromEntries(services.map((n) => [n, n])) };
  if (!KEY()) return fallback;
  try {
    const { json } = await complete({
      key: KEY(), json: true, attempts: 2, timeoutMs: 60e3, fetchImpl,
      prompt: `Give short, generic English search queries (1-2 words each, like you'd type on a stock photo site: "tropical fruit", "fruit market", "paella", "hair salon") for finding beautiful stock photographs for the website of this business. Mostly what they sell and their kind of place (a market stall, a dining room, a salon...), never people. Don't use town names (they're ambiguous); at most one query may be a Tenerife landscape.
Business: ${client.name}, a ${client.kind || "local business"} in ${client.town || "Tenerife"}, Canary Islands.
What they offer: ${[client.offer, prof.description].filter(Boolean).join(". ").slice(0, 500)}
${services.length ? `Their products and services (give one query for each, translated to English, e.g. "Plátano rojo" → "red banana"): ${services.join(" | ")}` : ""}
Reply with JSON only: {"queries": ["6 general queries, the most important first: it becomes the wide hero image"], "services": {${services.map((n) => `"${n.replace(/"/g, "'")}": "..."`).join(", ")}}}`,
    });
    const q = (json?.queries ?? []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 60));
    const sv = Object.fromEntries(services.map((n) => [n, typeof json?.services?.[n] === "string" && json.services[n].trim() ? json.services[n].trim().slice(0, 60) : n]));
    return { queries: q.length ? q.slice(0, 8) : fallback.queries, services: sv };
  } catch { return fallback; }
}

// Real stock libraries look professional; random Flickr uploads are hit and miss.
const STOCK_SOURCES = /^(stocksnap|rawpixel|nappy|wikimedia|spacex|nasa)$/i;
function stockScore(p, query) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const title = p.title.toLowerCase();
  const hits = words.filter((w) => title.includes(w.replace(/s$/, ""))).length;
  return (STOCK_SOURCES.test(p.source) ? 2 : 0) + (words.length ? (2 * hits) / words.length : 0) + (p.w >= 1600 ? 0.5 : 0) - (title.length > 70 ? 0.5 : 0);
}

/** Up to `n` candidate photos for one query: [{ url, w, h, title, credit, source }]. */
export async function searchStock(query, { wide = false, n = 10, fetchImpl = fetch } = {}) {
  const key = pexelsKey();
  if (key) {
    const u = `${PEXELS()}/v1/search?query=${encodeURIComponent(query)}&per_page=${n}&orientation=landscape`;
    const r = await fetchImpl(u, { headers: { Authorization: key }, signal: AbortSignal.timeout(20e3) });
    if (r.ok) {
      const j = await r.json();
      const out = (j.photos ?? []).map((p) => ({ url: p.src?.large2x || p.src?.large, w: p.width, h: p.height, title: p.alt || query, credit: p.photographer, source: "Pexels" })).filter((p) => p.url);
      if (out.length) return out;
    }
  }
  const u = `${OPENVERSE()}/v1/images/?q=${encodeURIComponent(query)}&license=cc0&category=photograph&mature=false&page_size=${Math.max(n, 20)}${wide ? "&aspect_ratio=wide" : ""}`;
  const r = await fetchImpl(u, { headers: { "User-Agent": "IslaAutopilot/1.0" }, signal: AbortSignal.timeout(20e3) });
  if (!r.ok) throw new Error(`Openverse ${r.status}`);
  const j = await r.json();
  return (j.results ?? [])
    .filter((p) => p.url && !/\.(svg|gif)(\?|$)/i.test(p.url) && (p.width ?? 0) >= 900 && (p.width ?? 0) >= (p.height ?? 0) * (wide ? 1.3 : 0.9))
    .map((p) => ({ url: p.url, w: p.width, h: p.height, title: p.title || query, credit: p.creator || "", source: p.source || "Openverse", tags: (p.tags ?? []).map((t) => t?.name).filter(Boolean) }))
    .map((p, i) => ({ p, score: stockScore(p, query) - i / 100 }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}

// Website pictures are of products and places: skip photos whose title says there's someone in them.
// Same for paintings and drawings that slip into the "photograph" category.
const PEOPLE = /\b(man|men|woman|women|girl|boy|people|person|portrait|child|kid|lady|guy|couple|selfie|model|vendor|seller|farmer|painting|drawing|illustration|watercolou?r|sketch|engraving|lithograph|vintage|poster|vector|clipart|icon)s?\b/i;

// Openverse tags tell us when a "photograph" is really a painting, a scan or has people in it.
const BAD_TAGS = /^(art|painting|watercolou?r|vintage|drawing|illustration|engraving|poster|book|text|person|people|man|woman|human|face|adult|child|girl|boy)$/i;
const notForUs = (p) => !PEOPLE.test(p.title) && !(p.tags ?? []).some((t) => BAD_TAGS.test(t));

/** Download a photo; returns the bytes (or throws when it isn't a usable image). */
export async function downloadPhoto(url, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 IslaAutopilot/1.0" }, signal: AbortSignal.timeout(30e3), redirect: "follow" });
  if (!r.ok) throw new Error(`download ${r.status}`);
  if (!/^image\/(jpeg|png|webp)/i.test(r.headers.get("content-type") ?? "")) throw new Error("not a photo");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 200) throw new Error("too small");
  if (await isGrey(buf)) throw new Error("black and white");
  return buf;
}

/** Black-and-white (or nearly) photos look out of place on a colourful business site. */
async function isGrey(buf) {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const cv = createCanvas(24, 24), ctx = cv.getContext("2d");
    ctx.drawImage(await loadImage(buf), 0, 0, 24, 24);
    const px = ctx.getImageData(0, 0, 24, 24).data;
    let sat = 0;
    for (let i = 0; i < px.length; i += 4) sat += Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]);
    return sat / (px.length / 4) < 14;
  } catch { return false; }
}

/**
 * Find `need` different stock photos for the business. save(buf, i, wide) writes one into the site
 * and returns its size; we skip any that fail to download. Returns [{ index, title, source, w, h }].
 */
export async function findStockPhotos(client, need, save, { fetchImpl = fetch } = {}) {
  const { queries, services } = await stockQueries(client, { fetchImpl });
  const used = new Set();
  const out = [];
  // Find one photo for `q`; skip results already used or that fail to download.
  const one = async (q, { wide = false, skip = 0, service } = {}) => {
    let found = [];
    // Stock libraries match short queries best: "exotic fruit display" → "fruit display" → "exotic".
    for (const v of [...new Set([q, q.split(/\s+/).slice(-2).join(" "), q.split(/\s+/)[0]])]) {
      try { found = (await searchStock(v, { wide, fetchImpl })).filter(notForUs); } catch (e) { console.warn("Stock search failed:", e.message); }
      if (found.length > skip) break;
    }
    for (const p of found.slice(skip)) {
      if (used.has(p.url)) continue;
      used.add(p.url);
      try {
        const size = await save(await downloadPhoto(p.url, { fetchImpl }), out.length + 1, wide);
        out.push({ index: out.length + 1, title: p.title, query: q, source: p.source, service, ...size });
        return true;
      } catch (e) { console.warn("Stock photo skipped:", e.message); }
    }
    return false;
  };
  // A picture for each product or service, then general ones (the first wide, for the hero).
  for (const [name, q] of Object.entries(services ?? {})) await one(q, { service: name });
  let general = 0;
  for (let round = 0; general < need && round < 3; round++) {
    for (const q of queries) {
      if (general >= need) break;
      if (await one(q, { wide: general === 0, skip: round * 3 })) general++;
    }
  }
  return out;
}
