// Loyalty card pages: join screen, the web card customers keep on their phone, the staff scanner,
// and the card's web manifest. Self-contained HTML strings on the Polar Marketing design system.
// The card face is rendered by `kit()`, which runs on the server for the first paint and (stringified)
// in the browser for live refreshes, so both always draw the same thing.
import QRCode from "qrcode";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// JSON safe inside <script>
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const safeHex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v ?? "") ? v : d);
const safeFile = (f) => (f && /^[\w.\-]+$/.test(f) ? f : "");

// QR as an inline SVG, generated synchronously
export function qrInline(text, label = "QR code") {
  const q = QRCode.create(String(text), { errorCorrectionLevel: "M" });
  const n = q.modules.size, d = q.modules.data;
  let p = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; ) {
      if (!d[y * n + x]) { x++; continue; }
      let w = 1;
      while (x + w < n && d[y * n + x + w]) w++;
      p += `M${x} ${y}h${w}v1h-${w}z`;
      x += w;
    }
  }
  return `<svg class="qr" viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><path d="${p}" fill="#111"/></svg>`;
}

// ---- Card face renderer: pure functions, no outer references, so it can be stringified into the page ----
function kit() {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const col = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : d);
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgba = (h, a) => `rgba(${rgb(h).join(",")},${a})`;
  const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const on = (h) => (lum(h) > 0.4 ? "#111111" : "#ffffff");
  const FONTS = {
    modern: `'Figtree','Segoe UI',system-ui,sans-serif`,
    serif: `'Fraunces','Iowan Old Style',Georgia,serif`,
    rounded: `'Nunito','SF Pro Rounded',ui-rounded,'Segoe UI',system-ui,sans-serif`,
    mono: `ui-monospace,'SF Mono',Menlo,Consolas,monospace`,
  };
  const CHK = `<svg class="pm-ic pm-ic--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
  const file = (f) => (f && /^[\w.\-]+$/.test(f) ? "/media/" + f : "");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const layoutOf = (d) => (["stripe", "full", "minimal"].includes(d?.layout) ? d.layout : "stripe");

  // CSS variables for one design (every colour sanitised to #rrggbb)
  const vars = (d) => {
    d = d || {};
    const bg = col(d.background, "#14232b"), fg = col(d.foreground, "#ffffff"), lb = col(d.label, "#a9c1c8"), ac = col(d.accent, "#3dd6d0");
    const img = layoutOf(d) === "full" ? file(d.backgroundFile) : layoutOf(d) === "stripe" ? file(d.stripFile) : "";
    return `--bg:${bg};--fg:${fg};--lb:${lb};--ac:${ac};--on-ac:${on(ac)};--fg18:${rgba(fg, 0.18)};--fg35:${rgba(fg, 0.35)};--fg60:${rgba(fg, 0.6)};--ac35:${rgba(ac, 0.35)};--s1:${rgba(bg, 0.5)};--s2:${rgba(bg, 0.88)};--font:${FONTS[d.fontStyle] || FONTS.modern};${img ? `--img:url(${img});` : ""}`;
  };
  const cls = (d) => `wc ${layoutOf(d)}${(layoutOf(d) === "full" && file(d?.backgroundFile)) || (layoutOf(d) === "stripe" && file(d?.stripFile)) ? " has-img" : ""}`;

  const grid = (goal, filled, d) => {
    goal = Math.max(1, Math.min(40, goal | 0));
    const cols = goal <= 5 ? goal : goal <= 10 ? Math.ceil(goal / 2) : goal <= 12 ? 6 : goal <= 20 ? 5 : 8;
    const on_ = esc(d.stampIcon || "\u2605"), off = esc(d.stampEmptyIcon || "\u25CB");
    let h = `<div class="wc-grid" style="--cols:${cols}" role="img" aria-label="${esc(filled + " of " + goal + " stamps")}">`;
    for (let i = 0; i < goal; i++) h += i < filled ? `<span class="wc-st on">${on_}</span>` : `<span class="wc-st off">${off}</span>`;
    return h + "</div>";
  };

  const tierBar = (v) => {
    const c = v.customer, tiers = v.program.tiers || [];
    if (!c.tier && !c.nextTier) return "";
    const cur = tiers.find((t) => t.name === c.tier), nx = c.nextTier && tiers.find((t) => t.name === c.nextTier.name);
    let pct = 100;
    if (nx) { const lo = cur ? cur.minPoints : 0, span = nx.minPoints - lo; pct = span > 0 ? Math.max(4, Math.min(100, ((c.lifetimePoints - lo) / span) * 100)) : 100; }
    return `<div class="wc-tier"><div class="wc-tier-row"><span>${esc(c.tier || "Member")}</span>${c.nextTier ? `<span class="wc-dim">${plural(c.nextTier.pointsToGo, "point")} to ${esc(c.nextTier.name)}</span>` : `<span class="wc-dim">Top tier</span>`}</div><div class="wc-bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>`;
  };

  // The dynamic part of the card (everything but the QR tile)
  const face = (v, opts) => {
    opts = opts || {};
    const d = v.program.design || {}, c = v.customer, p = v.program, lay = layoutOf(d);
    const logo = file(d.logoFile), biz = v.business.name || "";
    const ready = (v.rewards || []).filter((r) => r.available).length;
    const mark = logo ? `<img class="wc-logo" src="${esc(logo)}" alt="">` : `<span class="wc-logo wc-mono">${esc((biz.trim()[0] || "?").toUpperCase())}</span>`;
    let h = `<div class="wc-top">${mark}<span class="wc-biz">${esc(biz)}</span>${ready && !opts.preview ? `<span class="wc-ready">${ready} ready</span>` : ""}</div>`;
    h += `<div class="wc-head"><h2 class="wc-title">${esc(d.cardTitle || p.name)}</h2>${d.tagline ? `<p class="wc-tag">${esc(d.tagline)}</p>` : ""}</div>`;
    if (lay === "stripe") h += `<div class="wc-strip" aria-hidden="true"></div>`;
    h += `<div class="wc-bal">`;
    if (p.type === "stamps") {
      h += `<div class="wc-lab"><span>Stamps</span><b>${c.stamps} / ${p.stamps?.goal || 0}</b></div>${grid(p.stamps?.goal || 8, Math.min(c.stamps, p.stamps?.goal || 8), d)}`;
    } else if (p.type === "points") {
      h += `<div class="wc-lab"><span>Points</span></div><div class="wc-pts">${c.points}</div>${tierBar(v)}`;
    } else {
      h += `<div class="wc-pts-row"><div><div class="wc-lab"><span>Points</span></div><div class="wc-pts">${c.points}</div></div><div class="wc-lab right"><span>Stamps</span><b>${c.stamps} / ${p.stamps?.goal || 0}</b></div></div>${grid(p.stamps?.goal || 8, Math.min(c.stamps, p.stamps?.goal || 8), d)}${tierBar(v)}`;
    }
    h += `</div><div class="wc-who"><div><div class="wc-lab"><span>Member</span></div><div class="wc-name">${esc(c.name)}</div></div>${c.visits != null && !opts.preview ? `<div class="right"><div class="wc-lab"><span>Visits</span></div><div class="wc-name">${c.visits}</div></div>` : ""}</div>`;
    return h;
  };

  const need = (r, p) => {
    const def = (p.rewards || []).find((x) => x.id === r.id) || {};
    if (r.available) return { ok: true, text: "Ready to claim", pct: 100, def };
    if (r.remaining <= 0) return { ok: false, text: def.minTier ? "Unlocks at " + def.minTier : "Not available yet", pct: 100, def };
    const left = r.kind === "stamps" ? plural(r.remaining, "more stamp") : plural(r.remaining, "more point");
    return { ok: false, text: left, pct: Math.max(0, Math.min(100, ((r.cost - r.remaining) / r.cost) * 100)), def };
  };
  const rewards = (v) => {
    const list = v.rewards || [];
    if (!list.length) return `<p class="muted">No rewards yet. Check back soon.</p>`;
    return list.map((r) => {
      const n = need(r, v.program);
      const cost = r.kind === "stamps" ? plural(r.cost, "stamp") : plural(r.cost, "point");
      return `<li class="rw${n.ok ? " ready" : ""}"><div class="rw-row"><div><b>${esc(r.name)}</b>${n.def.description ? `<div class="muted sm">${esc(n.def.description)}</div>` : ""}</div><span class="rw-cost">${cost}</span></div><div class="rw-bar"><i style="width:${n.pct.toFixed(1)}%"></i></div><div class="rw-foot ${n.ok ? "ok" : ""}">${n.ok ? CHK + " " : ""}${esc(n.text)}${n.ok ? `<span class="muted sm"> Show this card at the till${n.def.expiresDays ? ", valid " + n.def.expiresDays + " days once claimed" : ""}.</span>` : ""}</div></li>`;
    }).join("");
  };

  const LABEL = { join: "Joined", visit: "Visit", purchase: "Purchase", redeem: "Reward claimed", adjust: "Adjustment" };
  const fmt = (at) => { try { return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); } catch { return ""; } };
  const history = (v) => {
    const list = v.history || [];
    if (!list.length) return `<p class="muted">Nothing yet. Your visits will show up here.</p>`;
    return list.slice(0, 20).map((x) => {
      const bits = [];
      if (x.stamps) bits.push((x.stamps > 0 ? "+" : "\u2212") + plural(Math.abs(x.stamps), "stamp"));
      if (x.points) bits.push((x.points > 0 ? "+" : "\u2212") + plural(Math.abs(x.points), "point"));
      return `<li><div><b>${esc(LABEL[x.type] || x.type)}</b>${x.note ? `<div class="muted sm">${esc(x.note)}</div>` : ""}</div><div class="hr"><span class="${x.stamps < 0 || x.points < 0 ? "neg" : "pos"}">${esc(bits.join(", "))}</span><span class="muted sm">${esc(fmt(x.at))}</span></div></li>`;
    }).join("");
  };

  return { esc, vars, cls, face, rewards, history, col, layoutOf, file };
}
const K = kit();
const KIT_SRC = `(${kit.toString()})()`;

// Shared card CSS (the card itself is drawn only from the design's own colours, never the page theme)
export const cardStyles = `
.wc{--r:28px;position:relative;isolation:isolate;overflow:hidden;border-radius:var(--r);background:var(--bg);color:var(--fg);font-family:var(--font);max-width:400px;margin:0 auto;box-shadow:0 28px 50px -24px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.08);text-align:left}
.wc.full.has-img{background-image:linear-gradient(var(--s1),var(--s2)),var(--img);background-size:cover;background-position:center}
.wc *{box-sizing:border-box}
.wc-top{display:flex;align-items:center;gap:10px;padding:18px 20px 0}
.wc-logo{width:36px;height:36px;border-radius:10px;object-fit:cover;flex:none;background:var(--fg18)}
.wc-mono{display:grid;place-items:center;background:var(--ac);color:var(--on-ac);font:800 17px var(--font)}
.wc-biz{flex:1;min-width:0;font:700 15px/1.2 var(--font);letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-ready{flex:none;background:var(--ac);color:var(--on-ac);border-radius:999px;padding:5px 11px;font:700 12px/1 var(--font)}
.wc-head{padding:14px 20px 0}
.wc-title{margin:0;font:800 clamp(24px,7.4vw,30px)/1.08 var(--font);letter-spacing:-.015em;text-wrap:balance}
.wc-tag{margin:6px 0 0;color:var(--lb);font:500 14px/1.35 var(--font)}
.wc-strip{height:128px;margin-top:16px;background:linear-gradient(120deg,var(--ac),var(--ac35));background-size:cover;background-position:center}
.wc.has-img .wc-strip{background:var(--img) center/cover}
.wc.minimal .wc-head{padding-bottom:2px}
.wc-bal{padding:18px 20px 4px}
.wc-lab{display:flex;gap:8px;align-items:baseline;color:var(--lb);font:700 11px/1 var(--font);letter-spacing:.09em;text-transform:uppercase}
.wc-lab b{color:var(--fg);font-size:13px;letter-spacing:.02em;margin-left:auto}
.wc-lab.right{flex-direction:column;align-items:flex-end;gap:7px}
.wc-lab.right b{margin:0;font-size:22px}
.wc-pts{font:800 clamp(48px,16vw,64px)/1 var(--font);letter-spacing:-.03em;margin:8px 0 2px;font-variant-numeric:tabular-nums}
.wc-pts-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
.wc-pts-row .wc-pts{margin-bottom:0}
.wc-grid{display:grid;grid-template-columns:repeat(var(--cols),1fr);gap:8px;margin-top:12px}
.wc-st{aspect-ratio:1;border-radius:50%;display:grid;place-items:center;font:600 clamp(16px,5.4vw,24px)/1 var(--font);min-width:0;overflow:hidden}
.wc-st.on{background:var(--ac);color:var(--on-ac);box-shadow:0 4px 10px -4px var(--ac)}
.wc-st.off{border:2px dashed var(--fg35);color:var(--fg60)}
.wc-tier{margin-top:14px}
.wc-tier-row{display:flex;justify-content:space-between;gap:10px;font:700 14px/1.2 var(--font);margin-bottom:8px}
.wc-dim{color:var(--lb);font-weight:600;font-size:13px}
.wc-bar{height:8px;border-radius:99px;background:var(--fg18);overflow:hidden}
.wc-bar i{display:block;height:100%;background:var(--ac);border-radius:99px;transition:width .4s}
.wc-who{display:flex;justify-content:space-between;gap:16px;padding:18px 20px 16px}
.wc-who .right{text-align:right}
.wc-name{margin-top:6px;font:700 18px/1.15 var(--font);overflow-wrap:anywhere}
.wc-qr{margin:0 14px 14px;border-radius:20px;background:#fff;color:#111;padding:14px 14px 10px;display:grid;justify-items:center;gap:6px;width:calc(100% - 28px);border:0;cursor:pointer;font-family:var(--font)}
.wc-qr .qr{width:min(100%,210px);height:auto;display:block}
.wc-code{font:600 12px/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.06em;color:#333;overflow-wrap:anywhere;text-align:center}
.wc-qr small{font:600 12px var(--font);color:#555}
.wc-qr.ph{background:rgba(255,255,255,.1);color:var(--fg60);cursor:default;border:2px dashed var(--fg35);min-height:120px;align-content:center;font:600 14px/1.4 var(--font);text-align:center;padding:18px}
`;

const HEAD_COMMON = (title) => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="color-scheme" content="light dark">
<script src="/brand/theme.js"></script>
<link rel="icon" href="/brand/logo/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/logo/favicon.ico" sizes="48x48">
<link rel="stylesheet" href="/brand/tokens.css">
<link rel="stylesheet" href="/brand/components.css">`;

const BASE_CSS = `
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh}
[hidden]{display:none!important}
.wrap{max-width:520px;margin:0 auto;padding:max(var(--space-4),env(safe-area-inset-top)) max(var(--space-4),env(safe-area-inset-right)) max(var(--space-7),env(safe-area-inset-bottom)) max(var(--space-4),env(safe-area-inset-left))}
.muted{color:var(--ink-2)}.sm{font-size:13px;line-height:18px}
.sec{margin-top:var(--space-4)}
.sec h3{font:700 19px/24px var(--font-display);margin:0 0 var(--space-3);letter-spacing:-.005em}
.err{display:none;margin:0 0 var(--space-4);padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);background:var(--bad-soft);color:var(--bad);font:600 15px/22px var(--font-sans)}
.err.on{display:block}
@media(prefers-reduced-motion:reduce){*{animation-duration:2s!important;transition:none!important}}
`;

// ---------- Join page ----------
export function joinPage({ program, client, baseUrl = "" }) {
  const design = program.design || {};
  const live = program.status === "live";
  const bizName = client?.name || "";
  const sample = {
    business: { name: bizName },
    program: { id: program.id, name: program.name, type: program.type, design, stamps: { goal: program.stamps?.goal || 8 }, tiers: program.tiers || [], rewards: [] },
    customer: { id: "", name: "Your name", stamps: Math.min(2, Math.max(0, (program.stamps?.goal || 8) - 1)), points: 0, lifetimePoints: 0, tier: (program.tiers || [])[0]?.name || "", nextTier: null, visits: 0 },
    rewards: [],
  };
  if (program.type === "points") sample.customer.stamps = 0;
  const bonus = program.welcomeBonus || {};
  const bonusTxt = [bonus.stamps > 0 ? `${bonus.stamps} free stamp${bonus.stamps === 1 ? "" : "s"}` : "", bonus.points > 0 ? `${bonus.points} bonus point${bonus.points === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
  const logo = safeFile(design.logoFile);
  const themeColor = safeHex(design.background, "#14232b");
  const preview = `<div class="${K.cls(design)}" style="${esc(K.vars(design))}">${K.face(sample, { preview: true })}<div class="wc-qr ph">Your QR code appears here once you join</div></div>`;
  const rewardsList = (program.rewards || []).filter((r) => r.active !== false).slice(0, 4);
  return `<!doctype html>
<html lang="en">
<head>
${HEAD_COMMON(`Join ${program.name} - ${bizName}`)}
<meta name="theme-color" content="${themeColor}">
<meta name="robots" content="noindex">
<meta name="description" content="${esc(design.tagline || `Join ${bizName}'s loyalty card`)}">
${logo ? `<link rel="apple-touch-icon" href="/media/${esc(logo)}">` : ""}
<style>${BASE_CSS}${cardStyles}
.jh{text-align:center;margin:var(--space-2) 0 var(--space-5)}
.jh h1{font:700 clamp(26px,7.5vw,34px)/1.08 var(--font-display);letter-spacing:-.015em;margin:0 0 var(--space-2)}
.jh p{margin:0;color:var(--ink-2);font-size:17px;line-height:26px}
.bonus{margin:var(--space-5) 0 0;padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);background:var(--good-soft);color:var(--good);font:600 15px/22px var(--font-sans);text-align:center}
form.cr-card{margin-top:var(--space-5);padding:var(--space-5) var(--space-4)}
.f{margin-bottom:var(--space-4)}
.check{display:flex;gap:12px;align-items:flex-start;margin:0 0 var(--space-4);font:400 15px/22px var(--font-sans);cursor:pointer;min-height:var(--tap)}
.check input{flex:none;width:24px;height:24px;margin:0;accent-color:var(--brand)}
.rl{list-style:none;margin:0;padding:0;display:grid;gap:var(--space-2)}
.rl li{display:flex;justify-content:space-between;gap:12px;font-weight:600}
.rl span{color:var(--ink-2);font-weight:500;white-space:nowrap}
.spin{width:18px;height:18px;border:3px solid var(--on-brand);border-top-color:transparent;border-radius:50%;animation:sp .8s linear infinite;display:none}
.cr-btn.busy .spin{display:block}
@keyframes sp{to{transform:rotate(360deg)}}
.closed{text-align:center;margin-top:var(--space-5)}
.closed h2{font:700 24px/30px var(--font-display);margin:0 0 var(--space-2)}
.again{margin:0 0 var(--space-4);padding:var(--space-4);border-radius:var(--radius-md);background:var(--brand-soft);color:var(--brand-ink);font:600 15px/22px var(--font-sans);display:flex;gap:12px;align-items:center;justify-content:space-between}
.again a{color:inherit;white-space:nowrap}
.terms{margin:var(--space-4) 0 0;color:var(--ink-2);font-size:13px;line-height:19px;white-space:pre-line}
.foot{margin:var(--space-6) auto 0;display:flex;flex-direction:column;align-items:center;gap:var(--space-3);color:var(--ink-2);font-size:13px}
.foot .by{display:inline-flex;align-items:center;gap:8px;font-weight:600}
.foot .pm-logo{width:24px;height:24px;border-radius:7px}
</style>
</head>
<body class="cr-root">
<div class="wrap">
  <header class="jh">
    <h1>${esc(live ? `Join ${program.name}` : program.name)}</h1>
    <p>${esc(bizName)}${design.tagline ? ` &middot; ${esc(design.tagline)}` : ""}</p>
  </header>
  <div id="again" class="again" hidden><span>You already have this card on this device.</span><a id="againLink" href="#">Open it</a></div>
  ${preview}
  ${live ? `
  ${bonusTxt ? `<p class="bonus">Join today and start with ${esc(bonusTxt)}.</p>` : ""}
  ${rewardsList.length ? `<section class="sec cr-card"><h3>What you can earn</h3><ul class="rl">${rewardsList.map((r) => `<li><b>${esc(r.name)}</b><span>${esc(r.kind === "stamps" ? `${r.cost} stamp${r.cost === 1 ? "" : "s"}` : `${r.cost} points`)}</span></li>`).join("")}</ul></section>` : ""}
  <form id="f" class="cr-card" novalidate>
    <div id="err" class="err" role="alert"></div>
    <div class="f cr-field"><label class="cr-label" for="name">Your name</label><input class="cr-input" id="name" name="name" type="text" autocomplete="name" maxlength="80" required></div>
    <div class="f cr-field"><label class="cr-label" for="email">Email</label><input class="cr-input" id="email" name="email" type="email" autocomplete="email" inputmode="email" maxlength="120" required></div>
    <div class="f cr-field"><label class="cr-label" for="phone">Phone <span class="muted">(optional)</span></label><input class="cr-input" id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="40"></div>
    <label class="check"><input type="checkbox" id="consent"><span>Send me offers and news from ${esc(bizName)}. I can stop at any time.</span></label>
    <button class="cr-btn cr-btn--primary cr-btn--lg cr-btn--block" id="go" type="submit"><span class="spin"></span><span id="goTxt">Get my card</span></button>
    ${program.terms ? `<p class="terms">${esc(program.terms)}</p>` : ""}
  </form>` : `
  <section class="closed cr-card"><h2>Not open yet</h2><p class="muted">${esc(bizName)} is still setting up this card. Please check back soon, or ask at the till.</p></section>`}
  <footer class="foot"><div id="themeSel"></div><span class="by"><img class="pm-logo" src="/brand/logo/polar-mark.png" alt="">Powered by Polar Marketing</span> <a href="/privacy" style="font-size:.8em;opacity:.7">Privacy</a></footer>
</div>
<script>if(window.PolarTheme)PolarTheme.mount(document.getElementById("themeSel"),document.documentElement.lang)</script>
${live ? `<script>
(function(){
var code=${js(program.joinCode || "")},$=function(i){return document.getElementById(i)},f=$("f"),err=$("err"),go=$("go"),KEY="lc-card-"+code;
try{var saved=localStorage.getItem(KEY);if(saved&&/^\\/card\\/[\\w-]+$/.test(saved)){$("againLink").href=saved;$("again").hidden=false}}catch(e){}
function show(m){err.textContent=m;err.classList.add("on");err.scrollIntoView({block:"nearest",behavior:"smooth"})}
f.addEventListener("submit",function(e){
  e.preventDefault();err.classList.remove("on");
  var name=$("name").value.trim();
  if(!name){show("Please enter your name.");$("name").focus();return}
  var em=$("email").value.trim();
  if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(em)){show("Please enter a valid email address.");$("email").focus();return}
  go.disabled=true;go.classList.add("busy");$("goTxt").textContent="Creating your card";
  fetch("/api/loyalty/join/"+encodeURIComponent(code),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name,email:$("email").value.trim(),phone:$("phone").value.trim(),marketingConsent:$("consent").checked})})
  .then(function(r){return r.json().catch(function(){return {}}).then(function(d){return {ok:r.ok,d:d}})})
  .then(function(x){
    if(!x.ok||!x.d.cardUrl)throw new Error(x.d.error||"Something went wrong. Please try again.");
    try{localStorage.setItem(KEY,x.d.cardUrl)}catch(e){}
    location.href=x.d.cardUrl;
  })
  .catch(function(e){go.disabled=false;go.classList.remove("busy");$("goTxt").textContent="Get my card";show(e&&e.message&&e.message!=="Failed to fetch"?e.message:"We couldn't reach the server. Check your connection and try again.")});
});
})();
</script>` : ""}
</body>
</html>`;
}

// ---------- Card page ----------
const tokenOf = (url) => (/\/card\/([\w-]+)/.exec(url || "") || [])[1] || "";

export function manifest(view) {
  const d = view.program?.design || {};
  const bg = safeHex(d.background, "#14232b");
  const name = d.cardTitle ? `${view.business?.name || ""} ${d.cardTitle}`.trim() : view.business?.name || view.program?.name || "Loyalty card";
  const logo = safeFile(d.logoFile);
  const token = tokenOf(view.installUrl);
  const m = {
    name,
    short_name: (view.business?.name || view.program?.name || "Card").slice(0, 12),
    description: d.tagline || `${view.program?.name || "Loyalty"} card`,
    start_url: token ? `/card/${token}` : view.installUrl || "/",
    scope: token ? `/card/${token}` : "/",
    id: token ? `/card/${token}` : undefined,
    display: "standalone",
    background_color: bg,
    theme_color: bg,
  };
  if (logo) {
    const type = /\.png$/i.test(logo) ? "image/png" : /\.jpe?g$/i.test(logo) ? "image/jpeg" : /\.webp$/i.test(logo) ? "image/webp" : /\.svg$/i.test(logo) ? "image/svg+xml" : undefined;
    m.icons = [192, 512].map((s) => ({ src: `/media/${logo}`, sizes: `${s}x${s}`, ...(type ? { type } : {}), purpose: "any" }));
  }
  if (!m.id) delete m.id;
  return m;
}

export function cardPage({ view, baseUrl = "" }) {
  const d = view.program?.design || {};
  const token = tokenOf(view.installUrl);
  const bg = safeHex(d.background, "#14232b");
  const logo = safeFile(d.logoFile);
  const title = `${d.cardTitle || view.program.name} - ${view.business.name}`;
  const wallet = view.wallet?.available && view.wallet.url;
  const google = view.wallet?.google?.available && view.wallet.google.url;
  const inactive = view.program.status && view.program.status !== "live";
  return `<!doctype html>
<html lang="en">
<head>
${HEAD_COMMON(title)}
<meta name="theme-color" content="${bg}">
<meta name="robots" content="noindex,nofollow">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${esc((view.business.name || "Card").slice(0, 14))}">
<link rel="manifest" id="mf" href="${token ? `/card/${esc(token)}/manifest.webmanifest` : ""}">
${logo ? `<link rel="apple-touch-icon" href="/media/${esc(logo)}">` : ""}
<style>${BASE_CSS}${cardStyles}
body{background:var(--bg)}
.wrap{padding-top:max(var(--space-5),env(safe-area-inset-top))}
.card-slot{perspective:900px}
.notice{margin:0 0 var(--space-4);padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);background:var(--warn-soft);color:var(--warn);font:600 15px/22px var(--font-sans);text-align:center}
.apple{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;max-width:400px;margin:var(--space-4) auto 0;min-height:54px;border-radius:999px;background:#000;color:#fff;font:600 17px/1 var(--font-sans);text-decoration:none;border:1px solid rgba(255,255,255,.25)}
.apple svg{width:20px;height:20px;fill:currentColor}
.apple:active{transform:scale(.98)}
.bk{display:flex;align-items:center;justify-content:center;width:100%;max-width:400px;margin:var(--space-4) auto 0;min-height:54px;border-radius:999px;background:var(--brand);color:var(--on-brand);font:700 17px/1 var(--font-sans);text-decoration:none}
.bk:active{transform:scale(.98)}
.panels{max-width:400px;margin:0 auto}
.panel{margin-top:var(--space-4);padding:var(--space-4) var(--space-4) var(--space-3)}
.panel h3{margin:0 0 var(--space-3);font:700 19px/24px var(--font-display)}
ul.list{list-style:none;margin:0;padding:0}
.rw{padding:var(--space-3) 0;border-top:1px solid var(--line)}
.rw:first-child{border-top:0;padding-top:0}
.rw-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.rw-cost{flex:none;font:600 13px/1 var(--font-mono);color:var(--ink-2);background:var(--surface-2);padding:6px 10px;border-radius:999px}
.rw-bar{height:8px;border-radius:99px;background:var(--surface-2);margin:10px 0 8px;overflow:hidden}
.rw-bar i{display:block;height:100%;background:var(--brand);border-radius:99px;transition:width .4s}
.rw.ready .rw-bar i{background:var(--good)}
.rw-foot{font:600 14px/20px var(--font-sans);color:var(--ink-2)}
.rw-foot.ok{color:var(--good)}
.rw-foot .muted{font-weight:400}
.rw.ready{background:var(--good-soft);margin:0 calc(var(--space-3) * -1);padding:var(--space-3);border-radius:var(--radius-md);border-top:0}
.hist li{display:flex;justify-content:space-between;gap:12px;padding:var(--space-3) 0;border-top:1px solid var(--line)}
.hist li:first-child{border-top:0;padding-top:0}
.hist .hr{display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:right;font-weight:600;font-size:14px}
.pos{color:var(--good)}.neg{color:var(--bad)}
.hint h3{margin-bottom:var(--space-2)}
.hint ol{margin:var(--space-2) 0 0;padding-left:22px;line-height:26px}
.hint kbd{display:inline-flex;vertical-align:middle;font:600 13px var(--font-sans);background:var(--surface-2);border-radius:6px;padding:2px 7px}
.terms{margin:0;color:var(--ink-2);font-size:13px;line-height:19px;white-space:pre-line}
details.panel summary{font:700 16px/24px var(--font-display);cursor:pointer;min-height:32px}
.status{max-width:400px;margin:var(--space-5) auto 0;text-align:center;color:var(--ink-2);font-size:13px}
.status.off{color:var(--warn)}
.foot{max-width:400px;margin:var(--space-5) auto 0;display:flex;flex-direction:column;align-items:center;gap:var(--space-3);color:var(--ink-2);font-size:13px}
.foot .by{display:inline-flex;align-items:center;gap:8px;font-weight:600}
.foot .pm-logo{width:24px;height:24px;border-radius:7px}
.qfull{position:fixed;inset:0;z-index:50;background:#fff;color:#111;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center;font-family:var(--font-sans);border:0;width:100%;cursor:pointer}
.qfull.on{display:flex}
.qfull .qr{width:min(88vw,70vh,420px);height:auto}
.qfull b{font:600 17px var(--font-mono);letter-spacing:.06em}
.qfull span{font:600 15px var(--font-sans);color:#555}
</style>
</head>
<body class="cr-root">
<div class="wrap">
  ${inactive ? `<p class="notice">This card is paused for now. Your balance is safe.</p>` : ""}
  <div class="card-slot">
    <div id="card" class="${K.cls(d)}" style="${esc(K.vars(d))}">
      <div id="face">${K.face(view)}</div>
      <button class="wc-qr" id="qrBtn" type="button" aria-label="Show a bigger QR code">${qrInline(view.code, "Your loyalty card QR code")}<span class="wc-code">${esc(view.code)}</span><small>Tap to enlarge</small></button>
    </div>
  </div>
  ${wallet ? `<a class="apple" href="${esc(wallet)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5V8H3V6.5zM3 10h18v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5V10zm12 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>Add to Apple Wallet</a>` : ""}
  ${google ? `<a class="apple gpay" href="${esc(google)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5V8H3V6.5zM3 10h18v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5V10zm12 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>Add to Google Wallet</a>` : ""}
  ${view.booking?.url ? `<a class="bk" id="bk" href="${esc(view.booking.url)}" data-es="${view.booking.kind === "room" ? "Reservar habitación" : "Reservar mesa"}">${view.booking.kind === "room" ? "Book a room" : "Book a table"}</a>` : ""}
  ${view.menu?.url ? `<a class="bk" id="mn" href="${esc(view.menu.url)}" data-es="Carta">Menu</a>` : ""}
  <div class="panels">
    <section class="panel cr-card"><h3>Rewards</h3><ul class="list" id="rewards">${K.rewards(view)}</ul></section>
    <section class="panel cr-card"><h3>Activity</h3><ul class="list hist" id="history">${K.history(view)}</ul></section>
    ${wallet || google ? "" : `<section class="panel cr-card hint" id="hint" hidden>
      <h3>Keep this card on your phone</h3>
      <p class="muted sm" style="margin:0" id="hintLead">Add it to your home screen to open it in one tap.</p>
      <ol id="hintIos" hidden><li>Tap the Share button <kbd><svg class="pm-ic pm-ic--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></kbd> in Safari.</li><li>Choose <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol>
      <ol id="hintAnd" hidden><li>Tap the menu <kbd><svg class="pm-ic pm-ic--sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg></kbd> in Chrome.</li><li>Choose <b>Add to Home screen</b> (or <b>Install app</b>).</li><li>Tap <b>Add</b>.</li></ol>
      <ol id="hintDesk" hidden><li>Open this same link on your phone.</li><li>Then add it to your home screen.</li></ol>
    </section>`}
    ${view.program.terms ? `<details class="panel cr-card"><summary>Terms</summary><p class="terms" style="margin-top:12px">${esc(view.program.terms)}</p></details>` : ""}
  </div>
  <p class="status" id="status" aria-live="polite"></p>
  <footer class="foot"><div id="themeSel"></div><span class="by"><img class="pm-logo" src="/brand/logo/polar-mark.png" alt="">Powered by Polar Marketing</span> <a href="/privacy" style="font-size:.8em;opacity:.7">Privacy</a></footer>
</div>
<button class="qfull" id="qfull" type="button" aria-label="Close"><b>${esc(view.customer.name)}</b>${qrInline(view.code, "Your loyalty card QR code")}<b>${esc(view.code)}</b><span>Tap anywhere to close</span></button>
<script>
(function(){
var K=${KIT_SRC},view=${js(view)},$=function(i){return document.getElementById(i)};
var parts=location.pathname.split("/").filter(Boolean),token=parts[0]==="card"?parts[1]:${js(token)};
if(token&&!$("mf").getAttribute("href"))$("mf").setAttribute("href","/card/"+token+"/manifest.webmanifest");
var last=JSON.stringify(view),failed=0,lastOk=Date.now();
function put(id,html){var e=$(id);if(e&&e.__h!==html){if(e.__h===undefined&&e.innerHTML===html){e.__h=html;return}e.innerHTML=html;e.__h=html}}
function paint(v){
  var d=v.program.design||{},c=$("card");
  c.className=K.cls(d);c.setAttribute("style",K.vars(d));
  put("face",K.face(v));put("rewards",K.rewards(v));put("history",K.history(v));
  var tc=document.querySelector('meta[name=theme-color]');if(tc)tc.content=K.col(d.background,"#14232b");
}
function status(){
  var s=$("status");
  if(failed>1){s.className="status off";s.textContent="Offline. Showing your last saved balance."}
  else{s.className="status";var m=Math.round((Date.now()-lastOk)/60000);s.textContent=m<1?"Up to date":"Updated "+m+" min ago"}
}
var busy=false;
function refresh(){
  if(busy||!token||document.hidden)return;busy=true;
  fetch("/api/loyalty/card/"+encodeURIComponent(token),{cache:"no-store",headers:{Accept:"application/json"}})
  .then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})
  .then(function(v){failed=0;lastOk=Date.now();var s=JSON.stringify(v);if(s!==last){last=s;view=v;paint(v)}status()})
  .catch(function(){failed++;status()})
  .then(function(){busy=false});
}
setInterval(refresh,15000);setInterval(status,30000);
addEventListener("focus",refresh);
document.addEventListener("visibilitychange",function(){if(!document.hidden){refresh();if($("qfull").classList.contains("on"))wake()}});
addEventListener("online",refresh);
status();
if(window.PolarTheme)PolarTheme.mount($("themeSel"),document.documentElement.lang);
addEventListener("polar-theme",function(){var tc=document.querySelector('meta[name=theme-color]');if(tc)tc.content=K.col((view.program.design||{}).background,"#14232b")});
var tc0=document.querySelector('meta[name=theme-color]');if(tc0)tc0.content=K.col((view.program.design||{}).background,"#14232b");
var bk=$("bk"),mn=$("mn");if(bk&&/^es/i.test(navigator.language||"")){bk.textContent=bk.getAttribute("data-es");document.documentElement.lang="es"}if(mn&&/^es/i.test(navigator.language||"")){mn.textContent=mn.getAttribute("data-es");document.documentElement.lang="es"}
// big QR on a white screen, kept awake
var lock=null;
function wake(){try{if(navigator.wakeLock)navigator.wakeLock.request("screen").then(function(l){lock=l}).catch(function(){})}catch(e){}}
$("qrBtn").addEventListener("click",function(){$("qfull").classList.add("on");wake()});
$("qfull").addEventListener("click",function(){$("qfull").classList.remove("on");try{lock&&lock.release();lock=null}catch(e){}});
// add to home screen hint
var h=$("hint");
if(h){
  var ua=navigator.userAgent||"",ios=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1),and=/Android/.test(ua);
  var standalone=(navigator.standalone===true)||matchMedia("(display-mode: standalone)").matches;
  if(!standalone){h.hidden=false;$(ios?"hintIos":and?"hintAnd":"hintDesk").hidden=false;if(!ios&&!and)$("hintLead").textContent="This card is made for your phone."}
}
})();
</script>
</body>
</html>`;
}

// ---------- Staff scanner ----------
export function staffPage({ program, client, baseUrl = "" }) {
  const bizName = client?.name || "";
  const d = program.design || {};
  const cfg = { name: program.name, business: bizName, type: program.type, minSpendEur: program.stamps?.minSpendEur || 0, live: program.status === "live", accent: safeHex(d.accent, "#3dd6d0"), bg: safeHex(d.background, "#14232b") };
  return `<!doctype html>
<html lang="en">
<head>
${HEAD_COMMON(`Scan - ${program.name} - ${bizName}`)}
<meta name="theme-color" content="#0e1316">
<meta name="robots" content="noindex,nofollow">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<style>${BASE_CSS}
body{overscroll-behavior-y:contain;-webkit-tap-highlight-color:transparent}
.wrap{max-width:480px;padding-bottom:calc(var(--space-8) * 3)}
.bar{display:flex;align-items:center;gap:12px;margin-bottom:var(--space-4)}
.dot{width:40px;height:40px;border-radius:12px;flex:none;display:grid;place-items:center;font:800 18px var(--font-display)}
.bar h1{margin:0;font:700 20px/24px var(--font-display);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar p{margin:0;font-size:14px;color:var(--ink-2)}
.tsel{display:flex;justify-content:center;margin:calc(var(--space-2) * -1) 0 var(--space-4)}
.x svg,.pad svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.x{display:inline-grid;place-items:center}
.pad button{display:grid;place-items:center}
.bar>div{min-width:0;flex:1}
.cam{position:relative;border-radius:var(--radius-lg);overflow:hidden;background:#000;aspect-ratio:1/1;display:none}
.cam.on{display:block}
.cam video{width:100%;height:100%;object-fit:cover;display:block}
.cam .aim{position:absolute;inset:18%;border:3px solid rgba(255,255,255,.9);border-radius:24px;box-shadow:0 0 0 999px rgba(0,0,0,.4)}
.cam .stop{position:absolute;right:12px;top:12px;min-height:40px;padding:0 14px;border-radius:99px;border:0;background:rgba(0,0,0,.6);color:#fff;font:700 14px var(--font-sans)}
.scan{display:grid;gap:var(--space-3)}
.scan .cr-btn svg,.act svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.manual{display:flex;gap:var(--space-2)}
.manual .cr-input{flex:1;min-width:0;font:600 17px var(--font-mono);text-transform:uppercase;letter-spacing:.04em}
.manual .cr-btn{flex:none;padding:0 var(--space-4)}
.note{margin:0;font-size:14px;color:var(--ink-2)}
.hits{list-style:none;margin:0;padding:0;display:grid;gap:var(--space-2)}
.hits li{list-style:none}
.hits .hit{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;min-height:56px;padding:var(--space-2) var(--space-3);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface-2);color:var(--ink);font:600 16px/20px var(--font-sans);text-align:left;cursor:pointer}
.hits .hit small{display:block;font:500 13px/18px var(--font-mono);color:var(--ink-2)}
.hits .none{margin:0;font-size:14px;color:var(--ink-2)}
.newCard{margin:0;font-size:15px}
.cust{margin-top:var(--space-4);padding:var(--space-4)}
.cust-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.cust h2{margin:0;font:700 26px/30px var(--font-display);overflow-wrap:anywhere}
.cust .meta{margin:4px 0 0;color:var(--ink-2);font-size:14px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-2);margin-top:var(--space-4)}
.stat{background:var(--surface-2);border-radius:var(--radius-md);padding:var(--space-3);text-align:center}
.stat b{display:block;font:700 26px/30px var(--font-display);font-variant-numeric:tabular-nums}
.stat span{font:600 12px/16px var(--font-sans);color:var(--ink-2);letter-spacing:.04em;text-transform:uppercase}
.rwds{margin:var(--space-4) 0 0;padding:0;list-style:none;display:grid;gap:var(--space-2)}
.rwds li{display:flex;justify-content:space-between;gap:10px;align-items:center;font:600 15px/20px var(--font-sans)}
.rwds .on{color:var(--good)}
.rwds .off{color:var(--ink-2);font-weight:500}
.sheet-bar{position:fixed;left:0;right:0;bottom:0;z-index:20;padding:var(--space-3) max(var(--space-4),env(safe-area-inset-right)) max(var(--space-3),env(safe-area-inset-bottom)) max(var(--space-4),env(safe-area-inset-left));background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line)}
.acts{max-width:480px;margin:0 auto;display:grid;gap:var(--space-2);grid-template-columns:1fr 1fr}
.acts .act{min-height:68px;font-size:18px;border-radius:22px}
.acts .act.full{grid-column:1/-1}
.act small{display:block;font:500 12px/14px var(--font-sans);opacity:.85}
.act .lbl{display:flex;flex-direction:column;align-items:flex-start;gap:2px}
.recent{margin-top:var(--space-5)}
.recent h3{font:700 17px/22px var(--font-display);margin:0 0 var(--space-2)}
.recent ul{list-style:none;margin:0;padding:0}
.recent li{display:flex;justify-content:space-between;gap:12px;padding:var(--space-3) 0;border-top:1px solid var(--line);font-size:15px}
.recent li span:last-child{color:var(--ink-2);font-size:13px;white-space:nowrap}
.modal{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.5);display:none;align-items:flex-end;justify-content:center}
.modal.on{display:flex}
.sheet{width:100%;max-width:480px;background:var(--surface);border-radius:28px 28px 0 0;padding:var(--space-4) var(--space-4) max(var(--space-4),env(safe-area-inset-bottom));max-height:92vh;overflow:auto;box-shadow:var(--shadow-pop)}
.sheet h3{margin:0 0 var(--space-3);font:700 20px/26px var(--font-display);display:flex;justify-content:space-between;align-items:center}
.x{border:0;background:var(--surface-2);color:var(--ink);width:40px;height:40px;border-radius:50%;cursor:pointer}
.amt{font:700 44px/1.1 var(--font-display);text-align:center;padding:var(--space-3) 0 var(--space-4);font-variant-numeric:tabular-nums}
.amt small{font-size:26px;color:var(--ink-2);margin-left:4px}
.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-2);margin-bottom:var(--space-3)}
.pad button{min-height:62px;border:0;border-radius:18px;background:var(--surface-2);color:var(--ink);font:700 26px var(--font-display);cursor:pointer}
.pad button:active{background:var(--line)}
.rbtn{width:100%;display:flex;justify-content:space-between;gap:12px;text-align:left;min-height:64px;padding:var(--space-3) var(--space-4);margin-bottom:var(--space-2);border-radius:var(--radius-md);border:2px solid var(--line);background:var(--surface);color:var(--ink);font:700 17px/22px var(--font-sans);cursor:pointer;align-items:center}
.rbtn:not([disabled]){border-color:var(--good);background:var(--good-soft);color:var(--good)}
.rbtn[disabled]{opacity:.55;cursor:not-allowed}
.rbtn small{display:block;font:500 13px/18px var(--font-sans);color:var(--ink-2)}
.toast{position:fixed;left:50%;top:max(var(--space-4),env(safe-area-inset-top));transform:translate(-50%,-140%);z-index:60;max-width:min(92vw,440px);width:max-content;padding:var(--space-3) var(--space-5);border-radius:var(--radius-md);font:700 16px/22px var(--font-sans);box-shadow:var(--shadow-pop);transition:transform .25s;text-align:center}
.toast.on{transform:translate(-50%,0)}
.toast.ok{background:var(--good-soft);color:var(--good);border:2px solid var(--good)}
.toast.bad{background:var(--bad-soft);color:var(--bad);border:2px solid var(--bad)}
.closed{text-align:center;padding:var(--space-6) var(--space-4)}
</style>
</head>
<body class="cr-root">
<div class="wrap">
  <header class="bar">
    <img class="pm-logo" src="/brand/logo/polar-mark.png" alt="">
    <div><h1>${esc(program.name)}</h1><p>${esc(bizName)} &middot; Staff</p></div>
  </header>
  <div class="tsel"><div id="themeSel"></div></div>
  ${cfg.live ? `
  <div id="err" class="err" role="alert"></div>
  <section class="scan">
    <div class="cam" id="cam"><video id="vid" playsinline webkit-playsinline muted autoplay></video><div class="aim"></div><button class="stop" id="stopCam" type="button">Stop</button></div>
    <button class="cr-btn cr-btn--primary cr-btn--lg cr-btn--block" id="startCam" type="button" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10"/></svg>Scan customer card</button>
    <p class="note" id="noCam" hidden>Camera scanning isn't available here (it needs a secure https page). Type the code under the QR instead.</p>
    <form class="manual" id="manual" autocomplete="off"><input class="cr-input" id="code" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="LC1-..." aria-label="Customer code"><button class="cr-btn cr-btn--soft" type="submit">Find</button></form>
    <form class="manual" id="ph" autocomplete="off"><input class="cr-input" id="phNum" inputmode="tel" autocomplete="off" placeholder="Phone or last 3 digits" aria-label="Customer phone number"><button class="cr-btn cr-btn--soft" type="submit">Search</button></form>
    <ul class="hits" id="hits" hidden></ul>
    <form class="manual" id="enrol" autocomplete="off" hidden><input class="cr-input" id="enName" maxlength="80" placeholder="First name (optional)" aria-label="Customer first name"><button class="cr-btn cr-btn--soft" type="submit">New card</button></form>
    <p class="newCard" id="newCard" hidden><a id="newCardLink" href="#" target="_blank" rel="noopener">Open the new card</a></p>
  </section>
  <section class="cust cr-card" id="cust" hidden>
    <div class="cust-top"><div><h2 id="cName"></h2><p class="meta" id="cMeta"></p></div><button class="x" id="clear" type="button" aria-label="Clear customer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <div class="stats" id="stats"></div>
    <ul class="rwds" id="rwds"></ul>
  </section>
  <section class="recent" id="recent" hidden><h3>Recent</h3><ul id="recentList"></ul></section>
  ` : `<section class="closed cr-card"><h2 class="display-md">Not live yet</h2><p class="muted">This programme is ${esc(program.status || "not live")}. Scanning is switched on once the owner makes it live.</p></section>`}
</div>
${cfg.live ? `
<div class="sheet-bar" id="bar" hidden><div class="acts" id="acts"></div></div>
<div class="modal" id="mAmt"><div class="sheet" role="dialog" aria-label="Purchase amount"><h3>Purchase amount <button class="x" data-close type="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></h3><div class="amt"><span id="amt">0</span><small>&euro;</small></div><div class="pad" id="pad"></div><button class="cr-btn cr-btn--primary cr-btn--lg cr-btn--block" id="amtOk" type="button">Add purchase</button></div></div>
<div class="modal" id="mRw"><div class="sheet" role="dialog" aria-label="Redeem a reward"><h3>Redeem a reward <button class="x" data-close type="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></h3><div id="rwList"></div></div></div>
` : ""}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
${cfg.live ? `<script>
(function(){
var CFG=${js(cfg)},$=function(i){return document.getElementById(i)};
if(window.PolarTheme)PolarTheme.mount($("themeSel"),document.documentElement.lang);
var parts=location.pathname.split("/").filter(Boolean),tok=parts[0]==="staff"?parts[1]:"";
var api="/api/loyalty/staff/"+encodeURIComponent(tok),cur=null,busy=false;
var KEY="lc-staff-"+tok,recent=[];
try{recent=JSON.parse(localStorage.getItem(KEY)||"[]")}catch(e){}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]})}
var tt;function toast(m,ok){var t=$("toast");t.textContent=m;t.className="toast on "+(ok?"ok":"bad");clearTimeout(tt);tt=setTimeout(function(){t.classList.remove("on")},ok?2800:4200);try{navigator.vibrate&&navigator.vibrate(ok?30:[60,40,60])}catch(e){}}
function post(path,body){return fetch(api+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return {}}).then(function(d){if(!r.ok)throw new Error(d.error||(r.status===429?"Too many tries. Wait a moment.":"Something went wrong."));return d})},function(){throw new Error("No connection. Try again.")})}
function ago(at){var s=Math.max(0,(Date.now()-at)/1000);return s<60?"just now":s<3600?Math.floor(s/60)+" min ago":s<86400?Math.floor(s/3600)+" h ago":new Date(at).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}
function drawRecent(){var l=$("recentList");$("recent").hidden=!recent.length;l.innerHTML=recent.map(function(r){return"<li><span>"+esc(r.text)+"</span><span>"+ago(r.at)+"</span></li>"}).join("")}
function addRecent(text){recent.unshift({text:text,at:Date.now()});recent=recent.slice(0,15);try{localStorage.setItem(KEY,JSON.stringify(recent))}catch(e){}drawRecent()}
drawRecent();setInterval(drawRecent,60000);

var isStamps=CFG.type==="stamps",showBuy=CFG.type!=="stamps"||CFG.minSpendEur>0;
var ICON={visit:'<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',buy:'<svg viewBox="0 0 24 24"><path d="M6 6h14l-1.5 9H8L6 3H3M9 20h.01M17 20h.01"/></svg>',gift:'<svg viewBox="0 0 24 24"><path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7C9 7 8 4.500 9.500 4S12 5 12 7c0-2 1-3.500 2.500-3S15 7 12 7z"/></svg>'};
function setCust(c){
  cur=c;
  if(!c){$("cust").hidden=true;$("bar").hidden=true;return}
  $("cust").hidden=false;$("bar").hidden=false;
  $("cName").textContent=c.name||"Customer";
  $("cMeta").textContent=[c.tier,c.lastVisitAt?"Last visit "+ago(new Date(c.lastVisitAt).getTime()):"First visit"].filter(Boolean).join(" · ");
  var st=[];
  if(CFG.type!=="points")st.push(["Stamps",c.stamps]);
  if(CFG.type!=="stamps")st.push(["Points",c.points]);
  st.push(["Visits",c.visits]);
  $("stats").innerHTML=st.map(function(s){return'<div class="stat"><b>'+esc(s[1])+"</b><span>"+s[0]+"</span></div>"}).join("");
  var rw=c.rewards||[];
  $("rwds").innerHTML=rw.map(function(r){return'<li class="'+(r.available?"on":"off")+'"><span>'+(r.available?'<svg class="pm-ic pm-ic--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> ':"")+esc(r.name)+"</span><span>"+esc(r.cost)+" "+(r.kind==="stamps"?"stamps":"pts")+"</span></li>"}).join("");
  var ready=rw.filter(function(r){return r.available}).length;
  var h='<button class="cr-btn cr-btn--primary act'+(showBuy?"":" full")+'" data-a="visit">'+ICON.visit+'<span class="lbl">'+(isStamps?"Add stamp":"Add visit")+"</span></button>";
  if(showBuy)h+='<button class="cr-btn cr-btn--primary act" data-a="buy">'+ICON.buy+'<span class="lbl">Purchase</span></button>';
  h+='<button class="cr-btn cr-btn--soft act full" data-a="redeem"'+(rw.length?"":" disabled")+'>'+ICON.gift+'<span class="lbl">Redeem reward'+(ready?"<small>"+ready+" ready to claim</small>":"")+"</span></button>";
  $("acts").innerHTML=h;
}
function err(m){var e=$("err");e.textContent=m;e.classList.add("on")}
function clearErr(){$("err").classList.remove("on")}
function lookup(code){
  code=String(code||"").trim();
  if(!code||busy)return;
  busy=true;clearErr();
  post("/lookup",{code:code}).then(function(d){setCust(d.customer);$("code").value="";window.scrollTo({top:0,behavior:"smooth"})})
  .catch(function(e){setCust(null);err(e.message);toast(e.message,false)}).then(function(){busy=false});
}
function record(body,label){
  if(!cur||busy)return;busy=true;
  post("/record",Object.assign({customerId:cur.id},body)).then(function(d){
    if(d.customer)setCust(d.customer);
    var m=d.message||"Done";toast(m,true);addRecent((cur&&cur.name?cur.name+": ":"")+(d.message||label));
  }).catch(function(e){toast(e.message,false)}).then(function(){busy=false});
}
$("manual").addEventListener("submit",function(e){e.preventDefault();lookup($("code").value)});
$("clear").addEventListener("click",function(){setCust(null)});
var hitMap={};
$("ph").addEventListener("submit",function(e){
  e.preventDefault();
  var raw=$("phNum").value.trim();
  if(raw.replace(/\D/g,"").length<3){toast("Type at least 3 digits of the number.",false);return}
  if(busy)return;busy=true;clearErr();
  $("hits").hidden=true;$("newCard").hidden=true;
  post("/find",{phone:raw}).then(function(d){
    var l=$("hits"),m=d.matches||[];hitMap={};
    m.forEach(function(c){hitMap[c.id]=c});
    l.innerHTML=m.length?m.map(function(c){return'<li><button type="button" class="hit" data-id="'+esc(c.id)+'"><span>'+esc(c.name||"Customer")+'<small>'+esc(c.phone)+"</small></span><span>"+esc(CFG.type==="points"?c.points:c.stamps)+"</span></button></li>"}).join(""):'<li class="none">No card for that number.</li>';
    l.hidden=false;$("enrol").hidden=false;
  }).catch(function(e){toast(e.message,false)}).then(function(){busy=false});
});
$("hits").addEventListener("click",function(e){
  var b=e.target.closest("[data-id]");if(!b)return;
  var c=hitMap[b.getAttribute("data-id")];if(!c)return;
  $("hits").hidden=true;$("enrol").hidden=true;
  setCust(c);window.scrollTo({top:0,behavior:"smooth"});
});
$("enrol").addEventListener("submit",function(e){
  e.preventDefault();
  var raw=$("phNum").value.trim();
  if(!raw){toast("Type the phone number first.",false);return}
  if(busy)return;busy=true;
  post("/enrol",{phone:raw,name:$("enName").value.trim()}).then(function(d){
    $("enName").value="";$("hits").hidden=true;$("enrol").hidden=true;
    if(d.cardUrl){$("newCardLink").href=d.cardUrl;$("newCard").hidden=false}
    setCust(d.customer);addRecent((d.customer&&d.customer.name?d.customer.name+": ":"")+(d.created?"New card":"Card already there"));
    toast(d.created?"Card created. Open it to show the customer.":"That number already had a card.",true);
  }).catch(function(e){toast(e.message,false)}).then(function(){busy=false});
});
$("acts").addEventListener("click",function(e){
  var b=e.target.closest("[data-a]");if(!b||!cur)return;
  var a=b.getAttribute("data-a");
  if(a==="visit")record({kind:"visit"},"Visit");
  else if(a==="buy"){amt="";drawAmt();$("mAmt").classList.add("on")}
  else if(a==="redeem")openRw();
});
document.addEventListener("click",function(e){if(e.target.closest("[data-close]")||e.target.classList.contains("modal"))document.querySelectorAll(".modal").forEach(function(m){m.classList.remove("on")})});
// amount keypad
var amt="";
$("pad").innerHTML=["1","2","3","4","5","6","7","8","9",",","0","\\u232B"].map(function(k){var bs=k==="\\u232B";return'<button type="button" data-k="'+k+'" aria-label="'+(bs?"Delete":k)+'">'+(bs?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4H8l-7 8 7 8h13a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zM18 9l-6 6M12 9l6 6"/></svg>':k)+"</button>"}).join("");
function drawAmt(){$("amt").textContent=amt||"0"}
$("pad").addEventListener("click",function(e){
  var b=e.target.closest("[data-k]");if(!b)return;var k=b.getAttribute("data-k");
  if(k==="\\u232B")amt=amt.slice(0,-1);
  else if(k===","){if(amt.indexOf(",")<0)amt=(amt||"0")+","}
  else{var p=amt.split(",");if(p[1]!=null&&p[1].length>=2)return;if(p[0].length>=5&&p[1]==null)return;amt+=k;if(/^0\\d/.test(amt))amt=amt.slice(1)}
  drawAmt();
});
$("amtOk").addEventListener("click",function(){
  var v=parseFloat(amt.replace(",","."));
  if(!(v>0)){toast("Enter the amount first.",false);return}
  $("mAmt").classList.remove("on");record({kind:"purchase",amountEur:Math.round(v*100)/100},"Purchase "+v.toFixed(2)+" EUR");
});
// rewards
function openRw(){
  var rw=(cur&&cur.rewards)||[];
  $("rwList").innerHTML=rw.length?rw.map(function(r){return'<button class="rbtn" data-r="'+esc(r.id)+'"'+(r.available?"":" disabled")+"><span>"+esc(r.name)+"<small>"+esc(r.cost)+" "+(r.kind==="stamps"?"stamps":"points")+(r.available?"":" · not enough yet")+"</small></span><span>"+(r.available?"Redeem":"")+"</span></button>"}).join(""):'<p class="muted">No rewards set up yet.</p>';
  $("mRw").classList.add("on");
}
$("rwList").addEventListener("click",function(e){var b=e.target.closest("[data-r]");if(!b||b.disabled)return;$("mRw").classList.remove("on");record({kind:"redeem",rewardId:b.getAttribute("data-r")},"Reward redeemed")});
// camera
var stream=null,det=null,raf=0,lastScan=0,vid=$("vid");
function stopCam(){cancelAnimationFrame(raf);if(stream){stream.getTracks().forEach(function(t){t.stop()});stream=null}vid.srcObject=null;$("cam").classList.remove("on");$("startCam").hidden=false}
var cv=null,cx=null,jsqrLoading=null;
function loadJsqr(){
  if(window.jsQR)return Promise.resolve();
  if(!jsqrLoading)jsqrLoading=new Promise(function(ok,no){var el=document.createElement("script");el.src="/assets/jsqr.js";el.onload=ok;el.onerror=function(){jsqrLoading=null;no(new Error("decoder"))};document.head.appendChild(el)});
  return jsqrLoading;
}
// Safari has no BarcodeDetector: read frames through a canvas with jsQR instead.
function decode(){
  if(det)return det.detect(vid).then(function(r){return r.length?(r[0].rawValue||""):""});
  var w=vid.videoWidth,h=vid.videoHeight;if(!w||!h||!window.jsQR)return Promise.resolve("");
  var sc=Math.min(1,640/w);cv=cv||document.createElement("canvas");cv.width=Math.round(w*sc);cv.height=Math.round(h*sc);
  cx=cx||cv.getContext("2d",{willReadFrequently:true});cx.drawImage(vid,0,0,cv.width,cv.height);
  var im=cx.getImageData(0,0,cv.width,cv.height),q=window.jsQR(im.data,im.width,im.height,{inversionAttempts:"dontInvert"});
  return Promise.resolve(q?q.data:"");
}
function tick(){
  if(!stream)return;
  var now=Date.now();
  if(now-lastScan>200&&vid.readyState>=2){
    lastScan=now;
    decode().then(function(v){
      if(/LC1-?[a-z0-9]/i.test(v)){stopCam();lookup(v);return}
      raf=requestAnimationFrame(tick)
    }).catch(function(){raf=requestAnimationFrame(tick)});
  }else raf=requestAnimationFrame(tick);
}
function startCam(){
  clearErr();
  var go=function(s){
    stream=s;vid.srcObject=s;vid.setAttribute("playsinline","");vid.muted=true;
    var p=vid.play();if(p&&p.catch)p.catch(function(){});
    $("cam").classList.add("on");$("startCam").hidden=true;raf=requestAnimationFrame(tick);
  };
  var fail=function(e){toast(location.protocol!=="https:"&&location.hostname!=="localhost"?"The camera needs a secure (https) page. Type the code instead.":"Camera blocked. Allow it in your browser settings, or type the code.",false)};
  var load=det?Promise.resolve():loadJsqr();
  load.then(function(){
    return navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false}).catch(function(){return navigator.mediaDevices.getUserMedia({video:true,audio:false})});
  }).then(go).catch(function(e){e&&e.message==="decoder"?toast("Couldn't load the scanner. Type the code instead.",false):fail(e)});
}
if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){
  if("BarcodeDetector" in window){try{det=new BarcodeDetector({formats:["qr_code"]})}catch(e){det=null}}
  $("startCam").hidden=false;
}else $("noCam").hidden=false;
$("startCam").addEventListener("click",startCam);$("stopCam").addEventListener("click",stopCam);
document.addEventListener("visibilitychange",function(){if(document.hidden&&stream)stopCam()});
})();
</script>` : ""}
</body>
</html>`;
}
