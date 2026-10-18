// Builds each client an AI-designed, SEO-ready static website in sites/<client-name>/, one page per language.
// One pipeline (server/aisite.mjs): their logo, photos (or free stock/AI pictures), colours and everything
// they told us go into one big prompt; a free model writes the whole page (HTML + CSS) and translates it;
// server/webpage.mjs makes it safe and adds the SEO head. Plain HTML + CSS, no JavaScript.
// There is no template fallback: if the AI is unavailable the build waits (status "waiting") and retries.
import { mkdir, writeFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { db, save, now } from "./store.mjs";
import { aiKey } from "./openrouter.mjs";
import { buildAiSite, prepareAssets } from "./aisite.mjs";
import { pickDirection } from "./directions.mjs";

export const SITES_DIR = process.env.SITES_DIR ?? join(import.meta.dirname, "..", "sites");
const KEY = aiKey;
const BACKOFF_MIN = [2, 5, 10, 30, 60];

export function slugify(name) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client";
}

/** A folder name from the client's name, unique across clients. */
export function siteSlug(client) {
  if (client.siteSlug) return client.siteSlug;
  const base = slugify(client.name);
  let s = base, n = 2;
  while (db.clients.some((c) => c.id !== client.id && c.siteSlug === s)) s = `${base}-${n++}`;
  return s;
}

function sitemap(langs, base, at) {
  const url = (l) => `${base}/${l === langs[0] ? "" : `${l}/`}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${langs.map((l) => `  <url>
    <loc>${url(l)}</loc>
    <lastmod>${at.slice(0, 10)}</lastmod>
${langs.map((x) => `    <xhtml:link rel="alternate" hreflang="${x}" href="${url(x)}"/>`).join("\n")}
    <xhtml:link rel="alternate" hreflang="x-default" href="${url(langs[0])}"/>
  </url>`).join("\n")}
</urlset>
`;
}

// ---------- Build ----------
const aiError = (msg) => Object.assign(new Error(msg), { ai: true });
const building = new Set();

/** Where the site will live (their domain, or this server). */
export function siteBase(client) {
  const d = (client.domain ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return d && /\./.test(d) ? `https://${d}` : `${process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`}/sites/${client.siteSlug}`;
}

/**
 * Build (or rebuild) a client's site in the background; progress is on client.site.
 * A rebuild keeps the look of the current design unless `newDesign` is set.
 * If the AI is unavailable the status becomes "waiting" and the build is retried with backoff.
 */
export async function buildSite(client, { newDesign = false } = {}) {
  if (building.has(client.id)) return;
  building.add(client.id);
  client.siteSlug = siteSlug(client);
  const dir = join(SITES_DIR, client.siteSlug);
  const work = join(SITES_DIR, `.${client.siteSlug}.building`);
  const langs = client.languages?.length ? client.languages : ["es", "en"];
  const base = siteBase(client);
  const prev = client.site ?? {};
  const design = newDesign ? "" : prev.design ?? "";
  const step = (s) => { client.site = { ...client.site, step: s }; void save(); };
  client.site = { ...prev, status: "building", step: "images", startedAt: now(), path: `sites/${client.siteSlug}/`, error: undefined, nextTryAt: undefined };
  void save();
  try {
    if (!KEY()) throw aiError("No OpenRouter key yet");
    // Build next to the live site, then swap, so the old site stays up while the new one is made.
    await rm(work, { recursive: true, force: true });
    await mkdir(join(work, "images"), { recursive: true });
    const assets = await prepareAssets(client, work);
    // A site designed before art directions existed keeps its look (no direction) until a new design.
    const direction = design && !prev.direction ? undefined
      : pickDirection({ style: client.profile?.style, images: assets.list.filter((a) => a.kind !== "logo").length, current: prev.direction, newDesign: newDesign || !design });
    let result;
    try {
      result = await buildAiSite(client, { dir: work, langs, base, assets, design, step, direction });
    } catch (e) {
      throw e.fatal || e.ai ? e : aiError(e.message);
    }
    const at = now();
    await writeFile(join(work, "sitemap.xml"), sitemap(result.langs, base, at));
    await writeFile(join(work, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
    await writeFile(join(work, "site.json"), JSON.stringify({ client: client.name, builtAt: at, base, languages: result.langs, kind: result.kind, design: result.design, models: result.models }, null, 1));
    await rm(dir, { recursive: true, force: true });
    await rename(work, dir);
    client.site = {
      status: "ready", builtAt: at, path: `sites/${client.siteSlug}/`, url: `/sites/${client.siteSlug}/`, kind: result.kind,
      design: result.design ?? design, models: result.models, languages: result.langs, attempts: 0,
      ...(result.kind === "ai" && direction ? { direction: direction.id, directionName: direction.name } : {}),
    };
  } catch (e) {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    const attempts = (prev.attempts ?? 0) + 1;
    const delay = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60e3;
    const wait = Boolean(e.ai || e.fatal);
    // AI trouble: wait and retry forever (capped at hourly), keeping any live site up. Anything else: failed, retried by hand.
    client.site = {
      ...(prev.status === "ready" || prev.builtAt ? { url: prev.url, builtAt: prev.builtAt, design: prev.design, kind: prev.kind, languages: prev.languages } : {}),
      status: wait ? "waiting" : "failed", error: e.message, path: `sites/${client.siteSlug}/`, attempts,
      nextTryAt: wait ? new Date(Date.now() + delay).toISOString() : undefined,
    };
    console.warn("Site build:", e.message);
  } finally {
    building.delete(client.id);
    void save();
  }
}

/** Retry every site whose wait is over. Called from the scheduler. */
export function retrySites(at = Date.now()) {
  const due = db.clients.filter((c) => c.site?.status === "waiting" && c.site.nextTryAt && Date.parse(c.site.nextTryAt) <= at);
  for (const c of due) void buildSite(c);
  // A crash mid-build leaves "building" behind: resume it.
  for (const c of db.clients) if (c.site?.status === "building" && !building.has(c.id) && Date.parse(c.site.startedAt ?? 0) < at - 15 * 60e3) void buildSite(c);
  return due;
}

export function startSiteRetries() {
  for (const c of db.clients) if (c.site?.status === "building") void buildSite(c);
  return setInterval(() => retrySites(), 60e3).unref();
}
