// "A website I like": fetch an example site the owner or the client points to and boil it down to a design
// brief for the model (structure, type, colours, mood). Only public http(s) pages, never this machine's own
// network: private and local addresses are refused, the connection is pinned to the address that was checked
// (no DNS rebinding), redirects are re-checked on every hop, size and time are capped.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";

const MAX_PAGE = 1.5e6;
const MAX_CSS = 300e3;
const TIMEOUT = 12e3;

function v4Private(a, b, c) {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0 && c <= 2) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

/** The eight 16-bit groups of an IPv6 address (handles "::" and an embedded dotted IPv4), or null. */
function parseV6(ip) {
  let s = ip.toLowerCase().split("%")[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const [a, b, c, d] = dotted[1].split(".").map(Number);
    s = s.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const g = [...left, ...Array(fill).fill("0"), ...right];
  if (g.length !== 8 || g.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return g.map((x) => parseInt(x, 16));
}

/** True for addresses that must never be fetched: loopback, private, link-local, CGNAT, multicast, unique-local, and IPv6 forms that embed those. Anything unparsable counts as private. */
export function isPrivateAddress(ip) {
  const s = String(ip ?? "").trim().replace(/^\[|\]$/g, "");
  if (isIP(s) === 4) { const [a, b, c] = s.split(".").map(Number); return v4Private(a, b, c); }
  if (isIP(s.split("%")[0]) !== 6) return true;
  const g = parseV6(s);
  if (!g) return true;
  const v4 = (hi, lo) => v4Private(hi >> 8, hi & 255, lo >> 8);
  if (g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1)) return true; // :: and ::1
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return v4(g[6], g[7]); // ::ffff:a.b.c.d (both spellings) and ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] !== 0 || g.slice(3, 6).some((x) => x !== 0) ? true : v4(g[6], g[7]); // NAT64 64:ff9b::/96 (and the local-use /48)
  if (g[0] === 0x2002) return v4(g[1], g[2]); // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard prefix
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // fe80::/10, fec0::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** Resolve a hostname and refuse anything private. Returns the first public address { address, family }. */
async function assertPublic(u, lookupImpl, { resolve = true } = {}) {
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https links are allowed");
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("That link uses an unusual port");
  if (u.username || u.password) throw new Error("Links with a login are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("That link points to a private address");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("That link points to a private address");
    return { address: host, family: isIP(host) };
  }
  if (!resolve) return null;
  const addrs = await lookupImpl(host, { all: true }).catch(() => { throw new Error("That website could not be found"); });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("That link points to a private address");
  return { address: addrs[0].address, family: addrs[0].family ?? isIP(addrs[0].address) };
}

/** fetch() that connects to one pre-validated address (no second DNS lookup), caps the body and never follows redirects. */
export function pinnedFetch(href, { pinned, headers = {}, signal, maxBytes = MAX_PAGE } = {}) {
  const u = new URL(href);
  const lib = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method: "GET", headers, signal,
      lookup: pinned ? (_h, opts, cb) => (opts?.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family)) : undefined,
    }, (res) => {
      const chunks = [];
      let size = 0;
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (v != null) h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      const status = res.statusCode;
      if (status >= 300 && status < 400) { res.resume(); return resolve(new Response(null, { status, headers: h })); }
      res.on("data", (c) => { size += c.length; chunks.push(c); if (size > maxBytes) { res.destroy(); finish(); } });
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks).subarray(0, maxBytes), { status, headers: h })); };
      res.on("end", finish); res.on("close", finish);
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * GET a public URL: every hop (up to `maxRedirects`) is validated and connected to the validated address.
 * Returns { res, url }; the caller reads the body (already capped by maxBytes with the default transport).
 */
export async function guardedFetch(url, { fetchImpl, lookupImpl, maxRedirects = 3, maxBytes = MAX_PAGE, headers = {}, timeout = TIMEOUT } = {}) {
  // A test can inject fetchImpl (then no real DNS is done unless lookupImpl is injected too).
  const injected = !!fetchImpl;
  const doFetch = fetchImpl ?? pinnedFetch;
  const look = lookupImpl ?? lookup;
  let u = new URL(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const pinned = await assertPublic(u, look, { resolve: !injected || !!lookupImpl });
    const res = await doFetch(u.href, { redirect: "manual", signal: AbortSignal.timeout(timeout), headers, pinned, maxBytes });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { u = new URL(res.headers.get("location"), u); continue; }
    return { res, url: u.href };
  }
  throw new Error("Too many redirects");
}

/** Read a response body up to `max` bytes. */
export async function readCapped(res, max) {
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.length;
      if (size > max) { await reader.cancel().catch(() => {}); break; }
    }
    return Buffer.concat(chunks).subarray(0, max);
  }
  return Buffer.from(await res.arrayBuffer()).subarray(0, max);
}

/** GET a public page as text (capped), following up to 3 redirects with the same checks each time. */
export async function safeGet(url, { fetchImpl, lookupImpl, max = MAX_PAGE, accept = "text/html" } = {}) {
  const { res: r, url: finalUrl } = await guardedFetch(url, { fetchImpl, lookupImpl, maxBytes: max, headers: { "User-Agent": "Mozilla/5.0 (compatible; IslaDesignBot/1.0)", Accept: accept } });
  if (!r.ok) throw new Error(`That website answered ${r.status}`);
  const type = r.headers.get("content-type") ?? "";
  if (accept === "text/html" && type && !/html|xml/i.test(type)) throw new Error("That link is not a web page");
  const buf = await readCapped(r, max);
  return { text: buf.toString("utf8"), url: finalUrl };
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
