// OpenRouter client that only ever uses free models (pricing 0/0, usually ids ending in ":free").
// The free list changes often, so it is fetched live and cached; a failing model is skipped for a while.

const API = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const LIST_TTL = 30 * 60e3;
const COOLDOWN = 10 * 60e3;

/** Preferred families first. Anything else free still qualifies, ranked after these. */
const PREFER = {
  quick: [/gemini.*flash/i, /llama-3\.3-70b/i, /mistral-small/i, /qwen.*(32b|30b)/i, /gemma-3-27b/i, /deepseek-chat/i],
  default: [/deepseek-chat|deepseek-v3/i, /llama-3\.3-70b/i, /gemini.*flash/i, /qwen.*(235b|72b|32b)/i, /mistral-small/i, /gemma-3-27b/i],
  complex: [/deepseek-r1|deepseek-v3|deepseek-chat/i, /qwen.*235b/i, /llama-3\.3-70b|llama-4-maverick/i, /gemini.*(pro|flash)/i, /kimi|glm/i],
};

let cache = { at: 0, models: [] };
const cooling = new Map(); // model id -> until

export function isFree(m) {
  const p = m.pricing ?? {};
  return m.id.endsWith(":free") || (Number(p.prompt) === 0 && Number(p.completion) === 0 && !m.id.startsWith("openrouter/auto"));
}

/** Rank free models for a tier: preferred families in order, then by context length. Pure, for tests. */
export function rankModels(models, tier = "default", now = Date.now(), vision = false) {
  const prefs = PREFER[tier] ?? PREFER.default;
  const score = (m) => {
    const i = prefs.findIndex((re) => re.test(m.id));
    return i === -1 ? prefs.length : i;
  };
  return models
    .filter(isFree)
    .filter((m) => !(m.architecture?.output_modalities ?? ["text"]).every((x) => x !== "text"))
    .filter((m) => !vision || (m.architecture?.input_modalities ?? []).includes("image"))
    .filter((m) => (cooling.get(m.id) ?? 0) < now)
    .sort((a, b) => score(a) - score(b) || (b.context_length ?? 0) - (a.context_length ?? 0))
    .map((m) => m.id);
}

export async function freeModels(key, fetchImpl = fetch) {
  if (Date.now() - cache.at < LIST_TTL && cache.models.length) return cache.models;
  const r = await fetchImpl(`${API}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!r.ok) throw new Error(`OpenRouter model list failed (${r.status})`);
  const { data } = await r.json();
  cache = { at: Date.now(), models: data.filter(isFree) };
  return cache.models;
}

/** Pull the first JSON object or array out of a model reply (models often wrap it in prose or fences). */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("No JSON in reply");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error("Unterminated JSON in reply");
}

/**
 * Run one chat completion on free models. Tries up to `attempts` models in ranked order,
 * passing the next two as OpenRouter fallbacks each time, and cools down models that fail.
 * onDelta(text) streams the reply when given. Returns { text, model }.
 */
export async function complete({ key, prompt, system, tier = "default", json = false, images = [], onDelta, signal, fetchImpl = fetch, attempts = 4 }) {
  const vision = images.length > 0;
  const ranked = rankModels(await freeModels(key, fetchImpl), tier, Date.now(), vision);
  if (!ranked.length) throw new Error(`No free ${vision ? "vision " : ""}models are available on OpenRouter right now`);
  const content = vision
    ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
    : prompt;
  const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content }];
  let lastErr;
  for (let i = 0; i < Math.min(attempts, ranked.length); i++) {
    const models = ranked.slice(i, i + 3);
    try {
      const r = await fetchImpl(`${API}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost",
          "X-Title": "Isla Autopilot",
        },
        body: JSON.stringify({ models, messages, stream: !!onDelta && !json, temperature: json ? 0.2 : 0.7 }),
      });
      if (!r.ok) {
        const msg = await r.text().catch(() => "");
        if (r.status === 401 || r.status === 402) throw Object.assign(new Error(`OpenRouter refused the key (${r.status})`), { fatal: true });
        cooling.set(models[0], Date.now() + COOLDOWN);
        lastErr = new Error(`OpenRouter ${r.status}: ${msg.slice(0, 200)}`);
        continue;
      }
      const out = onDelta && !json ? await readStream(r, onDelta) : await readOnce(r);
      if (!out.text.trim()) { cooling.set(out.model || models[0], Date.now() + COOLDOWN); lastErr = new Error("Empty reply"); continue; }
      if (json) {
        try { return { json: extractJson(out.text), text: out.text, model: out.model }; }
        catch (e) { cooling.set(out.model || models[0], Date.now() + COOLDOWN); lastErr = e; continue; }
      }
      return out;
    } catch (e) {
      if (e.fatal || e.name === "AbortError") throw e;
      lastErr = e;
      cooling.set(models[0], Date.now() + COOLDOWN);
    }
  }
  throw lastErr ?? new Error("All free models failed");
}

async function readOnce(r) {
  const d = await r.json();
  if (d.error) throw new Error(d.error.message ?? "OpenRouter error");
  return { text: d.choices?.[0]?.message?.content ?? "", model: d.model };
}

async function readStream(r, onDelta) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", model = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue; // ": OPENROUTER PROCESSING" keep-alives
      const data = line.slice(5).trim();
      if (data === "[DONE]") return { text, model };
      try {
        const ev = JSON.parse(data);
        if (ev.error) throw new Error(ev.error.message ?? "OpenRouter stream error");
        model ||= ev.model;
        const delta = ev.choices?.[0]?.delta?.content ?? "";
        if (delta) { text += delta; onDelta(delta); }
      } catch (e) { if (e.message?.startsWith("OpenRouter")) throw e; }
    }
  }
  return { text, model };
}

export function status() {
  return { cachedModels: cache.models.length, cooling: [...cooling.entries()].filter(([, t]) => t > Date.now()).map(([id]) => id) };
}
