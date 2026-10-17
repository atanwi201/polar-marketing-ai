// Local API for Isla Autopilot:
// - /api/ai: routes the app's AI calls to OpenRouter free models
// - /api/studio, /api/portal, /portal/<token>: the autonomous content studio and client portal
// - serves the built app after `npm run build`
// Settings come from .env (see .env.example).
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";

const root = join(import.meta.dirname, "..");
loadEnv(join(root, ".env"));

const { complete, freeModels, rankModels, status } = await import("./openrouter.mjs");
const { db, save, id, token, now, MEDIA_DIR, DATA_DIR } = await import("./store.mjs");
const { startPost, runPost, publish, startScheduler } = await import("./studio.mjs");
const { buildSite, SITES_DIR } = await import("./sitebuilder.mjs");

const KEY = process.env.OPENROUTER_API_KEY ?? "";
const PORT = Number(process.env.PORT ?? 8787);
const ADMIN = process.env.ADMIN_TOKEN ?? "";
const page = (name) => () => readFileSync(join(import.meta.dirname, name), "utf8");
const PORTAL_HTML = page("portal.html");
const SIGNUP_HTML = page("signup.html");
const LANGS = ["es", "en", "de", "it", "nl", "sv", "fr"];
const signupsByIp = new Map();

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

const MIME = { xml: "application/xml", txt: "text/plain; charset=utf-8", json: "application/json", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml" };

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

async function addBrief(client, { text, image }) {
  if (typeof text !== "string" || text.trim().length < 3) throw Object.assign(new Error("Say what you want to market"), { status: 400 });
  const brief = { id: id(), clientId: client.id, text: text.trim().slice(0, 2000), createdAt: now(), imageFile: image ? await saveUpload(image) : undefined };
  db.briefs.push(brief);
  const post = startPost(client, brief, "brief");
  return { brief, post };
}

const CLIENT_FIELDS = ["name", "kind", "town", "phone", "email", "domain", "offer", "hours", "tone", "languages", "platforms", "autopilot", "postsPerWeek", "autoPublish", "webhookUrl", "imageSize"];
const publicClient = (c) => ({ name: c.name, languages: c.languages, town: c.town, site: c.site ? { status: c.site.status, url: c.site.url, error: c.site.status === "failed" ? "The website couldn't be built yet. We'll retry." : undefined } : null });
const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const portalView = (c) => ({
  client: publicClient(c),
  briefs: db.briefs.filter((b) => b.clientId === c.id).map(({ id, text, createdAt, imageFile }) => ({ id, text, createdAt, imageFile })),
  posts: db.posts.filter((p) => p.clientId === c.id).map(({ id, briefId, createdAt, status, captions, hashtags, cta, imageFile, concept }) =>
    ({ id, briefId, createdAt, status, captions, hashtags, cta, imageFile, concept })),
});

async function route(req, res, url) {
  const p = url.pathname;
  const seg = p.split("/").filter(Boolean);

  // --- AI proxy for the main app ---
  if (p === "/api/ai/status") {
    if (!KEY) return send(res, 200, { configured: false, provider: "openrouter" });
    const models = await freeModels(KEY).catch(() => []);
    return send(res, 200, { configured: true, provider: "openrouter", models: rankModels(models).slice(0, 8), ...status() });
  }
  if (p === "/api/ai" && req.method === "POST") {
    if (!KEY) return send(res, 503, { error: "OPENROUTER_API_KEY is not set" });
    const { prompt, system, tier, json, stream } = await readBody(req);
    if (typeof prompt !== "string" || !prompt) return send(res, 400, { error: "prompt is required" });
    const ac = new AbortController();
    res.on("close", () => !res.writableEnded && ac.abort());
    if (stream && !json) {
      // Plain-text chunks, then \0 and the model id (or \0error:<message>).
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
      const out = await complete({ key: KEY, prompt, system, tier, onDelta: (d) => res.write(d), signal: ac.signal });
      return res.end(`\u0000${out.model ?? ""}`);
    }
    const out = await complete({ key: KEY, prompt, system, tier, json, signal: ac.signal });
    return send(res, 200, json ? { data: out.json, model: out.model } : { text: out.text, model: out.model });
  }

  // --- Client sign-up (public): creates the client, builds their website, makes a first post ---
  if (p === "/signup" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(SIGNUP_HTML());
  }
  if (p === "/api/signup" && req.method === "POST") {
    const ip = req.socket.remoteAddress ?? "";
    const recent = (signupsByIp.get(ip) ?? []).filter((t) => Date.now() - t < 36e5);
    if (recent.length >= 5) return send(res, 429, { error: "Too many sign-ups from here. Try again in an hour." });
    const b = await readBody(req, 9e6);
    const c = {
      id: id(), token: token(), createdAt: now(), source: "signup",
      name: str(b.name, 80), kind: str(b.kind, 60), town: str(b.town, 60), phone: str(b.phone, 30), email: str(b.email, 120),
      domain: str(b.domain, 120), offer: str(b.offer, 2000), hours: str(b.hours, 200),
      languages: (Array.isArray(b.languages) ? b.languages : []).filter((l) => LANGS.includes(l)),
      platforms: ["instagram", "facebook"], tone: "", autopilot: true, postsPerWeek: 3, autoPublish: false, webhookUrl: "",
      marketingConsent: b.marketingConsent === true ? { at: now(), source: "signup form" } : false,
    };
    if (!c.name || !c.offer || !c.phone || !c.email) return send(res, 400, { error: "Fill in the business name, what you offer, phone and email." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return send(res, 400, { error: "That email doesn't look right." });
    if (b.acceptTerms !== true) return send(res, 400, { error: "Please accept the terms to continue." });
    if (!c.languages.length) c.languages = ["es", "en"];
    signupsByIp.set(ip, [...recent, Date.now()]);
    db.clients.push(c);
    await save();
    void buildSite(c);
    const { post } = await addBrief(c, { text: c.offer, image: b.image });
    post.reason = "signup";
    return send(res, 201, { token: c.token, portalUrl: `/portal/${c.token}` });
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
    if (seg[3] === "briefs" && req.method === "POST") {
      const recent = db.briefs.filter((b) => b.clientId === c.id && Date.now() - Date.parse(b.createdAt) < 864e5).length;
      if (recent >= 10) return send(res, 429, { error: "That's 10 requests today. Try again tomorrow." });
      const { post } = await addBrief(c, await readBody(req, 9e6));
      return send(res, 201, { postId: post.id });
    }
    if (seg[3] === "posts" && seg[5] === "again" && req.method === "POST") {
      const old = db.posts.find((x) => x.id === seg[4] && x.clientId === c.id);
      const brief = db.briefs.find((b) => b.id === old?.briefId);
      if (!brief) return send(res, 404, { error: "Post not found" });
      return send(res, 201, { postId: startPost(c, brief, "again").id });
    }
    return send(res, 404, { error: "not found" });
  }

  // --- Owner studio API ---
  if (seg[0] === "api" && seg[1] === "studio") {
    if (ADMIN && req.headers["x-admin-token"] !== ADMIN) return send(res, 401, { error: "Admin token required" });
    const [, , kind, oid, action] = seg;
    if (!kind && req.method === "GET") return send(res, 200, { ...db, ai: { openrouter: !!KEY }, images: "pollinations" });
    if (kind === "clients" && req.method === "POST" && !oid) {
      const body = await readBody(req);
      let c = db.clients.find((x) => x.id === body.id);
      if (!c) { c = { id: body.id || id(), token: token(), createdAt: now() }; db.clients.push(c); }
      const isNew = !c.name;
      for (const f of CLIENT_FIELDS) if (f in body) c[f] = body[f];
      c.source ??= "owner";
      c.postsPerWeek = Math.max(0, Math.min(14, Number(c.postsPerWeek) || 0));
      await save();
      if (body.buildSite || (isNew && c.offer)) void buildSite(c);
      return send(res, 200, c);
    }
    if (kind === "clients" && oid && action === "site" && req.method === "POST") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      void buildSite(c);
      return send(res, 202, { ok: true });
    }
    if (kind === "clients" && oid && action === "token" && req.method === "POST") {
      const c = db.clients.find((x) => x.id === oid);
      if (!c) return send(res, 404, { error: "Client not found" });
      c.token = token();
      await save();
      return send(res, 200, c);
    }
    if (kind === "clients" && oid && req.method === "DELETE") {
      db.clients = db.clients.filter((x) => x.id !== oid);
      db.briefs = db.briefs.filter((x) => x.clientId !== oid);
      db.posts = db.posts.filter((x) => x.clientId !== oid);
      await save();
      return send(res, 200, { ok: true });
    }
    if (kind === "briefs" && req.method === "POST" && !oid) {
      const body = await readBody(req, 9e6);
      const c = db.clients.find((x) => x.id === body.clientId);
      if (!c) return send(res, 404, { error: "Client not found" });
      return send(res, 201, await addBrief(c, body));
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
        return send(res, 201, startPost(c, brief, "again"));
      }
      if (action === "retry" && req.method === "POST") { post.status = "generating"; post.error = undefined; void runPost(post.id); return send(res, 200, post); }
      if (action === "publish" && req.method === "POST") { post.status = "published"; await publish(c, post); await save(); return send(res, 200, post); }
      if (req.method === "DELETE") { db.posts = db.posts.filter((x) => x.id !== oid); await save(); return send(res, 200, { ok: true }); }
    }
    return send(res, 404, { error: "not found" });
  }

  // --- Generated and uploaded images ---
  if (seg[0] === "media" && seg[1]) {
    const file = normalize(join(MEDIA_DIR, seg[1]));
    if (!file.startsWith(MEDIA_DIR) || !existsSync(file)) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[file.split(".").pop()] ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
    return res.end(readFileSync(file));
  }

  // --- Client websites: sites/<client-name>/ ---
  if (seg[0] === "sites" && seg[1]) {
    if (!p.endsWith("/") && !p.split("/").pop().includes(".")) { res.writeHead(301, { Location: p + "/" }); return res.end(); }
    const file = normalize(join(SITES_DIR, ...seg.slice(1), p.endsWith("/") ? "index.html" : ""));
    if (!file.startsWith(SITES_DIR) || !existsSync(file)) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[file.split(".").pop()] ?? (file.endsWith(".xml") ? "application/xml" : file.endsWith(".txt") ? "text/plain" : "application/octet-stream") });
    return res.end(readFileSync(file));
  }

  // --- Built app (npm run build) ---
  const dist = join(root, "dist");
  const file = normalize(join(dist, p === "/" ? "index.html" : p));
  if (file.startsWith(dist) && existsSync(file) && !file.endsWith("/")) {
    res.writeHead(200, { "Content-Type": MIME[file.split(".").pop()] ?? "application/octet-stream" });
    return res.end(readFileSync(file));
  }
  send(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    await route(req, res, url);
  } catch (e) {
    if (res.headersSent) return res.end(`\u0000error:${e.message}`);
    send(res, e.status ?? 502, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Isla API on http://localhost:${PORT}`);
  console.log(`  AI: ${KEY ? "OpenRouter free models" : "OPENROUTER_API_KEY missing in .env, so captions use a simple template"}`);
  console.log(`  Images: Pollinations (free, no key) · data in ${DATA_DIR} · sites in ${SITES_DIR}`);
  startScheduler();
});
