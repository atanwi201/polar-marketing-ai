// Direct publishing with each client's own accounts: Facebook Page (photo or Reel), Instagram
// (photo or Reel), X (photo post) and YouTube Shorts. No SDKs: plain fetch, OAuth 1.0a for X.
// Every call is best effort and returns { ok, url | error } so one failing platform never blocks the rest.
import { readFile } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";
import { MEDIA_DIR, now } from "./store.mjs";

const env = (k, d = "") => process.env[k] ?? d;
const GRAPH = () => env("META_GRAPH_URL", `https://graph.facebook.com/${env("META_GRAPH_VERSION", "v25.0")}`);
const X_API = () => env("X_API_URL", "https://api.x.com");
const GOOGLE_TOKEN = () => env("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token");
const YT_API = () => env("YOUTUBE_API_URL", "https://www.googleapis.com");
const POLL_MS = () => Number(env("SOCIAL_POLL_MS", "4000"));
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

export const LABELS = { facebook: "Facebook", instagram: "Instagram", x: "X", youtube: "YouTube Shorts" };
/** Which platforms can take which kind of content. */
export const TARGETS = { post: ["instagram", "facebook", "x"], video: ["instagram", "facebook", "youtube"] };

// ---------- Public address (Instagram fetches photos by URL; link previews need it too) ----------

export const publicUrl = () => env("PUBLIC_URL").replace(/\/$/, "");
export const isPublic = () => /^https:\/\//.test(publicUrl()) && !/\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.)/.test(publicUrl());

// ---------- Accounts ----------

export const ACCOUNT_FIELDS = { facebook: ["pageId", "token"], instagram: ["userId", "token"], x: ["token", "secret"], youtube: ["refreshToken"] };
const SECRETS = new Set(["token", "secret", "refreshToken"]);
const MASK = "••••";

/** Secrets never leave the server in full: the studio sees the last 4 characters. */
export function maskAccounts(a = {}) {
  const out = {};
  for (const [pf, fields] of Object.entries(ACCOUNT_FIELDS)) {
    out[pf] = {};
    for (const f of fields) {
      const v = a[pf]?.[f] ?? "";
      out[pf][f] = SECRETS.has(f) && v ? MASK + v.slice(-4) : v;
    }
  }
  return out;
}

/** Merge edits from the studio: a masked value means "keep what is stored". */
export function mergeAccounts(old = {}, incoming = {}) {
  const out = structuredClone(old);
  for (const [pf, fields] of Object.entries(ACCOUNT_FIELDS)) {
    for (const f of fields) {
      const v = incoming?.[pf]?.[f];
      if (typeof v !== "string" || v.startsWith(MASK)) continue;
      out[pf] ??= {};
      out[pf][f] = v.trim().slice(0, 1000);
    }
  }
  return out;
}

const igToken = (a) => a.instagram?.token || a.facebook?.token || "";

/** Per platform: ready to post, or what is missing. */
export function connections(client) {
  const a = client.accounts ?? {};
  const need = (cond, msg) => (cond ? null : msg);
  const out = {
    facebook: need(a.facebook?.pageId && a.facebook?.token, "Add the Page ID and a Page access token"),
    instagram: need(a.instagram?.userId && igToken(a), "Add the Instagram account ID and an access token"),
    x: need(a.x?.token && a.x?.secret, "Add the account's access token and secret") ?? need(env("X_API_KEY") && env("X_API_SECRET"), "Set X_API_KEY and X_API_SECRET in .env"),
    youtube: need(a.youtube?.refreshToken, "Add a refresh token") ?? need(env("YOUTUBE_CLIENT_ID") && env("YOUTUBE_CLIENT_SECRET"), "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env"),
  };
  return Object.fromEntries(Object.entries(out).map(([pf, missing]) => [pf, missing ? { ready: false, missing } : { ready: true }]));
}

// ---------- Text per platform ----------

const tagLine = (item) => (item.hashtags ?? []).map((h) => "#" + String(h).replace(/^#+/, "")).join(" ");
export const pickLang = (client, item, lang) => {
  const have = Object.keys(item.captions ?? {});
  return have.includes(lang) ? lang : (client.languages ?? []).find((l) => have.includes(l)) ?? have[0] ?? "es";
};

/** Caption for a platform: full caption + hashtags, or a short one that fits X's 280 characters. */
export function textFor(item, platform, lang) {
  const cap = item.captions?.[lang] ?? Object.values(item.captions ?? {})[0] ?? "";
  if (platform !== "x") return [cap, tagLine(item)].filter(Boolean).join("\n\n");
  let t = (item.short?.[lang] || cap).trim();
  if (t.length > 280) t = t.slice(0, 277).replace(/\s+\S*$/, "") + "…";
  for (const tag of tagLine(item).split(" ").filter(Boolean).slice(0, 3)) {
    if (t.length + tag.length + 1 <= 280) t += (t.includes("#") ? " " : "\n\n") + tag;
  }
  return t;
}

/** YouTube title: max 100 characters, no angle brackets, tagged #Shorts. */
export function youtubeTitle(item, lang) {
  const base = String(item.title?.[lang] || item.concept || "Short").replace(/[<>]/g, "").trim();
  const tag = " #Shorts";
  return (base.length + tag.length > 100 ? base.slice(0, 100 - tag.length - 1).trim() + "…" : base) + tag;
}

// ---------- Meta (Facebook + Instagram) ----------

async function meta(method, path, params = {}, body) {
  const url = new URL(GRAPH() + path);
  let init = { method, signal: AbortSignal.timeout(120e3) };
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  else init.body = body ?? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Meta: ${j.error?.message ?? `answered ${r.status}`}`);
  return j;
}

/** Upload a local video to Meta's rupload host (Facebook Reels and Instagram resumable uploads). */
async function rupload(uploadUrl, token, buf) {
  const r = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(buf.length), "Content-Type": "application/octet-stream" },
    body: buf, signal: AbortSignal.timeout(600e3),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || j.success === false) throw new Error(`Meta upload: ${j.error?.message ?? j.debug_info?.message ?? `answered ${r.status}`}`);
  return j;
}

async function facebookPhoto(a, file, message) {
  const fd = new FormData();
  fd.set("source", new Blob([await readFile(join(MEDIA_DIR, file))], { type: "image/jpeg" }), file);
  fd.set("message", message);
  fd.set("access_token", a.facebook.token);
  const j = await meta("POST", `/${a.facebook.pageId}/photos`, {}, fd);
  const pid = j.post_id ?? j.id;
  return { id: pid, url: `https://www.facebook.com/${pid}` };
}

async function facebookReel(a, file, description) {
  const { pageId, token } = a.facebook;
  const start = await meta("POST", `/${pageId}/video_reels`, { upload_phase: "start", access_token: token });
  if (!start.video_id || !start.upload_url) throw new Error("Meta: no upload address for the Reel");
  await rupload(start.upload_url, token, await readFile(join(MEDIA_DIR, file)));
  await meta("POST", `/${pageId}/video_reels`, { upload_phase: "finish", video_id: start.video_id, video_state: "PUBLISHED", description, access_token: token });
  return { id: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` };
}

/** Wait until an Instagram container is processed (videos take a while). */
async function igReady(id, token, maxMs) {
  const until = Date.now() + maxMs;
  for (;;) {
    const s = await meta("GET", `/${id}`, { fields: "status_code,status", access_token: token });
    if (s.status_code === "FINISHED" || s.status_code == null) return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram could not process the file: ${s.status ?? s.status_code}`);
    if (Date.now() > until) throw new Error("Instagram is still processing the file. Try again in a few minutes.");
    await sleep(POLL_MS());
  }
}

async function igPublish(a, creationId) {
  const token = igToken(a);
  const pub = await meta("POST", `/${a.instagram.userId}/media_publish`, { creation_id: creationId, access_token: token });
  const link = await meta("GET", `/${pub.id}`, { fields: "permalink", access_token: token }).catch(() => ({}));
  return { id: pub.id, url: link.permalink ?? "https://www.instagram.com/" };
}

async function instagramPhoto(a, file, caption, altText) {
  if (!isPublic()) throw new Error("Instagram fetches the photo from a public address. Set PUBLIC_URL in .env to an https address that reaches this server (for example a Cloudflare tunnel).");
  const token = igToken(a);
  const params = { image_url: `${publicUrl()}/media/${file}`, caption, access_token: token };
  let c;
  try { c = await meta("POST", `/${a.instagram.userId}/media`, altText ? { ...params, alt_text: altText.slice(0, 1000) } : params); }
  catch (e) { if (!altText || !/alt_text/i.test(e.message)) throw e; c = await meta("POST", `/${a.instagram.userId}/media`, params); }
  await igReady(c.id, token, 60e3);
  return igPublish(a, c.id);
}

async function instagramReel(a, file, caption) {
  const token = igToken(a);
  const c = await meta("POST", `/${a.instagram.userId}/media`, { media_type: "REELS", upload_type: "resumable", caption, share_to_feed: "true", access_token: token });
  const uri = c.uri ?? `https://rupload.facebook.com/ig-api-upload/${env("META_GRAPH_VERSION", "v25.0")}/${c.id}`;
  await rupload(uri, token, await readFile(join(MEDIA_DIR, file)));
  await igReady(c.id, token, 10 * 60e3);
  return igPublish(a, c.id);
}

// ---------- X (OAuth 1.0a user context) ----------

const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** OAuth 1.0a Authorization header. Body params count only for form-encoded bodies (pass them in `form`). */
export function oauth1(method, url, { key, secret, token, tokenSecret }, { form = {}, nonce = randomBytes(16).toString("hex"), timestamp = String(Math.floor(Date.now() / 1000)) } = {}) {
  const u = new URL(url);
  const o = { oauth_consumer_key: key, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1", oauth_timestamp: timestamp, oauth_token: token, oauth_version: "1.0" };
  const pairs = [...Object.entries(o), ...u.searchParams.entries(), ...Object.entries(form)]
    .map(([k, v]) => [rfc3986(k), rfc3986(String(v))])
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const base = [method.toUpperCase(), rfc3986(u.origin + u.pathname), rfc3986(pairs.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const signature = createHmac("sha1", `${rfc3986(secret)}&${rfc3986(tokenSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.entries({ ...o, oauth_signature: signature }).map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`).join(", ");
}

const xKeys = (a) => ({ key: env("X_API_KEY"), secret: env("X_API_SECRET"), token: a.x.token, tokenSecret: a.x.secret });

async function x(method, path, a, init = {}) {
  const url = X_API() + path;
  const r = await fetch(url, { method, ...init, headers: { ...init.headers, Authorization: oauth1(method, url, xKeys(a)) }, signal: AbortSignal.timeout(120e3) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.errors && !j.data)) throw new Error(`X: ${j.detail ?? j.errors?.[0]?.message ?? j.title ?? `answered ${r.status}`}`);
  return j;
}

async function xPhoto(a, file, text, altText) {
  const fd = new FormData();
  fd.set("media", new Blob([await readFile(join(MEDIA_DIR, file))], { type: "image/jpeg" }), file);
  fd.set("media_category", "tweet_image");
  const up = await x("POST", "/2/media/upload", a, { body: fd });
  const mediaId = up.data?.id ?? up.media_id_string;
  if (!mediaId) throw new Error("X: the image upload returned no id");
  if (altText) {
    await x("POST", "/2/media/metadata", a, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: mediaId, metadata: { alt_text: { text: altText.slice(0, 1000) } } }) }).catch(() => {});
  }
  const t = await x("POST", "/2/tweets", a, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, media: { media_ids: [mediaId] } }) });
  return { id: t.data.id, url: `https://x.com/i/web/status/${t.data.id}` };
}

// ---------- YouTube Shorts ----------

async function googleAccess(a) {
  const r = await fetch(GOOGLE_TOKEN(), {
    method: "POST",
    body: new URLSearchParams({ client_id: env("YOUTUBE_CLIENT_ID"), client_secret: env("YOUTUBE_CLIENT_SECRET"), refresh_token: a.youtube.refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(30e3),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`YouTube sign-in: ${j.error_description ?? j.error ?? `answered ${r.status}`}`);
  return j.access_token;
}

async function youtubeShort(a, file, { title, description, tags, lang }) {
  const access = await googleAccess(a);
  const buf = await readFile(join(MEDIA_DIR, file));
  const body = {
    snippet: { title, description: description.slice(0, 4900), tags: tags.slice(0, 15), categoryId: "22", defaultLanguage: lang, defaultAudioLanguage: lang },
    status: { privacyStatus: env("YOUTUBE_PRIVACY", "public"), selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  };
  const init = await fetch(`${YT_API()}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(buf.length) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60e3),
  });
  const loc = init.headers.get("location");
  if (!init.ok || !loc) { const j = await init.json().catch(() => ({})); throw new Error(`YouTube: ${j.error?.message ?? `answered ${init.status}`}`); }
  const up = await fetch(loc, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: buf, signal: AbortSignal.timeout(600e3) });
  const j = await up.json().catch(() => ({}));
  if (!up.ok || !j.id) throw new Error(`YouTube upload: ${j.error?.message ?? `answered ${up.status}`}`);
  return { id: j.id, url: `https://youtube.com/shorts/${j.id}` };
}

// ---------- Entry points ----------

/**
 * Publish a post (photo) or a video render to one platform. Records the result on item.shares
 * under "<platform>:<lang>" and returns it.
 */
export async function shareItem(client, item, platform, { kind = "post", lang } = {}) {
  const l = pickLang(client, item, lang);
  const key = `${platform}:${l}`;
  const res = { platform, lang: l, at: now() };
  try {
    if (!TARGETS[kind].includes(platform)) throw new Error(`${LABELS[platform] ?? platform} is not available for this kind of content`);
    const conn = connections(client)[platform];
    if (!conn.ready) throw new Error(`${LABELS[platform]} is not connected: ${conn.missing}`);
    const a = client.accounts;
    const text = textFor(item, platform, l);
    let out;
    if (kind === "post") {
      if (!item.imageFile) throw new Error("This post has no image yet");
      if (platform === "facebook") out = await facebookPhoto(a, item.imageFile, text);
      else if (platform === "instagram") out = await instagramPhoto(a, item.imageFile, text, item.altText);
      else out = await xPhoto(a, item.imageFile, text, item.altText);
    } else {
      const file = item.renders?.[l]?.file;
      if (!file) throw new Error(`No ${l.toUpperCase()} video rendered yet`);
      if (platform === "facebook") out = await facebookReel(a, file, text);
      else if (platform === "instagram") out = await instagramReel(a, file, text);
      else out = await youtubeShort(a, file, { title: youtubeTitle(item, l), description: [item.description?.[l] || item.captions?.[l] || "", tagLine(item), "#Shorts"].filter(Boolean).join("\n\n"), tags: item.hashtags ?? [], lang: l });
    }
    Object.assign(res, { ok: true, ...out });
  } catch (e) {
    Object.assign(res, { ok: false, error: e.message });
  }
  item.shares = { ...item.shares, [key]: res };
  return res;
}

/** Quick read-only call per connected platform, so the owner knows the keys work. */
export async function checkAccounts(client) {
  const a = client.accounts ?? {};
  const conns = connections(client);
  const out = {};
  const run = async (pf, fn) => {
    if (!conns[pf].ready) return (out[pf] = { ok: false, error: conns[pf].missing });
    try { out[pf] = { ok: true, name: await fn() }; } catch (e) { out[pf] = { ok: false, error: e.message }; }
  };
  await Promise.all([
    run("facebook", async () => (await meta("GET", `/${a.facebook.pageId}`, { fields: "name", access_token: a.facebook.token })).name),
    run("instagram", async () => "@" + (await meta("GET", `/${a.instagram.userId}`, { fields: "username", access_token: igToken(a) })).username),
    run("x", async () => "@" + (await x("GET", "/2/users/me", a)).data.username),
    run("youtube", async () => {
      const r = await fetch(`${YT_API()}/youtube/v3/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${await googleAccess(a)}` }, signal: AbortSignal.timeout(30e3) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`YouTube: ${j.error?.message ?? `answered ${r.status}`}`);
      return j.items?.[0]?.snippet?.title ?? "connected";
    }),
  ]);
  return out;
}
