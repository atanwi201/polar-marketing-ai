// Local API for Isla Autopilot:
// - /api/ai: routes the app's AI calls to OpenRouter free models
// - /api/studio, /api/portal, /portal/<token>: the autonomous content studio and client portal
// - serves the built app after `npm run build`
// Settings come from .env (see .env.example).
import http from "node:http";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { join, normalize } from "node:path";

const root = join(import.meta.dirname, "..");
loadEnv(join(root, ".env"));

const { complete, freeModels, rankModels, status, aiKey, providerNames, configureAi, keySources, openrouterKey, providerList, runWithProvider, listModels } = await import("./openrouter.mjs");
const { db, save, id, token, now, MEDIA_DIR, DATA_DIR } = await import("./store.mjs");
const { startPost, runPost, publish, startScheduler, redrawImage, describeImage } = await import("./studio.mjs");
const { buildSite, SITES_DIR, startSiteRetries, siteBase, siteSlug, installUploadedSite, downloadSite } = await import("./sitebuilder.mjs");
const { qrPng, qrSvg } = await import("./qr.mjs");
const { editSite, undoSite, versionCount } = await import("./siteedit.mjs");
const { approval, blockReason, usage, DEFAULT_WEEKLY } = await import("./limits.mjs");
const { shareItem, checkAccounts, connections, maskAccounts, mergeAccounts, publicUrl, isPublic, TARGETS } = await import("./social.mjs");
const { startVideo, runVideo, rerender, capabilities, startVideoScheduler, videoTick, LENGTHS } = await import("./video.mjs");
const { sharePage } = await import("./share.mjs");
const { receiveUpload, addMessage, startAssistant, portalMessages } = await import("./assistant.mjs");
const { applyProfile, applyImages, profileView, MAX_PHOTOS } = await import("./profile.mjs");
const { handleLoyalty } = await import("./loyalty-routes.mjs");
const loyalty = await import("./loyalty.mjs");
const { handleBookings } = await import("./bookings-routes.mjs");
const bookings = await import("./bookings.mjs");
const { bookingMailer } = await import("./booking-mail.mjs");
const { handleWallet, pushUpdate } = await import("./wallet.mjs");
const { walletStatus, buildPass } = await import("./pass.mjs");
const { googleStatus, saveUrl: googleSaveUrl, pushGoogle, fallbackLogoPng } = await import("./gwallet.mjs");
const loyaltyDesign = await import("./loyalty-design.mjs").catch(() => null);
const PROFILE_FORM_JS = () => readFileSync(join(import.meta.dirname, "profile-form.js"), "utf8");

/** Save what a business (or you) entered in the profile form; the website is rebuilt in the background. */
async function saveProfile(c, b, { newDesign = false, rebuild = true } = {}) {
  applyProfile(c, { ...(b.profile ?? {}), ...(typeof b.offer === "string" ? { offer: b.offer } : {}), ...(typeof b.hours === "string" ? { hours: b.hours } : {}) });
  const room = MAX_PHOTOS - ((c.photos ?? []).length - (Array.isArray(b.removePhotos) ? b.removePhotos.length : 0));
  await applyImages(c, {
    logo: typeof b.logo === "string" ? b.logo : undefined,
    photos: (Array.isArray(b.photos) ? b.photos : []).filter((x) => typeof x === "string").slice(0, Math.max(0, room)),
    removePhotos: Array.isArray(b.removePhotos) ? b.removePhotos.filter((x) => typeof x === "string") : [],
  });
  if (b.removeLogo === true && !b.logo) c.logoFile = "";
  await save();
  if (rebuild && approval(c) === "approved") void buildSite(c, { newDesign }); // waiting businesses get theirs on approval
  return profileView(c);
}
const { configureImages, imageEngine, checkEngine, GOOGLE_MODELS, OPENROUTER_IMAGE_MODELS, PROVIDERS } = await import("./images.mjs");
const { configureStock, pexelsKey } = await import("./stock.mjs");
db.settings ??= {};
const { createAuth, newCode, findByCode, limiter } = await import("./auth.mjs");
const auth = createAuth(db, save);
const loginTries = limiter(10, 15 * 60e3), codeTries = limiter(12, 15 * 60e3);
// Every business gets a short access code to enter its dashboard from the landing page.
for (const c of db.clients) if (c.siteEdit?.status === "working") c.siteEdit = { status: "idle" }; // a restart mid-change
if (db.clients.some((c) => !c.code)) { for (const c of db.clients) c.code ||= newCode(db.clients); void save(); }
configureImages(() => db.settings.images);
configureAi(() => db.settings.ai);
configureStock(() => db.settings.images?.pexelsKey);

/** AI text providers for the studio: keys are never sent back in full. */
function aiSettingsView() {
  const s = db.settings.ai ?? {};
  const mask = (k) => (k ? "••••" + k.slice(-4) : "");
  return {
    puter: { imageModel: s.puter?.imageModel ?? "", voiceProvider: s.puter?.voiceProvider ?? "", voice: s.puter?.voice ?? "" },
    openrouter: !!aiKey(), providers: providerNames(), order: s.order ?? "", sources: keySources(),
    list: providerList().map((p) => ({ id: p.id, label: p.label, hint: p.hint, paid: p.paid, key: mask(s[p.field]), model: s.models?.[p.id] ?? "" })),
  };
}

/** Image settings for the studio: the key is never sent back in full. */
function imageSettingsView() {
  const e = imageEngine();
  const s = db.settings.images ?? {};
  return {
    provider: e.chosen, engine: e.label, fallback: e.fallback,
    googleModel: e.google.model, googleSize: e.google.imageSize, googleKey: s.googleKey ? "••••" + s.googleKey.slice(-4) : "",
    googleKeyFromEnv: e.googleKeySource === "env", googleModels: GOOGLE_MODELS,
    openrouterModel: e.openrouter.model, openrouterKey: !!e.openrouter.key, puterKey: !!e.puter.key, openrouterModels: OPENROUTER_IMAGE_MODELS,
    pexelsKey: s.pexelsKey ? "••••" + s.pexelsKey.slice(-4) : "", pexelsKeyFromEnv: !s.pexelsKey && !!pexelsKey(),
  };
}

/** Truthy when any AI provider has a key (re-read each time: keys can be saved in the dashboard). */
const KEYF = () => aiKey();
const PORT = Number(process.env.PORT ?? 8787);
const ADMIN = process.env.ADMIN_TOKEN ?? "";
const BRAND_DIR = join(import.meta.dirname, "..", "brand");
const BRAND = JSON.parse(readFileSync(join(BRAND_DIR, "brand.json"), "utf8")).name; // working name, swap it in brand/brand.json
const ICONS = `<link rel="icon" href="/brand/logo/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/logo/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/brand/logo/apple-touch-icon.png">
<link rel="manifest" href="/brand/site.webmanifest">
<meta name="theme-color" content="#0e1316">
<meta property="og:image" content="/brand/logo/og-image.png">`;
const page = (name) => () => readFileSync(join(import.meta.dirname, name), "utf8").replaceAll("{{BRAND}}", BRAND).replaceAll("{{ICONS}}", ICONS);
const PORTAL_HTML = page("portal.html");
const SIGNUP_HTML = page("signup.html");
const LANDING_HTML = page("landing.html");
const PUTER_CALLBACK_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Puter</title><link rel="icon" href="/brand/logo/favicon.svg" type="image/svg+xml">
<style>body{font:16px system-ui;background:#0f1417;color:#e8eef0;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:380px;padding:24px;text-align:center}</style>
<main><h1 id="t">Connecting Puter…</h1><p id="m">One moment.</p></main>
<script>
(async()=>{
  const q=new URLSearchParams(location.search), token=q.get("token");
  history.replaceState(null,"",location.pathname);
  const say=(t,m)=>{document.getElementById("t").textContent=t;document.getElementById("m").textContent=m;};
  if(!token) return say("No token","Puter did not send one. Close this window and try again.");
  let tok=""; try{tok=localStorage.getItem("isla:adminToken")||""}catch{}
  try{
    const r=await fetch("/api/studio/settings/ai/puter-token",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...(tok?{"x-admin-token":tok}:{})},body:JSON.stringify({token})});
    if(r.status===401) return say("Sign in first","Open the dashboard, sign in as the owner, then press Sign in with Puter again.");
    if(!r.ok) return say("Could not save",(await r.json().catch(()=>({}))).error||"Try again.");
    say("Puter connected","You can close this window.");
    try{window.opener&&window.opener.postMessage({type:"puter-connected"},location.origin)}catch{}
    setTimeout(()=>window.close(),1200);
  }catch{say("Could not reach the server","Try again.")}
})();
</script>`;
const LANGS = ["es", "en", "de", "it", "nl", "sv", "fr"];
const signupsByIp = new Map();
// Behind nginx every request comes from 127.0.0.1; the visitor's address is in X-Real-IP.
const clientIp = (req) => {
  const s = req.socket.remoteAddress ?? "";
  const local = /^(::ffff:)?127\.|^::1$/.test(s);
  return local ? String(req.headers["x-real-ip"] ?? req.headers["x-forwarded-for"] ?? s).split(",")[0].trim() : s;
};

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const readBody = (req, limit = 1e6) => new Promise((ok, fail) => {
  let s = "";
  req.on("data", (c) => { s += c; if (s.length > limit) { fail(Object.assign(new Error("Request too large"), { status: 413 })); req.destroy(); } });
  req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { fail(Object.assign(new Error("Invalid JSON"), { status: 400 })); } });
});

const send = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const MIME = { xml: "application/xml", txt: "text/plain; charset=utf-8", json: "application/json", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml", mp4: "video/mp4", aiff: "audio/aiff", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", weba: "audio/webm", ogg: "audio/ogg", wav: "audio/wav", gif: "image/gif", ico: "image/x-icon", avif: "image/avif", bmp: "image/bmp", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject", mjs: "text/javascript", htm: "text/html; charset=utf-8", webmanifest: "application/manifest+json", pdf: "application/pdf", vtt: "text/vtt", map: "application/json", webm: "video/webm" };

/** Save a data-URL upload (jpeg/png/webp, max 6 MB). Returns the media file name. */
async function saveUpload(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl ?? "");
  if (!m) throw Object.assign(new Error("Upload a JPEG, PNG or WebP image"), { status: 400 });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 6e6) throw Object.assign(new Error("Image is over 6 MB"), { status: 413 });
  const file = `up-${id()}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  await writeFile(join(MEDIA_DIR, file), buf);
  return file;
}

async function addBrief(client, { text, image, imageFile }, reason = "brief") {
  if (typeof text !== "string" || text.trim().length < 3) throw Object.assign(new Error("Say what you want to market"), { status: 400 });
  const brief = { id: id(), clientId: client.id, text: text.trim().slice(0, 2000), createdAt: now(), imageFile: image ? await saveUpload(image) : imageFile };
  db.briefs.push(brief);
  const post = startPost(client, brief, reason);
  return { brief, post };
}

const CLIENT_FIELDS = ["name", "kind", "town", "phone", "email", "domain", "offer", "hours", "tone", "languages", "platforms", "autopilot", "postsPerWeek", "autoPublish", "webhookUrl", "imageSize", "videosPerWeek", "videoSeconds", "videoVoice", "plan", "customPrice", "aiProvider", "exampleUrls"];
const POST_EDITS = { captions: 2200, short: 280 };
const VIDEO_EDITS = { captions: 2200, title: 100, description: 4900, endCta: 60 };
const base = (req) => publicUrl() || `http://${req.headers.host ?? `localhost:${PORT}`}`;

/** Studio view of a client: secrets masked, plus which platforms are ready to post. */
const studioClient = (c) => ({ ...c, accounts: maskAccounts(c.accounts), connections: connections(c), approvalStatus: approval(c), usage: usage(c) });

/** Apply per-language text edits ({ captions: { es: "..." } }) with length limits. */
function applyText(item, body, limits) {
  for (const [field, max] of Object.entries(limits)) {
    if (!body[field] || typeof body[field] !== "object") continue;
    item[field] = { ...item[field] };
    for (const [l, v] of Object.entries(body[field])) if (LANGS.includes(l) && typeof v === "string") item[field][l] = v.slice(0, max);
  }
  if (Array.isArray(body.hashtags)) item.hashtags = body.hashtags.map((h) => String(h).replace(/^#+/, "").replace(/\s+/g, "").slice(0, 60)).filter(Boolean).slice(0, 15);
  if (typeof body.altText === "string") item.altText = body.altText.slice(0, 1000);
}

/** New video ad from the studio or the portal. An attached photo is described and used as reference. */
async function addVideo(client, b, reason) {
  if (typeof b.text !== "string" || b.text.trim().length < 3) throw Object.assign(new Error("Say what the video should promote"), { status: 400 });
  const cap = await capabilities();
  if (!cap.ffmpeg) throw Object.assign(new Error("Video needs ffmpeg on the server (macOS: brew install ffmpeg)."), { status: 503 });
  const imageFile = b.image ? await saveUpload(b.image) : undefined;
  const langs = (Array.isArray(b.langs) ? b.langs : []).filter((l) => LANGS.includes(l));
  return startVideo(client, {
    text: b.text.trim(), seconds: b.seconds, langs: langs.length ? langs : (client.languages ?? ["es"]).slice(0, 1),
    voice: b.voice === true, reason, imageDescription: imageFile ? await describeImage(imageFile) : undefined, refImage: imageFile,
  });
}

async function deleteMedia(files) {
  for (const f of files.filter(Boolean)) await unlink(join(MEDIA_DIR, f)).catch(() => {});
}
const videoFiles = (v) => [...(v.scenes ?? []).map((s) => s.imageFile), ...Object.values(v.renders ?? {}).flatMap((r) => [r.file, r.cover])];
const publicClient = (c) => ({ name: c.name, logoFile: c.logoFile ?? "", code: c.code, languages: c.languages, town: c.town, site: c.site ? { status: c.site.status === "waiting" ? "building" : c.site.status, step: c.site.step, url: c.site.url, kind: c.site.kind, builtAt: c.site.builtAt, error: c.site.status === "failed" ? "The website couldn't be built yet. We'll retry." : undefined } : null });
const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const portalView = (c) => ({
  client: publicClient(c),
  briefs: db.briefs.filter((b) => b.clientId === c.id).map(({ id, text, createdAt, imageFile }) => ({ id, text, createdAt, imageFile })),
  posts: db.posts.filter((p) => p.clientId === c.id).map(({ id, briefId, createdAt, status, captions, short, hashtags, cta, imageFile, concept, altText, shareKey, kind }) =>
    ({ id, briefId, createdAt, status: status === "waiting" ? "generating" : status, captions, short, hashtags, cta, imageFile, concept, altText, shareKey, kind })),
  messages: portalMessages(c.id),
  profile: profileView(c),
  access: { approval: approval(c), ...usage(c) },
  videos: db.videos.filter((v) => v.clientId === c.id).map(({ id, createdAt, status, step, stepNote, progress, concept, captions, title, description, hashtags, renders, seconds, langs, shareKey }) =>
    ({ id, createdAt, status, step, stepNote, progress, concept, captions, title, description, hashtags, renders, seconds, langs, shareKey, error: status === "failed" ? "The video couldn't be made. Try again." : undefined })),
  shareBase: isPublic() ? publicUrl() : "",
});

// Loyalty cards: every card change pushes a refresh to the customer's Apple Wallet pass.
loyalty.setOnCardChanged((c) => {
  pushUpdate(c).catch((e) => console.warn("[wallet push]", e.message));
  pushGoogle(c, { client: db.clients.find((x) => x.id === c.clientId) }).catch((e) => console.warn("[google wallet push]", e.message));
});
// Reservations: confirmations go only to the customer who booked (transactional).
bookings.setOnBookingChange(bookingMailer({ baseUrl: () => publicUrl() || `http://localhost:${PORT}`, save }));
const loyaltyCtx = {
  send, readBody, saveUpload, isAdmin: (req) => auth.isAdmin(req), clientByToken: (t) => db.clients.find((x) => x.token === t), baseUrl: (req) => base(req), clientIp,
  designProgram: async (program, opts) => {
    if (!loyaltyDesign?.designProgram) return {};
    return loyaltyDesign.designProgram(program, db.clients.find((c) => c.id === program.clientId) ?? {}, opts);
  },
  wallet: {
    status: () => ({ ...walletStatus(), google: googleStatus() }),
    google: {
      saveUrl: (customer, baseUrl) => {
        const program = loyalty.findProgram(customer.programId);
        return googleSaveUrl({ program, customer, client: db.clients.find((c) => c.id === program.clientId) ?? {}, baseUrl });
      },
      logo: (program) => fallbackLogoPng(program),
    },
    buildPass: (customer) => {
      const program = loyalty.findProgram(customer.programId);
      return buildPass({ program, customer, client: db.clients.find((c) => c.id === program.clientId) ?? {}, baseUrl: publicUrl() || `http://localhost:${PORT}` });
    },
    push: (c) => pushUpdate(c),
  },
};

async function route(req, res, url) {
  const p = url.pathname;
  const seg = p.split("/").filter(Boolean);

  // --- Loyalty cards and Apple Wallet (before the portal and studio handlers) ---
  if (await handleWallet(req, res, url, seg, { send, readBody, baseUrl: base })) return;
  if (await handleLoyalty(req, res, url, seg, loyaltyCtx)) return;
  if (await handleBookings(req, res, url, seg, loyaltyCtx)) return;

  // --- AI proxy for the main app ---
  if (p === "/api/ai/status") {
    if (!KEYF()) return send(res, 200, { configured: false, provider: "openrouter" });
    const providers = providerNames();
    const models = openrouterKey() ? await freeModels(openrouterKey()).catch(() => []) : [];
    return send(res, 200, { configured: true, provider: providers[0], providers, models: rankModels(models).slice(0, 8), ...status() });
  }
  if (p === "/api/ai" && req.method === "POST") {
    if (!auth.isAdmin(req)) return send(res, 401, { error: "Sign in first" });
    if (!KEYF()) return send(res, 503, { error: "No AI key set (GROQ_API_KEY, MISTRAL_API_KEY or OPENROUTER_API_KEY)" });
    const { prompt, system, tier, json, stream } = await readBody(req);
    if (typeof prompt !== "string" || !prompt) return send(res, 400, { error: "prompt is required" });
    const ac = new AbortController();
    res.on("close", () => !res.writableEnded && ac.abort());
    if (stream && !json) {
      // Plain-text chunks, then \0 and the model id (or \0error:<message>).
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
      const out = await complete({ key: KEYF(), prompt, system, tier, onDelta: (d) => res.write(d), signal: ac.signal });
      return res.end(`\u0000${out.model ?? ""}`);
    }
    const out = await complete({ key: KEYF(), prompt, system, tier, json, signal: ac.signal });
    return send(res, 200, json ? { data: out.json, model: out.model } : { text: out.text, model: out.model });
  }

  // --- Landing page: the owner signs in with a password, a business with its access code ---
  if ((p === "/" || p === "/login") && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(LANDING_HTML());
  }
  if ((p === "/admin" || p === "/admin/") && req.method === "GET") {
    if (!auth.hasPassword() || !auth.isAdmin(req)) { res.writeHead(302, { Location: "/" }); return res.end(); }
    const app = join(root, "dist", "index.html");
    if (!existsSync(app)) { res.writeHead(302, { Location: "http://localhost:5173/admin/" }); return res.end(); } // dev: Vite serves it
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(readFileSync(app, "utf8").replace("</head>", `${ICONS}\n</head>`)); // Vite would rewrite icon links in index.html, so they are added here
  }
  if (p === "/api/auth" && req.method === "GET") {
    return send(res, 200, { admin: auth.hasPassword() || ADMIN ? auth.isAdmin(req) : false, setup: !auth.hasPassword(), fromEnv: auth.fromEnv() });
  }
  if (p === "/api/auth/login" && req.method === "POST") {
    const ip = clientIp(req);
    if (loginTries.blocked(ip)) return send(res, 429, { error: "Too many tries. Wait 15 minutes and try again." });
    const b = await readBody(req);
    const pw = typeof b.password === "string" ? b.password : "";
    if (!auth.hasPassword()) {
      // First run: whoever opens the landing page first creates the owner password.
      if (pw.length < 8) return send(res, 400, { error: "Use at least 8 characters." });
      await auth.setPassword(pw);
    } else if (!auth.checkPassword(pw)) {
      loginTries.fail(ip);
      return send(res, 401, { error: "Wrong password." });
    }
    loginTries.clear(ip);
    await auth.startSession(req, res);
    return send(res, 200, { ok: true, next: "/admin/" });
  }
  if (p === "/api/auth/logout" && req.method === "POST") {
    await auth.endSession(req, res);
    return send(res, 200, { ok: true });
  }
  if (p === "/api/auth/password" && req.method === "POST") {
    if (!auth.hasPassword() || !auth.isAdmin(req)) return send(res, 401, { error: "Sign in first" });
    if (auth.fromEnv()) return send(res, 400, { error: "The password is set with ADMIN_PASSWORD in .env. Change it there." });
    const b = await readBody(req);
    if (!auth.checkPassword(b.current ?? "")) return send(res, 401, { error: "Your current password isn't right." });
    if (typeof b.next !== "string" || b.next.length < 8) return send(res, 400, { error: "Use at least 8 characters." });
    await auth.setPassword(b.next);
    await auth.startSession(req, res);
    return send(res, 200, { ok: true });
  }
  if (p === "/api/client-login" && req.method === "POST") {
    const ip = clientIp(req);
    if (codeTries.blocked(ip)) return send(res, 429, { error: "Too many tries. Wait 15 minutes and try again." });
    const b = await readBody(req);
    const c = findByCode(db.clients, b.code);
    if (!c) { codeTries.fail(ip); return send(res, 404, { error: "We can't find that code. Check it and try again." }); }
    codeTries.clear(ip);
    return send(res, 200, { portalUrl: `/portal/${c.token}`, name: c.name });
  }

  // --- Client sign-up (public): creates the client, builds their website, makes a first post ---
  if (p === "/assets/profile-form.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(PROFILE_FORM_JS());
  }
  // Where Puter sends the owner's browser after "Sign in with Puter": hands the token to the dashboard API
  // with the owner's own sign-in, then closes. The token never touches the server log (it is read in the browser).
  if (p === "/puter-callback" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" });
    return res.end(PUTER_CALLBACK_HTML);
  }
  if (p === "/signup" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(SIGNUP_HTML());
  }
  if (p === "/api/signup" && req.method === "POST") {
    const ip = clientIp(req);
    const recent = (signupsByIp.get(ip) ?? []).filter((t) => Date.now() - t < 36e5);
    if (recent.length >= 5) return send(res, 429, { error: "Too many sign-ups from here. Try again in an hour." });
    const b = await readBody(req, 40e6);
    const c = {
      id: id(), token: token(), code: newCode(db.clients), createdAt: now(), source: "signup",
      name: str(b.name, 80), kind: str(b.kind, 60), town: str(b.town, 60), phone: str(b.phone, 30), email: str(b.email, 120),
      domain: /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(str(b.domain, 120).replace(/^https?:\/\//, "").replace(/\/.*$/, "")) ? str(b.domain, 120).replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "",
      offer: str(b.offer, 2000), hours: str(b.hours, 300),
      languages: (Array.isArray(b.languages) ? b.languages : []).filter((l) => LANGS.includes(l)),
      platforms: ["instagram", "facebook"], tone: "", autopilot: true, postsPerWeek: 7, autoPublish: false, webhookUrl: "",
      marketingConsent: b.marketingConsent === true ? { at: now(), source: "signup form" } : false,
      approval: { status: "pending", at: now() }, // the owner approves new businesses before they use anything
    };
    if (!c.name || !c.offer || !c.phone || !c.email) return send(res, 400, { error: "Fill in the business name, what you offer, phone and email." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return send(res, 400, { error: "That email doesn't look right." });
    if (b.acceptTerms !== true) return send(res, 400, { error: "Please accept the terms to continue." });
    if (!c.languages.length) c.languages = ["es", "en"];
    // Brand, offer, place and photos from the sign-up wizard (logo and photos as data URLs).
    try { await saveProfile(c, { profile: b.profile, logo: b.logo, photos: (b.photos ?? []).slice(0, 8) }, { rebuild: false }); }
    catch (e) { return send(res, e.status ?? 400, { error: e.message }); }
    signupsByIp.set(ip, [...recent, Date.now()]);
    db.clients.push(c);
    await save();
    return send(res, 201, { token: c.token, code: c.code, portalUrl: `/portal/${c.token}` });
  }

  // --- Client portal (public, by secret token) ---
  if (seg[0] === "portal" && seg[1]) {
    // Unknown tokens get the page too; it shows a "link not valid" message from the API's 404.
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(PORTAL_HTML());
  }
  if (seg[0] === "api" && seg[1] === "portal" && seg[2]) {
    const c = db.clients.find((x) => x.token === seg[2]);
    if (!c) return send(res, 404, { error: "Unknown portal link" });
    if (seg.length === 3 && req.method === "GET") return send(res, 200, portalView(c));
    const blocked = blockReason(c);
    const pendingOrDeclined = blocked && blocked.code !== "cap";
    if (blocked && ((seg[3] === "briefs" || seg[3] === "videos" || seg[5] === "again") && req.method === "POST")) return send(res, blocked.status, blocked);
    if (pendingOrDeclined && (seg[3] === "messages" || seg[3] === "upload") && req.method === "POST") return send(res, blocked.status, blocked);
    if (seg[3] === "briefs" && req.method === "POST") {
      const recent = db.briefs.filter((b) => b.clientId === c.id && Date.now() - Date.parse(b.createdAt) < 864e5).length;
      if (recent >= 10) return send(res, 429, { error: "That's 10 requests today. Try again tomorrow." });
      const { post } = await addBrief(c, await readBody(req, 9e6));
      return send(res, 201, { postId: post.id });
    }
    if (seg[3] === "profile" && req.method === "POST") {
      const recent = (c.profileSaves ?? []).filter((t) => Date.now() - t < 864e5);
      if (recent.length >= 15) return send(res, 429, { error: "That's 15 changes today. Try again tomorrow." });
      c.profileSaves = [...recent, Date.now()];
      return send(res, 200, await saveProfile(c, await readBody(req, 40e6)));
    }
    if ((seg[3] === "qr" || seg[3] === "qr.png") && req.method === "GET" && seg.length === 4) {
      if (c.site?.status !== "ready") return send(res, 404, { error: "No website yet" });
      const target = `${siteBase(c).replace(/\/$/, "")}/`;
      if (seg[3] === "qr.png") {
        const png = await qrPng(target);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Content-Disposition": `attachment; filename="${(c.siteSlug || "website").replace(/[^\w.-]/g, "")}-qr.png"` });
        return res.end(png);
      }
      return send(res, 200, { url: target, svg: await qrSvg(target) });
    }
    if (seg[3] === "upload" && req.method === "POST") {
      const today = (c.uploads ?? []).filter((u) => Date.now() - Date.parse(u.at) < 864e5).length;
      if (today >= 40) return send(res, 429, { error: "That's 40 uploads today. Try again tomorrow." });
      const up = await receiveUpload(req);
      c.uploads = [...(c.uploads ?? []), { ...up, at: now() }].slice(-200);
      await save();
      return send(res, 201, up);
    }
    if (seg[3] === "messages" && req.method === "POST") {
      const sent = db.messages.filter((m) => m.clientId === c.id && m.role === "client" && Date.now() - Date.parse(m.createdAt) < 864e5).length;
      if (sent >= 40) return send(res, 429, { error: "That's 40 messages today. Try again tomorrow." });
      const b = await readBody(req);
      const mine = new Map((c.uploads ?? []).map((u) => [u.file, u]));
      const attachments = (Array.isArray(b.attachments) ? b.attachments : []).map((a) => mine.get(a?.file ?? a)).filter(Boolean).slice(0, 4)
        .map(({ file, kind, duration }) => ({ file, kind, duration }));
      const text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text && !attachments.length) return send(res, 400, { error: "Write a message or attach a photo or video" });
      const { msg, reply } = addMessage(c, { role: "client", text, attachments, lang: b.lang === "en" ? "en" : "es" });
      return send(res, 201, { messageId: msg.id, replyId: reply.id });
    }
    if (seg[3] === "videos" && !seg[4] && req.method === "POST") {
      const recent = db.videos.filter((v) => v.clientId === c.id && Date.now() - Date.parse(v.createdAt) < 864e5).length;
      if (recent >= 3) return send(res, 429, { error: "That's 3 videos today. Try again tomorrow." });
      const b = await readBody(req, 9e6);
      const v = await addVideo(c, { ...b, voice: false, langs: (Array.isArray(b.langs) ? b.langs : c.languages ?? []).slice(0, 2) }, "portal");
      return send(res, 201, { videoId: v.id });
    }
    if (seg[3] === "posts" && seg[5] === "again" && req.method === "POST") {
      const old = db.posts.find((x) => x.id === seg[4] && x.clientId === c.id);
      if (!old) return send(res, 404, { error: "Post not found" });
      const brief = old.briefId ? db.briefs.find((b) => b.id === old.briefId) : null; // null: the AI picks the topic
      return send(res, 201, { postId: startPost(c, brief, "again").id });
    }
    return send(res, 404, { error: "not found" });
  }

  // --- Owner studio API ---
  if (seg[0] === "api" && seg[1] === "studio") {
    if (!auth.isAdmin(req)) return send(res, 401, { error: "Sign in first" });
    const [, , kind, oid, action] = seg;
    if (!kind && req.method === "GET") {
      const cap = await capabilities();
      return send(res, 200, {
        ...db, settings: undefined, limits: { postsPerWeek: db.settings.limits?.postsPerWeek ?? DEFAULT_WEEKLY }, clients: db.clients.map(studioClient), ai: aiSettingsView(), images: imageSettingsView(),
        video: { ffmpeg: cap.ffmpeg && cap.canvas, voices: cap.voices, lengths: LENGTHS },
        public: { url: publicUrl(), reachable: isPublic() },
        apps: { x: !!(process.env.X_API_KEY && process.env.X_API_SECRET), youtube: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) },
      });
    }
    if (kind === "clients" && req.method === "POST" && !oid) {
      const body = await readBody(req);
      let c = db.clients.find((x) => x.id === body.id);
      if (!c) { c = { id: body.id || id(), token: token(), code: newCode(db.clients), createdAt: now() }; db.clients.push(c); }
      const isNew = !c.name;
      for (const f of CLIENT_FIELDS) if (f in body) c[f] = body[f];
      if ("exampleUrls" in body) c.exampleUrls = (Array.isArray(body.exampleUrls) ? body.exampleUrls : []).map((x) => { try { const u = new URL(/^https?:\/\//i.test(String(x).trim()) ? String(x).trim() : `https://${String(x).trim()}`); return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u.href : ""; } catch { return ""; } }).filter(Boolean).slice(0, 3);
      if ("aiProvider" in body && !providerList().some((x) => x.id === c.aiProvider)) c.aiProvider = ""; // unknown id = automatic
      if (body.accounts) c.accounts = mergeAccounts(c.accounts, body.accounts);
      c.source ??= "owner";
      c.postsPerWeek = Math.max(7, Math.min(21, Number(c.postsPerWeek) || 0));
      c.videosPerWeek = Math.max(0, Math.min(7, Number(c.videosPerWeek) || 0));
      c.videoSeconds = LENGTHS.includes(Number(c.videoSeconds)) ? Number(c.videoSeconds) : 15;
      c.videoVoice = c.videoVoice === true;
      if (!["basic", "pro"].includes(c.plan)) c.plan = "";
      c.customPrice = Number.isFinite(Number(c.customPrice)) && c.customPrice !== null && c.customPrice !== "" ? Math.max(0, Number(c.customPrice)) : null;
      await save();
      if (body.buildSite || (isNew && c.offer)) void buildSite(c);
      return send(res, 200, studioClient(c));
    }
    // QR code for the client's website (print on menus, windows, cards). where=domain (default) or studio.
    if (kind === "clients" && oid && (action === "qr" || action === "qr.png") && req.method === "GET") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      c.siteSlug ||= siteSlug(c);
      const studio = `${(process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "")}/sites/${c.siteSlug}/`;
      const target = url.searchParams.get("where") === "studio" ? studio : `${siteBase(c).replace(/\/$/, "")}/`;
      if (action === "qr.png") {
        const png = await qrPng(target);
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Content-Disposition": `attachment; filename="${(c.siteSlug || "website").replace(/[^\w.-]/g, "")}-qr.png"` });
        return res.end(png);
      }
      return send(res, 200, { url: target, studioUrl: studio, hasDomain: /\./.test(c.domain ?? ""), svg: await qrSvg(target) });
    }
    if (kind === "clients" && oid && action === "site.zip" && req.method === "GET") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      try {
        const zip = await downloadSite(c);
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": zip.length, "Content-Disposition": `attachment; filename="${(c.siteSlug || "website").replace(/[^\w.-]/g, "")}.zip"` });
        return res.end(zip);
      } catch (e) { return send(res, 404, { error: e.message }); }
    }
    if (kind === "clients" && oid && action === "site-upload" && req.method === "POST") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      const chunks = [];
      let size = 0;
      for await (const ch of req) { size += ch.length; if (size > 80e6) return send(res, 413, { error: "That zip is too big (max 80 MB)" }); chunks.push(ch); }
      try { return send(res, 200, await installUploadedSite(c, Buffer.concat(chunks))); }
      catch (e) { return send(res, e.status ?? 400, { error: e.message }); }
    }
    if (kind === "clients" && oid && action === "site" && req.method === "POST") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      const b = await readBody(req).catch(() => ({}));
      void buildSite(c, { newDesign: b.newDesign === true });
      return send(res, 202, { ok: true });
    }
    // New businesses wait for the owner: approving builds their website and first post.
    if (kind === "clients" && oid && (action === "approve" || action === "decline") && req.method === "POST") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      const was = approval(c);
      c.approval = { status: action === "approve" ? "approved" : "declined", at: now() };
      await save();
      if (action === "approve" && was !== "approved") {
        if (!c.site?.builtAt && c.site?.status !== "building") void buildSite(c);
        if (!db.posts.some((x) => x.clientId === c.id)) {
          const { post } = await addBrief(c, { text: c.offer || c.kind || c.name, imageFile: c.photos?.[0]?.file }, "signup").catch(() => ({}));
          if (post) await save();
        }
      }
      return send(res, 200, studioClient(c));
    }
    if (kind === "settings" && oid === "limits" && req.method === "POST") {
      const b = await readBody(req);
      const n = Number(b.postsPerWeek);
      if (!Number.isInteger(n) || n < 0 || n > 100) return send(res, 400, { error: "Use a whole number from 0 to 100." });
      db.settings.limits = { ...db.settings.limits, postsPerWeek: n };
      await save();
      return send(res, 200, { limits: db.settings.limits });
    }
    if (kind === "clients" && oid && action === "cap" && req.method === "POST") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      const b = await readBody(req);
      if (b.postCap === null || b.postCap === "") delete c.postCap;
      else {
        const n = Number(b.postCap);
        if (!Number.isInteger(n) || n < 0 || n > 100) return send(res, 400, { error: "Use a whole number from 0 to 100." });
        c.postCap = n;
      }
      await save();
      return send(res, 200, studioClient(c));
    }
    // Website chat: the owner asks for a change and the AI edits the live page.
    if (kind === "clients" && oid && (action === "site-chat" || action === "site-undo") && req.method === "POST") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      if (c.site?.status === "building") return send(res, 409, { error: "The website is being rebuilt right now. Try again when it's ready." });
      if (c.siteEdit?.status === "working") return send(res, 409, { error: "Still working on the last change." });
      const opts = { sitesDir: SITES_DIR, siteBase };
      if (action === "site-undo") {
        try { await undoSite(c, opts); } catch (e) { return send(res, e.status ?? 500, { error: e.message }); }
        c.siteVersions = await versionCount(c);
        (c.siteChat ??= []).push({ id: id(), role: "ai", text: "Undone: the website is back to how it was before the last change.", at: now(), status: "done" });
        await save();
        return send(res, 200, studioClient(c));
      }
      const b = await readBody(req);
      const text = str(b.message, 1000);
      if (!text) return send(res, 400, { error: "Write what you'd like to change." });
      const msg = { id: id(), role: "owner", text, at: now(), status: "working" };
      c.siteChat = [...(c.siteChat ?? []), msg].slice(-60);
      c.siteEdit = { status: "working", step: "editing", at: now() };
      await save();
      void (async () => {
        try {
          const r = await editSite(c, text, { ...opts, onStep: (st) => { c.siteEdit = { ...c.siteEdit, step: st }; } });
          msg.status = "done";
          const note = r.skipped.length ? ` (the ${r.skipped.map((l) => l.toUpperCase()).join(", ")} version couldn't be changed this time)` : "";
          c.siteChat.push({ id: id(), role: "ai", text: r.summary + note, at: now(), status: "done" });
          c.site = { ...c.site, editedAt: now() };
          c.siteVersions = await versionCount(c);
        } catch (e) {
          msg.status = "failed";
          c.siteChat.push({ id: id(), role: "ai", text: e.message, at: now(), status: "failed" });
        }
        c.siteEdit = { status: "idle" };
        await save();
      })();
      return send(res, 202, studioClient(c));
    }
    if (kind === "clients" && oid && action === "profile" && req.method === "POST") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      const b = await readBody(req, 40e6);
      return send(res, 200, await saveProfile(c, b, { newDesign: b.newDesign === true, rebuild: b.rebuild !== false }));
    }
    if (kind === "clients" && oid && action === "token" && req.method === "POST") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      c.token = token();
      c.code = newCode(db.clients); // a new link also means a new access code
      await save();
      return send(res, 200, studioClient(c));
    }
    if (kind === "clients" && oid && action === "messages" && req.method === "POST") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      if (seg[5] === "seen") {
        for (const m of db.messages) if (m.clientId === c.id) m.seenByOwner = true;
        await save();
        return send(res, 200, { ok: true });
      }
      const b = await readBody(req);
      if (typeof b.text !== "string" || !b.text.trim()) return send(res, 400, { error: "Write a message" });
      for (const m of db.messages) if (m.clientId === c.id) m.seenByOwner = true;
      return send(res, 201, addMessage(c, { role: "owner", text: b.text }).msg);
    }
    if (kind === "clients" && oid && action === "accounts" && req.method === "POST") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      return send(res, 200, await checkAccounts(c));
    }
    if (kind === "clients" && oid && req.method === "DELETE") {
      db.clients = db.clients.filter((x) => x.id !== oid);
      db.briefs = db.briefs.filter((x) => x.clientId !== oid);
      db.posts = db.posts.filter((x) => x.clientId !== oid);
      await deleteMedia(db.videos.filter((x) => x.clientId === oid).flatMap(videoFiles));
      db.videos = db.videos.filter((x) => x.clientId !== oid);
      db.messages = db.messages.filter((x) => x.clientId !== oid);
      bookings.removeClientData(oid);
      await save();
      return send(res, 200, { ok: true });
    }
    if (kind === "briefs" && req.method === "POST" && !oid) {
      const body = await readBody(req, 9e6);
      const c = db.clients.find((x) => x.id === body.clientId);
      if (!c) return send(res, 404, { error: "Client not found" });
      return send(res, 201, await addBrief(c, body, "owner"));
    }
    if (kind === "briefs" && oid && action === "archive" && req.method === "POST") {
      const b = db.briefs.find((x) => x.id === oid);
      if (!b) return send(res, 404, { error: "Brief not found" });
      b.archived = !b.archived;
      await save();
      return send(res, 200, b);
    }
    if (kind === "posts" && oid) {
      const post = db.posts.find((x) => x.id === oid);
      const c = db.clients.find((x) => x.id === post?.clientId);
      if (!post || !c) return send(res, 404, { error: "Post not found" });
      if (action === "again" && req.method === "POST") {
        const brief = db.briefs.find((b) => b.id === post.briefId);
        return send(res, 201, startPost(c, brief, "owner"));
      }
      if (action === "retry" && req.method === "POST") { post.status = "generating"; post.error = undefined; void runPost(post.id); return send(res, 200, post); }
      if (action === "publish" && req.method === "POST") { post.status = "published"; await publish(c, post); await save(); return send(res, 200, post); }
      if (action === "image" && req.method === "POST") { void redrawImage(post.id); return send(res, 202, { ok: true }); }
      if (action === "edit" && req.method === "POST") { applyText(post, await readBody(req), POST_EDITS); await save(); return send(res, 200, post); }
      if (action === "share" && req.method === "POST") {
        const { platform, lang } = await readBody(req);
        const r = await shareItem(c, post, platform, { kind: "post", lang });
        if (r.ok) { post.status = "published"; post.publishedAt ??= r.at; }
        await save();
        return send(res, r.ok ? 200 : 502, r.ok ? r : { ...r, error: r.error });
      }
      if (req.method === "DELETE") { db.posts = db.posts.filter((x) => x.id !== oid); await save(); return send(res, 200, { ok: true }); }
    }
    if (kind === "settings" && oid === "ai" && action === "puter-token" && req.method === "POST") {
      // The token Puter handed to /puter-callback in the owner's own browser (see the Sign in with Puter button).
      const { token: t } = await readBody(req);
      if (typeof t !== "string" || t.length < 20 || t.length > 4000 || /\s/.test(t)) return send(res, 400, { error: "That is not a Puter token" });
      (db.settings.ai ??= {}).puterKey = t;
      await save();
      return send(res, 200, aiSettingsView());
    }
    if (kind === "settings" && oid === "ai" && action === "models" && req.method === "GET") {
      try { return send(res, 200, { models: await listModels(url.searchParams.get("p") ?? "", fetch, url.searchParams.get("kind") === "image" ? "image" : "chat") }); }
      catch (e) { return send(res, 502, { error: e.message }); }
    }
    if (kind === "settings" && oid === "ai" && req.method === "GET") return send(res, 200, aiSettingsView());
    if (kind === "settings" && oid === "ai" && req.method === "POST" && !action) {
      const b = await readBody(req);
      const s = (db.settings.ai ??= {});
      const ids = providerList().map((p) => p.id);
      for (const p of providerList()) {
        const v = b.keys?.[p.id];
        if (typeof v === "string" && !v.startsWith("••••")) s[p.field] = v.trim().slice(0, 300);
      }
      if (b.puter && typeof b.puter === "object") {
        s.puter ??= {};
        for (const k of ["imageModel", "voiceProvider", "voice"]) if (typeof b.puter[k] === "string") s.puter[k] = /^[\w.:@\/-]{0,100}$/.test(b.puter[k].trim()) ? b.puter[k].trim() : s.puter[k] ?? "";
      }
      if (b.models && typeof b.models === "object") {
        s.models ??= {};
        for (const id of ids) if (typeof b.models[id] === "string") s.models[id] = b.models[id].split(",").map((x) => x.trim()).filter((x) => /^[\w.:\/-]{1,100}$/.test(x)).join(",");
      }
      if (typeof b.order === "string") s.order = b.order.split(",").map((x) => x.trim().toLowerCase()).filter((x) => ids.includes(x)).join(",");
      await save();
      return send(res, 200, aiSettingsView());
    }
    if (kind === "settings" && oid === "images" && req.method === "POST" && !action) {
      const b = await readBody(req);
      const s = (db.settings.images ??= {});
      if (PROVIDERS.includes(b.provider)) s.provider = b.provider;
      if (typeof b.openrouterModel === "string" && /^[\w.-]+\/[\w.:-]+$/.test(b.openrouterModel.trim())) s.openrouterModel = b.openrouterModel.trim();
      if (typeof b.googleKey === "string" && !b.googleKey.startsWith("••••")) s.googleKey = b.googleKey.trim().slice(0, 200);
      if (typeof b.pexelsKey === "string" && !b.pexelsKey.startsWith("••••")) s.pexelsKey = b.pexelsKey.trim().slice(0, 200);
      if (GOOGLE_MODELS.some((m) => m.id === b.googleModel)) s.googleModel = b.googleModel;
      if (b.googleSize === "1K" || b.googleSize === "2K") s.googleSize = b.googleSize;
      if (typeof b.fallback === "boolean") s.fallback = b.fallback;
      await save();
      return send(res, 200, imageSettingsView());
    }
    if (kind === "settings" && oid === "images" && action === "check" && req.method === "POST") {
      return send(res, 200, await checkEngine());
    }
    if (kind === "videos" && !oid && req.method === "POST") {
      const body = await readBody(req, 9e6);
      const c = db.clients.find((x) => x.id === body.clientId);
      if (!c) return send(res, 404, { error: "Client not found" });
      return send(res, 201, await addVideo(c, body, "owner"));
    }
    if (kind === "videos" && oid) {
      const v = db.videos.find((x) => x.id === oid);
      const c = db.clients.find((x) => x.id === v?.clientId);
      if (!v || !c) return send(res, 404, { error: "Video not found" });
      if (v.status === "generating" && req.method === "POST" && action !== "share") return send(res, 409, { error: "This video is still being made" });
      if (action === "again" && req.method === "POST") {
        return send(res, 201, startVideo(c, { text: v.text, seconds: v.seconds, langs: v.langs, voice: v.voice, imageDescription: v.imageDescription, reason: "owner" }));
      }
      if (action === "retry" && req.method === "POST") { rerender(v); return send(res, 200, v); }
      if (action === "edit" && req.method === "POST") {
        const body = await readBody(req);
        applyText(v, body, VIDEO_EDITS);
        if (Array.isArray(body.scenes)) body.scenes.forEach((s, i) => {
          if (!v.scenes?.[i] || !s?.text) return;
          for (const [l, t] of Object.entries(s.text)) if (LANGS.includes(l) && typeof t === "string") v.scenes[i].text[l] = t.slice(0, 80);
        });
        if (typeof body.voice === "boolean") v.voice = body.voice;
        if (Array.isArray(body.langs)) {
          const langs = body.langs.filter((l) => LANGS.includes(l)).slice(0, 4);
          if (langs.length) v.langs = langs;
        }
        await save();
        if (body.render) {
          // Languages the script doesn't cover yet need a new script; keep the images.
          if (v.langs.some((l) => !v.scenes?.every((s) => s.text?.[l]))) {
            const { scenes, endCta, voiceover, captions, title, description } = v;
            v.keep = { scenes, endCta, voiceover, captions, title, description };
            v.scenes = undefined;
          }
          rerender(v);
        }
        return send(res, 200, v);
      }
      if (action === "publish" && req.method === "POST") { v.status = "published"; await publish(c, v, "video"); await save(); return send(res, 200, v); }
      if (action === "share" && req.method === "POST") {
        const { platform, lang } = await readBody(req);
        const r = await shareItem(c, v, platform, { kind: "video", lang });
        if (r.ok) { v.status = "published"; v.publishedAt ??= r.at; }
        await save();
        return send(res, r.ok ? 200 : 502, r);
      }
      if (req.method === "DELETE") { await deleteMedia(videoFiles(v)); db.videos = db.videos.filter((x) => x.id !== oid); await save(); return send(res, 200, { ok: true }); }
    }
    return send(res, 404, { error: "not found" });
  }

  // --- Public share page for one post or video (Open Graph for Facebook / X link previews) ---
  if (seg[0] === "p" && seg[1]) {
    const post = db.posts.find((x) => x.shareKey === seg[1] && x.imageFile);
    const video = post ? null : db.videos.find((x) => x.shareKey === seg[1] && x.renders);
    const item = post ?? video;
    const client = db.clients.find((c) => c.id === item?.clientId);
    if (!item || !client) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(sharePage({ item, kind: post ? "post" : "video", client, base: base(req), lang: url.searchParams.get("lang") ?? client.languages?.[0] }));
  }


  // --- Brand: design tokens, logo and favicon set (also at the root paths browsers probe by default) ---
  const ROOT_ICONS = { "/favicon.ico": "logo/favicon.ico", "/apple-touch-icon.png": "logo/apple-touch-icon.png", "/apple-touch-icon-precomposed.png": "logo/apple-touch-icon.png", "/site.webmanifest": "site.webmanifest" };
  const brandRel = ROOT_ICONS[p] ?? (seg[0] === "brand" && seg.length >= 2 && seg.length <= 3 && /^[\w.-]+(\/[\w.-]+)?$/.test(seg.slice(1).join("/")) && /\.(css|json|svg|png|ico|webmanifest)$/.test(p) ? seg.slice(1).join("/") : null);
  if (brandRel && req.method === "GET") {
    const file = normalize(join(BRAND_DIR, brandRel));
    if (!file.startsWith(BRAND_DIR) || !existsSync(file)) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": file.endsWith(".webmanifest") ? "application/manifest+json" : MIME[file.split(".").pop()], "Cache-Control": "no-cache" });
    return res.end(readFileSync(file));
  }

  // --- Generated and uploaded images and videos (with byte ranges, so videos can seek) ---
  if (seg[0] === "media" && seg[1]) {
    const file = normalize(join(MEDIA_DIR, seg[1]));
    if (!file.startsWith(MEDIA_DIR) || !existsSync(file)) return send(res, 404, { error: "not found" });
    const size = statSync(file).size;
    const head = { "Content-Type": MIME[file.split(".").pop()] ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*" };
    if (url.searchParams.has("download")) head["Content-Disposition"] = `attachment; filename="${seg[1].replace(/[^\w.-]/g, "")}"`;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { ...head, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...head, "Content-Length": size });
    if (req.method === "HEAD") return res.end();
    return createReadStream(file).pipe(res);
  }

  // --- Client websites: sites/<client-name>/ ---
  if (seg[0] === "sites" && seg[1]) {
    if (!p.endsWith("/") && !p.split("/").pop().includes(".")) { res.writeHead(301, { Location: p + "/" }); return res.end(); }
    const file = normalize(join(SITES_DIR, ...seg.slice(1), p.endsWith("/") ? "index.html" : ""));
    if (!file.startsWith(SITES_DIR) || !existsSync(file) || seg.slice(1).some((x) => x.startsWith("."))) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[file.split(".").pop()] ?? (file.endsWith(".xml") ? "application/xml" : file.endsWith(".txt") ? "text/plain" : "application/octet-stream") });
    return res.end(readFileSync(file));
  }

  // --- Built app (npm run build) ---
  const dist = join(root, "dist");
  const file = normalize(join(dist, p));
  // The app itself (index.html) is only served at /admin, behind the password.
  if (file.startsWith(dist) && existsSync(file) && !file.endsWith("/") && !file.endsWith(".html")) {
    res.writeHead(200, { "Content-Type": MIME[file.split(".").pop()] ?? "application/octet-stream" });
    return res.end(readFileSync(file));
  }
  send(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    // The dashboard can pick one AI provider for what it starts (x-ai-provider); only the owner may.
    const pick = auth.isAdmin(req) ? String(req.headers["x-ai-provider"] ?? "") : "";
    await runWithProvider(/^[a-z]+$/.test(pick) ? pick : "", () => route(req, res, url));
  } catch (e) {
    if (res.headersSent) return res.end(`\u0000error:${e.message}`);
    send(res, e.status ?? 502, { error: e.message });
  }
});

server.listen(PORT, process.env.HOST || undefined, () => {
  console.log(`Isla API on http://localhost:${PORT}`);
  console.log(`  AI: ${KEYF() ? `${providerNames().join(" > ")} (first one with capacity answers)` : "No AI key in .env (GROQ_API_KEY, MISTRAL_API_KEY or OPENROUTER_API_KEY), so posts and sites wait until one is added"}`);
  console.log(`  Images: Pollinations (free, no key) · data in ${DATA_DIR} · sites in ${SITES_DIR}`);
  startScheduler();
  startVideoScheduler();
  startAssistant();
  startSiteRetries(); // resumes half-built sites and retries waiting ones (the live site stays up meanwhile)
  setInterval(() => videoTick(), 60e3).unref();
  videoTick();
});
