// Voice for the app: what the business says becomes text, and text becomes speech.
// NagaAI first when a key is set (it transcribes and speaks over the OpenAI audio format), then
// Puter, which runs on the owner's own allowance. Both are optional: the browser can also do the
// recording and the speaking on its own, and the app still works without any voice at all.
import { puterSpeech, puterTranscribe } from "./puter.mjs";

const nagaKey = () => process.env.NAGAAI_API_KEY ?? "";
const nagaBase = () => (process.env.NAGAAI_BASE_URL ?? "https://api.naga.ac/v1").replace(/\/$/, "");
const nagaSttModel = () => process.env.NAGAAI_TRANSCRIBE_MODEL ?? "gpt-4o-transcribe";
const nagaTtsModel = () => process.env.NAGAAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const nagaVoice = () => process.env.NAGAAI_TTS_VOICE ?? "alloy";

/** Is any speech-to-text available? */
export const canTranscribe = () => !!nagaKey();

/** Turn a recording into text. NagaAI first, then Puter. Returns null when neither can. */
export async function transcribe(buffer, mime = "audio/webm", { lang = "" } = {}) {
  if (!buffer?.length) return null;
  if (nagaKey()) {
    try {
      const form = new FormData();
      form.append("file", new Blob([buffer], { type: mime }), "voice");
      form.append("model", nagaSttModel());
      if (lang) form.append("language", String(lang).slice(0, 2).toLowerCase());
      const r = await fetch(`${nagaBase()}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${nagaKey()}` }, body: form });
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        const text = String(d?.text ?? "").trim();
        if (text) return { text, provider: "nagaai", model: nagaSttModel() };
      } else {
        console.warn("[voice] NagaAI answered", r.status);
      }
    } catch (e) {
      console.warn("[voice] NagaAI could not transcribe:", e.message);
    }
  }
  try {
    const text = await puterTranscribe(buffer, mime);
    if (text) return { text: String(text).trim(), provider: "puter" };
  } catch (e) {
    console.warn("[voice] Puter could not transcribe:", e.message);
  }
  return null;
}

/** Say a sentence out loud. NagaAI first, then Puter. Returns { buffer, ext } or null. */
export async function speak(text, lang = "es") {
  const t = String(text ?? "").slice(0, 300);
  if (!t) return null;
  if (nagaKey()) {
    try {
      const r = await fetch(`${nagaBase()}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${nagaKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: nagaTtsModel(), input: t, voice: nagaVoice() }),
      });
      if (r.ok) {
        const buffer = Buffer.from(await r.arrayBuffer());
        if (buffer.length) return { buffer, ext: "mp3", provider: "nagaai" };
      }
    } catch (e) {
      console.warn("[voice] NagaAI could not speak:", e.message);
    }
  }
  try {
    const out = await puterSpeech(t, lang === "en" ? "en" : "es");
    if (out?.buffer?.length) return { buffer: out.buffer, ext: out.ext, provider: "puter" };
  } catch (e) {
    console.warn("[voice] Puter could not speak:", e.message);
  }
  return null;
}
