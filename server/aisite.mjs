// Premium websites designed by a free model. Everything we know about the business goes into one
// big prompt (brand, offer and prices, story, hours, address, links, the exact images available,
// colours from their logo, the style they chose, SEO and accessibility rules). The model writes a
// complete HTML + CSS page from scratch; we make it safe, add the SEO head, and translate it.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { save, MEDIA_DIR, DATA_DIR } from "./store.mjs";
import { complete, aiKey } from "./openrouter.mjs";
import { generateImage } from "./images.mjs";
import { findStockPhotos } from "./stock.mjs";
import { describeImage, CONTEXT } from "./studio.mjs";
import { extractHtml, pageProblem, sanitize, assemble, readMeta, lintPage, BOOTSTRAP_CSS, BOOTSTRAP_ICONS_CSS, BOOTSTRAP_JS, ANIMATE_CSS } from "./webpage.mjs";
import { directionPrompt } from "./directions.mjs";
import { cleanLogo, analysePhoto, planImages, renderPlan, imgTag, fixPageImages, FRAMES, IMAGE_CSS } from "./siteimages.mjs";

const KEY = aiKey;
const LANG_NAMES = { es: "Spanish", en: "English", de: "German", it: "Italian", nl: "Dutch", sv: "Swedish", fr: "French" };
const PAGE_TIMEOUT = () => Number(process.env.SITE_MODEL_TIMEOUT_MS ?? 9 * 60e3);
const STYLE = {
  modern: "modern and minimal: clean grid, lots of white space, crisp sans-serif type, one strong accent colour",
  warm: "warm and welcoming: soft earthy tones, rounded shapes, friendly serif headings, a homely local feel",
  bold: "bold and colourful: big confident type, strong colour blocks, energetic layout, high contrast",
  elegant: "elegant and premium: refined serif headings, restrained palette, fine lines, luxury magazine feel",
  natural: "fresh and natural: greens and light neutrals, organic shapes, airy photography-led layout",
};
const FONTS = {
  modern: "e.g. Inter or Manrope with Space Grotesk headings", warm: "e.g. Fraunces headings with Nunito Sans body",
  bold: "e.g. Archivo Black or Bricolage Grotesque headings with Inter body", elegant: "e.g. Cormorant Garamond or Playfair Display headings with Lato body",
  natural: "e.g. DM Serif Display headings with DM Sans body",
};

// ---------- Images ----------

async function resize(src, out, { max, type = "image/jpeg", quality = 84 }) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(src);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * k), h = Math.round(img.height * k);
  const cv = createCanvas(w, h);
  cv.getContext("2d").drawImage(img, 0, 0, w, h);
  await writeFile(out, type === "image/png" ? cv.toBuffer("image/png") : cv.toBuffer("image/jpeg", quality));
  return { w, h };
}

const toHex = (r, g, b) => "#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
function hue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** The two main colours of a logo (ignoring white, black and greys). */
export async function logoPalette(file) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(file);
  const cv = createCanvas(48, 48);
  const ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0, 48, 48);
  const px = ctx.getImageData(0, 0, 48, 48).data;
  const buckets = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
    if (a < 200) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 40 || mx < 40 || mn > 225) continue; // grey, black or white
    const key = [r, g, b].map((x) => Math.round(x / 24)).join(",");
    const bk = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    buckets.set(key, { n: bk.n + 1, r: bk.r + r, g: bk.g + g, b: bk.b + b });
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n).map((x) => ({ n: x.n, r: x.r / x.n, g: x.g / x.n, b: x.b / x.n }));
  if (!ranked.length) return null;
  const first = ranked[0];
  const second = ranked.find((c) => Math.min(Math.abs(hue(c.r, c.g, c.b) - hue(first.r, first.g, first.b)), 360 - Math.abs(hue(c.r, c.g, c.b) - hue(first.r, first.g, first.b))) > 35);
  return { primary: toHex(first.r, first.g, first.b), accent: second ? toHex(second.r, second.g, second.b) : "" };
}

/**
 * Get the pictures ready like an art director would: a clean logo (plain background removed), the
 * business's photos, free stock photos for what's missing (one per product when possible; AI
 * pictures only as a last resort), each analysed for its subject, then a plan that gives every
 * picture one job on the page, cropped to the exact frame that job needs.
 */
export async function prepareAssets(client, dir) {
  await mkdir(join(dir, "images"), { recursive: true });
  const list = [];
  const pics = [];
  let logo, logoInfo = null, palette = null;
  if (client.logoFile) {
    try {
      logoInfo = await cleanLogo(join(MEDIA_DIR, client.logoFile), join(dir, "images", "logo.png"));
      logo = "images/logo.png";
      list.push({ path: logo, kind: "logo", desc: "the business's logo", w: logoInfo.w, h: logoInfo.h });
      palette = await logoPalette(join(dir, "images", "logo.png")).catch(() => null);
    } catch (e) { console.warn("Logo couldn't be used:", e.message); }
  }
  const addPic = async (path, kind, desc, extra = {}) => {
    const src = join(dir, path);
    const a = await analysePhoto(src);
    list.push({ path, kind, desc, w: a.w, h: a.h });
    pics.push({ id: path.replace(/^images\//, "").replace(/\.jpg$/, ""), src, kind, desc, ...a, ...extra });
  };
  let changed = false;
  for (const [i, p] of (client.photos ?? []).slice(0, 8).entries()) {
    try {
      const path = `images/photo-${i + 1}.jpg`;
      await resize(join(MEDIA_DIR, p.file), join(dir, path), { max: 2000 });
      if (p.description == null && KEY()) { p.description = await describeImage(p.file).catch(() => ""); changed = true; }
      await addPic(path, "photo", p.description || "a real photo of the business");
    } catch (e) { console.warn("Photo couldn't be used:", e.message); }
  }
  if (changed) void save();
  const photos = pics.length;
  const prof = client.profile ?? {};
  // Stock: one per product or service, plus enough general ones for a full page.
  try {
    const stock = await findStockPhotos(client, Math.max(photos ? 2 : 3, 6 - photos), async (buf, n) => resize(buf, join(dir, `images/stock-${n}.jpg`), { max: 2000 }));
    for (const s of stock) await addPic(`images/stock-${s.index}.jpg`, "stock", `Stock photo: ${s.title}`.slice(0, 160), s.service ? { service: s.service } : {});
  } catch (e) { console.warn("Stock photos failed:", e.message); }
  // Last resort (no stock found): AI pictures, objects only (free image models add odd people).
  const mood = STYLE[prof.style] ?? STYLE.modern;
  const subjects = [`${client.offer || client.kind || client.name}, arranged as a still life`, `close-up detail of the best products of ${client.name} on a table`, `an empty, tidy display of the products of ${client.name}, nobody in the shot`];
  const reference = client.photos?.[0] ? join(MEDIA_DIR, client.photos[0].file) : undefined;
  for (let n = 1; pics.length < 3 && n <= 3; n++) {
    const subject = subjects[n - 1];
    const prompt = `${n === 1 ? "Wide" : "Premium"} product photograph for ${client.kind || "a local business"} in ${client.town || "Tenerife"}, Canary Islands. Subject: ${subject}. Mood: ${mood}. Natural light, realistic, sharp focus, magazine quality. Objects only: no people, no person, no hands, no faces, no text, no letters, no logos, no watermarks.`;
    try {
      const path = `images/ai-${n}.jpg`;
      await generateImage(prompt, join(dir, path), { size: n === 1 ? [1600, 1000] : [1200, 900], reference });
      await addPic(path, "ai", `AI picture: ${subject}`.slice(0, 160));
    } catch (e) { console.warn("Site image failed:", e.message); }
  }
  const plan = await renderPlan(planImages(pics, prof.services ?? []), dir);
  for (const s of plan.slots) list.push({ path: s.file, kind: s.kind, desc: s.desc, w: s.w, h: s.h, frame: s.frame });
  return { list, logo, logoInfo, hero: plan.hero?.file, palette, plan };
}

// ---------- The big prompt ----------

const DEFAULT_COLORS = { modern: ["#1f3a5f", "#f2a541"], warm: ["#8a4b2a", "#e9b44c"], bold: ["#d7263d", "#1b998b"], elegant: ["#1d1d1f", "#b08d57"], natural: ["#2f6b3b", "#e3b23c"] };

export function mapsEmbed(client) {
  const q = [client.profile?.address, client.town, "Tenerife"].filter(Boolean).join(", ") || client.name;
  return `https://maps.google.com/maps?q=${encodeURIComponent(`${client.name}, ${q}`)}&output=embed`;
}
export const directions = (client) => client.profile?.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([client.name, client.profile?.address, client.town, "Tenerife"].filter(Boolean).join(", "))}`;
const waLink = (c) => (c.phone ? `https://wa.me/${c.phone.replace(/\D/g, "")}` : "");

export function designPrompt(client, { lang, assets, design, langs, direction }) {
  const p = client.profile ?? {};
  const L = LANG_NAMES[lang] ?? lang;
  const style = p.style && STYLE[p.style] ? p.style : "modern";
  const [defP, defA] = DEFAULT_COLORS[style];
  const primary = p.colors?.primary || assets.palette?.primary || defP;
  const accent = p.colors?.accent || assets.palette?.accent || defA;
  const colourSource = p.colors?.primary ? "chosen by the business" : assets.palette?.primary ? "taken from their logo" : "suggested for the style";
  const wa = waLink(client);
  const social = Object.entries(p.social ?? {}).filter(([, v]) => v);
  const services = (p.services ?? []).map((s) => `- ${s.name}${s.price ? ` — ${s.price}` : ""}${s.description ? `: ${s.description}` : ""}`).join("\n");
  const info = [
    `Name: ${client.name}`,
    `Type of business: ${client.kind || "local business"}`,
    `Town: ${client.town || "Tenerife"}, Tenerife, Canary Islands, Spain`,
    p.address && `Address: ${p.address}`,
    client.phone && `Phone / WhatsApp: ${client.phone} (WhatsApp link: ${wa}; call link: tel:${client.phone.replace(/[^\d+]/g, "")})`,
    client.email && `Email: ${client.email}`,
    client.hours && `Opening hours: ${client.hours}`,
    p.tagline && `Slogan: ${p.tagline}`,
    `What they offer, in their words: ${client.offer || "-"}`,
    services && `Products and services (show prices exactly as written):\n${services}`,
    p.usps && `What makes them special: ${p.usps}`,
    p.story && `Their story: ${p.story}`,
    p.since && `In business since: ${p.since}`,
    p.team && `The team: ${p.team}`,
    p.payment && `Payment methods: ${p.payment}`,
    p.extras && `Other useful details: ${p.extras}`,
    p.bookingUrl && `Booking link: ${p.bookingUrl}`,
    p.menuUrl && `Menu / catalogue link: ${p.menuUrl}`,
    social.length && `Social and review profiles: ${social.map(([k, v]) => `${k}: ${v}`).join(", ")}`,
    `Their customers speak: ${langs.map((l) => LANG_NAMES[l] ?? l).join(", ")} (this page is the ${L} version)`,
  ].filter(Boolean).join("\n");
  const plan = assets.plan ?? { gallery: [], services: [] };
  const kindNote = (x) => (x.kind === "photo" ? "real photo of the business" : x.kind === "stock" ? "stock photo, illustrative only" : "illustration");
  const slotLine = (x, label, opts) => `- ${label} (${FRAMES[x.frame].label}, ${kindNote(x)}${x.desc && !/^Stock photo|^AI picture/.test(x.desc) ? `: ${x.desc.slice(0, 120)}` : ""}):\n  ${imgTag(x, opts)}`;
  const imagePlan = [
    plan.hero && slotLine(plan.hero, "HERO", { eager: true }),
    ...plan.services.map((x) => slotLine(x, `PRODUCT CARD "${x.service}"`)),
    plan.about && slotLine(plan.about, "ABOUT"),
    ...plan.gallery.map((x, i) => slotLine(x, `GALLERY ${i + 1}${i === 0 && x.frame === "tall" ? " (feature tile: larger, spans two rows)" : ""}`)),
  ].filter(Boolean).join("\n");
  return `You are an award-winning web designer and senior front-end developer. Design and code a premium one-page website for a real local business in Tenerife. It must look custom-made and expensive, as if a top agency designed it for this exact business, never like a generic template.

## The business
${info}

## Brand
Logo: ${assets.logo ? `<img src="${assets.logo}" width="${assets.logoInfo?.w ?? ""}" height="${assets.logoInfo?.h ?? ""}" alt="${client.name}"> (${assets.logoInfo?.transparent ? "transparent background, trimmed" : "has its own background, so show it with rounded corners"}). Header: about 48px tall next to (or instead of) the name. Footer: at most 80px tall. Never inside a coloured box or circle, never stretched, never as a big image.` : "no logo: design an elegant wordmark from the business name with CSS typography"}.
Colours (${colourSource}): primary ${primary}, accent ${accent}. Build a full palette from these (tints, a dark tone for text, light backgrounds) and keep text contrast at WCAG AA or better.
Style the business asked for: ${STYLE[style]}.
Fonts: ${direction ? "the Google Fonts the art direction below suggests" : `pick a Google Fonts pairing that fits that style (${FONTS[style]})`}.

## Image plan (an art director chose, cropped and placed every picture: follow it exactly)
${imagePlan || "- no pictures: use CSS colour, gradients and typography instead; never leave empty image boxes"}
Rules for pictures:
- Copy each tag above exactly where its label says (keep src, width, height and style). You may add a class, and write a specific alt text in ${L}. Every picture appears exactly once; no other images anywhere (the logo is the only one used twice: header and footer).
- Each picture is already cropped to its frame (16:9, 4:3, 1:1 or 4:5), so show it whole: width:100%; height:auto (or the same aspect-ratio). The only exception is a full-bleed hero, which may fill its container with height:100%.
- Frames get the direction's corner radius and nothing else: no filters, no blur, no opacity, no borders or boxes around photos, no CSS background-image photos, no decorative empty boxes or blurred blobs standing in for pictures. If a section has no picture in the plan, design it with type and colour instead.
- Text on a photo always sits on a gradient overlay so it reads perfectly; buttons on photos are solid (never outline-only).
- A product card with a picture shows it at the top of the card; cards without one use a small icon (Bootstrap Icons or inline SVG) instead, and all cards in one row stay the same height.
- Stock photos are illustrative: never caption or describe them as this business's own shop, team or products.

## Copy
Write every visible word in ${L}: natural, native, warm and persuasive, short sentences, written for locals and tourists. Never invent facts, prices, discounts, awards, reviews, ratings, years, certifications or people that are not listed above; if something isn't given, leave it out. Show prices exactly as given.

## Page structure (in this order, adapt names to the business)
1. Header: logo, short anchor navigation to the sections, a language switcher placeholder written exactly as <nav class="lang-switch" data-lang-switch aria-label="Language"></nav>, and a WhatsApp button${wa ? ` (${wa})` : ""}. On mobile the navigation collapses into a CSS-only menu made with <details><summary> (no JavaScript). Sticky header.
2. Hero: one <h1> that says what they are and where (e.g. "${client.kind || "Business"} in ${client.town || "Tenerife"}" in ${L}, with flair), a supporting line${p.tagline ? " using their slogan" : ""}, two calls to action${wa ? " (WhatsApp and call)" : ""}, and the hero image${direction ? " laid out as the art direction says" : " with a tasteful overlay"}.
3. Highlights: 3 or 4 short strengths from what makes them special and the facts above, with small inline SVG icons.
4. ${services ? "Products and services: elegant cards or a menu-style list with names, short descriptions and prices." : "What they offer: elegant cards built from their own description."}
5. Gallery: ${plan.gallery.length ? `the GALLERY pictures in a grid that fits their frames${plan.gallery[0]?.frame === "tall" ? " (the first one larger)" : ""}` : "skip this section (there are no gallery pictures)"}.
6. About: their story${p.since ? " and since when" : ""}${plan.about ? ", with the ABOUT picture beside the text" : ", typographic (no picture)"}.
7. Visit us: address, opening hours as a clean list, and a Google Map: an <iframe> with exactly src="${mapsEmbed(client)}" title="Map" and loading="lazy", plus a "how to get there" button to ${directions(client)}${p.bookingUrl ? `, and a booking button to ${p.bookingUrl}` : ""}${p.menuUrl ? `, and a button to the menu/catalogue ${p.menuUrl}` : ""}.
8. FAQ: 4 to 6 questions their customers really search for in ${L}, answered only from the facts above, using <details><summary>.
9. Closing call to action band${wa ? " with the WhatsApp button" : ""}.
10. Footer: logo, name, address, phone, ${social.length ? "links to their social profiles with small icons (Bootstrap Icons like bi-instagram, bi-facebook, or inline SVG), " : ""}© ${new Date().getFullYear()} ${client.name}.
${wa ? "Also a floating round WhatsApp button fixed at the bottom right." : ""}

${direction ? directionPrompt(direction) + "\n\n" : ""}## Quality bar (every direction)
- Header: sticky and slim, logo left, short anchor links, the language switcher and a solid WhatsApp button; a translucent background with backdrop-filter blur once over content.
- Hero images: if text sits on a photo, layer the image (z-index 0), a gradient overlay (z-index 1) and the text (z-index 2) inside a position:relative container; never use a negative z-index. Text on photos must stay readable.
- Typography: base body size 17-18px, line-height 1.6; a clear type scale; h2 about clamp(2rem, 4vw, 3.4rem). Each section starts with a small eyebrow label above the h2. Always wrap the eyebrow, the h2 and its intro line together in one <div class="section-head">, so a grid or flex layout never splits them into separate columns.
- Images: apart from a full-bleed hero, no image is taller than about 620px on desktop or 70vh on phones; give every frame an aspect-ratio or max-height with object-fit: cover.
- Layout: the header, every section and the footer share the same container (max-width about 1200px, centred, side padding at least 20px, so nothing touches the screen edge); section padding clamp(72px, 10vw, 136px) top and bottom; vary section backgrounds so the page has rhythm.
- Visit us: address and opening hours next to the map; give the map frame a fixed height (about 380px, 300px on phones) so it never collapses.
- Buttons and links: clear hover and focus-visible states; tap targets of at least 44px.
- Mobile-first and fully responsive (breakpoints around 640px and 1024px), no horizontal page scrolling. Subtle CSS-only motion (hover transitions, a gentle fade-in) that respects prefers-reduced-motion.

## Technical rules (strict)
- ONE complete HTML5 document from <!doctype html> to </html>. All CSS in a single <style> in the <head>, using CSS custom properties in :root.
- NO inline JavaScript: no <script> blocks, no on* attributes, no forms. The one script you may load is Bootstrap's bundle (see below). External CSS is limited to: Google Fonts (one <link> to https://fonts.googleapis.com/css2?...&display=swap, with preconnect links), and you MAY use Bootstrap 5 and Bootstrap Icons through exactly these two links: <link rel="stylesheet" href="${BOOTSTRAP_CSS}"> and <link rel="stylesheet" href="${BOOTSTRAP_ICONS_CSS}"> (put them before your own <style> so your CSS wins). Bootstrap is optional: use its grid, utilities, cards, buttons and badges where they save work, but override its look with your own CSS variables, fonts and colours so the site does not look like a stock Bootstrap template. Icons: <i class="bi bi-geo-alt" aria-hidden="true"></i> style Bootstrap Icons (https://icons.getbootstrap.com names, e.g. bi-telephone, bi-whatsapp, bi-clock, bi-geo-alt, bi-star-fill, bi-instagram), or small inline SVGs. Bootstrap's JavaScript IS available through <script src="${BOOTSTRAP_JS}"></script> just before </body>, driven only by data-bs-* attributes (never write your own script): a collapsing navbar (navbar-toggler with data-bs-toggle="collapse"), a carousel for reviews or photos, an accordion for the FAQ, a modal for a photo or the menu. Optional animation: <link rel="stylesheet" href="${ANIMATE_CSS}"> (animate__animated animate__fadeInUp), or your own CSS animations and scroll-driven effects. Use any of this when it makes the site look more professional, not just because it exists. No other libraries, fonts or icon sets.
- The very first thing inside <head> is a comment: <!-- design: one sentence describing the palette, fonts and layout -->.
- Include <title> (max 60 characters: name, main offer, town) and <meta name="description"> (max 155 characters, with a call to action), both in ${L}.
- Semantic HTML: header, nav, main, sections with ids, footer; exactly one h1; an h2 for each section; lists for lists; buttons and links with clear text.
- SEO: use the phrases people search for (like "${(client.kind || "business").toLowerCase()} ${client.town || "Tenerife"}") naturally in headings and text.
- Make it rich and polished: aim for 25,000 to 45,000 characters in total (never more than 50,000). No other comments.
${(() => { const asks = (client.siteChat ?? []).filter((m) => m.role === "owner" && m.status === "done").map((m) => m.text).slice(-10); return asks.length ? `\n## Changes the studio asked for on the previous version (keep them)\n${asks.map((a) => `- ${a}`).join("\n")}\n` : ""; })()}${design ? `\n## Keep the current look\nThis business already has a website. Keep the same design (palette, fonts, layout and feel) and update the content: ${design}\n` : ""}
Return only the HTML document, nothing before or after it.`;
}

function translatePrompt(html, lang) {
  const L = LANG_NAMES[lang] ?? lang;
  return `Translate this website into ${L} for people who speak ${L}.
Change ONLY the human-readable text: headings, paragraphs, buttons, list items, the <title>, the meta description, alt, title and aria-label attributes, FAQ questions and answers. Write it natively, not word for word, and keep it about the same length.
Keep everything else exactly the same: every tag, attribute, class, id, the CSS, all URLs and links, image paths, phone numbers, prices, addresses and the business name. Keep the <!-- design: ... --> comment as it is.
Return the full HTML document only, nothing before or after it.

${html}`;
}

// ---------- Structured data ----------

function schemaType(kind = "") {
  const k = kind.toLowerCase();
  if (/frut|verdur|grocer|greengrocer|super|aliment|food shop/.test(k)) return "GroceryStore";
  if (/restaur|tasca|guachinche|bistro|marisquer/.test(k)) return "Restaurant";
  if (/caf[eé]|coffee|bar\b|bar /.test(k)) return "CafeOrCoffeeShop";
  if (/bakery|panader|pastel/.test(k)) return "Bakery";
  if (/hotel|apart|hostel|casa rural|villa/.test(k)) return "LodgingBusiness";
  if (/hair|peluq|beauty|belleza|nail|uñas|spa/.test(k)) return "BeautySalon";
  if (/dive|buceo|surf|boat|barco|excurs|tour|whale|ballena/.test(k)) return "TouristAttraction";
  if (/estate|inmobil/.test(k)) return "RealEstateAgent";
  if (/shop|tienda|store/.test(k)) return "Store";
  return "LocalBusiness";
}

const stripTags = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function structuredData(client, { lang, url, base, assets, html, description }) {
  const p = client.profile ?? {};
  const price = (s) => { const m = /(\d+(?:[.,]\d{1,2})?)/.exec(s ?? ""); return m ? m[1].replace(",", ".") : undefined; };
  const biz = {
    "@context": "https://schema.org", "@type": schemaType(client.kind), name: client.name, description, url, inLanguage: lang,
    image: assets.list.filter((a) => a.kind !== "logo").slice(0, 4).map((a) => `${base}/${a.path}`),
    ...(assets.logo ? { logo: `${base}/${assets.logo}` } : {}),
    ...(client.phone ? { telephone: client.phone } : {}),
    ...(client.email ? { email: client.email } : {}),
    address: { "@type": "PostalAddress", ...(p.address ? { streetAddress: p.address } : {}), addressLocality: client.town || "Tenerife", addressRegion: "Santa Cruz de Tenerife", addressCountry: "ES" },
    ...(client.hours ? { openingHours: client.hours } : {}),
    ...(p.payment ? { paymentAccepted: p.payment } : {}),
    ...(Object.values(p.social ?? {}).some(Boolean) ? { sameAs: Object.values(p.social).filter(Boolean) } : {}),
    hasMap: directions(client),
    areaServed: client.town || "Tenerife",
    ...((p.services ?? []).length ? {
      makesOffer: p.services.map((s) => ({ "@type": "Offer", name: s.name, ...(s.description ? { description: s.description } : {}), ...(price(s.price) ? { price: price(s.price), priceCurrency: "EUR" } : {}) })),
    } : {}),
  };
  const faq = [...html.matchAll(/<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi)]
    .map((m) => ({ q: stripTags(m[1]), a: stripTags(m[2]) })).filter((x) => x.q && x.a && x.q.length < 200).slice(0, 8)
    .filter((x) => !/^(men[uú]|menu)$/i.test(x.q));
  return faq.length >= 2
    ? [biz, { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }]
    : [biz];
}

// ---------- Build ----------

/** Design the page with the model, translate it, and write the finished pages. Throws if the design fails. */
export async function buildAiSite(client, { dir, langs, base, assets, design, step, direction }) {
  const allowed = assets.list.map((a) => a.path);
  const fallbackImage = assets.hero ?? allowed.find((x) => !x.endsWith("logo.png")) ?? "";
  const urls = Object.fromEntries(langs.map((l) => [l, `${base}/${l === langs[0] ? "" : `${l}/`}`]));
  // Safe HTML, then the pictures repaired: true sizes, nothing shown twice.
  const clean = (text) => fixPageImages(sanitize(extractHtml(text) ?? "", { images: allowed, fallbackImage }), assets.plan?.slots ?? []);
  const models = [];

  step("design");
  const out = await complete({
    key: KEY(), prompt: designPrompt(client, { lang: langs[0], assets, design, langs, direction }), system: CONTEXT, tier: "complex",
    maxTokens: 16000, timeoutMs: PAGE_TIMEOUT(), attempts: 3, onDelta: () => {},
    validate: (t) => pageProblem(extractHtml(t)),
  });
  models.push(out.model);
  let main = clean(out.text);
  let qa = null;
  try {
    step("review");
    const r = await qualityCheck(client, main, { clean, assets });
    main = r.html; qa = r.qa;
    if (r.model) models.push(r.model);
  } catch (e) {
    console.warn("Website quality check skipped:", e.message); // never fails the build
  }
  const meta = readMeta(main);
  const pages = { [langs[0]]: main };

  for (const l of langs.slice(1)) {
    step(`translating:${l}`);
    try {
      const t = await complete({
        key: KEY(), prompt: translatePrompt(main, l), system: CONTEXT, tier: "default",
        maxTokens: 16000, timeoutMs: PAGE_TIMEOUT(), attempts: 3, onDelta: () => {},
        validate: (x) => pageProblem(extractHtml(x), { minLength: Math.min(3500, main.length * 0.6) }),
      });
      pages[l] = clean(t.text);
      models.push(t.model);
    } catch (e) {
      console.warn(`Translation to ${l} failed:`, e.message);
    }
  }

  const done = langs.filter((l) => pages[l]);
  await writePages(client, { dir, langs: done, pages, base, assets });
  await saveSources(client, { langs: done, pages, assets });
  return { kind: "ai", langs: done, models: [...new Set(models.filter(Boolean))], design: (meta.design || design || "").slice(0, 600), ...(qa ? { quality: qa } : {}) };
}

// ---------- Quality check ----------

const PASS_SCORE = 8;

function reviewPrompt(client, html, lint) {
  return `You are a strict art director reviewing a finished website for "${client.name}" (${client.kind || "local business"}${client.town ? `, ${client.town}` : ""}) before it goes live. Judge it from the HTML and CSS as a visitor would see it on a phone and on a laptop.

Check:
- Looks professional and finished: a clear visual hierarchy, a consistent palette (max 3 colours plus neutrals), 2 fonts at most, generous spacing, aligned grids, not a stock Bootstrap template.
- Text is readable: enough contrast against its background (especially text over photos), sensible sizes, no walls of text.
- Content: a clear headline and call to action, real specific copy (no filler, no placeholder text), contact details, opening hours, map or address when known.
- Layout problems that would break on phones: fixed widths, overflowing rows, tiny tap targets, missing responsive rules, sections that collapse.
- Images: used with object-fit, alt text, no stretched or repeated pictures.
- Icons work (Bootstrap Icons only if the icon stylesheet is linked).
${lint.length ? `
Automatic checks already found:
${lint.map((l) => `- ${l}`).join("\n")}
` : ""}
Score 1 to 10 (8 or more means ready to publish). List the 3 to 6 most important concrete problems, each with the exact fix to make in the HTML or CSS.
Reply with JSON only: {"score": number, "issues": ["problem and fix", ...]}

${html.slice(0, 60000)}`;
}

/**
 * After the design is written: check it looks professional (deterministic lint plus an AI art-director
 * review) and, if it falls short, have the model fix the listed problems once. Keeps whichever version
 * scores better. Returns { html, qa: { score, issues, revised }, model }.
 */
export async function qualityCheck(client, html, { clean, assets }) {
  const ask = async (page) => {
    const lint = lintPage(page);
    const r = await complete({ key: KEY(), prompt: reviewPrompt(client, page, lint), system: CONTEXT, json: true, tier: "default", attempts: 2, timeoutMs: 120e3 });
    const score = Math.max(0, Math.min(10, Number(r.json?.score) || 0));
    const issues = [...lint, ...(Array.isArray(r.json?.issues) ? r.json.issues.map(String) : [])].slice(0, 10);
    return { score, issues, model: r.model };
  };
  const first = await ask(html);
  if (first.score >= PASS_SCORE) return { html, qa: { score: first.score, issues: first.issues, revised: false }, model: first.model };

  console.log(`Website quality check for ${client.name}: ${first.score}/10, improving the page`);
  const fixed = await complete({
    key: KEY(), tier: "complex", system: CONTEXT, maxTokens: 16000, timeoutMs: PAGE_TIMEOUT(), attempts: 2, onDelta: () => {},
    prompt: `Here is a website for "${client.name}" that a design review found not yet professional enough. Fix every problem below and polish the rest, keeping the same content, structure, image paths, language and the rules it already follows (one HTML document, no inline JavaScript, external files only Google Fonts and the Bootstrap, Bootstrap Icons and animate.css links already used).

Problems to fix:
${first.issues.map((i) => `- ${i}`).join("\n")}

Return only the complete improved HTML document, nothing before or after it.

${html}`,
    validate: (t) => pageProblem(extractHtml(t)),
  });
  const better = clean(fixed.text);
  const second = await ask(better);
  const useNew = second.score >= first.score;
  const kept = useNew ? second : first;
  return { html: useNew ? better : html, qa: { score: kept.score, issues: kept.issues, revised: useNew, before: first.score }, model: fixed.model };
}

/** Turn the (safe) page bodies into the finished files: SEO head, language links, image CSS. */
export async function writePages(client, { dir, langs, pages, base, assets }) {
  const urls = Object.fromEntries(langs.map((l) => [l, `${base}/${l === langs[0] ? "" : `${l}/`}`]));
  for (const l of langs) {
    const m = readMeta(pages[l]);
    const title = (m.title || `${client.name} · ${client.kind || ""} ${client.town || ""}`).slice(0, 70);
    const description = (m.description || `${client.name}, ${client.kind || ""} ${client.town || "Tenerife"}. ${client.offer || ""}`).replace(/\s+/g, " ").slice(0, 160);
    let html = assemble(pages[l], {
      lang: l, langs, urls, title, description, rel: l === langs[0] ? "" : "../",
      ogImage: assets.hero ? `${base}/${assets.hero}` : "", names: { logo: assets.logo },
      ld: structuredData(client, { lang: l, url: urls[l], base, assets, html: pages[l], description }),
    });
    html = html.replace(/<\/head>/i, `${IMAGE_CSS}\n</head>`); // after the model's CSS, so it wins
    const folder = l === langs[0] ? dir : join(dir, l);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "index.html"), html);
  }
}

// The page bodies are kept (outside the public sites folder) so the website chat can edit them later.
export const sourceDir = (client) => join(DATA_DIR, "site-src", client.siteSlug || "site");
async function saveSources(client, { langs, pages, assets }) {
  const d = sourceDir(client);
  await mkdir(d, { recursive: true });
  for (const l of langs) await writeFile(join(d, `${l}.html`), pages[l]);
  const { list, logo, logoInfo, hero, palette, plan } = assets;
  await writeFile(join(d, "assets.json"), JSON.stringify({ langs, list, logo, logoInfo, hero, palette, plan: plan && { slots: plan.slots } }, null, 1));
}
