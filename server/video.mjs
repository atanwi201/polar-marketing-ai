// Short vertical video ads (9:16, 1080x1920, H.264/AAC MP4) for Instagram Reels, Facebook Reels and
// YouTube Shorts. The AI writes the script, every scene gets a brand-new image, text is drawn on
// screen with @napi-rs/canvas, and ffmpeg animates it (slow zoom, crossfades, end card).
// Optional voice-over with the system voices (macOS `say`). One MP4 per language from the same images.
import { spawn, execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { db, save, id, token, now, MEDIA_DIR } from "./store.mjs";
import { complete, aiKey, withClientAi } from "./openrouter.mjs";
import { puterSpeech, puterConfigured } from "./puter.mjs";
import { generateImage } from "./images.mjs";
import { CONTEXT } from "./studio.mjs";
import { FONT, clean, glue, fitText, boxedLines } from "./draw.mjs";
import { blockReason } from "./limits.mjs";

const run = promisify(execFile);
const KEY = aiKey;
const FFMPEG = () => process.env.FFMPEG_PATH ?? "ffmpeg";
const LANG_NAMES = { es: "Spanish", en: "English", de: "German", it: "Italian", nl: "Dutch", sv: "Swedish", fr: "French" };
export const LENGTHS = [15, 20, 30];
const W = 1080, H = 1920, FPS = 30, FADE = 0.45, END = 3;
const SCENES = { 15: 3, 20: 4, 30: 6 };

// ---------- What this machine can do ----------

let caps;
/** ffmpeg (needed) and system voices (optional), checked once. */
export async function capabilities() {
  if (caps) return caps;
  const ffmpeg = await run(FFMPEG(), ["-hide_banner", "-version"]).then(() => true, () => false);
  const voices = process.platform === "darwin" ? await systemVoices().catch(() => ({})) : {};
  let canvas = true;
  try { await import("@napi-rs/canvas"); } catch { canvas = false; }
  caps = { ffmpeg, canvas, voices: Object.keys(voices), voiceMap: voices };
  return puterConfigured() ? { ...caps, voices: ["Puter", ...caps.voices] } : caps; // Puter speaks every language, on any computer
}

const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Zarvox|Fred|Junior|Ralph|Kathy|Grandma|Grandpa|Rocko|Sandy|Shelley|Reed|Eddy|Flo)\b/;
const PREFERRED = { es: ["Mónica", "Monica", "Paulina", "Jorge"], en: ["Samantha", "Daniel", "Karen", "Moira"], de: ["Anna", "Markus"], it: ["Alice", "Luca"], fr: ["Thomas", "Amélie"], nl: ["Xander", "Ellen"], sv: ["Alva", "Klara"] };

async function systemVoices() {
  const { stdout } = await run("say", ["-v", "?"]);
  const byLang = {};
  for (const line of stdout.split("\n")) {
    const m = /^(.+?)\s{2,}([a-z]{2})_[A-Z]{2}\s+#/.exec(line);
    if (!m || NOVELTY.test(m[1])) continue;
    (byLang[m[2]] ??= []).push(m[1].trim());
  }
  const out = {};
  for (const [l, names] of Object.entries(byLang)) out[l] = (PREFERRED[l] ?? []).find((p) => names.includes(p)) ?? names[0];
  return out;
}

// ---------- Script ----------

async function writeScript(client, video) {
  const langs = video.langs;
  const n = SCENES[video.seconds] ?? 3;
  const words = Math.round(video.seconds * 2.1);
  const per = (desc) => `{${langs.map((l) => `"${l}": string`).join(", ")}} (${desc})`;
  const shape = `{"concept": string (one line, in ${LANG_NAMES[langs[0]] ?? "Spanish"}), "scenes": [{"imagePrompt": string (English, 40-70 words, vertical 9:16 photo-realistic shot for an image generator: subject, setting in Tenerife where it fits, light, camera angle; no text, no logos, no close-up faces), "text": ${per("on-screen text, max 7 words, punchy")}}] (exactly ${n} scenes; scene 1 is the hook that stops the scroll, the last one shows the offer), "endCta": ${per("max 5 words, e.g. book on WhatsApp")}, "voiceover": ${per(`spoken script, natural, max ${words} words`)}, "captions": ${per("Reels/Facebook caption, max 400 characters")}, "title": ${per("YouTube Shorts title, max 70 characters")}, "description": ${per("YouTube description, 2-3 sentences")}, "hashtags": string[] (5-8, no #)}`;
  const prompt =
    `Business: ${client.name} (${client.kind || "local business"}, ${client.town || "Tenerife"}). Tone: ${client.tone || "warm, direct"}. Contact: ${client.phone || ""}.\n` +
    `Write a ${video.seconds}-second vertical video ad for Instagram Reels, Facebook Reels and YouTube Shorts, in ${langs.map((l) => LANG_NAMES[l] ?? l).join(", ")} (each written natively).\n` +
    `What to promote:\n"""${video.text}"""\n` +
    (video.imageDescription ? `The client attached a photo: ${video.imageDescription}\nUse it as reference for the subject, but every scene is a fresh image.\n` : "") +
    `Return JSON only, exactly this shape: ${shape}`;

  if (!KEY()) {
    const t = video.text.replace(/\s+/g, " ").trim();
    const bits = [t.split(/[.,:;!?]/)[0], client.kind || client.name, client.town || "Tenerife"].map((s) => s.trim()).filter(Boolean);
    return {
      concept: t.slice(0, 80),
      scenes: Array.from({ length: n }, (_, i) => ({
        imagePrompt: `Vertical advertising photo for ${client.kind || "a local business"} in ${client.town || "Tenerife"}: ${t}. Shot ${i + 1} of ${n}, ${["wide establishing view", "close-up detail", "people enjoying it, seen from behind", "warm atmosphere", "product close-up", "golden hour"][i % 6]}. Natural Canary Islands light, vibrant, high detail, no text`,
        text: Object.fromEntries(langs.map((l) => [l, (bits[i % bits.length] ?? t).split(" ").slice(0, 7).join(" ")])),
      })),
      endCta: Object.fromEntries(langs.map((l) => [l, l === "es" ? "Escríbenos" : "Message us"])),
      voiceover: Object.fromEntries(langs.map((l) => [l, t.split(" ").slice(0, words).join(" ")])),
      captions: Object.fromEntries(langs.map((l) => [l, `${t}\n\n${client.name} · ${client.town || "Tenerife"}`])),
      title: Object.fromEntries(langs.map((l) => [l, `${client.name}: ${t}`.slice(0, 70)])),
      description: Object.fromEntries(langs.map((l) => [l, `${t}\n${client.name} · ${client.town || "Tenerife"} · ${client.phone || ""}`])),
      hashtags: ["tenerife", "canaryislands", (client.town || "tenerife").toLowerCase().replace(/\W/g, "")],
      model: "template (add OPENROUTER_API_KEY for AI scripts)",
    };
  }
  const out = await complete({ key: KEY(), prompt, system: CONTEXT, json: true, tier: "default" });
  const j = out.json ?? {};
  if (!Array.isArray(j.scenes) || !j.scenes.length || !j.scenes.every((s) => s?.imagePrompt)) throw new Error("The model's reply was missing the scenes");
  return { ...j, scenes: j.scenes.slice(0, n), model: out.model };
}

// ---------- On-screen text ----------

// Instagram/YouTube put buttons on the right and captions at the bottom: keep text in the middle band.
const SAFE = { left: 90, right: 150, top: 260, bottom: 520 };
const CX = SAFE.left + (W - SAFE.left - SAFE.right) / 2;
const MAX_W = W - SAFE.left - SAFE.right - 60;

export async function sceneOverlay(text, hook, file) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  const t = glue(clean(text));
  if (t) {
    if (hook) {
      const fit = fitText(ctx, t, { maxW: MAX_W, maxLines: 4, size: 104, min: 64 });
      const h = fit.lines.length * Math.round(fit.size * 1.32 + 8);
      boxedLines(ctx, fit, { cx: CX, top: Math.round(H * 0.42 - h / 2), bg: "rgba(255,255,255,0.94)", fg: "#14232a" });
    } else {
      const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = g;
      ctx.fillRect(0, H * 0.45, W, H * 0.55);
      const fit = fitText(ctx, t, { maxW: MAX_W, maxLines: 3, size: 82, min: 54 });
      const h = fit.lines.length * Math.round(fit.size * 1.32 + 8);
      boxedLines(ctx, fit, { cx: CX, top: H - SAFE.bottom - h, bg: "rgba(12,24,30,0.78)", fg: "#ffffff" });
    }
  }
  await writeFile(file, cv.toBuffer("image/png"));
}

const AI_LABEL = {
  es: ["Imágenes creadas con IA", "Voz e imágenes creadas con IA"], en: ["Images made with AI", "Voice and images made with AI"],
  de: ["Bilder mit KI erstellt", "Stimme und Bilder mit KI erstellt"], it: ["Immagini create con IA", "Voce e immagini create con IA"],
  fr: ["Images créées par IA", "Voix et images créées par IA"], nl: ["Beelden gemaakt met AI", "Stem en beelden gemaakt met AI"],
  sv: ["Bilder skapade med AI", "Röst och bilder skapade med AI"],
};

export async function endOverlay(client, cta, lang, voice, file) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "rgba(8,18,24,0.5)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const name = fitText(ctx, clean(client.name), { maxW: MAX_W, maxLines: 2, size: 112, min: 64, weight: 800 });
  let y = Math.round(H * 0.36);
  ctx.font = `800 ${name.size}px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 24;
  for (const l of name.lines) { ctx.fillText(l, CX, y); y += Math.round(name.size * 1.12); }
  ctx.shadowBlur = 0;
  y += 40;
  const pill = fitText(ctx, clean(cta), { maxW: MAX_W - 80, maxLines: 2, size: 66, min: 44 });
  y += boxedLines(ctx, pill, { cx: CX, top: y, bg: "#ffcf4a", fg: "#14232a" }) + 56;
  ctx.font = `600 50px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  for (const l of [client.phone, [client.town, client.domain && /\./.test(client.domain) ? client.domain : ""].filter(Boolean).join(" · ")].map(clean).filter(Boolean)) {
    ctx.fillText(l, CX, y + 40); y += 70;
  }
  ctx.font = `500 30px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText((AI_LABEL[lang] ?? AI_LABEL.en)[voice ? 1 : 0], CX, H - SAFE.bottom + 40);
  await writeFile(file, cv.toBuffer("image/png"));
}

// ---------- Voice-over ----------

async function voiceOver(text, lang, file) {
  if (!clean(text)) return null;
  const original = file;
  if (puterConfigured()) {
    try {
      const { buffer, ext } = await puterSpeech(clean(text), lang);
      file = file.replace(/\.\w+$/, `.${ext}`);
      await writeFile(file, buffer);
    } catch (e) {
      console.warn("Puter voice failed, using the system voice:", e.message);
      file = null;
    }
  } else file = null;
  if (!file) {
    const voice = (await capabilities()).voiceMap[lang];
    if (!voice) return null;
    file = original;
    await run("say", ["-v", voice, "-r", "175", "-o", file, clean(text)], { timeout: 60e3 });
  }
  const { stdout } = await run(FFMPEG().replace(/ffmpeg$/, "ffprobe"), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).catch(() => ({ stdout: "0" }));
  return { file, duration: Number(stdout) || 0 };
}

// ---------- Render ----------

const MOTIONS = [
  (n) => ({ z: `1+0.13*on/${n}`, x: "(iw-iw/zoom)/2", y: "(ih-ih/zoom)/2" }),
  (n) => ({ z: `1.13-0.13*on/${n}`, x: "(iw-iw/zoom)/2", y: "(ih-ih/zoom)/2" }),
  (n) => ({ z: "1.12", x: `(iw-iw/zoom)*on/${n}`, y: "(ih-ih/zoom)/2" }),
  (n) => ({ z: `1+0.1*on/${n}`, x: "(iw-iw/zoom)/2", y: `(ih-ih/zoom)*(1-on/${n})` }),
];

/** Scene durations so that scenes + end card (with crossfades) add up to the requested length. */
export function timeline(seconds, n) {
  const scene = (seconds - END + n * FADE) / n;
  return { scene: Math.round(scene * 100) / 100, end: END, total: Math.round((n * scene + END - n * FADE) * 100) / 100 };
}

export function ffmpeg(args, timeoutMs = 10 * 60e3) {
  return new Promise((ok, fail) => {
    const p = spawn(FFMPEG(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", (e) => { clearTimeout(timer); fail(e); });
    p.on("close", (code) => { clearTimeout(timer); code === 0 ? ok() : fail(new Error(`ffmpeg failed (${code}): ${err.split("\n").filter(Boolean).slice(-3).join(" | ")}`)); });
  });
}

/** Render one language: scenes with motion + text, end card, audio, H.264/AAC MP4 and a cover JPEG. */
export async function renderVideo({ images, texts, endPng, voice, seconds, out, cover, work }) {
  const n = images.length;
  const tl = timeline(seconds, n);
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  const f = [];
  let input = 0;
  const frames = Math.round(tl.scene * FPS);
  images.forEach((img, i) => {
    args.push("-loop", "1", "-framerate", String(FPS), "-t", String(tl.scene), "-i", img);
    args.push("-loop", "1", "-framerate", String(FPS), "-t", String(tl.scene), "-i", texts[i]);
    const m = MOTIONS[i % MOTIONS.length](frames);
    f.push(`[${input}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,` +
      `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=1:s=${W}x${H}:fps=${FPS},trim=duration=${tl.scene},setpts=PTS-STARTPTS[b${i}]`);
    f.push(`[${input + 1}:v]format=rgba,fade=t=in:st=${i === 0 ? 0.1 : 0.35}:d=0.45:alpha=1[o${i}]`);
    f.push(`[b${i}][o${i}]overlay=0:0:format=auto,format=yuv420p,setsar=1[s${i}]`);
    input += 2;
  });
  args.push("-loop", "1", "-framerate", String(FPS), "-t", String(tl.end), "-i", images[n - 1]);
  args.push("-loop", "1", "-framerate", String(FPS), "-t", String(tl.end), "-i", endPng);
  f.push(`[${input}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:2,setsar=1[eb]`);
  f.push(`[${input + 1}:v]format=rgba,fade=t=in:st=0:d=0.4:alpha=1[eo]`);
  f.push(`[eb][eo]overlay=0:0:format=auto,format=yuv420p,setsar=1[s${n}]`);
  input += 2;
  let last = "s0";
  for (let i = 1; i <= n; i++) {
    const offset = Math.round((i * tl.scene - i * FADE) * 1000) / 1000;
    f.push(`[${last}][s${i}]xfade=transition=${i === n ? "fadeblack" : "fade"}:duration=${FADE}:offset=${offset}[x${i}]`);
    last = `x${i}`;
  }
  f.push(`[${last}]fps=${FPS},scale=out_range=tv,format=yuv420p,setparams=range=tv[v]`);
  if (voice) {
    args.push("-i", voice.file);
    const tempo = voice.duration > tl.total - 0.6 ? Math.min(1.35, voice.duration / (tl.total - 0.6)) : 1;
    f.push(`[${input}:a]aresample=48000,${tempo > 1 ? `atempo=${tempo.toFixed(3)},` : ""}adelay=300|300,apad,atrim=0:${tl.total},afade=t=out:st=${tl.total - 0.5}:d=0.5,aformat=channel_layouts=stereo[a]`);
  } else {
    args.push("-f", "lavfi", "-t", String(tl.total), "-i", "anullsrc=r=48000:cl=stereo");
    f.push(`[${input}:a]anull[a]`);
  }
  args.push("-filter_complex", f.join(";"), "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-r", String(FPS), "-g", String(FPS * 2),
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", "-t", String(tl.total), out);
  await ffmpeg(args);
  await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-ss", "1.2", "-i", out, "-frames:v", "1", "-q:v", "3", cover]);
  return { duration: tl.total, size: (await stat(out)).size };
}

// ---------- Jobs ----------

const running = new Set();
let queue = Promise.resolve(); // one render at a time: ffmpeg is heavy

/** Run a heavy ffmpeg job after the ones already waiting (videos and client clips share one line). */
export function enqueueRender(fn) {
  const job = queue.then(fn);
  queue = job.catch(() => {});
  return job;
}

/** Queue a new video ad. `opts`: { text, seconds, langs, voice, briefId, imageDescription, reason }. */
export function startVideo(client, opts) {
  const langs = (opts.langs?.length ? opts.langs : (client.languages ?? ["es"]).slice(0, 1)).filter((l) => LANG_NAMES[l]).slice(0, 4);
  const video = {
    id: id(), clientId: client.id, briefId: opts.briefId, text: String(opts.text).slice(0, 2000), imageDescription: opts.imageDescription, refImage: opts.refImage,
    seconds: LENGTHS.includes(Number(opts.seconds)) ? Number(opts.seconds) : 15, langs: langs.length ? langs : ["es"], voice: !!opts.voice,
    createdAt: now(), status: "generating", step: "script", progress: 0, reason: opts.reason ?? "request", shareKey: token(),
  };
  db.videos.push(video);
  void save();
  void runVideo(video.id);
  return video;
}

export async function runVideo(videoId) {
  // Clips are the business's own video with the offer on top: no script, no new images.
  if (db.videos.find((v) => v.id === videoId)?.kind === "clip") return (await import("./assistant.mjs")).runClip(videoId);
  if (running.has(videoId)) return;
  running.add(videoId);
  const video = db.videos.find((v) => v.id === videoId);
  const client = db.clients.find((c) => c.id === video?.clientId);
  const set = (o) => { Object.assign(video, o); void save(); };
  let work;
  try {
    if (!video || !client) throw new Error("Missing client or video");
    const cap = await capabilities();
    if (!cap.ffmpeg) throw new Error("ffmpeg is not installed on the server. Install it (macOS: brew install ffmpeg) and try again.");
    if (!cap.canvas) throw new Error("The text renderer is missing. Run npm install.");
    work = await mkdtemp(join(tmpdir(), "isla-video-"));

    if (!video.scenes) {
      set({ step: "script", progress: 5 });
      const s = await writeScript(client, video);
      // A re-render that adds languages keeps the images and every text already written or edited.
      const k = video.keep ?? {};
      const merge = (field) => ({ ...s[field], ...k[field] });
      set({
        keep: undefined,
        concept: video.concept ?? s.concept,
        scenes: (k.scenes ?? s.scenes).map((x, i) => ({ imagePrompt: x.imagePrompt, imageFile: x.imageFile, text: { ...s.scenes[i]?.text, ...(k.scenes ? x.text : {}) } })),
        endCta: merge("endCta"), voiceover: merge("voiceover"), captions: merge("captions"), title: merge("title"), description: merge("description"),
        hashtags: video.hashtags?.length ? video.hashtags : (s.hashtags ?? []).map((h) => String(h).replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean), model: s.model,
      });
    }
    // Images: a new one for every scene (kept if a render is retried).
    for (const [i, sc] of video.scenes.entries()) {
      if (sc.imageFile) continue;
      set({ step: "images", progress: 10 + Math.round((i / video.scenes.length) * 55), stepNote: `Scene ${i + 1} of ${video.scenes.length}` });
      const file = `${video.id}-s${i}.jpg`;
      const img = await generateImage(sc.imagePrompt, join(MEDIA_DIR, file), { size: [W, H], reference: video.refImage ? join(MEDIA_DIR, video.refImage) : undefined });
      Object.assign(sc, { imageFile: file, imageEngine: img.engine });
      if (img.note) video.imageNote = img.note;
      void save();
    }
    set({ step: "rendering", progress: 70, stepNote: "" });
    // ffmpeg runs one video at a time across all clients.
    const job = enqueueRender(async () => {
      const renders = {};
      for (const [k, lang] of video.langs.entries()) {
        set({ stepNote: video.langs.length > 1 ? `${lang.toUpperCase()} (${k + 1} of ${video.langs.length})` : "" });
        const texts = [];
        for (const [i, sc] of video.scenes.entries()) {
          const png = join(work, `t-${lang}-${i}.png`);
          await sceneOverlay(sc.text?.[lang] ?? Object.values(sc.text ?? {})[0] ?? "", i === 0, png);
          texts.push(png);
        }
        const endPng = join(work, `end-${lang}.png`);
        const vo = video.voice ? await voiceOver(video.voiceover?.[lang], lang, join(work, `vo-${lang}.aiff`)).catch(() => null) : null;
        await endOverlay(client, video.endCta?.[lang] ?? "", lang, !!vo, endPng);
        const file = `${video.id}-${lang}-${Date.now().toString(36)}.mp4`;
        const cover = file.replace(/\.mp4$/, ".jpg");
        const r = await renderVideo({
          images: video.scenes.map((s) => join(MEDIA_DIR, s.imageFile)), texts, endPng, voice: vo, seconds: video.seconds,
          out: join(MEDIA_DIR, file), cover: join(MEDIA_DIR, cover), work,
        });
        renders[lang] = { file, cover, duration: r.duration, size: r.size, voice: !!vo };
        set({ progress: 70 + Math.round(((k + 1) / video.langs.length) * 29) });
      }
      return renders;
    });
    const renders = await job;
    const fresh = new Set(Object.values(renders).flatMap((r) => [r.file, r.cover]));
    const old = Object.values(video.renders ?? {}).flatMap((r) => [r.file, r.cover]).filter((f) => f && !fresh.has(f));
    await Promise.all(old.map((f) => rm(join(MEDIA_DIR, f), { force: true })));
    set({ renders, status: client.autoPublish ? "published" : "ready", step: "", stepNote: "", progress: 100, error: undefined, generatedAt: now() });
    if (client.autoPublish) {
      const { publish } = await import("./studio.mjs");
      await publish(client, video, "video");
    }
  } catch (e) {
    if (video) set({ status: "failed", error: e.message, step: "" });
    console.warn("Video generation failed:", e.message);
  } finally {
    running.delete(videoId);
    if (work) await rm(work, { recursive: true, force: true }).catch(() => {});
    void save();
  }
}

/** Re-render with the same script and images (e.g. after editing on-screen text or adding a language). */
export function rerender(video) {
  video.status = "generating";
  video.error = undefined;
  void runVideo(video.id);
}

/** Videos left "generating" by a restart get another go; autopilot adds videosPerWeek. */
export function startVideoScheduler() {
  for (const v of db.videos) if (v.status === "generating") void runVideo(v.id);
}

export function videoTick(at = Date.now()) {
  for (const c of db.clients) {
    if (!c.autopilot || !(c.videosPerWeek > 0) || blockReason(c)) continue; // approval and the weekly limit
    const briefs = db.briefs.filter((b) => b.clientId === c.id && !b.archived);
    if (!briefs.length) continue;
    const mine = db.videos.filter((v) => v.clientId === c.id);
    if (mine.some((v) => v.status === "generating")) continue;
    const last = mine.reduce((t, v) => Math.max(t, Date.parse(v.createdAt)), 0);
    if (at - last < (7 * 864e5) / c.videosPerWeek) continue;
    const brief = briefs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[mine.length % briefs.length];
    startVideo(c, { text: brief.text, briefId: brief.id, imageDescription: brief.imageDescription, refImage: brief.imageFile, seconds: c.videoSeconds ?? 15, langs: (c.languages ?? []).slice(0, 2), voice: !!c.videoVoice, reason: "autopilot" });
  }
}

// The client's own AI provider (set in the studio) applies to everything done for them, including scheduled work.
writeScript = withClientAi(writeScript);
