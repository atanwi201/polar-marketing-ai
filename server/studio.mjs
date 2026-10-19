// The autonomous content studio. A client says what to market (optionally with a photo); the AI
// writes the posts and a brand-new image every time, then publishes or queues them on its own.
// The scheduler keeps each client on autopilot at their posts-per-week rate.
import { join, resolve, dirname } from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { db, save, id, token, now, MEDIA_DIR } from "./store.mjs";
import { complete, aiKey, withClientAi } from "./openrouter.mjs";
import { generateImage } from "./images.mjs";
import { composeOfferImage, POST_SIZE } from "./overlay.mjs";
import { shareItem, connections, pickLang, TARGETS, LABELS } from "./social.mjs";
import { blockReason } from "./limits.mjs";

const KEY = aiKey;
const LANG_NAMES = { es: "Spanish", en: "English", de: "German", it: "Italian", nl: "Dutch", sv: "Swedish", fr: "French" };
const running = new Set(); // post ids being generated

const BACKOFF_MIN = [1, 2, 5, 10, 30, 60];
const MAX_FAILED_ATTEMPTS = 6;
const WAIT_MSG = "Waiting for the AI to be available";
/** The AI (OpenRouter) can't answer right now: the post waits and is retried, never templated. */
const aiWaiting = (detail) => Object.assign(new Error(detail), { waiting: true, retryable: true });

export const CONTEXT =
  "You are the content engine of a small AI marketing studio in Tenerife (Canary Islands, Spain). " +
  "Write natural, native-quality social posts for local businesses and their tourist customers. " +
  "Never invent prices, opening hours, awards or facts that are not in the brief. No emoji spam: at most two per caption.";

/**
 * A client-supplied media file name is only accepted as a plain image name inside MEDIA_DIR
 * (no separators, no dots-dots). Returns the name, or throws a 400.
 */
export function safeMediaFile(file) {
  const bad = () => Object.assign(new Error("Invalid image file"), { status: 400 });
  if (typeof file !== "string" || !/^[\w-]+\.(jpe?g|png|webp)$/.test(file)) throw bad();
  const full = resolve(MEDIA_DIR, file);
  if (dirname(full) !== resolve(MEDIA_DIR)) throw bad();
  return file;
}

/** Describe an uploaded photo with a free vision model, so the new image can build on it. */
export async function describeImage(file) {
  if (!KEY()) { safeMediaFile(file); return ""; }
  safeMediaFile(file);
  const buf = await readFile(join(MEDIA_DIR, file));
  const ext = file.split(".").pop();
  const url = `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${buf.toString("base64")}`;
  try {
    const out = await complete({
      key: KEY(), tier: "quick", images: [url],
      prompt: "Describe this photo for a designer in 2 sentences: the subject, setting, colours and mood. No preamble.",
    });
    return out.text.trim();
  } catch (e) {
    console.warn("Image description failed:", e.message);
    return "";
  }
}

function pastConcepts(clientId) {
  return db.posts.filter((p) => p.clientId === clientId && p.concept).slice(-8).map((p) => `- ${p.concept}`).join("\n");
}

/** Ask the LLM for one post: concept, image prompt and captions. Never falls back to a template: without the AI the post waits and is retried. */
async function writePost(client, brief) {
  const langs = client.languages?.length ? client.languages : ["es", "en"];
  const platforms = client.platforms?.length ? client.platforms : ["instagram", "facebook"];
  const shape = `{"concept": string (one line, what this post is about), "imagePrompt": string (English, 40-80 words, a photo-realistic scene for an image generator: subject, setting in Tenerife where it fits, light, composition, style; no text or logos in the image), "altText": string (in ${LANG_NAMES[langs[0]]}, one sentence describing the image for blind users), "captions": {${langs.map((l) => `"${l}": string`).join(", ")}}, "short": {${langs.map((l) => `"${l}": string`).join(", ")}} (the same post for X/Twitter, max 220 characters, no hashtags), "hashtags": string[] (5-8, no #), "cta": string (in ${LANG_NAMES[langs[0]]})}`;
  const prompt =
    `Business: ${client.name} (${client.kind || "local business"}, ${client.town || "Tenerife"}). Tone: ${client.tone || "warm, direct"}.\n` +
    `Platforms: ${platforms.join(", ")}. Write one caption per language (${langs.map((l) => LANG_NAMES[l] ?? l).join(", ")}), each written natively, not translated word for word, max 600 characters.\n` +
    `What the client wants to market now:\n"""${brief.text}"""\n` +
    (brief.imageDescription ? `The client attached a photo: ${brief.imageDescription}\nUse it as reference for the subject, but the new image must be a fresh composition.\n` : "") +
    (pastConcepts(client.id) ? `Earlier posts for this client (pick a clearly different angle and image idea):\n${pastConcepts(client.id)}\n` : "") +
    `Return JSON only, exactly this shape: ${shape}`;

  if (!KEY()) throw aiWaiting("No OpenRouter key configured");
  let out;
  try {
    out = await complete({ key: KEY(), prompt, system: CONTEXT, json: true, tier: "default" });
  } catch (e) {
    throw aiWaiting(e.message);
  }
  const j = out.json ?? {};
  const missing = !j.imagePrompt || !j.captions || langs.some((l) => typeof j.captions[l] !== "string" || !j.captions[l].trim());
  if (missing) throw Object.assign(new Error("The model's reply was missing the image prompt or captions"), { retryable: true });
  return { ...j, model: out.model };
}

/** When the client hasn't said what to market, the AI picks the angle itself from what the business offers. */
const autoBrief = (c) => ({ id: null, text: `No specific request today. Pick a fresh, timely angle (season, day of the week, local life in ${c.town || "Tenerife"}, a product or service highlight) from what the business offers: ${c.offer || c.kind || c.name}` });

export const MIN_POSTS_PER_WEEK = 7; // autopilot posts at least once a day

/** Create a post for a brief (null: the AI picks the topic) and generate it in the background. */
export function startPost(client, brief, reason = "brief") {
  const post = { id: id(), clientId: client.id, briefId: brief?.id ?? null, createdAt: now(), status: "generating", reason, shareKey: token() };
  db.posts.push(post);
  void save();
  void runPost(post.id);
  return post;
}

export async function runPost(postId) {
  if (running.has(postId)) return;
  running.add(postId);
  const post = db.posts.find((p) => p.id === postId);
  const client = db.clients.find((c) => c.id === post?.clientId);
  const brief = post?.briefId ? db.briefs.find((b) => b.id === post.briefId) : client && autoBrief(client);
  try {
    // Posts from the assistant arrive already written (and, for "photo" posts, with the client's own picture).
    if (!post || !client || (!brief && !post.preWritten)) throw new Error("Missing client or brief");
    // A retry after an image error keeps the captions the AI already wrote and only redoes the image.
    if (!post.preWritten && !(post.captions && post.imagePrompt)) {
      if (brief.imageFile && brief.imageDescription == null) {
        brief.imageDescription = await describeImage(brief.imageFile);
      }
      const w = await writePost(client, brief);
      Object.assign(post, {
        concept: w.concept, imagePrompt: w.imagePrompt, altText: w.altText ?? "", captions: w.captions, short: w.short ?? {},
        hashtags: (w.hashtags ?? []).map((h) => String(h).replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean), cta: w.cta ?? "", model: w.model,
      });
    }
    try {
      await drawPostImage(client, post);
    } catch (e) {
      throw e.retryable ? e : Object.assign(new Error(`Image generation failed: ${e.message}`), { retryable: true });
    }
    Object.assign(post, { status: client.autoPublish ? "published" : "ready", generatedAt: now(), error: undefined, nextTryAt: undefined });
    if (client.autoPublish) await publish(client, post);
  } catch (e) {
    if (post) {
      post.attempts = (post.attempts ?? 0) + 1;
      if (e.retryable) {
        const delay = BACKOFF_MIN[Math.min(post.attempts - 1, BACKOFF_MIN.length - 1)] * 60e3;
        const giveUp = !e.waiting && post.attempts >= MAX_FAILED_ATTEMPTS;
        Object.assign(post, {
          status: e.waiting ? "waiting" : "failed", retryable: !giveUp,
          error: e.waiting ? WAIT_MSG : "The AI could not finish this post yet" + (giveUp ? "" : ", we'll retry"),
          nextTryAt: giveUp ? undefined : new Date(Date.now() + delay).toISOString(),
        });
      } else Object.assign(post, { status: "failed", retryable: false, error: e.message, nextTryAt: undefined });
    }
    console.warn("Post generation failed:", e.message);
  } finally {
    running.delete(postId);
    void save();
  }
}

/** Draw a brand-new image for a post (also used to redraw just the image). */
async function drawPostImage(client, post) {
  const file = `${post.id}-${Date.now().toString(36)}.jpg`;
  const old = post.imageFile;
  if (post.kind === "photo") {
    // The client's own photo with the offer written on top.
    await composeOfferImage({ src: join(MEDIA_DIR, post.sourceFile), out: join(MEDIA_DIR, file), ...post.overlay, brand: brandLine(client) });
    Object.assign(post, { imageFile: file, imageEngine: "client photo" });
  } else {
    const brief = db.briefs.find((b) => b.id === post.briefId);
    const raw = post.overlay ? file.replace(/\.jpg$/, "-raw.jpg") : file;
    const img = await generateImage(post.imagePrompt, join(MEDIA_DIR, raw), {
      size: post.overlay ? POST_SIZE : client.imageSize ?? [1080, 1080], reference: brief?.imageFile ? join(MEDIA_DIR, safeMediaFile(brief.imageFile)) : undefined,
    });
    // Offer posts from the assistant get the offer written on the new image too.
    if (post.overlay) {
      await composeOfferImage({ src: join(MEDIA_DIR, raw), out: join(MEDIA_DIR, file), ...post.overlay, brand: brandLine(client) });
      await unlink(join(MEDIA_DIR, raw)).catch(() => {});
    }
    Object.assign(post, { imageFile: file, imageEngine: img.engine, imageNote: img.note });
  }
  if (old && old !== file) await unlink(join(MEDIA_DIR, old)).catch(() => {});
}

/** "Business · Town" line printed on offer images. */
export const brandLine = (c) => [c.name, c.town].filter(Boolean).join(" · ");

/** Keep the captions, draw a new image. */
export async function redrawImage(postId) {
  const post = db.posts.find((p) => p.id === postId);
  const client = db.clients.find((c) => c.id === post?.clientId);
  if ((!post?.imagePrompt && post?.kind !== "photo") || !client || running.has(postId)) return;
  running.add(postId);
  const before = post.status;
  post.status = "generating";
  void save();
  try {
    await drawPostImage(client, post);
    post.status = before === "failed" ? "ready" : before;
    post.error = undefined;
  } catch (e) {
    post.status = before;
    post.error = `New image failed: ${e.message}`;
  } finally {
    running.delete(postId);
    void save();
  }
}

/**
 * Publishing: posts go straight to every connected account the client picked (Instagram, Facebook,
 * X; videos to Reels and YouTube Shorts), and to the client's webhook (n8n, Make, Zapier...) if set.
 * Without either, the post waits in the portal and the studio, ready to share by hand.
 */
export async function publish(client, item, kind = "post") {
  item.publishedAt = now();
  const notes = [];
  const conns = connections(client);
  const langs = kind === "video" ? Object.keys(item.renders ?? {}) : [pickLang(client, item)];
  for (const pf of TARGETS[kind].filter((p) => (client.platforms ?? []).includes(p) && conns[p].ready)) {
    for (const lang of langs.slice(0, 1)) {
      const r = await shareItem(client, item, pf, { kind, lang });
      notes.push(r.ok ? `${LABELS[pf]}: posted` : `${LABELS[pf]}: ${r.error}`);
    }
  }
  if (client.webhookUrl) {
    const base = process.env.PUBLIC_URL ?? "";
    const media = kind === "video"
      ? { videos: Object.fromEntries(Object.entries(item.renders ?? {}).map(([l, r]) => [l, `${base}/media/${r.file}`])) }
      : { imageUrl: `${base}/media/${item.imageFile}` };
    try {
      const r = await fetch(client.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, client: { id: client.id, name: client.name }, [kind]: { ...item, ...media } }),
        signal: AbortSignal.timeout(15e3),
      });
      notes.push(r.ok ? `Sent to webhook (${r.status})` : `Webhook answered ${r.status}`);
    } catch (e) {
      notes.push(`Webhook failed: ${e.message}`);
    }
  }
  item.publishNote = notes.length ? notes.join(" · ") : "Nothing connected yet: share it from the post";
}

/** A post the scheduler will retry on its own (waiting for the AI, or an AI/image error with attempts left). */
const retrying = (p) =>
  (p.status === "waiting" || p.status === "failed") && p.retryable !== false && p.nextTryAt && (p.status === "waiting" || (p.attempts ?? 0) < MAX_FAILED_ATTEMPTS);

/** Restart every waiting/failed post whose backoff has elapsed. Returns the posts restarted. */
export function retryDue(at = Date.now()) {
  const due = db.posts.filter((p) => retrying(p) && !running.has(p.id) && Date.parse(p.nextTryAt) <= at);
  for (const p of due) { p.status = "generating"; void runPost(p.id); }
  if (due.length) void save();
  return due;
}

/**
 * Autopilot: every client with autopilot on gets at least one post a day (`postsPerWeek`, min 7), spaced evenly,
 * from their briefs in rotation (newest first), or on a topic the AI picks when there are none. Each has a new image.
 */
export function tick(at = Date.now()) {
  retryDue(at);
  for (const c of db.clients) {
    if (!c.autopilot || blockReason(c)) continue; // waiting for approval, or at the weekly limit
    const perWeek = Math.max(MIN_POSTS_PER_WEEK, Number(c.postsPerWeek) || 0);
    const briefs = db.briefs.filter((b) => b.clientId === c.id && !b.archived);
    const mine = db.posts.filter((p) => p.clientId === c.id);
    if (mine.some((p) => p.status === "generating" || retrying(p))) continue;
    const last = mine.reduce((t, p) => Math.max(t, Date.parse(p.createdAt)), 0);
    if (at - last < (7 * 864e5) / perWeek) continue;
    const brief = briefs.length ? briefs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[mine.length % briefs.length] : null;
    startPost(c, brief, "autopilot");
  }
}

export function startScheduler() {
  // Posts left "generating" by a restart get another go.
  for (const p of db.posts) if (p.status === "generating") void runPost(p.id);
  setInterval(() => tick(), 60e3).unref();
  tick();
}

// The client's own AI provider (set in the studio) applies to everything done for them, including scheduled work.
writePost = withClientAi(writePost);
