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

const MAPS = /^https:\/\/(www\.google\.com\/maps\/embed|maps\.google\.com\/maps\?|www\.google\.com\/maps\?)/i;
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//i;
/** Bootstrap 5 and Bootstrap Icons, CSS only (the pages have no JavaScript), pinned on jsDelivr. */
export const BOOTSTRAP_CSS = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css";
export const BOOTSTRAP_ICONS_CSS = "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css";
export const BOOTSTRAP_JS = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js";
export const ANIMATE_CSS = "https://cdn.jsdelivr.net/npm/animate.css@4.1.1/animate.min.css";
const BOOTSTRAP = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(bootstrap@5(\.\d+){0,2}\/dist\/css|bootstrap-icons@1(\.\d+){0,2}\/font|animate\.css@4(\.\d+){0,2})\/[\w.-]+\.css$/i;
// The only script allowed: Bootstrap's bundle, loaded by URL. It is driven by data-bs-* attributes
// (navbar toggle, carousel, accordion, modal, dropdown), so pages never need inline JavaScript.
const BOOTSTRAP_SCRIPT = /^https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap@5(\.\d+){0,2}\/dist\/js\/bootstrap(\.bundle)?(\.min)?\.js$/i;

/**
 * Remove everything that can run code or pull in outside content. Images must be one of `images`
 * (paths like "images/hero.jpg"); any other picture becomes `fallbackImage` (or is dropped).
 */
export function sanitize(html, { images = [], fallbackImage = "" } = {}) {
  const allowed = new Set(images);
  let h = html;
  // Elements whose content the browser reads as plain text until their end tag: a model that forgets
  // the end tag (e.g. "<title>Name</meta>") blanks the page. Titles are rewritten later anyway.
  h = h.replace(/<title\b[^>]*>[^<]*(?:<\/title\s*>)?/gi, (m) => `<title>${m.replace(/<\/?title\b[^>]*>/gi, "").trim()}</title>`).replace(/<\/meta\s*>/gi, "");
  h = h.replace(/<(textarea|xmp|plaintext|noembed|noframes)\b[\s\S]*?(<\/\1\s*>|$)/gi, "");
  // Whole elements that never belong in these pages.
  const keepScripts = [];
  h = h.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (m, attrs) => {
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(" " + attrs)?.[1] ?? "";
    return BOOTSTRAP_SCRIPT.test(src) ? `\u0001SCRIPT${keepScripts.push(src) - 1}\u0001` : "";
  }).replace(/<script\b[^>]*>/gi, "").replace(/\u0001SCRIPT(\d+)\u0001/g, (m, i) => `<script src="${keepScripts[i]}" defer></script>`);
  h = h.replace(/<(object|embed|applet|frameset|frame)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<(object|embed|applet|base|frame)\b[^>]*>/gi, "");
  h = h.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "");
  h = h.replace(/<meta\b[^>]*http-equiv[^>]*>/gi, "");
  h = h.replace(/<\/?form\b[^>]*>/gi, "");
  h = h.replace(/<input\b[^>]*>/gi, "");
  // Event handlers and script URLs in any attribute.
  h = h.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  h = h.replace(/\s(href|src|xlink:href|action|formaction|poster|background)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi, "");
  // Iframes: only a Google Maps embed (kept aside while stray iframe tags are removed).
  const maps = [];
  h = h.replace(/<iframe\b([^>]*)>([\s\S]*?)<\/iframe\s*>/gi, (m, attrs) => {
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
    if (!MAPS.test(src)) return "";
    const title = /\stitle\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "Map";
    const style = /\sstyle\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "border:0;width:100%;height:100%;min-height:320px";
    const cls = /\sclass\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
    maps.push(`<iframe src="${src.replace(/"/g, "&quot;")}" title="${title}"${cls ? ` class="${cls}"` : ""} style="${style}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`);
    return `\u0000MAP${maps.length - 1}\u0000`;
  }).replace(/<\/?iframe\b[^>]*>/gi, "").replace(/\u0000MAP(\d+)\u0000/g, (m, i) => maps[i]);
  // Stylesheets: only Google Fonts and Bootstrap. Preconnects to the font hosts are fine.
  h = h.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = /\shref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    const rel = /\srel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    return (FONTS.test(href) && /stylesheet|preconnect|preload/i.test(rel)) || (BOOTSTRAP.test(href) && /stylesheet/i.test(rel)) ? tag : "";
  });
  // CSS: no imports except Google Fonts, no expressions, only our own images in url().
  const cssClean = (css) => css
    .replace(/@import\s+(url\()?\s*["']?([^"')\s;]+)["']?\)?[^;]*;/gi, (m, _u, href) => (FONTS.test(href) ? m : ""))
    .replace(/expression\s*\(|behavior\s*:|-moz-binding|javascript:/gi, "")
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, _q, u) => (allowed.has(u.replace(/^\.\.?\//, "")) || u.startsWith("data:image/") || u.startsWith("#") || FONTS.test(u) ? m : "none"));
  h = h.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (m, a, css, b) => a + cssClean(css) + b);
  h = h.replace(/\sstyle\s*=\s*"([^"]*)"/gi, (m, css) => ` style="${cssClean(css)}"`).replace(/\sstyle\s*=\s*'([^']*)'/gi, (m, css) => ` style='${cssClean(css)}'`);
  // Pictures: our files only. srcset could point anywhere, so it goes.
  h = h.replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*')/gi, "");
  h = h.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    const clean = src.replace(/^\.\.?\//, "");
    if (allowed.has(clean)) return tag.replace(src, clean);
    if (src.startsWith("data:image/") && !src.startsWith("data:image/svg")) return tag;
    return fallbackImage ? tag.replace(/\ssrc\s*=\s*["'][^"']*["']/i, ` src="${fallbackImage}"`) : "";
  });
  // <source> inside <picture>/<video> could load anything.
  h = h.replace(/<source\b[^>]*>/gi, "");
  return h;
}

const escA = (s = "") => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The page's own <title> and meta description (to keep the model's wording). */
export function readMeta(html) {
  const title = /<title[^>]*>([^<]*)/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const description = /<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i.exec(html)?.[0]?.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() ?? "";
  const design = /<!--\s*design\s*:([\s\S]*?)-->/i.exec(html)?.[1]?.trim() ?? "";
  return { title, description, design };
}

export const CSP = "default-src 'none'; img-src 'self' data:; script-src https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net data:; frame-src https://www.google.com https://maps.google.com; base-uri 'none'; form-action 'none'";

/**
 * Finish a sanitized page: lang, our SEO head, image paths for sub-folders, language switcher.
 * `rel` is "" for the main language (site root) and "../" for /<lang>/ pages.
 */
export function assemble(html, { lang, langs, urls, title, description, ogImage, ld = [], rel = "", names = {} }) {
  let h = html;
  h = /<html\b[^>]*\blang=/i.test(h) ? h.replace(/(<html\b[^>]*\blang=)["'][^"']*["']/i, `$1"${lang}"`) : h.replace(/<html\b/i, `<html lang="${lang}"`);
  // Drop head tags we write ourselves.
  h = h.replace(/<meta\b[^>]*(charset|name\s*=\s*["'](viewport|description|robots|twitter:[^"']*)["']|property\s*=\s*["']og:[^"']*["'])[^>]*>\s*/gi, "");
  h = h.replace(/<link\b[^>]*rel\s*=\s*["'](canonical|alternate|icon|shortcut icon|apple-touch-icon)["'][^>]*>\s*/gi, "");
  h = h.replace(/<title\b[^>]*>[^<]*(?:<\/title\s*>)?\s*/gi, "").replace(/<\/title\s*>/gi, "");
  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    `<title>${escA(title)}</title>`,
    `<meta name="description" content="${escA(description)}">`,
    `<link rel="canonical" href="${urls[lang]}">`,
    ...langs.map((l) => `<link rel="alternate" hreflang="${l}" href="${urls[l]}">`),
    `<link rel="alternate" hreflang="x-default" href="${urls[langs[0]]}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escA(title)}">`,
    `<meta property="og:description" content="${escA(description)}">`,
    `<meta property="og:url" content="${urls[lang]}">`,
    `<meta property="og:locale" content="${lang}">`,
    ...(ogImage ? [`<meta property="og:image" content="${ogImage}">`, `<meta name="twitter:card" content="summary_large_image">`] : []),
    ...(names.logo ? [`<link rel="icon" href="${rel}${names.logo}">`] : []),
    // Base look for the language links we put in the page's switcher (the page's own CSS can override it).
    // Models often put the hero picture at z-index:-1, which hides it behind the section's background.
    `<style>section,main>*{isolation:isolate}</style>`,
    ...(langs.length > 1 ? [`<style>[data-lang-switch]{display:inline-flex;gap:4px;align-items:center}[data-lang-switch] a{display:inline-block;padding:4px 8px;border-radius:999px;font-size:.8rem;font-weight:700;letter-spacing:.04em;text-decoration:none;color:inherit;opacity:.7}[data-lang-switch] a[aria-current]{opacity:1;background:rgba(127,127,127,.18)}</style>`] : []),
    ...ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`),
  ].join("\n");
  h = /<head\b[^>]*>/i.test(h) ? h.replace(/<head\b[^>]*>/i, (m) => `${m}\n${head}\n`) : h.replace(/<html\b[^>]*>/i, (m) => `${m}\n<head>\n${head}\n</head>`);
  // Pages for other languages live one folder down.
  if (rel) h = h.replace(/(\s(?:src|href)\s*=\s*["'])images\//gi, `$1${rel}images/`).replace(/url\(\s*(["']?)images\//gi, `url($1${rel}images/`);
  // Language switcher: fill the model's placeholder, or add a small one.
  if (langs.length > 1) {
    const links = langs.map((l) => `<a href="${rel}${l === langs[0] ? "" : `${l}/`}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="page"' : ""}>${l.toUpperCase()}</a>`).join(" ");
    if (/<([a-z]+)\b[^>]*data-lang-switch[^>]*>[\s\S]*?<\/\1>/i.test(h)) h = h.replace(/(<([a-z]+)\b[^>]*data-lang-switch[^>]*>)[\s\S]*?(<\/\2>)/i, `$1${links}$3`);
    else h = h.replace(/<\/body>/i, `<nav aria-label="Language" style="position:fixed;top:12px;right:12px;z-index:99;display:flex;gap:4px;background:rgba(255,255,255,.92);padding:6px 8px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.15);font:600 13px system-ui,sans-serif">${links.replace(/<a /g, '<a style="color:#111;text-decoration:none;padding:2px 6px" ')}</nav>\n</body>`);
  }
  return h.startsWith("<!") ? h : `<!doctype html>\n${h}`;
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
