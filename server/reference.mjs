// "A website I like": fetch an example site the owner or the client points to and boil it down to a design
// brief for the model (structure, type, colours, mood). Only public http(s) pages, never this machine's own
// network: private and local addresses are refused, redirects are re-checked, size and time are capped.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_PAGE = 1.5e6;
const MAX_CSS = 300e3;
const TIMEOUT = 12e3;

/** True for addresses that must never be fetched: loopback, private, link-local, CGNAT, multicast, unique-local. */
export function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0);
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("ff");
}

async function assertPublic(u, lookupImpl) {
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https links are allowed");
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("That link uses an unusual port");
  if (u.username || u.password) throw new Error("Links with a login are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("That link points to a private address");
  const addrs = isIP(host) ? [{ address: host }] : await lookupImpl(host, { all: true }).catch(() => { throw new Error("That website could not be found"); });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("That link points to a private address");
}

/** GET a public page as text (capped), following up to 3 redirects with the same checks each time. */
export async function safeGet(url, { fetchImpl = fetch, lookupImpl = lookup, max = MAX_PAGE, accept = "text/html" } = {}) {
  let u = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(u, lookupImpl);
    const r = await fetchImpl(u.href, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT), headers: { "User-Agent": "Mozilla/5.0 (compatible; IslaDesignBot/1.0)", Accept: accept } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u = new URL(r.headers.get("location"), u); continue; }
    if (!r.ok) throw new Error(`That website answered ${r.status}`);
    const type = r.headers.get("content-type") ?? "";
    if (accept === "text/html" && type && !/html|xml/i.test(type)) throw new Error("That link is not a web page");
    const buf = Buffer.from(await r.arrayBuffer());
    return { text: buf.subarray(0, max).toString("utf8"), url: u.href };
  }
  throw new Error("Too many redirects");
}

const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function colours(css) {
  const count = new Map();
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (Math.max(r, g, b) - Math.min(r, g, b) < 24) continue; // greys, white and black say nothing about the brand
    count.set("#" + h, (count.get("#" + h) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h]) => h);
}

/** Pure: turn a page's HTML (+ any CSS text) into a short design summary. */
export function summarise(html, css = "") {
  const all = html + "\n" + css;
  const title = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const desc = /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i.exec(html)?.[1] ?? "";
  const heads = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => `h${m[1]}: ${strip(m[2])}`).filter((x) => x.length > 4 && x.length < 120).slice(0, 24);
  const nav = [...(/<nav[\s\S]*?<\/nav>/i.exec(html)?.[0] ?? "").matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => strip(m[1])).filter((x) => x && x.length < 30).slice(0, 10);
  const sections = [...html.matchAll(/<(header|section|footer|main|aside)\b([^>]*)>/gi)].map((m) => {
    const id = /\bid=["']([^"']+)/i.exec(m[2])?.[1], cl = /\bclass=["']([^"']+)/i.exec(m[2])?.[1]?.split(/\s+/).slice(0, 2).join(".");
    return [m[1].toLowerCase(), id && "#" + id, cl && "." + cl].filter(Boolean).join("");
  }).slice(0, 20);
  const fonts = [...new Set([
    ...[...all.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^&"')]+)/gi)].flatMap((m) => decodeURIComponent(m[1]).split("|").map((f) => f.split(":")[0].replace(/\+/g, " "))),
    ...[...all.matchAll(/font-family\s*:\s*["']?([\w -]{3,30})["']?\s*[,;}]/gi)].map((m) => m[1].trim()).filter((f) => !/^(inherit|sans-serif|serif|system-ui|monospace|arial|helvetica|georgia|times|verdana)/i.test(f)),
  ])].slice(0, 5);
  const vars = [...css.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi)].slice(0, 8).map((m) => `--${m[1]}: ${m[2]}`);
  const tech = [/bootstrap/i.test(all) && "Bootstrap", /tailwind/i.test(all) && "Tailwind", /swiper|slick|carousel/i.test(all) && "carousel/slider", /parallax/i.test(all) && "parallax", /video/i.test(html) && "video"].filter(Boolean);
  const skeleton = html.replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(\w+)\b([^>]*)>/g, (m, tag, attrs) => { const c = /\bclass=["']([^"']{1,60})/i.exec(attrs)?.[1]; return `<${tag}${c ? ` class="${c}"` : ""}>`; })
    .replace(/>\s*([^<]{80,})/g, (m, t) => `>${t.slice(0, 40)}…`).replace(/\s+/g, " ").slice(0, 5000);
  return { title, desc, heads, nav, sections, fonts, colours: colours(css + "\n" + (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join("\n")), vars, tech, skeleton };
}

/** The text block that goes into the design prompt for one reference site. */
export function referenceText(url, s) {
  return [
    `Reference website: ${url}`,
    s.title && `Title: ${s.title}`, s.desc && `Description: ${s.desc.slice(0, 200)}`,
    s.nav.length && `Navigation: ${s.nav.join(" | ")}`,
    s.heads.length && `Headings in order:\n${s.heads.join("\n")}`,
    s.sections.length && `Page structure (top to bottom): ${s.sections.join(", ")}`,
    s.fonts.length && `Fonts: ${s.fonts.join(", ")}`,
    s.colours.length && `Main colours: ${s.colours.join(", ")}${s.vars.length ? ` (${s.vars.join("; ")})` : ""}`,
    s.tech.length && `Features: ${s.tech.join(", ")}`,
    `HTML skeleton (classes only, text shortened):\n${s.skeleton}`,
  ].filter(Boolean).join("\n");
}

/** Fetch and summarise one example site. Throws a readable message when it can't be read. */
export async function readReference(url, opts = {}) {
  const page = await safeGet(url, opts);
  let css = "";
  const links = [...page.text.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)].map((m) => /href=["']([^"']+)/i.exec(m[0])?.[1]).filter(Boolean)
    .filter((h) => !/fonts\.googleapis|cdnjs|jsdelivr|bootstrap(\.min)?\.css|font-?awesome/i.test(h)).slice(0, 2);
  for (const h of links) {
    try { css += "\n" + (await safeGet(new URL(h, page.url).href, { ...opts, max: MAX_CSS, accept: "text/css,*/*" })).text; } catch { /* a missing stylesheet only costs detail */ }
  }
  return referenceText(page.url, summarise(page.text, css));
}

/**
 * Example sites for a client: the owner's list (client.exampleUrls) plus the business's own
 * (client.profile.examples), up to 3. Results are cached on the client for a day. Never throws.
 */
export async function referenceBlock(client, opts = {}) {
  const urls = [...new Set([...(client.exampleUrls ?? []), ...(client.profile?.examples ?? [])].filter((u) => typeof u === "string" && u))].slice(0, 3);
  if (!urls.length) return "";
  const cache = (client.exampleCache ??= {});
  const parts = [];
  for (const u of urls) {
    const hit = cache[u];
    if (hit && Date.now() - hit.at < 864e5) { parts.push(hit.text); continue; }
    try {
      const text = await readReference(u, opts);
      cache[u] = { at: Date.now(), text };
      parts.push(text);
    } catch (e) {
      console.warn(`Example site ${u} skipped: ${e.message}`);
      cache[u] = { at: Date.now(), text: "", error: e.message };
    }
  }
  const text = parts.filter(Boolean);
  return text.length
    ? `## Example websites the business likes\nStudy how these are laid out: section order, spacing, type, colour mood, image treatment and overall polish. Recreate that kind of design for THIS business, with its own content, colours/logo and photos. Do NOT copy their text, names, logos, photos or code.\n\n${text.join("\n\n---\n\n")}\n`
    : "";
}
