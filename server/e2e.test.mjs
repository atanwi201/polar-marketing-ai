// End-to-end against fakes of OpenRouter, Pollinations, Meta (Facebook + Instagram), X and YouTube:
// sign-up -> website + first post, a portal brief, sharing to every platform, and a rendered video ad.
import http from "node:http";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "isla-"));
let hasFfmpeg = true;
try { execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=orange:s=96x170", "-frames:v", "1", join(dir, "img.jpg")]); }
catch { hasFfmpeg = false; }
// 1x1 jpeg when ffmpeg is missing (posts only need some bytes)
const JPG = hasFfmpeg ? readFileSync(join(dir, "img.jpg")) : Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

let chats = 0;
// A designed page as a model would write it (with a script and an outside image that must be removed).
const DESIGNED = (lang) => `<!doctype html><html lang="${lang}"><head><!-- design: sea blue and sand, Fraunces + Inter --><title>${lang === "es" ? "Tasca Prueba · Pescado fresco en Los Cristianos" : "Tasca Prueba · Fresh fish in Los Cristianos"}</title>
<meta name="description" content="${lang === "es" ? "Pescado del día junto al mar." : "Catch of the day by the sea."}"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap">
<style>:root{--p:#0a6a86}${".x{color:var(--p)}".repeat(200)}</style></head><body><header><nav class="lang-switch" data-lang-switch aria-label="Language"></nav></header>
<main><h1>${lang === "es" ? "Pescado fresco en Los Cristianos" : "Fresh fish in Los Cristianos"}</h1><img src="images/stock-1.jpg" alt="hero" width="1600" height="1000"><img src="https://evil.example/x.jpg" alt="x">
<script>alert(1)</script><section id="faq"><details><summary>${lang === "es" ? "¿Reservas?" : "Bookings?"}</summary><p>WhatsApp.</p></details><details><summary>${lang === "es" ? "¿Horario?" : "Hours?"}</summary><p>12-23.</p></details></section>
<iframe src="https://maps.google.com/maps?q=Tasca&output=embed" title="Map"></iframe></main><footer>© Tasca</footer></body></html>`;
const calls = []; // [method, path, auth] seen by the fake social APIs
const json = (res, body, code = 200, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
const mock = http.createServer((req, res) => {
  const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
    const body = Buffer.concat(chunks).toString();
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    if (p === "/openverse/v1/images/") return json(res, { results: [1, 2, 3, 4, 5, 6].map((i) => ({ url: `http://localhost:9901/stock/${u.searchParams.get("q").length}-${i}.jpg`, width: 1600, height: 1000, title: "Fresh fish", license: "cc0" })) });
    if (p.startsWith("/stock/")) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(JPG); }
    if (p.startsWith("/prompt/")) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(JPG); }
    if (p === "/v1/models") return json(res, { data: [
      { id: "deepseek/deepseek-chat-v3-0324:free", pricing: { prompt: "0", completion: "0" }, context_length: 160000, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
      { id: "google/gemini-2.0-flash-exp:free", pricing: { prompt: "0", completion: "0" }, context_length: 1000000, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
      { id: "openai/gpt-4o", pricing: { prompt: "0.00001", completion: "0.00003" } } ] });
    if (p === "/v1/chat/completions") {
      chats++;
      const b = JSON.parse(body);
      const text = JSON.stringify(b.messages);
      if (b.models.some((m) => !m.endsWith(":free"))) { res.writeHead(500); return res.end("paid model used!"); }
      let content;
      if (Array.isArray(b.messages.at(-1).content)) content = "A sunny terrace with grilled fish on a white plate, sea in the background.";
      else if (text.includes("asks for a change")) content = "SUMMARY: Título cambiado\n<<<<<<< FIND\n<h1>Pescado fresco en Los Cristianos</h1>\n=======\n<h1>El mejor pescado de Los Cristianos</h1>\n>>>>>>> END";
      else if (text.includes("The same change was just made")) content = "SUMMARY: Title changed\n<<<<<<< FIND\n<h1>Fresh fish in Los Cristianos</h1>\n=======\n<h1>The best fish in Los Cristianos</h1>\n>>>>>>> END";
      else if (text.includes("award-winning web designer")) content = "Here is the site:\n```html\n" + DESIGNED("es") + "\n```";
      else if (text.includes("Translate this website into English")) content = DESIGNED("en");
      else if (text.includes("website copy")) content = "```json\n" + JSON.stringify({ metaTitle: "Tasca Prueba · Seafood restaurant Los Cristianos", metaDescription: "Fresh fish on the promenade. Book by WhatsApp.", h1: "Fresh fish by the sea", tagline: "Seafood in Los Cristianos", intro: "We grill the catch of the day.", services: [{ name: "Grilled fish", description: "Catch of the day." }, { name: "Paella", description: "For two." }], about: "Family run.", why: ["Fresh", "Sea view", "Local"], faq: [{ q: "Do you take bookings?", a: "Yes, on WhatsApp." }], cta: "Book on WhatsApp", keywords: ["seafood los cristianos"], imagePrompts: { hero: "terrace", services: ["fish", "paella"] } }) + "\n```";
      else if (text.includes("assistant inside the marketing app")) {
        const prompt = String(b.messages.at(-1).content);
        const said = /New message from the business:\n"""([\s\S]*?)"""/.exec(prompt)?.[1] ?? "";
        const attached = /Attached: (image|video)/.exec(prompt)?.[1];
        const base = { reply: "Hecho", needsOwner: false, concept: "Plátanos", overlay: { badge: "Oferta", headline: "Plátanos de Canarias", subline: "1,50 €/kg" },
          captions: { es: "Plátanos a 1,50 €/kg", en: "Bananas at €1.50/kg" }, short: { es: "Plátanos", en: "Bananas" }, hashtags: ["tenerife"], altText: "Plátanos", imagePrompt: "bananas", videoSeconds: 15, info: {} };
        const j = attached ? { ...base, action: "media_post" }
          : /horario/i.test(said) ? { ...base, action: "update_info", reply: "Horario cambiado", info: { hours: "9:00-14:00" } }
          : /factura/i.test(said) ? { ...base, action: "answer", reply: "Se lo paso a tu equipo", needsOwner: true }
          : { ...base, action: "ai_post" };
        content = JSON.stringify(j);
      }
      else if (text.includes("vertical video ad")) content = JSON.stringify({ concept: "Sunset fish", scenes: [1, 2, 3].map((i) => ({ imagePrompt: `scene ${i}`, text: { es: `Escena ${i}`, en: `Scene ${i}` } })), endCta: { es: "Reserva ya", en: "Book now" }, voiceover: { es: "Hola", en: "Hello" }, captions: { es: "Pescado al atardecer", en: "Sunset fish" }, title: { es: "Pescado", en: "Fish" }, description: { es: "Ven", en: "Come" }, hashtags: ["tenerife"] });
      else content = JSON.stringify({ concept: "Catch of the day " + chats, imagePrompt: "grilled fish on a terrace", altText: "Grilled fish on a white plate", captions: { es: "Pescado fresco hoy", en: "Fresh fish today" }, short: { es: "Pescado fresco", en: "Fresh fish" }, hashtags: ["tenerife"], cta: "Reserva" });
      if (b.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ model: b.models[0], choices: [{ delta: { content } }] })}\n\n`);
        return res.end("data: [DONE]\n\n");
      }
      return json(res, { model: b.models[0], choices: [{ message: { content } }] });
    }
    // --- Meta Graph ---
    if (p.startsWith("/graph/") || p.startsWith("/rupload/")) {
      const params = u.searchParams.size ? u.searchParams : new URLSearchParams(body);
      calls.push([req.method, p, req.headers.authorization ?? params.get("access_token") ?? (body.includes("PAGETOKEN") ? "PAGETOKEN" : "")]);
      if (p.startsWith("/rupload/")) return json(res, { success: true });
      if (p === "/graph/PAGE1/photos") return json(res, { id: "ph1", post_id: "PAGE1_77" });
      if (p === "/graph/PAGE1/video_reels") return json(res, params.get("upload_phase") === "start" ? { video_id: "v55", upload_url: "http://localhost:9901/rupload/v55" } : { success: true });
      if (p === "/graph/IG1/media") return json(res, params.get("media_type") === "REELS" ? { id: "c2", uri: "http://localhost:9901/rupload/c2" } : { id: "c1" });
      if (p === "/graph/IG1/media_publish") return json(res, { id: "m1" });
      if (p === "/graph/m1") return json(res, { permalink: "https://www.instagram.com/p/abc/" });
      if (p === "/graph/c1" || p === "/graph/c2") return json(res, { status_code: "FINISHED" });
      if (p === "/graph/PAGE1") return json(res, { name: "Tasca Page" });
      if (p === "/graph/IG1") return json(res, { username: "tasca" });
    }
    // --- X ---
    if (p.startsWith("/x/")) {
      calls.push([req.method, p, req.headers.authorization ?? ""]);
      if (!/^OAuth .*oauth_signature=/.test(req.headers.authorization ?? "")) return json(res, { title: "Unauthorized" }, 401);
      if (p === "/x/2/media/upload") return json(res, { data: { id: "555" } });
      if (p === "/x/2/media/metadata") return json(res, { data: {} });
      if (p === "/x/2/tweets") return json(res, { data: { id: "999", text: JSON.parse(body).text } });
      if (p === "/x/2/users/me") return json(res, { data: { username: "tasca" } });
    }
    // --- Google / YouTube ---
    if (p === "/token") return json(res, { access_token: "ya29.test" });
    if (p.startsWith("/yt/")) {
      calls.push([req.method, p, req.headers.authorization ?? ""]);
      if (p === "/yt/upload/youtube/v3/videos" && req.method === "POST") return json(res, {}, 200, { Location: "http://localhost:9901/yt/upload/session1" });
      if (p === "/yt/upload/session1" && req.method === "PUT") return json(res, { id: "yt123" });
    }
    res.writeHead(404); res.end();
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const B = "http://localhost:8799";
const api = async (method, path, body) => {
  const r = await fetch(B + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null), headers: r.headers };
};
const until = async (fn, tries = 80, ms = 250) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

let srv;
before(async () => {
  await new Promise((ok) => mock.listen(9901, ok));
  srv = spawn(process.execPath, [join(import.meta.dirname, "index.mjs")], {
    env: {
      ...process.env, OPENROUTER_API_KEY: "test", OPENROUTER_BASE_URL: "http://localhost:9901/v1", POLLINATIONS_BASE_URL: "http://localhost:9901", OPENVERSE_URL: "http://localhost:9901/openverse", PEXELS_API_KEY: "",
      PORT: "8799", DATA_DIR: dir, SITES_DIR: join(dir, "sites"), PUBLIC_URL: "https://studio.example", ADMIN_TOKEN: "",
      META_GRAPH_URL: "http://localhost:9901/graph", X_API_URL: "http://localhost:9901/x", GOOGLE_TOKEN_URL: "http://localhost:9901/token",
      YOUTUBE_API_URL: "http://localhost:9901/yt", GOOGLE_API_KEY: "", GEMINI_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "", SILICONFLOW_API_KEY: "", DEEPSEEK_API_KEY: "", DASHSCOPE_API_KEY: "", OPENAI_API_KEY: "", PUTER_AUTH_TOKEN: "", AI_PROVIDERS: "openrouter", X_API_KEY: "ck", X_API_SECRET: "cs", YOUTUBE_CLIENT_ID: "gid", YOUTUBE_CLIENT_SECRET: "gs", SOCIAL_POLL_MS: "50",
    },
    stdio: "ignore",
  });
  await sleep(900);
});
after(() => { srv?.kill(); mock.close(); });

let token, clientId, post;

test("sign-up builds a site and a post using only free models", async () => {
  const dataUrl = `data:image/jpeg;base64,${JPG.toString("base64")}`;
  const r = await fetch(B + "/api/signup", { method: "POST", body: JSON.stringify({
    name: "Tasca Prueba", kind: "Restaurant", town: "Los Cristianos", phone: "+34 600 000 000", email: "a@b.es", languages: ["es", "en"],
    offer: "Fresh fish on the promenade", hours: "12-23", acceptTerms: true, domain: "tascaprueba",
    logo: dataUrl, photos: [dataUrl],
    profile: { tagline: "Pescado del día", style: "warm", address: "Paseo Marítimo 5", services: [{ name: "Parrillada", price: "18 €", description: "" }, { name: "" }],
      social: { instagram: "instagram.com/tasca", facebook: "javascript:alert(1)" }, colors: { primary: "#123456", accent: "nope" } },
  }) });
  assert.equal(r.status, 201);
  ({ token } = await r.json());
  // New businesses wait for the owner: nothing is made and the AI features are closed until approval.
  const waiting = (await api("GET", `/api/portal/${token}`)).data;
  assert.equal(waiting.access.approval, "pending");
  assert.equal(waiting.client.site, null);
  assert.equal(waiting.posts.length, 0);
  const closed = await api("POST", `/api/portal/${token}/briefs`, { text: "Pescado fresco hoy" });
  assert.equal(closed.status, 403);
  assert.equal(closed.data.code, "pending");
  assert.equal((await api("POST", `/api/portal/${token}/messages`, { text: "Hola" })).status, 403);
  const pendingId = (await api("GET", "/api/studio")).data.clients.find((c) => c.approvalStatus === "pending").id;
  assert.equal((await api("POST", `/api/studio/clients/${pendingId}/approve`)).status, 200);
  const v = await until(async () => {
    const x = (await api("GET", `/api/portal/${token}`)).data;
    return x.client.site?.status === "ready" && x.posts[0]?.status === "ready" ? x : null;
  });
  assert.ok(v, "site and post ready");
  post = v.posts[0];
  assert.ok(existsSync(join(dir, "sites", "tasca-prueba", "en", "index.html")));
  // Everything from the sign-up wizard was kept, safely, and reached the website.
  const prof = v.profile;
  assert.ok(prof.logoFile && prof.photos.length === 1);
  assert.equal(prof.profile.address, "Paseo Marítimo 5");
  assert.deepEqual(prof.profile.services.map((x) => x.name), ["Parrillada"]);
  assert.equal(prof.profile.social.instagram, "https://instagram.com/tasca");
  assert.equal(prof.profile.social.facebook, undefined, "a script link is not a URL");
  assert.equal(prof.profile.colors.primary, "#123456");
  assert.equal(prof.profile.colors.accent, undefined);
  assert.ok(!prof.missing.includes("logo") && prof.missing.includes("photos"));
  assert.ok(existsSync(join(dir, "sites", "tasca-prueba", "images", "logo.png")));
  assert.ok(existsSync(join(dir, "sites", "tasca-prueba", "images", "photo-1.jpg")));
  const studio0 = (await api("GET", "/api/studio")).data.clients[0];
  assert.equal(studio0.domain, "", "a domain without an ending is not kept");
  // The page was designed by the model, made safe, and given the SEO head.
  const site = readFileSync(join(dir, "sites", "tasca-prueba", "index.html"), "utf8");
  const en = readFileSync(join(dir, "sites", "tasca-prueba", "en", "index.html"), "utf8");
  assert.match(site, /Pescado fresco en Los Cristianos/);
  assert.match(en, /Fresh fish in Los Cristianos/);
  assert.doesNotMatch(site, /alert\(1\)|evil\.example/);
  assert.match(site, /<link rel="canonical"/);
  assert.match(site, /"@type":"FAQPage"/);
  assert.match(en, /src="\.\.\/images\/stock-1\.jpg"/);
  assert.match(site, /maps\.google\.com\/maps\?q=Tasca&output=embed/);
  assert.equal((await fetch(`${B}/media/${post.imageFile}`)).status, 200);
  assert.equal(post.altText, "Grilled fish on a white plate");
  assert.equal(post.short.es, "Pescado fresco");
  assert.ok(post.shareKey);
  const again = await fetch(`${B}/api/portal/${token}/posts/${post.id}/again`, { method: "POST" });
  assert.equal(again.status, 201);
});

test("share page has Open Graph tags for Facebook and X", async () => {
  const r = await fetch(`${B}/p/${post.shareKey}?lang=en`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, new RegExp(`<meta property="og:image" content="https://studio.example/media/${post.imageFile}">`));
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /Fresh fish today/);
  assert.equal((await fetch(`${B}/p/nope`)).status, 404);
});

test("accounts are stored masked and posts go to Facebook, Instagram and X", async () => {
  const studio = (await api("GET", "/api/studio")).data;
  clientId = studio.clients[0].id;
  const saved = await api("POST", "/api/studio/clients", {
    id: clientId, platforms: ["instagram", "facebook", "x", "youtube"],
    accounts: { facebook: { pageId: "PAGE1", token: "PAGETOKEN" }, instagram: { userId: "IG1", token: "" }, x: { token: "xt", secret: "xs" }, youtube: { refreshToken: "1//refresh" } },
  });
  assert.equal(saved.data.accounts.facebook.token, "••••OKEN");
  assert.deepEqual(Object.values(saved.data.connections).map((c) => c.ready), [true, true, true, true]);
  // Saving the masked value back keeps the real token.
  await api("POST", "/api/studio/clients", { id: clientId, accounts: saved.data.accounts });
  const check = (await api("POST", `/api/studio/clients/${clientId}/accounts`)).data;
  assert.deepEqual([check.facebook.name, check.instagram.name, check.x.name], ["Tasca Page", "@tasca", "@tasca"]);

  for (const platform of ["facebook", "instagram", "x"]) {
    const r = await api("POST", `/api/studio/posts/${post.id}/share`, { platform, lang: "es" });
    assert.equal(r.status, 200, `${platform}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.ok && r.data.url, platform);
  }
  assert.ok(calls.some(([m, p, auth]) => p === "/graph/PAGE1/photos" && auth === "PAGETOKEN"), "facebook photo with the real token");
  assert.ok(calls.some(([, p]) => p === "/graph/IG1/media_publish"));
  assert.ok(calls.some(([, p]) => p === "/x/2/tweets"));
  const p2 = (await api("GET", "/api/studio")).data.posts.find((x) => x.id === post.id);
  assert.equal(p2.status, "published");
  assert.equal(p2.shares["x:es"].url, "https://x.com/i/web/status/999");
  // YouTube is for videos only
  const yt = await api("POST", `/api/studio/posts/${post.id}/share`, { platform: "youtube" });
  assert.equal(yt.status, 502);
});

test("post text can be edited and the image redrawn", async () => {
  const e = await api("POST", `/api/studio/posts/${post.id}/edit`, { captions: { es: "Nuevo texto" }, hashtags: ["#a b", "c"] });
  assert.equal(e.data.captions.es, "Nuevo texto");
  assert.equal(e.data.captions.en, "Fresh fish today");
  assert.deepEqual(e.data.hashtags, ["ab", "c"]);
  const before = e.data.imageFile;
  assert.equal((await api("POST", `/api/studio/posts/${post.id}/image`)).status, 202);
  const after = await until(async () => {
    const p = (await api("GET", "/api/studio")).data.posts.find((x) => x.id === post.id);
    return p.status !== "generating" && p.imageFile !== before ? p : null;
  });
  assert.ok(after, "new image file");
  assert.equal(after.captions.es, "Nuevo texto");
});

test("a video ad is rendered as 1080x1920 MP4 and posted to Reels and YouTube Shorts", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const r = await api("POST", "/api/studio/videos", { clientId, text: "Sunset fish menu, 20 euros", seconds: 15, langs: ["es"] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const v = await until(async () => {
    const x = (await api("GET", "/api/studio")).data.videos.find((y) => y.id === r.data.id);
    if (x.status === "failed") throw new Error(x.error);
    return x.status === "ready" ? x : null;
  }, 240, 500);
  assert.ok(v, "video ready");
  const out = v.renders.es;
  assert.equal(v.scenes.length, 3);
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt:format=duration", "-of", "json", join(dir, "media", out.file)]).toString();
  const info = JSON.parse(probe);
  const vs = info.streams.find((s) => s.codec_name === "h264");
  assert.deepEqual([vs.width, vs.height, vs.pix_fmt], [1080, 1920, "yuv420p"]);
  assert.ok(info.streams.some((s) => s.codec_name === "aac"));
  assert.ok(Math.abs(Number(info.format.duration) - 15) < 0.5);

  // Byte ranges, so phones can play and seek.
  const part = await fetch(`${B}/media/${out.file}`, { headers: { Range: "bytes=0-99" } });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  const page = await (await fetch(`${B}/p/${v.shareKey}`)).text();
  assert.match(page, /og:video/);
  // Portal sees it too.
  assert.equal((await api("GET", `/api/portal/${token}`)).data.videos[0].renders.es.file, out.file);

  for (const platform of ["instagram", "facebook", "youtube"]) {
    const s = await api("POST", `/api/studio/videos/${v.id}/share`, { platform, lang: "es" });
    assert.equal(s.status, 200, `${platform}: ${JSON.stringify(s.data)}`);
  }
  assert.ok(calls.some(([, p]) => p === "/rupload/v55"), "facebook reel uploaded");
  assert.ok(calls.some(([, p]) => p === "/rupload/c2"), "instagram reel uploaded");
  assert.ok(calls.some(([m, p, auth]) => m === "PUT" && p === "/yt/upload/session1"));
  assert.ok(calls.some(([, p, auth]) => p === "/yt/upload/youtube/v3/videos" && auth === "Bearer ya29.test"));
  const final = (await api("GET", "/api/studio")).data.videos.find((y) => y.id === v.id);
  assert.equal(final.shares["youtube:es"].url, "https://youtube.com/shorts/yt123");

  // Edit the on-screen text and render again with the same images.
  const img0 = final.scenes[0].imageFile;
  const ed = await api("POST", `/api/studio/videos/${v.id}/edit`, { scenes: [{ text: { es: "Nuevo gancho" } }], render: true });
  assert.equal(ed.status, 200);
  const again = await until(async () => {
    const x = (await api("GET", "/api/studio")).data.videos.find((y) => y.id === v.id);
    return x.status !== "generating" && x.renders.es.file !== out.file ? x : null;
  }, 240, 500);
  assert.ok(again, "re-rendered");
  assert.equal(again.scenes[0].imageFile, img0);
  assert.equal(again.scenes[0].text.es, "Nuevo gancho");
  assert.equal((await fetch(`${B}/media/${out.file}`)).status, 404, "old render removed");
});

test("the assistant turns a photo into an offer post with the text on top", async () => {
  const up = await fetch(`${B}/api/portal/${token}/upload`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: JPG });
  assert.equal(up.status, 201);
  const { file, kind } = await up.json();
  assert.equal(kind, "image");
  const m = await fetch(`${B}/api/portal/${token}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "quiero ofrecer plátanos a 1,50 €/kg", attachments: [file], lang: "es" }) });
  assert.equal(m.status, 201);
  const { replyId } = await m.json();
  const done = await until(async () => {
    const v = (await api("GET", `/api/portal/${token}`)).data;
    const r = v.messages.find((x) => x.id === replyId);
    const p = v.posts.find((x) => x.id === r?.postId);
    return r?.status === "done" && p?.status === "ready" ? { r, p } : null;
  });
  assert.ok(done, "reply and post ready");
  assert.equal(done.r.text, "Hecho");
  assert.equal(done.p.kind, "photo");
  const img = await fetch(`${B}/media/${done.p.imageFile}`);
  assert.equal(img.status, 200);
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const pic = await loadImage(Buffer.from(await img.arrayBuffer()));
  assert.deepEqual([pic.width, pic.height], [1080, 1350]);
  // Someone else's file can't be attached.
  const bad = await fetch(`${B}/api/portal/${token}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attachments: ["up-not-mine.jpg"] }) });
  assert.equal(bad.status, 400);
});

test("the assistant updates opening hours and flags billing questions for the owner", async () => {
  const send = (text) => fetch(`${B}/api/portal/${token}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang: "es" }) }).then((r) => r.json());
  const a = await send("nuevo horario: de 9 a 14");
  const b = await send("tengo una duda con mi factura");
  const v = await until(async () => {
    const d = (await api("GET", "/api/studio")).data;
    const ra = d.messages.find((x) => x.id === a.replyId), rb = d.messages.find((x) => x.id === b.replyId);
    return ra?.status === "done" && rb?.status === "done" ? { d, ra, rb } : null;
  });
  assert.ok(v);
  assert.equal(v.d.clients.find((c) => c.id === clientId).hours, "9:00-14:00");
  assert.deepEqual(v.ra.updated, ["hours"]);
  assert.equal(v.rb.needsOwner, true);
  assert.equal(v.rb.seenByOwner, false);
  // The owner answers in the same chat; that marks it as seen.
  const own = await api("POST", `/api/studio/clients/${clientId}/messages`, { text: "Hola, te escribo por WhatsApp" });
  assert.equal(own.status, 201);
  const after = (await api("GET", "/api/studio")).data.messages.find((x) => x.id === b.replyId);
  assert.equal(after.seenByOwner, true);
  assert.ok((await api("GET", `/api/portal/${token}`)).data.messages.some((m) => m.role === "owner" && m.text.startsWith("Hola")));
});

test("the assistant turns a client's video into a vertical Reel with the offer on top", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const clip = join(dir, "clip-in.mp4");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=3", "-pix_fmt", "yuv420p", "-c:v", "libx264", clip]);
  const up = await fetch(`${B}/api/portal/${token}/upload`, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: readFileSync(clip) });
  assert.equal(up.status, 201);
  const u = await up.json();
  assert.equal(u.kind, "video");
  const m = await (await fetch(`${B}/api/portal/${token}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "plátanos frescos", attachments: [u.file] }) })).json();
  const v = await until(async () => {
    const d = (await api("GET", `/api/portal/${token}`)).data;
    const r = d.messages.find((x) => x.id === m.replyId);
    const vid = d.videos.find((x) => x.id === r?.videoId);
    if (vid?.status === "failed") throw new Error("clip failed");
    return vid?.status === "ready" ? vid : null;
  }, 160, 500);
  assert.ok(v, "clip ready");
  const out = Object.values(v.renders)[0];
  const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", join(dir, "media", out.file)]).toString());
  const vs = info.streams.find((s) => s.codec_name === "h264");
  assert.deepEqual([vs.width, vs.height], [1080, 1920]);
  assert.ok(info.streams.some((s) => s.codec_name === "aac"), "has a sound track");
  assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.5);
  // Not a video: refused.
  const junk = await fetch(`${B}/api/portal/${token}/upload`, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: Buffer.alloc(5000, 1) });
  assert.equal(junk.status, 400);
});

test("the business completes its website info from the dashboard and the site is rebuilt", async () => {
  const before = (await api("GET", `/api/portal/${token}`)).data.client.site.builtAt;
  const r = await api("POST", `/api/portal/${token}/profile`, { profile: { address: "Avenida 1", story: "Desde 1990" }, hours: "9-14" });
  assert.equal(r.status, 200);
  assert.equal(r.data.profile.address, "Avenida 1");
  const v = await until(async () => {
    const d = (await api("GET", `/api/portal/${token}`)).data;
    return d.client.site.status === "ready" && d.client.site.builtAt !== before ? d : null;
  }, 120, 250);
  assert.ok(v, "website rebuilt");
  assert.equal((await api("GET", "/api/studio")).data.clients.find((c) => c.id === clientId).hours, "9-14");
});

test("the weekly limit stops new posts from the business, but not the owner's", async () => {
  const before = (await api("GET", "/api/studio")).data.clients.find((x) => x.id === clientId).usage;
  assert.ok(before.used >= 1 && before.cap === 7 && !before.custom);
  assert.equal((await api("POST", `/api/studio/clients/${clientId}/cap`, { postCap: before.used })).status, 200);
  const portal = (await api("GET", `/api/portal/${token}`)).data;
  assert.deepEqual([portal.access.used, portal.access.cap], [before.used, before.used]);
  const blocked = await api("POST", `/api/portal/${token}/briefs`, { text: "Otra oferta de pescado" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.code, "cap");
  assert.match(blocked.data.error, /publicaciones de esta semana/);
  const mine = await api("POST", "/api/studio/briefs", { clientId, text: "Owner's own post" });
  assert.equal(mine.status, 201, "the owner is never limited");
  assert.equal((await api("GET", "/api/studio")).data.clients.find((x) => x.id === clientId).usage.used, before.used, "and it doesn't count");
  // Back to the default, which the owner can change for everyone.
  assert.equal((await api("POST", `/api/studio/clients/${clientId}/cap`, { postCap: null })).status, 200);
  assert.equal((await api("POST", "/api/studio/settings/limits", { postsPerWeek: 20 })).status, 200);
  assert.equal((await api("GET", `/api/portal/${token}`)).data.access.cap, 20);
  assert.equal((await api("POST", "/api/studio/settings/limits", { postsPerWeek: -1 })).status, 400);
});

test("the website chat changes the live site in every language, and undo puts it back", async () => {
  const site = (await api("GET", `/api/portal/${token}`)).data.client.site;
  const r = await api("POST", `/api/studio/clients/${clientId}/site-chat`, { message: "Cambia el título a algo más vendedor" });
  assert.equal(r.status, 202);
  const done = await until(async () => {
    const c = (await api("GET", "/api/studio")).data.clients.find((x) => x.id === clientId);
    return c.siteEdit?.status === "idle" ? c : null;
  }, 120, 250);
  assert.ok(done, "change finished");
  assert.equal(done.siteChat.at(-1).text, "Título cambiado");
  assert.equal(done.siteVersions, 1);
  const es = await (await fetch(`${B}${site.url}`)).text();
  const en = await (await fetch(`${B}${site.url}en/`)).text();
  assert.match(es, /El mejor pescado de Los Cristianos/);
  assert.match(en, /The best fish in Los Cristianos/);
  assert.match(es, /application\/ld\+json/, "still has the SEO head");
  assert.doesNotMatch(es, /<script>alert/, "still safe");
  const undo = await api("POST", `/api/studio/clients/${clientId}/site-undo`);
  assert.equal(undo.status, 200);
  assert.match(await (await fetch(`${B}${site.url}`)).text(), /<h1>Pescado fresco en Los Cristianos<\/h1>/);
  assert.equal((await api("POST", `/api/studio/clients/${clientId}/site-undo`)).status, 400, "nothing left to undo");
});

test("the owner downloads a site as a zip and uploads a replacement", async () => {
  const { unzipSync, zipSync } = await import("fflate");
  const c = (await api("GET", "/api/studio")).data.clients.find((x) => x.site?.status === "ready");
  assert.ok(c, "a client with a live site");
  const dl = await fetch(`${B}/api/studio/clients/${c.id}/site.zip`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-type"), "application/zip");
  assert.ok(Object.keys(unzipSync(new Uint8Array(await dl.arrayBuffer()))).includes("index.html"));
  const qr = (await api("GET", `/api/studio/clients/${c.id}/qr`)).data;
  assert.match(qr.svg, /^<svg/);
  assert.ok(qr.url.startsWith("http"));
  const ptok = (await api("GET", "/api/studio")).data.clients.find((x) => x.id === c.id).token;
  assert.match((await api("GET", `/api/portal/${ptok}/qr`)).data.svg, /^<svg/);
  assert.equal((await fetch(`${B}/api/portal/${ptok}/qr.png`)).headers.get("content-type"), "image/png");
  const qrPng = await fetch(`${B}/api/studio/clients/${c.id}/qr.png`);
  assert.equal(qrPng.headers.get("content-type"), "image/png");
  const bad = await fetch(`${B}/api/studio/clients/${c.id}/site-upload`, { method: "POST", body: Buffer.from("nope") });
  assert.equal(bad.status, 400);
  const mine = Buffer.from(zipSync({ "my/index.html": new TextEncoder().encode("<!doctype html><h1>Uploaded by hand</h1>"), "my/style.css": new TextEncoder().encode("h1{color:red}") }));
  const up = await fetch(`${B}/api/studio/clients/${c.id}/site-upload`, { method: "POST", body: mine });
  assert.equal(up.status, 200);
  const live = await fetch(`${B}${c.site.url}`);
  assert.match(await live.text(), /Uploaded by hand/);
  assert.equal((await fetch(`${B}${c.site.url}style.css`)).headers.get("content-type"), "text/css");
  assert.equal((await api("GET", "/api/studio")).data.clients.find((x) => x.id === c.id).site.kind, "upload");
});

test("landing page: the owner creates a password and signs in, a business enters with its code", async () => {
  const home = await fetch(`${B}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Soy cliente/);
  assert.deepEqual((await api("GET", "/api/auth")).data, { admin: false, setup: true, fromEnv: false });

  // First run: the password is created (8+ characters) and the owner is signed in.
  assert.equal((await api("POST", "/api/auth/login", { password: "short" })).status, 400);
  const login = await fetch(`${B}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "olas-de-teide-1" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);

  // From now on the dashboard, its API and the AI proxy need the session.
  assert.equal((await fetch(`${B}/api/studio`)).status, 401);
  assert.equal((await fetch(`${B}/api/ai`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(`${B}/api/studio`, { headers: { cookie } })).status, 200);
  const admin = await fetch(`${B}/admin/`, { redirect: "manual" });
  assert.equal(admin.status, 302);
  assert.equal(admin.headers.get("location"), "/");
  assert.equal((await fetch(`${B}/index.html`)).status, 404, "the app isn't reachable around the password");
  assert.deepEqual((await (await fetch(`${B}/api/auth`, { headers: { cookie } })).json()).admin, true);
  assert.equal((await api("POST", "/api/auth/login", { password: "wrong-password" })).status, 401);

  // Every business has a code like ABC-123; typing it (any case, with or without the dash) opens its dashboard.
  const code = (await api("GET", `/api/portal/${token}`)).data.client.code;
  assert.match(code, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  const enter = await api("POST", "/api/client-login", { code: code.toLowerCase().replace("-", "") });
  assert.equal(enter.status, 200);
  assert.equal(enter.data.portalUrl, `/portal/${token}`);
  assert.equal((await api("POST", "/api/client-login", { code: "ZZZ-999" })).status, 404);

  // Changing the password keeps this browser signed in; signing out ends the session.
  const change = await fetch(`${B}/api/auth/password`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ current: "olas-de-teide-1", next: "olas-de-teide-2" }) });
  assert.equal(change.status, 200);
  const cookie2 = change.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(`${B}/api/studio`, { headers: { cookie } })).status, 401, "old sessions end");
  await fetch(`${B}/api/auth/logout`, { method: "POST", headers: { cookie: cookie2 } });
  assert.equal((await fetch(`${B}/api/studio`, { headers: { cookie: cookie2 } })).status, 401);
});
test("client pages load the Polar Marketing brand and the product name is swappable", async () => {
  const tokens = await fetch(`${B}/brand/tokens.css`);
  assert.equal(tokens.status, 200);
  assert.match(tokens.headers.get("content-type"), /text\/css/);
  assert.equal((await fetch(`${B}/brand/components.css`)).status, 200);
  assert.equal((await fetch(`${B}/brand/..%2Fserver%2Findex.mjs`)).status, 404);
  for (const path of ["/signup", `/portal/${token}`]) {
    const html = await (await fetch(B + path)).text();
    assert.match(html, /\/brand\/tokens\.css/);
    assert.doesNotMatch(html, /\{\{BRAND\}\}/, "placeholder must be replaced with the name from brand/brand.json");
    assert.match(html, /Polar Marketing/);
    if (path === "/signup") assert.match(html, /\/brand\/theme\.js/);
  }
  for (const asset of ["/brand/theme.js", "/brand/logo/polar-mark.png", "/brand/logo/favicon.ico"]) assert.equal((await fetch(B + asset)).status, 200, asset);
});

