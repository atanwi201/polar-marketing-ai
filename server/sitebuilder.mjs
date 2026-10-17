// Builds each client an SEO-ready static marketing site in sites/<client-name>/:
// one page per language with hreflang, canonical, Open Graph, LocalBusiness + FAQ JSON-LD,
// sitemap.xml, robots.txt and AI-generated images. Plain HTML, no JS, deployable anywhere.
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { complete } from "./openrouter.mjs";
import { generateImage } from "./images.mjs";
import { db, save, now } from "./store.mjs";
import { CONTEXT } from "./studio.mjs";

export const SITES_DIR = process.env.SITES_DIR ?? join(import.meta.dirname, "..", "sites");
const LANG_NAMES = { es: "Spanish", en: "English", de: "German", it: "Italian", nl: "Dutch", sv: "Swedish", fr: "French" };
const KEY = () => process.env.OPENROUTER_API_KEY ?? "";

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

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clip = (s = "", n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

const SHAPE = `{"metaTitle": string (max 60 chars, business + main service + town), "metaDescription": string (max 155 chars, with a call to action), "h1": string, "tagline": string, "intro": string (2-3 sentences), "services": [{"name": string, "description": string (2 sentences)}] (3 to 6, only things in the brief), "about": string (one paragraph), "why": string[] (3 short reasons), "faq": [{"q": string, "a": string}] (4, real questions tourists and locals search for), "cta": string (button text), "keywords": string[] (6-10 search phrases people type in this language)}`;

function fallbackContent(c, lang) {
  return {
    metaTitle: clip(`${c.name} · ${c.kind || ""} ${c.town || "Tenerife"}`, 60),
    metaDescription: clip(`${c.name}, ${c.kind || "local business"} in ${c.town || "Tenerife"}. ${c.offer || ""}`, 155),
    h1: `${c.name}`, tagline: `${c.kind || ""} · ${c.town || "Tenerife"}`,
    intro: c.offer || "", services: [], about: c.offer || "", why: [], faq: [], cta: lang === "es" ? "Escríbenos por WhatsApp" : "Message us on WhatsApp", keywords: [],
  };
}

async function writeContent(c, lang, primary) {
  if (!KEY()) return fallbackContent(c, lang);
  const facts = `Business: ${c.name}\nType: ${c.kind || "-"}\nTown: ${c.town || "Tenerife"}, Tenerife, Canary Islands\nWhat they offer, in their words:\n"""${c.offer || ""}"""\nOpening hours: ${c.hours || "not given"}\nPhone/WhatsApp: ${c.phone || "not given"}`;
  const prompt = primary
    ? `Write the website copy in ${LANG_NAMES[lang] ?? lang} for this business, optimised for local search by tourists and residents.\n${facts}\nAlso add "imagePrompts": {"hero": string, "services": string[]} (English, photo-realistic scenes, no text in images), one per service.\nReturn JSON only, exactly: ${SHAPE.slice(0, -1)}, "imagePrompts": {"hero": string, "services": string[]}}`
    : `Here is the website copy in ${LANG_NAMES[primary_lang(c)]}:\n${JSON.stringify(c._primaryContent)}\n\nWrite it natively in ${LANG_NAMES[lang] ?? lang} for people searching in that language (adapt the keywords and FAQ to what they search, keep the same services and facts).\n${facts}\nReturn JSON only, exactly: ${SHAPE}`;
  const out = await complete({ key: KEY(), prompt, system: CONTEXT, json: true, tier: "default" });
  const j = out.json ?? {};
  if (!j.h1 || !j.metaTitle) throw new Error(`Site copy for ${lang} came back incomplete`);
  j.metaTitle = clip(j.metaTitle, 60);
  j.metaDescription = clip(j.metaDescription ?? "", 155);
  return { ...j, model: out.model };
}
const primary_lang = (c) => (c.languages?.[0] ?? "es");

function css() {
  return `:root{--ink:#16211f;--muted:#4d5d5a;--bg:#fbfaf7;--card:#fff;--accent:#0a6a86;--line:#e3e6e4}
*{box-sizing:border-box}body{margin:0;font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--accent)}img{max-width:100%;height:auto;display:block}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
header.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 20px;max-width:1080px;margin:0 auto;flex-wrap:wrap}
.brand{font-weight:800;font-size:1.15rem;text-decoration:none;color:var(--ink)}
nav.langs a{margin-left:10px;font-size:.85rem;text-decoration:none;text-transform:uppercase}
nav.langs a[aria-current]{font-weight:700;text-decoration:underline}
.hero{position:relative;min-height:62vh;display:grid;align-items:end;color:#fff;overflow:hidden}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.7),rgba(0,0,0,.05) 60%)}
.hero .wrap{position:relative;z-index:1;padding-bottom:48px}
h1{font-size:clamp(2rem,5vw,3.4rem);line-height:1.08;margin:0 0 8px;text-wrap:balance}
.tagline{font-size:1.2rem;margin:0 0 20px;max-width:46ch}
.btn{display:inline-block;background:#25d366;color:#08311a;font-weight:700;padding:13px 22px;border-radius:999px;text-decoration:none}
section{padding:56px 0}h2{font-size:1.8rem;margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.card img{aspect-ratio:4/3;object-fit:cover;width:100%}.card div{padding:16px}.card h3{margin:0 0 6px}
.why{list-style:none;padding:0;display:grid;gap:10px}.why li::before{content:"✓ ";color:var(--accent);font-weight:700}
details{border-bottom:1px solid var(--line);padding:14px 0}summary{font-weight:600;cursor:pointer}
.contact{background:var(--ink);color:#fff}.contact a{color:#9fe0f2}
footer{padding:24px 0;color:var(--muted);font-size:.85rem}`;
}

function page(c, lang, content, langs, base, images) {
  const prefix = (l) => (l === langs[0] ? "" : `${l}/`);
  const url = (l) => `${base}/${prefix(l)}`;
  const rel = lang === langs[0] ? "" : "../";
  const wa = c.phone ? `https://wa.me/${c.phone.replace(/\D/g, "")}` : "";
  const ld = [
    {
      "@context": "https://schema.org", "@type": c.schemaType || "LocalBusiness", name: c.name, description: content.metaDescription,
      url: url(lang), image: `${base}/images/hero.jpg`, telephone: c.phone || undefined,
      address: { "@type": "PostalAddress", addressLocality: c.town || "Tenerife", addressRegion: "Santa Cruz de Tenerife", addressCountry: "ES" },
      areaServed: "Tenerife", openingHours: c.hours || undefined, inLanguage: lang,
      makesOffer: (content.services ?? []).map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.name, description: s.description } })),
    },
    ...(content.faq?.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: content.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] : []),
  ];
  const T = {
    es: ["Servicios", "Por qué elegirnos", "Preguntas frecuentes", "Contacto", "Sobre nosotros"],
    en: ["Services", "Why choose us", "FAQ", "Contact", "About us"],
    de: ["Leistungen", "Warum wir", "Häufige Fragen", "Kontakt", "Über uns"],
    it: ["Servizi", "Perché sceglierci", "Domande frequenti", "Contatti", "Chi siamo"],
    nl: ["Diensten", "Waarom wij", "Veelgestelde vragen", "Contact", "Over ons"],
    sv: ["Tjänster", "Varför oss", "Vanliga frågor", "Kontakt", "Om oss"],
    fr: ["Services", "Pourquoi nous", "Questions fréquentes", "Contact", "À propos"],
  }[lang] ?? ["Services", "Why choose us", "FAQ", "Contact", "About us"];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(content.metaTitle)}</title>
<meta name="description" content="${esc(content.metaDescription)}">
${content.keywords?.length ? `<meta name="keywords" content="${esc(content.keywords.join(", "))}">\n` : ""}<link rel="canonical" href="${url(lang)}">
${langs.map((l) => `<link rel="alternate" hreflang="${l}" href="${url(l)}">`).join("\n")}
<link rel="alternate" hreflang="x-default" href="${url(langs[0])}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(content.metaTitle)}">
<meta property="og:description" content="${esc(content.metaDescription)}">
<meta property="og:image" content="${base}/images/hero.jpg">
<meta property="og:url" content="${url(lang)}">
<meta property="og:locale" content="${lang}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${rel}styles.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head>
<body>
<header class="top">
  <a class="brand" href="${rel}${prefix(lang)}">${esc(c.name)}</a>
  ${langs.length > 1 ? `<nav class="langs" aria-label="Language">${langs.map((l) => `<a href="${rel}${prefix(l)}" hreflang="${l}"${l === lang ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>` : ""}
</header>
<main>
<section class="hero">
  ${images.hero ? `<img src="${rel}images/${images.hero}" alt="${esc(content.h1)}" width="1600" height="900" fetchpriority="high">` : ""}
  <div class="wrap">
    <h1>${esc(content.h1)}</h1>
    <p class="tagline">${esc(content.tagline)}</p>
    ${wa ? `<a class="btn" href="${wa}">${esc(content.cta)}</a>` : ""}
  </div>
</section>
<section><div class="wrap"><p style="font-size:1.15rem;max-width:65ch">${esc(content.intro)}</p></div></section>
${content.services?.length ? `<section id="services"><div class="wrap"><h2>${T[0]}</h2><div class="grid">
${content.services.map((s, i) => `<article class="card">${images.services[i] ? `<img src="${rel}images/${images.services[i]}" alt="${esc(s.name)}" width="800" height="600" loading="lazy">` : ""}<div><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p></div></article>`).join("\n")}
</div></div></section>` : ""}
<section id="about"><div class="wrap"><h2>${T[4]}</h2><p style="max-width:65ch">${esc(content.about)}</p>
${content.why?.length ? `<h2 style="margin-top:32px">${T[1]}</h2><ul class="why">${content.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
</div></section>
${content.faq?.length ? `<section id="faq"><div class="wrap"><h2>${T[2]}</h2>${content.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n")}</div></section>` : ""}
<section id="contact" class="contact"><div class="wrap"><h2>${T[3]}</h2>
<p>${esc(c.name)} · ${esc(c.town || "Tenerife")}, Tenerife${c.hours ? `<br>${esc(c.hours)}` : ""}</p>
${c.phone ? `<p><a href="tel:${esc(c.phone.replace(/\s/g, ""))}">${esc(c.phone)}</a>${wa ? ` · <a href="${wa}">WhatsApp</a>` : ""}</p>` : ""}
<p><a href="https://www.google.com/maps/search/${encodeURIComponent(`${c.name} ${c.town || ""} Tenerife`)}">Google Maps</a></p>
</div></section>
</main>
<footer><div class="wrap">© ${new Date().getFullYear()} ${esc(c.name)}</div></footer>
</body>
</html>
`;
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

const building = new Set();

/** Build (or rebuild) a client's site. Runs in the background; progress is on client.site. */
export async function buildSite(client) {
  if (building.has(client.id)) return;
  building.add(client.id);
  client.siteSlug = siteSlug(client);
  const dir = join(SITES_DIR, client.siteSlug);
  const langs = client.languages?.length ? client.languages : ["es", "en"];
  const base = (client.domain ? `https://${client.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : `${process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`}/sites/${client.siteSlug}`);
  client.site = { status: "building", startedAt: now(), path: `sites/${client.siteSlug}/` };
  void save();
  try {
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, "images"), { recursive: true });
    const contents = {};
    const primary = await writeContent(client, langs[0], true);
    contents[langs[0]] = primary;
    client._primaryContent = { ...primary, imagePrompts: undefined, model: undefined };
    for (const l of langs.slice(1)) {
      contents[l] = await writeContent(client, l, false).catch((e) => { console.warn(e.message); return fallbackContent(client, l); });
    }
    delete client._primaryContent;

    const prompts = primary.imagePrompts ?? {
      hero: `Wide professional photo for ${client.kind || "a local business"} in ${client.town || "Tenerife"}, Canary Islands: ${client.offer || client.name}. Golden hour, inviting, no text`,
      services: [],
    };
    const images = { hero: "", services: [] };
    try { await generateImage(prompts.hero, join(dir, "images", "hero.jpg"), { size: [1600, 900] }); images.hero = "hero.jpg"; } catch (e) { console.warn("Hero image failed:", e.message); }
    for (const [i, p] of (prompts.services ?? []).slice(0, (primary.services ?? []).length).entries()) {
      try { await generateImage(p, join(dir, "images", `service-${i + 1}.jpg`), { size: [800, 600] }); images.services[i] = `service-${i + 1}.jpg`; } catch { /* page shows the card without a picture */ }
    }

    await writeFile(join(dir, "styles.css"), css());
    for (const l of langs) {
      const folder = l === langs[0] ? dir : join(dir, l);
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "index.html"), page(client, l, contents[l], langs, base, images));
    }
    const at = now();
    await writeFile(join(dir, "sitemap.xml"), sitemap(langs, base, at));
    await writeFile(join(dir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
    await writeFile(join(dir, "site.json"), JSON.stringify({ client: client.name, builtAt: at, base, languages: langs, contents }, null, 1));
    client.site = { status: "ready", builtAt: at, path: `sites/${client.siteSlug}/`, url: `/sites/${client.siteSlug}/`, models: [...new Set(Object.values(contents).map((x) => x.model).filter(Boolean))] };
  } catch (e) {
    client.site = { status: "failed", error: e.message, path: `sites/${client.siteSlug}/` };
    console.warn("Site build failed:", e.message);
  } finally {
    building.delete(client.id);
    void save();
  }
}
