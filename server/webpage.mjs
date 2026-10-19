// Turning a web page written by a model into a safe, complete page: pull the HTML out of the reply,
// check it isn't cut off, strip anything that could run code or load outside content, and add the
// SEO head (canonical, hreflang, Open Graph, JSON-LD), a strict CSP and the language switcher.
// The page is HTML + CSS; the only JavaScript allowed is Bootstrap's bundle from jsDelivr (no inline scripts).

/** The HTML document in a model reply (fenced or bare). Null when there isn't one. */
export function extractHtml(text) {
  const fenced = /```(?:html)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced && /<html|<body/i.test(fenced[1]) ? fenced[1] : text;
  const start = body.search(/<!doctype html|<html[\s>]/i);
  if (start === -1) return null;
  const end = body.toLowerCase().lastIndexOf("</html>");
  return end === -1 ? body.slice(start).trim() : body.slice(start, end + 7).trim();
}

/** Why a page isn't usable, or null when it is. */
export function pageProblem(html, { minLength = 3500 } = {}) {
  if (!html) return "no HTML in the reply";
  if (!/<\/html>\s*$/i.test(html)) return "the page was cut off";
  if (!/<body[\s>]/i.test(html)) return "no <body>";
  if (!/<h1[\s>]/i.test(html)) return "no <h1>";
  if (html.length < minLength) return "the page is too short";
  if (html.length > 400e3) return "the page is too long";
  // An unclosed <style> or <textarea> swallows the rest of the page.
  const count = (re) => (html.match(re) ?? []).length;
  if (count(/<style\b/gi) !== count(/<\/style\s*>/gi)) return "a <style> is not closed";
  if (count(/<textarea\b/gi) !== count(/<\/textarea\s*>/gi)) return "a <textarea> is not closed";
  return null;
}

/** Bootstrap 5 and Bootstrap Icons, CSS only, pinned on jsDelivr. */
export const BOOTSTRAP_CSS = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css";
export const BOOTSTRAP_ICONS_CSS = "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css";
export const BOOTSTRAP_JS = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js";
export const ANIMATE_CSS = "https://cdn.jsdelivr.net/npm/animate.css@4.1.1/animate.min.css";
// TODO(SRI): no copy of Bootstrap is available offline here, so no integrity hashes could be computed.
// The CSP below pins script-src to the exact BOOTSTRAP_JS URL and the sanitizer rewrites any accepted
// Bootstrap 5.x script URL to that one. To also pin by hash: self-host the file or compute sha384 and
// add `integrity` + `crossorigin="anonymous"` to the emitted <script>.
const BOOTSTRAP = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(bootstrap@5(\.\d+){0,2}\/dist\/css|bootstrap-icons@1(\.\d+){0,2}\/font|animate\.css@4(\.\d+){0,2})\/[\w.-]+\.css$/i;
const BOOTSTRAP_SCRIPT = /^https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap@5(\.\d+){0,2}\/dist\/js\/bootstrap(\.bundle)?(\.min)?\.js$/i;
const MAPS = /^https:\/\/(www\.google\.com\/maps\/embed|maps\.google\.com\/maps\?|www\.google\.com\/maps\?)/i;
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

// ---------- Tokenizer (follows the HTML tokenizer closely enough that our output re-parses the same way) ----------

const WS = /[\t\n\f\r ]/;
const LETTER = /[a-z]/i;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext", "noscript"]);

function parseTag(src, lt, isEnd) {
  const n = src.length;
  let i = lt + (isEnd ? 2 : 1);
  const ns = i;
  while (i < n && !WS.test(src[i]) && src[i] !== "/" && src[i] !== ">") i++;
  const name = src.slice(ns, i).toLowerCase();
  const attrs = [];
  let selfClose = false;
  for (;;) {
    while (i < n && (WS.test(src[i]) || src[i] === "/")) { selfClose = src[i] === "/"; i++; }
    if (i >= n) return { name, attrs, end: n, closed: false, selfClose };
    if (src[i] === ">") return { name, attrs, end: i + 1, closed: true, selfClose };
    selfClose = false;
    const as = i;
    i++; // a leading "=" belongs to the name
    while (i < n && !WS.test(src[i]) && src[i] !== "/" && src[i] !== ">" && src[i] !== "=") i++;
    const an = src.slice(as, i).toLowerCase();
    let j = i;
    while (j < n && WS.test(src[j])) j++;
    let value = "", bare = true;
    if (src[j] === "=") {
      bare = false; j++;
      while (j < n && WS.test(src[j])) j++;
      const q = src[j];
      if (q === '"' || q === "'") {
        const e = src.indexOf(q, j + 1);
        if (e === -1) return { name, attrs, end: n, closed: false, selfClose };
        value = src.slice(j + 1, e); j = e + 1;
      } else {
        const vs = j;
        while (j < n && !WS.test(src[j]) && src[j] !== ">") j++;
        value = src.slice(vs, j);
      }
      i = j;
    }
    if (!attrs.some((a) => a.name === an)) attrs.push({ name: an, value, bare });
  }
}

/** Split markup into tokens: text, comment, doctype, bogus, start (with attrs, and raw content for raw-text elements), end. */
export function scan(src) {
  const toks = [];
  const n = src.length;
  let i = 0, ts = 0;
  const flush = (end) => { if (end > ts) toks.push({ t: "text", s: ts, e: end }); };
  const push = (tok) => { flush(tok.s); toks.push(tok); i = ts = tok.e; };
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt === -1) break;
    const c1 = src[lt + 1] ?? "";
    if (src.startsWith("<!--", lt)) {
      let end;
      if (src.startsWith("<!-->", lt)) end = lt + 5;
      else if (src.startsWith("<!--->", lt)) end = lt + 6;
      else { const re = /--!?>/g; re.lastIndex = lt + 4; const r = re.exec(src); end = r ? r.index + r[0].length : n; }
      push({ t: "comment", s: lt, e: end });
    } else if (c1 === "!" || c1 === "?") {
      const gt = src.indexOf(">", lt);
      push({ t: /^<!doctype/i.test(src.slice(lt, lt + 10)) ? "doctype" : "bogus", s: lt, e: gt === -1 ? n : gt + 1 });
    } else if (c1 === "/") {
      if (LETTER.test(src[lt + 2] ?? "")) {
        const p = parseTag(src, lt, true);
        push({ t: "end", name: p.name, s: lt, e: p.end });
      } else {
        const gt = src.indexOf(">", lt);
        push({ t: "bogus", s: lt, e: gt === -1 ? n : gt + 1 });
      }
    } else if (LETTER.test(c1)) {
      const p = parseTag(src, lt, false);
      const tok = { t: "start", name: p.name, attrs: p.attrs, selfClose: p.selfClose, s: lt, e: p.end };
      if (!p.closed) { tok.e = n; tok.dropped = true; }
      else if (RAW.has(p.name)) {
        if (p.name === "plaintext") { tok.raw = src.slice(p.end); tok.e = n; }
        else if (p.name === "title") {
          // A model that forgets the end tag ("<title>Name</meta>") would blank the page: the title ends at the next "<".
          const nx = src.indexOf("<", p.end);
          const stop = nx === -1 ? n : nx;
          tok.raw = src.slice(p.end, stop); tok.e = stop;
          const m = /^<\/title(?=[\t\n\f\r />])/i.exec(src.slice(stop, stop + 12));
          if (m) tok.e = parseTag(src, stop, true).end;
        } else {
          const re = new RegExp(`</${p.name}(?=[\\t\\n\\f\\r />])`, "ig");
          re.lastIndex = p.end;
          const r = re.exec(src);
          if (r) { tok.raw = src.slice(p.end, r.index); tok.e = parseTag(src, r.index, true).end; }
          else { tok.raw = src.slice(p.end); tok.e = n; }
        }
      }
      push(tok);
    } else {
      i = lt + 1; // a stray "<" is text
    }
  }
  flush(n);
  return toks;
}

// ---------- Values ----------

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", tab: "\t", newline: "\n", colon: ":", sol: "/", bsol: "\\", lpar: "(", rpar: ")", period: ".", comma: ",", semi: ";", num: "#", excl: "!", quest: "?", equals: "=", percnt: "%", lsqb: "[", rsqb: "]", lbrack: "[", rbrack: "]", lcub: "{", rcub: "}", lbrace: "{", rbrace: "}", plus: "+", dollar: "$", commat: "@", ast: "*", hyphen: "-", dash: "-", lowbar: "_", grave: "`", verbar: "|", vert: "|" };
const cp = (n) => (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\ufffd");
/** Decode character references the way a browser does in an attribute value. */
export function decodeEntities(s) {
  return s.replace(/&(?:#[xX]([0-9a-fA-F]+);?|#(\d+);?|([A-Za-z][A-Za-z0-9]*);|(amp|lt|gt|quot)(?![A-Za-z0-9=]))/g, (m, hex, dec, name, legacy) => {
    if (hex) return cp(parseInt(hex, 16));
    if (dec) return cp(parseInt(dec, 10));
    const k = (name ?? legacy).toLowerCase();
    return k in NAMED ? NAMED[k] : m;
  });
}
const escAttr = (v) => v.replace(/&(?![A-Za-z][A-Za-z0-9]*=)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escText = (v) => v.replace(/</g, "&lt;");
const CTRL = /[\u0000-\u0020\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/** A URL that may go into a link: http(s), mailto, tel, a relative path or a #fragment. Returns the cleaned URL or null. */
export function safeLinkUrl(value) {
  const v = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, "").trim();
  const n = value.replace(CTRL, "");
  const m = /^([a-z][a-z0-9+.\-]*):/i.exec(n);
  if (m) return /^(https?|mailto|tel)$/i.test(m[1]) ? v : null;
  return v;
}
function fontsUrl(u) {
  try { const x = new URL(u.replace(CTRL, "")); return x.protocol === "https:" && FONT_HOSTS.has(x.hostname) && !x.username && !x.password && !x.port; } catch { return false; }
}

const cssUnescape = (s) => s.replace(/\\([0-9a-f]{1,6})[\t\n\f\r ]?/gi, (m, h) => cp(parseInt(h, 16))).replace(/\\([^\n])/g, "$1");
/** CSS with no imports except Google Fonts, no script hooks and only our own images (or data images) in url(). */
export function cleanCss(css, allowed = new Set()) {
  const pass = (c) => { const keep = []; return passInner(c, keep).replace(/\u0001(\d+)\u0001/g, (m, i) => keep[i]); };
  const passInner = (c, keep) => c
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import\b[^;{}]*(?:;|$)/gi, (m) => { const u = /^@import\s*(?:url\()?\s*["']?([^"')\s;]+)/i.exec(m)?.[1] ?? ""; return fontsUrl(u) ? m : ""; })
    .replace(/expression\s*\(|behavior\s*:|-moz-binding|javascript:|vbscript:/gi, "")
    .replace(/(?<![\w-])(?:-webkit-)?(?:image-set|cross-fade|image|src|element|paint)\s*\(/gi, "invalid(")
    .replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (m, _q, u) => {
      const t = u.trim();
      return allowed.has(t.replace(/^\.\.?\//, "")) || /^data:image\//i.test(t) || t.startsWith("#") || fontsUrl(t) ? `\u0001${keep.push(m) - 1}\u0001` : "none";
    })
    .replace(/url\s*\(/gi, "invalid(");
  let out = pass(css);
  const un = cssUnescape(out);
  if (un !== out && pass(un) !== un) out = pass(un); // escapes used to hide a url()/expression(): drop them
  return out.replace(/</g, "\\3c ");
}

// ---------- Allow-lists ----------

const HTML_TAGS = new Set("html head body title meta link style script iframe a abbr address article aside b bdi bdo big blockquote br button caption center cite code col colgroup data dd del details dfn div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd label li main mark nav ol p picture pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr".split(" "));
const SVG_TAGS = new Set("svg g path circle ellipse rect line polyline polygon defs lineargradient radialgradient stop clippath mask pattern symbol use text tspan marker filter fegaussianblur feoffset feblend fecolormatrix femerge femergenode feflood fecomposite desc".split(" "));
const DROP_ATTR = new Set(["srcset", "srcdoc", "formaction", "action", "ping", "form", "background", "poster", "data", "manifest", "codebase", "longdesc", "cite", "dynsrc", "lowsrc", "is", "http-equiv", "content-security-policy"]);
const NAME_OK = /^[a-z_:][a-z0-9_:.\-]*$/;

function serTag(name, attrs, selfClose = false) {
  const a = attrs.map(([k, v]) => (v === null ? ` ${k}` : ` ${k}="${escAttr(v)}"`)).join("");
  return `<${name}${a}${selfClose ? " /" : ""}>`;
}

/** Cleaned attribute list [[name, value|null]] for an allowed tag, or null to drop the tag. */
function cleanAttrs(name, attrs, ctx) {
  const out = [];
  for (const a of attrs) {
    const k = a.name;
    if (!NAME_OK.test(k) || k.startsWith("on") || DROP_ATTR.has(k) || k.startsWith("xmlns")) continue;
    const v = decodeEntities(a.value);
    if (k === "style") { out.push([k, cleanCss(v, ctx.allowed)]); continue; }
    if (k === "href" || k === "xlink:href") {
      if (name === "a" || name === "area") { const u = safeLinkUrl(v); if (u !== null) out.push([k, u]); }
      else if (name === "use" && v.trim().startsWith("#")) out.push([k, v.trim()]);
      continue;
    }
    if (k === "src") continue; // img handled by the caller
    out.push([k, a.bare ? null : v]);
  }
  if (name === "a" && out.some(([k, v]) => k === "target" && /^_blank$/i.test(v ?? "")) && !out.some(([k]) => k === "rel")) out.push(["rel", "noopener noreferrer"]);
  return out;
}

/**
 * Remove everything that can run code or pull in outside content. The HTML is tokenized and rebuilt
 * from an allow-list of elements and attributes (so odd separators, entities, comments or nesting tricks
 * can't smuggle anything through). Images must be one of `images` (paths like "images/hero.jpg");
 * any other picture becomes `fallbackImage` (or is dropped).
 */
export function sanitize(html, { images = [], fallbackImage = "" } = {}) {
  const ctx = { allowed: new Set(images) };
  const toks = scan(html);
  const out = [];
  let started = false;
  for (const tok of toks) {
    if (tok.t === "text") { out.push(escText(html.slice(tok.s, tok.e))); if (html.slice(tok.s, tok.e).trim()) started = true; continue; }
    if (tok.t === "comment") {
      // Only the model's "design" note survives (read by readMeta), reduced to plain text.
      const m = /^<!--\s*design\s*:([\s\S]*?)(?:--!?>)?$/i.exec(html.slice(tok.s, tok.e));
      if (m) out.push(`<!-- design: ${m[1].replace(/[<>&]/g, " ").replace(/-{2,}/g, "-").replace(/-$/, "").trim()} -->`);
      continue;
    }
    if (tok.t === "doctype") { if (!started) out.push("<!doctype html>"); started = true; continue; }
    if (tok.t === "bogus") continue;
    started = true;
    if (tok.t === "end") {
      if ((HTML_TAGS.has(tok.name) || SVG_TAGS.has(tok.name)) && !VOID.has(tok.name) && tok.name !== "script" && tok.name !== "style" && tok.name !== "title" && tok.name !== "iframe") out.push(`</${tok.name}>`);
      continue;
    }
    if (tok.dropped) continue;
    const name = tok.name;
    const attr = (k) => tok.attrs.find((a) => a.name === k);
    const val = (k) => { const a = attr(k); return a ? decodeEntities(a.value) : ""; };
    if (name === "script") {
      const src = safeLinkUrl(val("src")) ?? "";
      if (BOOTSTRAP_SCRIPT.test(src)) out.push(`<script src="${BOOTSTRAP_JS}" defer></script>`);
      continue;
    }
    if (name === "style") { out.push(`<style>${cleanCss(tok.raw ?? "", ctx.allowed)}</style>`); continue; }
    if (name === "title") { out.push(`<title>${escText((tok.raw ?? "").replace(/\s+/g, " ").trim())}</title>`); continue; }
    if (name === "iframe") {
      const src = val("src").replace(/[\u0000-\u001f]/g, "").trim();
      if (!MAPS.test(src)) continue;
      const style = attr("style") ? cleanCss(val("style"), ctx.allowed) : "border:0;width:100%;height:100%;min-height:320px";
      const a = [["src", src], ["title", val("title") || "Map"]];
      if (attr("class")) a.push(["class", val("class")]);
      a.push(["style", style], ["loading", "lazy"], ["referrerpolicy", "no-referrer-when-downgrade"], ["allowfullscreen", null]);
      out.push(`${serTag("iframe", a)}</iframe>`);
      continue;
    }
    if (RAW.has(name)) continue; // textarea, xmp, plaintext, noembed, noframes, noscript: dropped with their content
    if (name === "link") {
      const href = val("href").replace(/[\u0000-\u001f]/g, "").trim();
      const rels = val("rel").toLowerCase().split(/\s+/).filter(Boolean);
      const okRel = rels.length && rels.every((r) => ["stylesheet", "preconnect", "preload", "dns-prefetch"].includes(r));
      const asv = val("as").toLowerCase();
      const ok = okRel && ((fontsUrl(href) && (!rels.includes("preload") || ["style", "font"].includes(asv))) || (BOOTSTRAP.test(href) && rels.length === 1 && rels[0] === "stylesheet"));
      if (!ok) continue;
      const a = [["rel", rels.join(" ")], ["href", href]];
      if (rels.includes("preload")) a.push(["as", asv]);
      if (attr("crossorigin")) a.push(["crossorigin", /use-credentials/i.test(val("crossorigin")) ? "use-credentials" : "anonymous"]);
      out.push(serTag("link", a));
      continue;
    }
    if (name === "meta") {
      if (tok.attrs.some((a) => ["http-equiv", "charset", "http_equiv"].includes(a.name))) continue;
      const a = tok.attrs.filter((x) => ["name", "property", "content"].includes(x.name)).map((x) => [x.name, decodeEntities(x.value)]);
      if (a.length) out.push(serTag("meta", a));
      continue;
    }
    if (name === "img") {
      const a = cleanAttrs("img", tok.attrs, ctx);
      const sa = attr("src");
      if (sa) {
        const src = decodeEntities(sa.value).replace(/[\u0000-\u001f]/g, "").trim();
        const clean = src.replace(/^\.\.?\//, "");
        if (ctx.allowed.has(clean)) a.push(["src", clean]);
        else if (/^data:image\/(png|jpe?g|gif|webp|avif)[;,]/i.test(src.replace(CTRL, ""))) a.push(["src", src]);
        else if (fallbackImage) a.push(["src", fallbackImage]);
        else continue;
      }
      out.push(serTag("img", a));
      continue;
    }
    const svg = SVG_TAGS.has(name);
    if (!HTML_TAGS.has(name) && !svg) continue;
    out.push(serTag(name, cleanAttrs(name, tok.attrs, ctx), svg && tok.selfClose));
  }
  return out.join("");
}

const escA = (s = "") => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The page's own <title> and meta description (to keep the model's wording). */
export function readMeta(html) {
  const title = /<title[^>]*>([^<]*)/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const description = /<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i.exec(html)?.[0]?.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() ?? "";
  const design = /<!--\s*design\s*:([\s\S]*?)-->/i.exec(html)?.[1]?.trim() ?? "";
  return { title, description, design };
}

export const CSP = `default-src 'none'; img-src 'self' data:; script-src ${BOOTSTRAP_JS}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net data:; frame-src https://www.google.com https://maps.google.com; base-uri 'none'; form-action 'none'`;

/**
 * Finish a sanitized page: lang, our SEO head, image paths for sub-folders, language switcher.
 * `rel` is "" for the main language (site root) and "../" for /<lang>/ pages.
 * The document is rebuilt from tokens: comments are dropped, the real <head> start tag is replaced by ours,
 * and our head (CSP meta first) is always the first thing inside it.
 */
export function assemble(html, { lang, langs, urls, title, description, ogImage, ld = [], rel = "", names = {} }) {
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${escA(CSP)}">`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${escA(title)}</title>`,
    `<meta name="description" content="${escA(description)}">`,
    `<link rel="canonical" href="${escA(urls[lang])}">`,
    ...langs.map((l) => `<link rel="alternate" hreflang="${escA(l)}" href="${escA(urls[l])}">`),
    `<link rel="alternate" hreflang="x-default" href="${escA(urls[langs[0]])}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escA(title)}">`,
    `<meta property="og:description" content="${escA(description)}">`,
    `<meta property="og:url" content="${escA(urls[lang])}">`,
    `<meta property="og:locale" content="${escA(lang)}">`,
    ...(ogImage ? [`<meta property="og:image" content="${escA(ogImage)}">`, `<meta name="twitter:card" content="summary_large_image">`] : []),
    ...(names.logo ? [`<link rel="icon" href="${escA(rel + names.logo)}">`] : []),
    // Models often put the hero picture at z-index:-1, which hides it behind the section's background.
    `<style>section,main>*{isolation:isolate}</style>`,
    ...(langs.length > 1 ? [`<style>[data-lang-switch]{display:inline-flex;gap:4px;align-items:center}[data-lang-switch] a{display:inline-block;padding:4px 8px;border-radius:999px;font-size:.8rem;font-weight:700;letter-spacing:.04em;text-decoration:none;color:inherit;opacity:.7}[data-lang-switch] a[aria-current]{opacity:1;background:rgba(127,127,127,.18)}</style>`] : []),
    ...ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")}</script>`),
  ].join("\n");

  const links = langs.map((l) => `<a href="${escA(rel)}${l === langs[0] ? "" : `${l}/`}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="page"' : ""}>${l.toUpperCase()}</a>`).join(" ");
  const relocate = (v) => (rel ? v.replace(/^images\//, `${rel}images/`).replace(/url\(\s*(["']?)images\//gi, `url($1${rel}images/`) : v);
  const toks = scan(html);
  const htmlTok = toks.find((t) => t.t === "start" && t.name === "html");
  const htmlAttrs = (htmlTok?.attrs ?? []).filter((a) => a.name !== "lang" && NAME_OK.test(a.name) && !a.name.startsWith("on") && !a.name.startsWith("xmlns")).map((a) => [a.name, a.bare ? null : decodeEntities(a.value)]);
  const body = [];
  let switchDepth = 0, switchName = "", switched = false, navAdded = false;
  const nav = `<nav aria-label="Language" style="position:fixed;top:12px;right:12px;z-index:99;display:flex;gap:4px;background:rgba(255,255,255,.92);padding:6px 8px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.15);font:600 13px system-ui,sans-serif">${links.replace(/<a /g, '<a style="color:#111;text-decoration:none;padding:2px 6px" ')}</nav>\n`;
  for (const tok of toks) {
    if (switchDepth) {
      if (tok.t === "start" && tok.name === switchName && !tok.selfClose) switchDepth++;
      else if (tok.t === "end" && tok.name === switchName && --switchDepth === 0) body.push(`</${switchName}>`);
      continue;
    }
    if (tok.t === "text") { body.push(escText(html.slice(tok.s, tok.e))); continue; }
    if (tok.t !== "start" && tok.t !== "end") continue; // comments, doctypes, bogus comments
    const name = tok.name;
    if (tok.t === "end") {
      if (name === "html" || name === "title") continue;
      if (name === "body" && langs.length > 1 && !switched && !navAdded) { body.push(nav); navAdded = true; }
      if (!VOID.has(name)) body.push(`</${name}>`);
      continue;
    }
    if (tok.dropped || name === "html" || name === "head" || name === "base") continue;
    const attr = (k) => tok.attrs.find((a) => a.name === k);
    const val = (k) => decodeEntities(attr(k)?.value ?? "");
    if (name === "title") continue;
    if (name === "meta") {
      if (attr("http-equiv") || attr("charset") || /^(viewport|description|robots|twitter:.*)$/i.test(val("name")) || /^og:/i.test(val("property"))) continue;
    }
    if (name === "link" && /(^|\s)(canonical|alternate|icon|shortcut|apple-touch-icon)(\s|$)/i.test(val("rel"))) continue;
    if (name === "script") {
      const src = safeLinkUrl(val("src")) ?? "";
      if (BOOTSTRAP_SCRIPT.test(src)) body.push(`<script src="${BOOTSTRAP_JS}" defer></script>`);
      continue;
    }
    if (name === "style") { body.push(`<style>${relocate((tok.raw ?? "").replace(/</g, "\\3c "))}</style>`); continue; }
    if (RAW.has(name) && name !== "iframe") continue;
    const attrs = [];
    for (const a of tok.attrs) {
      if (!NAME_OK.test(a.name) || a.name.startsWith("on") || DROP_ATTR.has(a.name) || a.name.startsWith("xmlns")) continue;
      let v = decodeEntities(a.value);
      if (a.name === "href" || a.name === "xlink:href") { if (name === "a" || name === "area" || name === "link") { const u = safeLinkUrl(v); if (u === null) continue; v = u; } else if (!(name === "use" && v.trim().startsWith("#"))) continue; }
      if (a.name === "src") { if (name !== "img" && name !== "iframe") continue; const u = safeLinkUrl(v); if (u === null || (name === "iframe" && !MAPS.test(u))) continue; v = u; }
      if (a.name === "href" || a.name === "src" || a.name === "style") v = relocate(v);
      attrs.push([a.name, a.bare ? null : v]);
    }
    if (!SVG_TAGS.has(name) && !HTML_TAGS.has(name)) continue;
    if (langs.length > 1 && !switched && attr("data-lang-switch") && !VOID.has(name)) {
      switched = true; switchName = name; switchDepth = 1;
      body.push(serTag(name, attrs), links);
      continue;
    }
    body.push(serTag(name, attrs, SVG_TAGS.has(name) && tok.selfClose));
    if (name === "iframe") body.push("</iframe>");
  }
  let rest = body.join("");
  if (langs.length > 1 && !switched && !navAdded) rest += nav;
  const attrStr = serTag("html", [["lang", lang], ...htmlAttrs]);
  return `<!doctype html>\n${attrStr}\n<head>\n${head}\n${rest}\n</html>`;
}

/**
 * Cheap, deterministic problems that make a page look unprofessional. Fed to the AI quality check
 * so it doesn't have to spot them by eye. Returns a list of short messages (empty when clean).
 */
export function lintPage(html) {
  const out = [];
  if (!/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html)) out.push("no viewport meta tag, so phones show a zoomed-out desktop page");
  const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (h1 !== 1) out.push(`${h1} <h1> headings (should be exactly one)`);
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  if (imgs.some((t) => !/\salt\s*=/i.test(t))) out.push("some images have no alt text");
  if (!/@media/i.test(html) && !/bootstrap(\.min)?\.css/i.test(html)) out.push("no responsive rules (@media or Bootstrap grid)");
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<svg[\s\S]*?<\/svg>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (text.length < 1500) out.push("very little text on the page");
  if (/lorem ipsum|\[(your|name|insert)[^\]]*\]|TODO|placeholder/i.test(text)) out.push("placeholder text left in the page");
  if (!/<footer\b/i.test(html)) out.push("no footer");
  if (imgs.length < 2) out.push("fewer than two pictures");
  if (/data-bs-/.test(html) && !/bootstrap(\.bundle)?(\.min)?\.js/i.test(html)) out.push("uses data-bs-* components without loading the Bootstrap script");
  if (/\bbi bi-/.test(html) && !/bootstrap-icons/i.test(html)) out.push("uses Bootstrap Icons classes without loading the icon stylesheet");
  return out;
}
