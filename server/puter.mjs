// Everything Puter.js can do beyond chat, from Node with the owner's Puter auth token: pictures
// (txt2img), spoken voice (txt2speech) and speech recognition (speech2txt). Puter returns browser-style
// objects (an <img> or <audio> with a src), so the result is turned into plain bytes here.
import { aiSettings, puterApi, puterConfigured } from "./openrouter.mjs";

export { puterConfigured };

/** Image or audio bytes from whatever Puter returned: bytes, a Blob, a data: URL or an http(s) URL. */
export async function toBuffer(x, fetchImpl = fetch) {
  if (!x) throw new Error("Puter returned nothing");
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x);
  if (x instanceof ArrayBuffer) return Buffer.from(x);
  if (typeof x.arrayBuffer === "function") return Buffer.from(await x.arrayBuffer());
  const src = typeof x === "string" ? x : x.src ?? x.url ?? x.currentSrc ?? x.data?.url;
  if (typeof src !== "string" || !src) throw new Error("Puter returned something unreadable");
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(src);
  if (m) return m[1] ? Buffer.from(m[2], "base64") : Buffer.from(decodeURIComponent(m[2]));
  if (/^https?:/i.test(src)) {
    const r = await fetchImpl(src);
    if (!r.ok) throw new Error(`Puter file download failed (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error("Puter returned a link this server can't open");
}

const msg = (e) => e?.error?.message ?? e?.message ?? (typeof e === "string" ? e : JSON.stringify(e)?.slice(0, 160));
const settings = () => aiSettings().puter ?? {};
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`Puter ${what} took too long`)), ms).unref?.())]);

/** Draw a picture. `reference` is an optional data URL of the client's photo for image-to-image. Returns a Buffer. */
export async function puterImage(prompt, size = [1080, 1080], { reference, model } = {}) {
  const puter = await puterApi();
  if (!puter) throw new Error("Add your Puter auth token in AI providers first");
  const [w, h] = size;
  const opts = { ratio: { w: Math.round(w), h: Math.round(h) }, ...((model || settings().imageModel) ? { model: model || settings().imageModel } : {}), ...(reference ? { input_image: reference } : {}) };
  try {
    return await toBuffer(await withTimeout(puter.ai.txt2img(String(prompt).slice(0, 3000), opts), 180e3, "image"));
  } catch (e) { throw new Error(`Puter image: ${msg(e)}`); }
}

const SPEECH_LANG = { es: "es-ES", en: "en-US", de: "de-DE", fr: "fr-FR", it: "it-IT", pt: "pt-PT", nl: "nl-NL", sv: "sv-SE", ru: "ru-RU", pl: "pl-PL" };

/** Speak `text` (up to 3000 characters). Returns { buffer, ext }. Provider and voice come from the AI providers dialog. */
export async function puterSpeech(text, lang = "en") {
  const puter = await puterApi();
  if (!puter) throw new Error("Add your Puter auth token in AI providers first");
  const s = settings();
  const provider = s.voiceProvider || "openai"; // OpenAI voices speak every language we use
  const opts = { provider, ...(s.voice ? { voice: s.voice } : {}), ...(provider === "aws-polly" ? { language: SPEECH_LANG[lang] ?? "en-US", engine: "neural" } : {}) };
  try {
    const buffer = await toBuffer(await withTimeout(puter.ai.txt2speech(String(text).slice(0, 3000), opts), 90e3, "voice"));
    const head = buffer.subarray(0, 4).toString("latin1");
    return { buffer, ext: head === "RIFF" ? "wav" : head === "OggS" ? "ogg" : "mp3" };
  } catch (e) { throw new Error(`Puter voice: ${msg(e)}`); }
}

/** Turn a recording into text. `buffer` holds the audio, `mime` its type. Returns the transcript ("" when silent). */
export async function puterTranscribe(buffer, mime = "audio/mpeg") {
  const puter = await puterApi();
  if (!puter) throw new Error("Add your Puter auth token in AI providers first");
  try {
    const res = await withTimeout(puter.ai.speech2txt(`data:${mime};base64,${buffer.toString("base64")}`), 120e3, "transcription");
    return String(typeof res === "string" ? res : res?.text ?? res?.transcript ?? "").trim();
  } catch (e) { throw new Error(`Puter transcription: ${msg(e)}`); }
}
