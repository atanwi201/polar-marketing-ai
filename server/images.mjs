// Image generation. With the owner's Google API key: Gemini image models ("Nano Banana"). Without
// one: Pollinations (free, no key). A new picture every call. The free tier caps the size and stamps
// a small logo in the bottom corner, so we ask it for a slightly taller picture, cut that strip off
// and scale the result to exactly the size asked for.
import { writeFile, readFile } from "node:fs/promises";
import { puterImage, puterConfigured } from "./puter.mjs";

const BASE = process.env.POLLINATIONS_BASE_URL ?? "https://image.pollinations.ai";
const KEY = process.env.POLLINATIONS_KEY ?? "";
// Without a key the free tier allows one image every 45 seconds per IP, so every image request
// (posts, video scenes, websites) waits its turn in one line.
const GAP = Number(process.env.POLLINATIONS_GAP_MS ?? (KEY || process.env.POLLINATIONS_BASE_URL ? 0 : 46e3));
let line = Promise.resolve();
let lastStart = 0;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Run fn when it's this request's turn (and the free-tier gap has passed). */
function inLine(fn) {
  const turn = line.then(async () => {
    const wait = lastStart + GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    return fn();
  });
  line = turn.catch(() => {});
  return turn;
}

export function imageUrl(prompt, { seed = randomSeed(), width = 1080, height = 1080, model = process.env.IMAGE_MODEL ?? "flux" } = {}) {
  const q = new URLSearchParams({ width: String(width), height: String(height), seed: String(seed), model, nologo: "true", enhance: "true", safe: "true" });
  return `${BASE}/prompt/${encodeURIComponent(prompt.slice(0, 1500))}?${q}`;
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

let freeModels = { at: 0, list: [] };
/** The free tier's model list changes (it is sometimes a single model), so pick from it live. */
async function freeModel(fetchImpl) {
  if (Date.now() - freeModels.at > 3600e3) {
    const list = await fetchImpl(`${BASE}/models`, { signal: AbortSignal.timeout(10e3) })
      .then((r) => (r.ok ? r.json() : []), () => [])
      .catch(() => []);
    const names = (Array.isArray(list) ? list : []).map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean);
    if (names.length) freeModels = { at: Date.now(), list: names }; // an empty answer is not cached
  }
  const want = process.env.IMAGE_MODEL;
  return want && (!freeModels.list.length || freeModels.list.includes(want)) ? want : freeModels.list[0] ?? want ?? "flux";
}

const LOGO_STRIP = 0.075; // share of the height cut from the bottom

/** Crop the bottom strip, cover-fit to w x h, re-encode as JPEG. Returns the input if it can't. */
export async function finishImage(buf, [w, h], { strip = LOGO_STRIP } = {}) {
  let canvas;
  try { canvas = await import("@napi-rs/canvas"); } catch { return buf; }
  try {
    const img = await canvas.loadImage(buf);
    const srcH = img.height * (1 - strip);
    const k = Math.max(w / img.width, h / srcH);
    const cw = w / k, ch = h / k;
    const sx = (img.width - cw) / 2, sy = Math.max(0, (srcH - ch) / 2);
    const cv = canvas.createCanvas(w, h);
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, cw, ch, 0, 0, w, h);
    return cv.toBuffer("image/jpeg", 90);
  } catch {
    return buf;
  }
}

/** Pollinations: retries with a new seed, since the free service is sometimes busy; a "free limit"
 * answer (402/429) just waits for the time the service asks and tries again. Returns JPEG bytes. */
async function pollinationsImage(prompt, size, { fetchImpl = fetch, attempts = 3 } = {}) {
  let lastErr;
  for (let i = 0, limited = 0; i < attempts; i++) {
    const seed = randomSeed();
    try {
      const tall = Math.round(size[1] / (1 - LOGO_STRIP));
      const model = await freeModel(fetchImpl);
      const r = await inLine(() => fetchImpl(imageUrl(prompt, { seed, width: size[0], height: tall, model }), {
        headers: KEY ? { Authorization: `Bearer ${KEY}` } : {}, signal: AbortSignal.timeout(150e3),
      }));
      if ((r.status === 402 || r.status === 429) && limited++ < 6) {
        const ra = r.headers.get("retry-after");
        const after = ra != null && Number.isFinite(Number(ra)) ? Number(ra) : 45;
        await sleep(after * 1000 + 1000);
        i--;
        continue;
      }
      const type = r.headers.get("content-type") ?? "";
      if (!r.ok || !type.startsWith("image/")) {
        const why = await r.json().then((j) => j?.error?.message ?? "", () => "");
        throw new Error(`Image service answered ${r.status}${why ? `: ${why}` : ` ${type}`}`);
      }
      return await finishImage(Buffer.from(await r.arrayBuffer()), size);
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

// ---------- Google (Gemini "Nano Banana" image models, with the owner's API key) ----------

const GOOGLE = () => (process.env.GOOGLE_AI_BASE_URL ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
export const GOOGLE_MODELS = [
  { id: "gemini-nano-banana-2.1", label: "Nano Banana 2.1" },
  { id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite (cheapest)" },
  { id: "gemini-3-pro-image", label: "Nano Banana Pro (best)" },
];
const RATIOS = ["1:1", "4:5", "5:4", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "21:9"];

/** Closest aspect ratio Google supports for a target size (the result is cropped to the exact size). */
export function nearestRatio([w, h]) {
  const want = Math.log(w / h);
  return RATIOS.reduce((best, r) => {
    const [a, b] = r.split(":").map(Number);
    return Math.abs(Math.log(a / b) - want) < Math.abs(Math.log(best.split(":").map(Number).reduce((x, y) => x / y)) - want) ? r : best;
  }, "1:1");
}

/** Pull the base64 image out of an interaction (or a generateContent-style) response. */
export function findImageData(j) {
  if (j?.output_image?.data) return j.output_image.data;
  for (const step of j?.steps ?? j?.outputs ?? []) {
    for (const c of step.content ?? [step]) if (c?.type === "image" && c.data) return c.data;
  }
  for (const cand of j?.candidates ?? []) for (const p of cand.content?.parts ?? []) if (p.inlineData?.data) return p.inlineData.data;
  return null;
}

async function googleCall(fetchImpl, key, method, path, body) {
  const r = await fetchImpl(GOOGLE() + path, {
    method, headers: { "x-goog-api-key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180e3),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const msg = j.error?.message ?? `answered ${r.status}`;
    throw Object.assign(new Error(`Google: ${msg}`), { status: r.status });
  }
  return j;
}

async function googleImage(prompt, size, { key, model, imageSize = "1K", reference, fetchImpl = fetch }) {
  const input = [{ type: "text", text: reference
    ? `Use the attached photo as reference for the real subject (product, place or style), but create a new, different composition. ${prompt}`
    : prompt }];
  if (reference) {
    const buf = await readFile(reference).catch(() => null);
    if (buf) input.push({ type: "image", mime_type: reference.endsWith(".png") ? "image/png" : reference.endsWith(".webp") ? "image/webp" : "image/jpeg", data: buf.toString("base64") });
  }
  const body = {
    model, input,
    response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: nearestRatio(size), ...(/lite/.test(model) ? {} : { image_size: imageSize }) },
  };
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      let j = await googleCall(fetchImpl, key, "POST", "/v1beta/interactions", body);
      // Long jobs may come back unfinished: poll until done.
      for (let t = 0; !findImageData(j) && j.id && /progress|queued|running|pending/i.test(j.status ?? "") && t < 60; t++) {
        await sleep(3000);
        j = await googleCall(fetchImpl, key, "GET", `/v1beta/interactions/${encodeURIComponent(j.id)}`);
      }
      const data = findImageData(j);
      if (!data) {
        const said = (j.steps ?? []).flatMap((s) => s.content ?? []).find((c) => c.type === "text")?.text;
        throw new Error(`Google returned no image${said ? `: ${said.slice(0, 160)}` : " (the prompt may have been blocked)"}`);
      }
      return await finishImage(Buffer.from(data, "base64"), size, { strip: 0 });
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500 && e.status !== 429) break; // bad key, billing, blocked prompt: no point retrying
      await sleep(2000 * (i + 1));
    }
  }
  throw lastErr;
}

/** Check a Google key and model without generating anything. */
export async function checkGoogle({ key, model }, fetchImpl = fetch) {
  if (!key) return { ok: false, error: "No Google API key yet" };
  try {
    const m = await googleCall(fetchImpl, key, "GET", `/v1beta/models/${encodeURIComponent(model)}`);
    return { ok: true, model: m.displayName ?? model };
  } catch (e) {
    return { ok: false, error: e.status === 404 ? `This key can't use ${model} (not found). Try another model.` : e.message };
  }
}

// ---------- OpenRouter (paid image models, with the OPENROUTER_API_KEY already used for text) ----------

const OPENROUTER = () => (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
export const OPENROUTER_IMAGE_MODELS = [
  { id: "black-forest-labs/flux.2-klein-4b", label: "FLUX.2 Klein (cheapest)" },
  { id: "google/gemini-3.1-flash-lite-image", label: "Gemini Flash Lite Image" },
  { id: "bytedance-seed/seedream-4.5", label: "Seedream 4.5" },
  { id: "google/gemini-nano-banana-2.1", label: "Nano Banana 2.1 (best)" },
];

async function openrouterImage(prompt, size, { key, model, reference, fetchImpl = fetch }) {
  const body = { model, prompt: prompt.slice(0, 3000), aspect_ratio: nearestRatio(size), n: 1 };
  if (reference) {
    const buf = await readFile(reference).catch(() => null);
    if (buf) {
      body.prompt = `Use the reference photo for the real subject (product, place or style), but create a new, different composition. ${body.prompt}`;
      body.input_references = [{ type: "image_url", image_url: { url: `data:image/${reference.endsWith(".png") ? "png" : reference.endsWith(".webp") ? "webp" : "jpeg"};base64,${buf.toString("base64")}` } }];
    }
  }
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchImpl(`${OPENROUTER()}/images`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost", "X-Title": "Polar Marketing" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(180e3),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw Object.assign(new Error(`OpenRouter: ${j.error?.message ?? `answered ${r.status}`}`), { status: r.status });
      const data = j.data?.[0]?.b64_json;
      if (!data) throw new Error("OpenRouter returned no image (the prompt may have been blocked)");
      return await finishImage(Buffer.from(data, "base64"), size, { strip: 0 });
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500 && e.status !== 429) break; // no credits, bad model, blocked: no point retrying
      await sleep(2000 * (i + 1));
    }
  }
  throw lastErr;
}

/** Check the OpenRouter key and image model without generating anything. */
async function checkOpenrouter({ key, model }, fetchImpl = fetch) {
  if (!key) return { ok: false, error: "OPENROUTER_API_KEY is not set in .env" };
  try {
    const k = await fetchImpl(`${OPENROUTER()}/key`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20e3) });
    if (!k.ok) return { ok: false, error: `OpenRouter refused the key (${k.status})` };
    const m = await fetchImpl(`${OPENROUTER()}/images/models/${model}/endpoints`, { signal: AbortSignal.timeout(20e3) });
    if (!m.ok) return { ok: false, error: `OpenRouter has no image model called ${model}` };
    const info = (await k.json().catch(() => ({}))).data ?? {};
    const left = info.limit_remaining ?? (info.limit != null ? info.limit - (info.usage ?? 0) : null);
    return { ok: true, model, note: left != null ? `Credit left on this key: $${Number(left).toFixed(2)}` : "" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------- Choosing the engine ----------

let settingsOf = () => ({});
/** index.mjs passes a getter for the owner's image settings (stored in the studio data). */
export function configureImages(getter) { settingsOf = getter; }

export const PROVIDERS = ["free", "openrouter", "google", "puter"];

/**
 * The image engine in use. "free" (default): Pollinations, no key. "openrouter": paid image models
 * with OPENROUTER_API_KEY. "google": Gemini with the owner's Google key (Studio, else GOOGLE_API_KEY).
 * IMAGE_PROVIDER in .env sets the default; the studio setting wins.
 */
export function imageEngine() {
  const s = settingsOf() ?? {};
  const chosen = PROVIDERS.includes(s.provider) ? s.provider : PROVIDERS.includes(process.env.IMAGE_PROVIDER) ? process.env.IMAGE_PROVIDER : "free";
  const googleKey = s.googleKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
  const openrouterKey = process.env.OPENROUTER_API_KEY ?? "";
  const google = { key: googleKey, model: s.googleModel || process.env.GOOGLE_IMAGE_MODEL || GOOGLE_MODELS[0].id, imageSize: s.googleSize === "2K" ? "2K" : "1K" };
  const openrouter = { key: openrouterKey, model: s.openrouterModel || process.env.OPENROUTER_IMAGE_MODEL || OPENROUTER_IMAGE_MODELS[0].id };
  // A paid engine without its key quietly uses the free one.
  const puterKey = puterConfigured();
  const provider = chosen === "google" && !googleKey ? "free" : chosen === "openrouter" && !openrouterKey ? "free" : chosen === "puter" && !puterKey ? "free" : chosen;
  return {
    chosen, provider, google, openrouter, puter: { key: puterKey }, fallback: s.fallback !== false,
    googleKeySource: s.googleKey ? "studio" : googleKey ? "env" : "",
    label: provider === "puter" ? "puter" : provider === "google" ? `google/${google.model}` : provider === "openrouter" ? `openrouter/${openrouter.model}` : "free",
  };
}

/** The client's photo as a data URL (for Puter's image-to-image). */
async function referenceUrl(path) {
  const buf = await readFile(path).catch(() => null);
  return buf ? `data:image/${path.endsWith(".png") ? "png" : path.endsWith(".webp") ? "webp" : "jpeg"};base64,${buf.toString("base64")}` : undefined;
}

/** Check the chosen paid engine's key and model without generating anything. */
export async function checkEngine(fetchImpl = fetch) {
  const e = imageEngine();
  if (e.chosen === "openrouter") return checkOpenrouter(e.openrouter, fetchImpl);
  if (e.chosen === "google") return checkGoogle(e.google, fetchImpl);
  if (e.chosen === "puter") return e.puter.key ? { ok: true, model: "Puter", note: "Token saved. The first picture shows whether your Puter account can draw." } : { ok: false, error: "Add your Puter auth token in AI providers first" };
  return { ok: true, model: "free image service", note: "No key needed." };
}

/**
 * Generate and save a new image with the chosen engine. Paid engines also get the client's photo as
 * a reference, when there is one; if they fail, the free service takes over (unless switched off).
 * forceFree: only the free Pollinations service, whatever engine the owner chose.
 * Returns { engine, note? }.
 */
export async function generateImage(prompt, file, { size = [1080, 1080], reference, fetchImpl = fetch, attempts = 3, forceFree = false } = {}) {
  const eng = forceFree ? { provider: "free" } : imageEngine();
  let note;
  if (eng.provider !== "free") {
    try {
      const buf = eng.provider === "google"
        ? await googleImage(prompt, size, { ...eng.google, reference, fetchImpl })
        : eng.provider === "puter"
          ? await puterImage(prompt, size, { reference: reference ? await referenceUrl(reference) : undefined })
          : await openrouterImage(prompt, size, { ...eng.openrouter, reference, fetchImpl });
      await writeFile(file, buf);
      return { engine: eng.label };
    } catch (e) {
      if (!eng.fallback) throw e;
      note = `${e.message}. Used the free image service instead.`;
      console.warn("Paid image engine failed, falling back:", e.message);
    }
  }
  await writeFile(file, await pollinationsImage(prompt, size, { fetchImpl, attempts }));
  return { engine: "free", note };
}
