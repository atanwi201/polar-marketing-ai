// The autonomous content studio. A client says what to market (optionally with a photo); the AI
// writes the posts and a brand-new image every time, then publishes or queues them on its own.
// The scheduler keeps each client on autopilot at their posts-per-week rate.
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { db, save, id, now, MEDIA_DIR } from "./store.mjs";
import { complete } from "./openrouter.mjs";
import { generateImage } from "./images.mjs";

const KEY = () => process.env.OPENROUTER_API_KEY ?? "";
const LANG_NAMES = { es: "Spanish", en: "English", de: "German", it: "Italian", nl: "Dutch", sv: "Swedish", fr: "French" };
const running = new Set(); // post ids being generated

export const CONTEXT =
  "You are the content engine of a small AI marketing studio in Tenerife (Canary Islands, Spain). " +
  "Write natural, native-quality social posts for local businesses and their tourist customers. " +
  "Never invent prices, opening hours, awards or facts that are not in the brief. No emoji spam: at most two per caption.";

/** Describe an uploaded photo with a free vision model, so the new image can build on it. */
async function describeImage(file) {
  if (!KEY()) return "";
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

/** Ask the LLM for one post: concept, image prompt and captions. Falls back to a template without a key. */
async function writePost(client, brief) {
  const langs = client.languages?.length ? client.languages : ["es", "en"];
  const platforms = client.platforms?.length ? client.platforms : ["instagram", "facebook"];
  const shape = `{"concept": string (one line, what this post is about), "imagePrompt": string (English, 40-80 words, a photo-realistic scene for an image generator: subject, setting in Tenerife where it fits, light, composition, style; no text or logos in the image), "captions": {${langs.map((l) => `"${l}": string`).join(", ")}}, "hashtags": string[] (5-8, no #), "cta": string (in ${LANG_NAMES[langs[0]]})}`;
  const prompt =
    `Business: ${client.name} (${client.kind || "local business"}, ${client.town || "Tenerife"}). Tone: ${client.tone || "warm, direct"}.\n` +
    `Platforms: ${platforms.join(", ")}. Write one caption per language (${langs.map((l) => LANG_NAMES[l] ?? l).join(", ")}), each written natively, not translated word for word, max 600 characters.\n` +
    `What the client wants to market now:\n"""${brief.text}"""\n` +
    (brief.imageDescription ? `The client attached a photo: ${brief.imageDescription}\nUse it as reference for the subject, but the new image must be a fresh composition.\n` : "") +
    (pastConcepts(client.id) ? `Earlier posts for this client (pick a clearly different angle and image idea):\n${pastConcepts(client.id)}\n` : "") +
    `Return JSON only, exactly this shape: ${shape}`;

  if (!KEY()) {
    return {
      concept: brief.text.slice(0, 80),
      imagePrompt: `Professional advertising photo for ${client.kind || "a local business"} in ${client.town || "Tenerife"}: ${brief.text}. ${brief.imageDescription || ""} Natural Canary Islands light, vibrant, high detail, no text`,
      captions: Object.fromEntries(langs.map((l) => [l, `${brief.text}\n\n${client.name} · ${client.town || "Tenerife"}`])),
      hashtags: ["tenerife", "canaryislands", (client.town || "tenerife").toLowerCase().replace(/\W/g, "")],
      cta: "",
      model: "template (add OPENROUTER_API_KEY for AI captions)",
    };
  }
  const out = await complete({ key: KEY(), prompt, system: CONTEXT, json: true, tier: "default" });
  const j = out.json ?? {};
  if (!j.imagePrompt || !j.captions) throw new Error("The model's reply was missing the image prompt or captions");
  return { ...j, model: out.model };
}

/** Create a post for a brief and generate it in the background. */
export function startPost(client, brief, reason = "brief") {
  const post = { id: id(), clientId: client.id, briefId: brief.id, createdAt: now(), status: "generating", reason };
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
  const brief = db.briefs.find((b) => b.id === post?.briefId);
  try {
    if (!post || !client || !brief) throw new Error("Missing client or brief");
    if (brief.imageFile && brief.imageDescription == null) {
      brief.imageDescription = await describeImage(brief.imageFile);
    }
    const w = await writePost(client, brief);
    Object.assign(post, { concept: w.concept, imagePrompt: w.imagePrompt, captions: w.captions, hashtags: w.hashtags ?? [], cta: w.cta ?? "", model: w.model });
    const file = `${post.id}.jpg`;
    const img = await generateImage(w.imagePrompt, join(MEDIA_DIR, file), { size: client.imageSize ?? [1080, 1080] });
    Object.assign(post, { imageFile: file, imageSeed: img.seed, status: client.autoPublish ? "published" : "ready", generatedAt: now() });
    if (client.autoPublish) await publish(client, post);
  } catch (e) {
    if (post) Object.assign(post, { status: "failed", error: e.message });
    console.warn("Post generation failed:", e.message);
  } finally {
    running.delete(postId);
    void save();
  }
}

/**
 * Publishing: real Instagram/Facebook posting needs Meta's API, so each client can set a webhook
 * (n8n, Make, Zapier...) that receives the finished post and posts it. Without one, the post sits
 * in the client's portal and the studio, ready to download.
 */
export async function publish(client, post) {
  post.publishedAt = now();
  if (!client.webhookUrl) { post.publishNote = "No webhook set: ready in the portal"; return; }
  try {
    const r = await fetch(client.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: { id: client.id, name: client.name }, post: { ...post, imageUrl: `${process.env.PUBLIC_URL ?? ""}/media/${post.imageFile}` } }),
      signal: AbortSignal.timeout(15e3),
    });
    post.publishNote = r.ok ? `Sent to webhook (${r.status})` : `Webhook answered ${r.status}`;
  } catch (e) {
    post.publishNote = `Webhook failed: ${e.message}`;
  }
}

/**
 * Autopilot: every client with autopilot on gets `postsPerWeek` posts, spaced evenly, each from
 * their briefs in rotation (newest brief first), each with a new image.
 */
export function tick(at = Date.now()) {
  for (const c of db.clients) {
    if (!c.autopilot || !(c.postsPerWeek > 0)) continue;
    const briefs = db.briefs.filter((b) => b.clientId === c.id && !b.archived);
    if (!briefs.length) continue;
    const mine = db.posts.filter((p) => p.clientId === c.id);
    if (mine.some((p) => p.status === "generating")) continue;
    const last = mine.reduce((t, p) => Math.max(t, Date.parse(p.createdAt)), 0);
    if (at - last < (7 * 864e5) / c.postsPerWeek) continue;
    const brief = briefs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[mine.length % briefs.length];
    startPost(c, brief, "autopilot");
  }
}

export function startScheduler() {
  // Posts left "generating" by a restart get another go.
  for (const p of db.posts) if (p.status === "generating") void runPost(p.id);
  setInterval(() => tick(), 60e3).unref();
  tick();
}
