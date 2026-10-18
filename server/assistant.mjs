// The business's assistant. In their dashboard a business writes what it wants ("quiero ofrecer
// plátanos") and can attach a photo or a video. A free model reads the message, the attachment and
// the conversation, decides what to do and the server does it:
//   media_post  their photo or video with the offer written on top (post or Reel/Short)
//   ai_post     a new AI image with the offer written on top
//   video_ad    a short AI video ad (the existing video pipeline)
//   update_info new opening hours, phone or what they sell (website rebuilt)
//   answer      a reply (and a flag for the owner when it's something only a person can do)
import { join } from "node:path";
import { unlink, stat, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { db, save, id, token, now, MEDIA_DIR } from "./store.mjs";
import { complete, aiKey, withClientAi } from "./openrouter.mjs";
import { puterTranscribe, puterConfigured } from "./puter.mjs";
import { CONTEXT, runPost, describeImage, brandLine } from "./studio.mjs";
import { startVideo } from "./video.mjs";
import { composeOfferVideo, probeVideo, videoFrame, MAX_CLIP_SECONDS } from "./overlay.mjs";
import { buildSite } from "./sitebuilder.mjs";
import { applyImages } from "./profile.mjs";
import { blockReason } from "./limits.mjs";

const KEY = aiKey;
const LANG_NAMES = { es: "Spanish", en: "English", de: "German", it: "Italian", nl: "Dutch", sv: "Swedish", fr: "French" };
const ACTIONS = ["media_post", "ai_post", "video_ad", "update_info", "answer"];
const busy = new Set();

// ---------- Uploads (streamed: phone videos are big) ----------

const UPLOAD_TYPES = {
  "image/jpeg": ["jpg", "image", 12e6], "image/png": ["png", "image", 12e6], "image/webp": ["webp", "image", 12e6],
  "audio/mpeg": ["mp3", "audio", 25e6], "audio/mp4": ["m4a", "audio", 25e6], "audio/x-m4a": ["m4a", "audio", 25e6], "audio/aac": ["aac", "audio", 25e6],
  "audio/webm": ["weba", "audio", 25e6], "audio/ogg": ["ogg", "audio", 25e6], "audio/wav": ["wav", "audio", 25e6], "audio/x-wav": ["wav", "audio", 25e6],
  "video/mp4": ["mp4", "video", 250e6], "video/quicktime": ["mov", "video", 250e6], "video/webm": ["webm", "video", 250e6],
};

/** Save an uploaded photo or video. Returns { file, kind, duration? }. Videos over 3 minutes are refused. */
export async function receiveUpload(req) {
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const spec = UPLOAD_TYPES[type];
  if (!spec) throw Object.assign(new Error("Send a photo (JPEG, PNG, WebP), a video (MP4, MOV, WebM) or a voice note (MP3, M4A, OGG, WAV)"), { status: 415 });
  const [ext, kind, limit] = spec;
  if (Number(req.headers["content-length"] ?? 0) > limit) throw Object.assign(new Error(kind === "video" ? "That video is too big (max 250 MB)" : "That photo is too big (max 12 MB)"), { status: 413 });
  const file = `up-${id()}.${ext}`;
  const path = join(MEDIA_DIR, file);
  await new Promise((ok, fail) => {
    let size = 0;
    const out = createWriteStream(path);
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); out.destroy(); fail(Object.assign(new Error("File too big"), { status: 413 })); }
    });
    req.on("error", fail);
    out.on("error", fail);
    out.on("finish", ok);
    req.pipe(out);
  }).catch(async (e) => { await unlink(path).catch(() => {}); throw e; });
  if ((await stat(path)).size < 100) { await unlink(path).catch(() => {}); throw Object.assign(new Error("The file arrived empty"), { status: 400 }); }
  if (kind === "image" || kind === "audio") return { file, kind };
  try {
    const info = await probeVideo(path);
    if (info.duration > 180) throw Object.assign(new Error("Videos can be up to 3 minutes"), { status: 400 });
    return { file, kind, duration: info.duration };
  } catch (e) {
    await unlink(path).catch(() => {});
    throw Object.assign(e, { status: e.status ?? 400, message: e.status ? e.message : "That video can't be read. Try another file." });
  }
}

// ---------- Messages ----------

/** A message from the business (or from you, the owner). The assistant answers the business's ones. */
export function addMessage(client, { role, text, attachments = [], lang }) {
  const msg = { id: id(), clientId: client.id, role, text: String(text ?? "").trim().slice(0, 2000), attachments, lang, createdAt: now(), seenByOwner: role === "owner" };
  db.messages.push(msg);
  if (role !== "client") { void save(); return { msg }; }
  const reply = { id: id(), clientId: client.id, role: "assistant", text: "", status: "thinking", replyTo: msg.id, lang, createdAt: now(), seenByOwner: true };
  db.messages.push(reply);
  void save();
  void handle(reply.id);
  return { msg, reply };
}

/** Owner-facing summary: messages the owner should look at. */
export const needsOwner = (clientId) => db.messages.filter((m) => m.clientId === clientId && m.needsOwner && !m.seenByOwner);

const mainLang = (c) => c.languages?.[0] ?? "es";
const T = (lang, es, en) => (lang === "es" ? es : en);

/** What a voice note says, as text (Puter speech recognition). "" when it can't be read. */
async function transcribeNote(file) {
  if (!puterConfigured()) return "";
  try {
    const ext = file.split(".").pop();
    const mime = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", weba: "audio/webm", ogg: "audio/ogg", wav: "audio/wav" }[ext] ?? "audio/mpeg";
    return await puterTranscribe(await readFile(join(MEDIA_DIR, file)), mime);
  } catch (e) {
    console.warn("Voice note not transcribed:", e.message);
    return "";
  }
}

/** Describe what's attached so the model can write about it. */
async function describeAttachments(atts) {
  const out = [];
  for (const a of atts) {
    if (a.kind === "image") out.push({ ...a, description: a.description ?? (await describeImage(a.file)) });
    else if (a.kind === "audio") out.push({ ...a, description: a.description ?? (await transcribeNote(a.file)) });
    else {
      let description = a.description;
      if (description == null) {
        const frame = `${a.file}.frame.jpg`;
        try {
          await videoFrame(join(MEDIA_DIR, a.file), join(MEDIA_DIR, frame), Math.min(1.5, (a.duration ?? 2) / 2));
          description = await describeImage(frame);
        } catch { description = ""; }
        await unlink(join(MEDIA_DIR, frame)).catch(() => {});
      }
      out.push({ ...a, description });
    }
  }
  return out;
}

function facts(client) {
  const posts = db.posts.filter((p) => p.clientId === client.id);
  const videos = db.videos.filter((v) => v.clientId === client.id);
  return [
    `Website: ${client.site?.status === "ready" ? `live at ${client.site.url}` : client.site?.status ?? "not built yet"}.`,
    `Posts: ${posts.filter((p) => p.status === "ready" || p.status === "published").length} ready, ${posts.filter((p) => p.status === "generating").length} being made.`,
    `Videos: ${videos.filter((v) => v.renders).length} ready, ${videos.filter((v) => v.status === "generating").length} being made.`,
    `Autopilot: ${client.autopilot ? `${client.postsPerWeek} posts a week` : "off"}.`,
    `Plan: ${client.plan || "free trial"}.`,
  ].join(" ");
}

/** Ask the model what to do. Without a key (or if it fails twice), a simple rule-based guess. */
async function interpret(client, msg, atts, uiLang) {
  const langs = client.languages?.length ? client.languages : ["es", "en"];
  const main = mainLang(client);
  const earlier = (m) => m.clientId === client.id && m.id !== msg.id && m.text && (m.role !== "assistant" || m.status === "done");
  const history = db.messages.filter(earlier).slice(-8).map((m) => `${m.role === "client" ? "Business" : m.role === "owner" ? "Studio owner" : "Assistant"}: ${m.text.slice(0, 300)}`).join("\n");
  const per = (d) => `{${langs.map((l) => `"${l}": string`).join(", ")}} (${d})`;
  const shape = `{"action": "media_post" | "ai_post" | "video_ad" | "update_info" | "answer", "reply": string (in ${LANG_NAMES[uiLang] ?? "Spanish"}, warm, 1-3 short sentences, say what you're doing; no markdown), "needsOwner": boolean, "concept": string (one line), "overlay": {"badge": string (1-2 words in ${LANG_NAMES[main]}, like Oferta / Nuevo / Hoy / Promo), "headline": string (max 6 words in ${LANG_NAMES[main]}, the product or offer), "subline": string (max 8 words in ${LANG_NAMES[main]}: the price, dates or detail they gave; otherwise a short benefit)}, "captions": ${per("social caption, max 500 characters, natively written")}, "short": ${per("same post for X, max 220 characters, no hashtags")}, "hashtags": string[] (5-8, no #), "altText": string (in ${LANG_NAMES[main]}, describes the image), "imagePrompt": string (English, 40-80 words, photo-realistic scene for an image generator, no text in the image; only for ai_post), "videoSeconds": 15 | 20 | 30, "info": {"hours"?: string, "phone"?: string, "offer"?: string}, "attachmentUse": "post" | "logo" | "website_photos"}`;
  const prompt =
    `You are the assistant inside the marketing app of ${client.name} (${client.kind || "local business"}, ${client.town || "Tenerife"}). ` +
    `They sell: ${client.offer || "-"}. Opening hours: ${client.hours || "-"}. Phone: ${client.phone || "-"}. Customer languages: ${langs.join(", ")}.\n` +
    `What you know about their account: ${facts(client)}\n` +
    (history ? `Conversation so far:\n${history}\n` : "") +
    `New message from the business:\n"""${msg.text || "(no text)"}"""\n` +
    (atts.length ? `Attached: ${atts.map((a) => `${a.kind}${a.description ? (a.kind === "audio" ? ` (says: ${a.description})` : ` (shows: ${a.description})`) : ""}`).join("; ")}\n` : "No attachment.\n") +
    `Decide the action:\n` +
    `- media_post: they attached a photo or video and want to promote or show something. We put the offer text on top of THEIR photo or video.\n` +
    `- ai_post: they want to promote something but attached nothing. We draw a new image and put the offer text on it.\n` +
    `- video_ad: they ask for a video, reel or short and attached no video.\n` +
    `- update_info: they give new opening hours, a new phone or a change in what they sell (fill "info"; we update their website). Also when they send their LOGO (attachmentUse "logo") or photos meant for their website (attachmentUse "website_photos").\n` +
    `attachmentUse is "post" unless they clearly say the picture is their logo or is for their website.\n` +
    `- answer: questions, thanks, anything else. Set needsOwner true when only a person can help (billing, cancelling, complaints, website design changes, logos, anything you can't do).\n` +
    `Never invent prices, dates, discounts or facts that the business did not give. Keep the overlay short: it is printed on the picture.\n` +
    `Return JSON only, exactly this shape: ${shape}`;
  if (KEY()) {
    try {
      const out = await complete({ key: KEY(), prompt, system: CONTEXT, json: true, tier: "default" });
      const j = out.json ?? {};
      if (ACTIONS.includes(j.action) && typeof j.reply === "string") return { ...j, model: out.model };
    } catch (e) {
      console.warn("Assistant model failed:", e.message);
    }
  }
  return guess(client, msg, atts, uiLang);
}

/** Rule-based fallback: good enough to keep the dashboard useful without a model. */
function guess(client, msg, atts, uiLang) {
  const text = msg.text || "";
  const main = mainLang(client);
  const langs = client.languages?.length ? client.languages : ["es", "en"];
  const headline = text.replace(/^(quiero|queremos|i want to|we want to|me gustaría)\s+(ofrecer|promocionar|anunciar|offer|promote|advertise)\s+/i, "").split(/[.,;!\n]/)[0].trim().slice(0, 40) || client.name;
  const price = text.match(/\d+(?:[.,]\d+)?\s?(?:€|eur|euros?)(?:\s?\/\s?\w+)?|€\s?\d+(?:[.,]\d+)?/i)?.[0] ?? "";
  const promo = /ofrec|promo|oferta|vend|tenemos|offer|promot|sale|deal|nuevo|new/i.test(text);
  const wantsVideo = /v[ií]deo|reel|short/i.test(text);
  const isLogo = atts.some((a) => a.kind === "image") && /\blogo\b/i.test(text);
  const action = isLogo ? "update_info" : atts.length ? "media_post" : wantsVideo ? "video_ad" : promo || text.length > 12 ? "ai_post" : "answer";
  const caption = `${text}\n\n${brandLine(client)}`;
  return {
    action, needsOwner: false, concept: headline,
    reply: isLogo ? T(uiLang, "¡Gracias! He guardado tu logo y estoy actualizando tu web con él.", "Thanks! I've saved your logo and I'm updating your website with it.")
      : action === "answer"
      ? T(uiLang, "Cuéntame qué quieres promocionar y, si quieres, adjunta una foto o un vídeo.", "Tell me what you want to promote, and attach a photo or video if you like.")
      : action === "video_ad" ? T(uiLang, "Perfecto, preparo un vídeo corto para Reels y Shorts. Tardará unos minutos.", "Great, I'm making a short video for Reels and Shorts. It takes a few minutes.")
      : T(uiLang, "¡Hecho! Preparo la publicación con tu oferta encima de la imagen.", "Done! I'm making the post with your offer on top of the image."),
    overlay: { badge: T(main, "Oferta", "Offer"), headline, subline: price },
    captions: Object.fromEntries(langs.map((l) => [l, caption])), short: Object.fromEntries(langs.map((l) => [l, text.slice(0, 200)])),
    hashtags: ["tenerife", "canaryislands"], altText: headline,
    imagePrompt: `Advertising photo for ${client.kind || "a local business"} in ${client.town || "Tenerife"}: ${text}. Natural light, vibrant, high detail, no text`,
    videoSeconds: 15, info: {}, attachmentUse: isLogo ? "logo" : "post", model: KEY() ? "rules (the model didn't answer)" : "rules (add OPENROUTER_API_KEY for the AI assistant)",
  };
}

const cleanTags = (h) => (Array.isArray(h) ? h : []).map((x) => String(x).replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 10);

/** Work out the reply to one business message and do what it asks. */
async function handle(replyId) {
  if (busy.has(replyId)) return;
  busy.add(replyId);
  const reply = db.messages.find((m) => m.id === replyId);
  const msg = db.messages.find((m) => m.id === reply?.replyTo);
  const client = db.clients.find((c) => c.id === reply?.clientId);
  try {
    if (!reply || !msg || !client) throw new Error("Missing message or client");
    const uiLang = msg.lang === "en" ? "en" : msg.lang === "es" ? "es" : mainLang(client);
    const atts = await describeAttachments(msg.attachments ?? []);
    msg.attachments = atts;
    // A voice note is a message: what was said becomes the text when they typed nothing.
    const said = atts.filter((a) => a.kind === "audio" && a.description).map((a) => a.description).join(" ");
    if (said && !msg.text) msg.text = said.slice(0, 2000);
    const d = await interpret(client, msg, atts, uiLang);
    const overlay = {
      badge: String(d.overlay?.badge ?? "").slice(0, 24), headline: String(d.overlay?.headline || d.concept || client.name).slice(0, 80),
      subline: String(d.overlay?.subline ?? "").slice(0, 80),
    };
    const copy = {
      concept: String(d.concept || overlay.headline).slice(0, 160), captions: d.captions ?? {}, short: d.short ?? {},
      hashtags: cleanTags(d.hashtags), altText: String(d.altText ?? overlay.headline).slice(0, 300), model: d.model,
    };
    Object.assign(reply, { text: String(d.reply).slice(0, 1200), action: d.action, needsOwner: !!d.needsOwner, seenByOwner: !d.needsOwner, model: d.model });

    const media = atts.find((a) => a.kind === "image") ?? atts.find((a) => a.kind === "video");
    // The weekly limit (and approval) the owner set: say so instead of making the post.
    const blocked = ["media_post", "ai_post", "video_ad"].includes(d.action) ? blockReason(client) : null;
    if (blocked) {
      Object.assign(reply, { text: blocked.error, action: "limit" });
    } else if (d.action === "media_post" && media?.kind === "image") {
      const post = { id: id(), clientId: client.id, createdAt: now(), status: "generating", reason: "assistant", shareKey: token(),
        kind: "photo", preWritten: true, sourceFile: media.file, overlay, messageId: reply.id, ...copy };
      db.posts.push(post);
      reply.postId = post.id;
      void runPost(post.id);
    } else if (d.action === "media_post" && media?.kind === "video") {
      reply.videoId = startClip(client, media, overlay, copy, reply.id).id;
    } else if (d.action === "ai_post" || (d.action === "media_post" && !media)) {
      const post = { id: id(), clientId: client.id, createdAt: now(), status: "generating", reason: "assistant", shareKey: token(),
        kind: "ai", preWritten: true, overlay, imagePrompt: String(d.imagePrompt || `${overlay.headline}, ${client.kind}, ${client.town}`).slice(0, 1500), messageId: reply.id, ...copy };
      db.posts.push(post);
      reply.postId = post.id;
      void runPost(post.id);
    } else if (d.action === "video_ad") {
      const v = startVideo(client, { text: msg.text || overlay.headline, seconds: [15, 20, 30].includes(Number(d.videoSeconds)) ? Number(d.videoSeconds) : 15,
        langs: (client.languages ?? ["es"]).slice(0, 1), reason: "assistant", refImage: atts.find((a) => a.kind === "image")?.file });
      reply.videoId = v.id;
    } else if (d.action === "update_info") {
      const info = d.info ?? {};
      const changed = [];
      const pics = atts.filter((a) => a.kind === "image").map((a) => a.file);
      if (d.attachmentUse === "logo" && pics[0]) { await applyImages(client, { logoFile: pics[0] }); changed.push("logo"); }
      else if (d.attachmentUse === "website_photos" && pics.length) { await applyImages(client, { photoFiles: pics }); changed.push("photos"); }
      for (const k of ["hours", "phone", "offer"]) {
        if (typeof info[k] === "string" && info[k].trim()) { client[k] = info[k].trim().slice(0, k === "offer" ? 2000 : 200); changed.push(k); }
      }
      if (changed.length) { reply.updated = changed; void buildSite(client); }
    }
    reply.status = "done";
  } catch (e) {
    console.warn("Assistant failed:", e.message);
    if (reply) Object.assign(reply, {
      status: "failed", needsOwner: true, seenByOwner: false,
      text: T(msg?.lang ?? "es", "Lo siento, no he podido hacerlo ahora. Tu equipo lo ha visto y te ayudará.", "Sorry, I couldn't do that right now. Your team has been told and will help."),
      error: e.message,
    });
  } finally {
    busy.delete(replyId);
    void save();
  }
}

/** Their own video, cut to a vertical Reel/Short with the offer on top. Shows up with the other videos. */
function startClip(client, media, overlay, copy, messageId) {
  const lang = mainLang(client);
  const video = {
    id: id(), clientId: client.id, kind: "clip", text: copy.concept, sourceFile: media.file, overlay, seconds: Math.round(Math.min(media.duration ?? MAX_CLIP_SECONDS, MAX_CLIP_SECONDS)),
    langs: [lang], voice: false, createdAt: now(), status: "generating", step: "rendering", progress: 40, reason: "assistant", shareKey: token(), messageId,
    concept: copy.concept, captions: copy.captions, hashtags: copy.hashtags, title: { [lang]: copy.concept.slice(0, 90) }, description: copy.captions, model: copy.model,
  };
  db.videos.push(video);
  void save();
  void runClip(video.id);
  return video;
}

export async function runClip(videoId) {
  const video = db.videos.find((v) => v.id === videoId);
  const client = db.clients.find((c) => c.id === video?.clientId);
  if (!video || !client || busy.has(videoId)) return;
  busy.add(videoId);
  try {
    const lang = video.langs[0];
    const file = `${video.id}-${lang}-${Date.now().toString(36)}.mp4`;
    const cover = file.replace(/\.mp4$/, ".jpg");
    const r = await composeOfferVideo({ src: join(MEDIA_DIR, video.sourceFile), out: join(MEDIA_DIR, file), cover: join(MEDIA_DIR, cover), ...video.overlay, brand: brandLine(client) });
    const old = Object.values(video.renders ?? {}).flatMap((x) => [x.file, x.cover]);
    Object.assign(video, { renders: { [lang]: { file, cover, duration: r.duration, size: (await stat(join(MEDIA_DIR, file))).size, voice: false } },
      status: "ready", step: "", progress: 100, error: undefined, generatedAt: now() });
    for (const f of old) if (f && f !== file && f !== cover) await unlink(join(MEDIA_DIR, f)).catch(() => {});
  } catch (e) {
    Object.assign(video, { status: "failed", error: e.message, step: "" });
    console.warn("Clip failed:", e.message);
  } finally {
    busy.delete(videoId);
    void save();
  }
}

/** Replies left "thinking" by a restart get another go. */
export function startAssistant() {
  for (const m of db.messages) if (m.role === "assistant" && m.status === "thinking") void handle(m.id);
}

/** What the business's dashboard shows of the conversation. */
export const portalMessages = (clientId) => db.messages.filter((m) => m.clientId === clientId).slice(-80)
  .map(({ id, role, text, attachments, status, postId, videoId, createdAt, updated }) => ({ id, role, text, attachments: (attachments ?? []).map(({ file, kind }) => ({ file, kind })), status, postId, videoId, createdAt, updated }));

// The client's own AI provider (set in the studio) applies to everything done for them, including scheduled work.
interpret = withClientAi(interpret);
