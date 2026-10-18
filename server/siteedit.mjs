// The website chat: the owner asks for a change ("make the logo bigger", "put the coconut photo in
// the hero", "change the title to…") and a free model edits the live page with small find/replace
// blocks instead of redesigning it. Every language gets the same change, the result goes through the
// same safety and image checks as a new design, and each change can be undone.
import { readFile, writeFile, mkdir, readdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { complete, aiKey } from "./openrouter.mjs";
import { sanitize, pageProblem } from "./webpage.mjs";
import { writePages, sourceDir } from "./aisite.mjs";
import { fixPageImages } from "./siteimages.mjs";
import { CONTEXT } from "./studio.mjs";

const KEY = aiKey;
const LANG_NAMES = { es: "Spanish", en: "English", de: "German", it: "Italian", nl: "Dutch", sv: "Swedish", fr: "French" };
const KEEP_VERSIONS = 15;

// ---------- Edit blocks ----------

/** Parse "<<<<<<< FIND … ======= … >>>>>>> END" blocks (plus an optional SUMMARY line). */
export function parseEdits(text) {
  const summary = /^\s*SUMMARY:\s*(.+)$/im.exec(text)?.[1]?.trim() ?? "";
  const blocks = [];
  const re = /<{5,}\s*FIND\s*\n([\s\S]*?)\n={5,}\s*\n([\s\S]*?)\n?>{5,}\s*(?:END|REPLACE)?/g;
  let m;
  while ((m = re.exec(text))) blocks.push({ find: m[1], replace: m[2] });
  return { summary, blocks };
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Apply blocks to a page. Exact match first, then ignoring differences in whitespace. */
export function applyEdits(html, blocks) {
  let out = html;
  const failed = [];
  for (const b of blocks) {
    if (!b.find.trim()) { failed.push(b); continue; }
    if (out.includes(b.find)) { out = out.replace(b.find, () => b.replace); continue; }
    const loose = new RegExp(b.find.trim().split(/\s+/).map(escRe).join("\\s+"));
    if (loose.test(out)) { out = out.replace(loose, () => b.replace.trim()); continue; }
    failed.push(b);
  }
  return { html: out, applied: blocks.length - failed.length, failed };
}

const FORMAT = `Reply with:
SUMMARY: one short sentence saying what you changed, in the owner's language

then one block per change, in exactly this format:
<<<<<<< FIND
(an exact, unique snippet copied from the page: a few whole lines)
=======
(the new version of that snippet)
>>>>>>> END

Rules: copy FIND text exactly as it is in the page (same spaces and quotes); keep each FIND short but unique; change only what was asked; to add CSS, find the line "</style>" and put the new rules before it. Never add scripts, forms, iframes (except the existing map), external images or links to other sites' files. Images may only use the paths already on the page or in this list: {images}. Keep every <img> tag's width, height and style as they are, except when moving a picture to another place.`;

function editPrompt(page, { request, lang, images, history }) {
  return `You are the senior web designer who built this one-page website for a local business in Tenerife. The owner of the web studio asks for a change. Make it with the smallest precise edits, keeping the design premium and consistent (same palette, fonts, spacing and style), the page responsive, and the text in ${LANG_NAMES[lang] ?? lang}.
${history.length ? `\nEarlier changes they asked for (already done): ${history.map((h) => `"${h}"`).join("; ")}\n` : ""}
The change they want now: "${request}"

${FORMAT.replace("{images}", images.join(", ") || "none")}

The page:
${page}`;
}

function followPrompt(page, { request, lang, summary, images }) {
  return `This is the ${LANG_NAMES[lang] ?? lang} version of a one-page website. The same change was just made to the main language version: "${request}" (${summary || "done"}). Make the equivalent change on this page, with all visible text in ${LANG_NAMES[lang] ?? lang}.

${FORMAT.replace("{images}", images.join(", ") || "none")}

The page:
${page}`;
}

async function askForEdits(prompt, page) {
  const out = await complete({
    key: KEY(), prompt, system: CONTEXT, tier: "complex", maxTokens: 6000, timeoutMs: 4 * 60e3, attempts: 3,
    validate: (t) => {
      const { blocks } = parseEdits(t);
      if (!blocks.length) return "no edit blocks";
      return applyEdits(page, blocks).applied ? null : "none of the edits match the page";
    },
  });
  return { ...parseEdits(out.text), model: out.model };
}

// ---------- Versions ----------

const versionsDir = (client) => join(sourceDir(client), "versions");
async function snapshot(client, langs) {
  const d = join(versionsDir(client), String(Date.now()));
  await mkdir(d, { recursive: true });
  for (const l of langs) await cp(join(sourceDir(client), `${l}.html`), join(d, `${l}.html`));
  const all = (await readdir(versionsDir(client))).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_VERSIONS))) await rm(join(versionsDir(client), old), { recursive: true, force: true });
}
export async function versionCount(client) {
  try { return (await readdir(versionsDir(client))).length; } catch { return 0; }
}

// ---------- Running a change ----------

async function loadSite(client, { sitesDir, siteBase }) {
  const src = sourceDir(client);
  if (!existsSync(join(src, "assets.json"))) throw Object.assign(new Error("This website was made before the chat existed. Click “Update website” once, then you can change it here."), { status: 409 });
  const assets = JSON.parse(await readFile(join(src, "assets.json"), "utf8"));
  const langs = assets.langs;
  const pages = {};
  for (const l of langs) pages[l] = await readFile(join(src, `${l}.html`), "utf8");
  return { src, assets, langs, pages, dir: join(sitesDir, client.siteSlug), base: siteBase(client) };
}

async function publish(client, site, pages) {
  await writePages(client, { dir: site.dir, langs: site.langs, pages, base: site.base, assets: site.assets });
  for (const l of site.langs) await writeFile(join(site.src, `${l}.html`), pages[l]);
}

/**
 * Make one change. Returns { summary, langs: [...changed], skipped: [...] }. Throws with a message
 * the owner can read when nothing could be changed.
 */
export async function editSite(client, request, { sitesDir, siteBase, onStep = () => {} }) {
  if (!KEY()) throw Object.assign(new Error("The website chat needs the OpenRouter key."), { status: 503 });
  const site = await loadSite(client, { sitesDir, siteBase });
  const images = (site.assets.list ?? []).map((a) => a.path);
  const clean = (html) => fixPageImages(sanitize(html, { images, fallbackImage: site.assets.hero ?? "" }), site.assets.plan?.slots ?? []);
  const history = (client.siteChat ?? []).filter((m) => m.role === "owner" && m.status === "done").map((m) => m.text).slice(-6);
  const [main, ...others] = site.langs;

  onStep(`editing:${main}`);
  const first = await askForEdits(editPrompt(site.pages[main], { request, lang: main, images, history }), site.pages[main]);
  const done = applyEdits(site.pages[main], first.blocks);
  const next = { ...site.pages, [main]: clean(done.html) };
  const problem = pageProblem(next[main]);
  if (problem) throw new Error(`That change broke the page (${problem}), so nothing was changed. Try asking in a different way.`);

  // Other languages: CSS and structure edits usually apply as they are; text needs its own edit.
  const skipped = [];
  for (const l of others) {
    onStep(`editing:${l}`);
    const same = applyEdits(site.pages[l], first.blocks);
    if (!same.failed.length) { next[l] = clean(same.html); continue; }
    try {
      const own = await askForEdits(followPrompt(same.html, { request, lang: l, summary: first.summary, images }), same.html);
      const r = applyEdits(same.html, own.blocks);
      const page = clean(r.html);
      if (!pageProblem(page)) next[l] = page; else skipped.push(l);
    } catch (e) {
      console.warn(`Site chat: ${l} not changed:`, e.message);
      if (same.applied) next[l] = clean(same.html); else skipped.push(l);
    }
  }
  await snapshot(client, site.langs);
  await publish(client, site, next);
  return { summary: first.summary || "Done.", applied: done.applied, failed: done.failed.length, skipped, model: first.model };
}

/** Put back the page from before the last change. */
export async function undoSite(client, { sitesDir, siteBase }) {
  const site = await loadSite(client, { sitesDir, siteBase });
  const all = (await readdir(versionsDir(client)).catch(() => [])).sort();
  const last = all.pop();
  if (!last) throw Object.assign(new Error("There's nothing to undo."), { status: 400 });
  const pages = {};
  for (const l of site.langs) pages[l] = existsSync(join(versionsDir(client), last, `${l}.html`)) ? await readFile(join(versionsDir(client), last, `${l}.html`), "utf8") : site.pages[l];
  await publish(client, site, pages);
  await rm(join(versionsDir(client), last), { recursive: true, force: true });
  return { versions: all.length };
}
