// Public share page for one post or video: /p/<shareKey>. Facebook and X read its Open Graph /
// Twitter card tags to show the image (or video) and text when the link is shared.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tags = (item) => (item.hashtags ?? []).map((h) => "#" + h).join(" ");

import { ownWebsite } from "./ownsite.mjs";

export function sharePage({ item, kind, client, base, lang }) {
  const l = item.captions?.[lang] != null ? lang : Object.keys(item.captions ?? {})[0];
  const caption = item.captions?.[l] ?? "";
  const title = `${client.name}${item.concept ? " · " + item.concept : ""}`;
  const desc = caption.replace(/\s+/g, " ").slice(0, 200);
  const render = kind === "video" ? item.renders?.[l] ?? Object.values(item.renders ?? {})[0] : null;
  const img = `${base}/media/${kind === "video" ? render?.cover : item.imageFile}`;
  const video = render ? `${base}/media/${render.file}` : "";
  const site = ownWebsite(client) || (client.site?.url ? (/^https?:/.test(client.site.url) ? client.site.url : base + client.site.url) : "");
  const wa = (client.phone ?? "").replace(/[^\d]/g, "");
  const media = video
    ? `<video src="${esc(video)}" poster="${esc(img)}" controls playsinline preload="metadata"></video>`
    : `<img src="${esc(img)}" alt="${esc(item.altText || item.concept || client.name)}">`;
  return `<!doctype html>
<html lang="${esc(l)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="/brand/logo/favicon.svg" type="image/svg+xml">
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="${video ? "video.other" : "article"}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:alt" content="${esc(item.altText || item.concept || "")}">
<meta property="og:url" content="${esc(`${base}/p/${item.shareKey}`)}">
${video ? `<meta property="og:video" content="${esc(video)}">\n<meta property="og:video:type" content="video/mp4">\n<meta property="og:video:width" content="1080">\n<meta property="og:video:height" content="1920">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#f2f3f7;--card:#fff;--fill:#f2f3f7;--ink:#191c1f;--muted:#717780;--accent:#0666eb;--accent-text:#0559cc;--hero:linear-gradient(135deg,#2f5bff 0%,#6a3df5 52%,#c94fd0 100%)}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#16181b;--fill:#212428;--ink:#f5f6f7;--muted:#9aa0a8;--accent:#3d8bff;--accent-text:#7fb2ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:560px;margin:0 auto;padding:16px 16px 48px}
.top{display:flex;align-items:center;gap:12px;margin:4px 0 16px}
.avatar{width:42px;height:42px;border-radius:50%;background:var(--hero);color:#fff;display:grid;place-items:center;font:800 15px "Inter Tight",sans-serif}
.top b{font:700 18px "Inter Tight",sans-serif;letter-spacing:-.01em}
.card{background:var(--card);border-radius:28px;overflow:hidden}
img,video{display:block;width:100%;height:auto;background:#000}
video{max-height:80vh;object-fit:contain}
.body{padding:18px 20px 22px}
p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 12px}
.cap{background:var(--fill);border-radius:16px;padding:13px 14px}
.tags{color:var(--accent-text);font-weight:500}
.acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
a.btn{flex:1;display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 18px;border-radius:999px;background:var(--accent);color:#fff;text-decoration:none;font-weight:700}
a.btn.sec{background:var(--fill);color:var(--ink)}
</style>
</head>
<body>
<main>
  <div class="top"><span class="avatar" aria-hidden="true">${esc(String(client.name || "?").split(/\s+/).filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?")}</span><b>${esc(client.name)}</b></div>
  <article class="card">
    ${media}
    <div class="body">
      <p class="cap">${esc(caption)}</p>
      ${tags(item) ? `<p class="tags">${esc(tags(item))}</p>` : ""}
      <div class="acts">
        ${wa ? `<a class="btn" href="https://wa.me/${esc(wa)}">WhatsApp</a>` : ""}
        ${site ? `<a class="btn sec" href="${esc(site)}">Web</a>` : ""}
      </div>
    </div>
  </article>
</main>
</body>
</html>`;
}
