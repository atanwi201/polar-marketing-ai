// Text AI with provider fallback: Groq, Mistral and OpenRouter (any with a key set, tried in AI_PROVIDERS order).
// The OpenRouter part only ever uses free models (pricing 0/0, usually ids ending in ":free").
// The free list changes often, so it is fetched live and cached; a failing model is skipped for a while.

const API = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const LIST_TTL = 30 * 60e3;
const COOLDOWN = 10 * 60e3;
const TIMEOUT = () => Number(process.env.OPENROUTER_TIMEOUT_MS ?? 120e3); // per model attempt: free models sometimes hang

/**
 * Preferred families first. Anything else free still qualifies, ranked after these. The free list
 * changes every few months, so newer general-purpose families are listed next to the older ones.
 */
const PREFER = {
  quick: [/gemini.*flash/i, /gemma-4-(31b|26b)/i, /nemotron-3\.5-lightning/i, /llama-3\.3-70b/i, /inkling-small/i, /mistral-small/i, /qwen.*(32b|30b)/i, /gemma-3-27b/i, /deepseek-chat/i, /nemotron-3-super/i],
  default: [/deepseek-chat|deepseek-v3/i, /nemotron-3-ultra/i, /llama-3\.3-70b/i, /gemini.*flash/i, /nemotron-3-super/i, /gemma-4-31b/i, /inkling(?!-small)/i, /qwen.*(235b|72b|32b)/i, /mistral-small/i, /gemma-4/i, /gemma-3-27b/i],
  complex: [/deepseek-r1|deepseek-v3|deepseek-chat/i, /nemotron-3-ultra/i, /qwen.*235b/i, /llama-3\.3-70b|llama-4-maverick/i, /gemini.*(pro|flash)/i, /nemotron-3-super/i, /inkling(?!-small)/i, /kimi|glm/i, /gemma-4-31b/i],
};
/** Free models that are not general chat models: music/speech, safety classifiers, code-only, routers. */
const NOT_CHAT = /lyria|music|audio-gen|tts|speech|whisper|embed|rerank|guard|safety|moderation|code|coder|^openrouter\//i;

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
    .filter((m) => (m.architecture?.output_modalities ?? ["text"]).every((x) => x === "text"))
    .filter((m) => !NOT_CHAT.test(m.id))
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
  const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : clean;
  // Prose around the JSON may contain brackets too ("[1]", "{name}"): keep the longest part that parses.
  let best = null, bestLen = 0, lastErr = new Error("No JSON in reply");
  for (let start = body.search(/[[{]/); start !== -1; start = nextOpen(body, start + 1)) {
    const end = matchEnd(body, start);
    if (end === -1) { lastErr = new Error("Unterminated JSON in reply"); continue; }
    if (end - start + 1 <= bestLen) continue;
    try { best = JSON.parse(body.slice(start, end + 1)); bestLen = end - start + 1; } catch (e) { lastErr = e; }
  }
  if (best === null) throw lastErr;
  return best;
}

function nextOpen(s, from) {
  const i = s.slice(from).search(/[[{]/);
  return i === -1 ? -1 : from + i;
}

function matchEnd(body, start) {
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

/**
 * Run one chat completion on free models. Tries up to `attempts` models in ranked order,
 * passing the next two as OpenRouter fallbacks each time, and cools down models that fail.
 * onDelta(text) streams the reply when given. Returns { text, model }.
 */
async function viaOpenRouter({ key, prompt, system, tier = "default", json = false, images = [], onDelta, signal, fetchImpl = fetch, attempts = 4, maxTokens, timeoutMs, skip = [], validate }) {
  // maxTokens/timeoutMs: for long outputs (a whole web page). validate(text) returns an error message
  // when a reply isn't usable (e.g. cut off), and the next model gets a try.
  const vision = images.length > 0;
  const ranked = rankModels(await freeModels(key, fetchImpl), tier, Date.now(), vision).filter((m) => !skip.includes(m));
  if (!ranked.length) throw new Error(`No free ${vision ? "vision " : ""}models are available on OpenRouter right now`);
  const content = vision
    ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
    : prompt;
  const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content }];
  let lastErr;
  for (let i = 0; i < Math.min(attempts, ranked.length); i++) {
    const models = ranked.slice(i, i + 3);
    const timeout = AbortSignal.timeout(timeoutMs ?? TIMEOUT());
    try {
      const send = (withMax) => fetchImpl(`${API}/chat/completions`, {
        method: "POST",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost",
          "X-Title": "Isla Autopilot",
        },
        body: JSON.stringify({ models, messages, stream: !!onDelta && !json, temperature: json ? 0.2 : 0.7, ...(withMax && maxTokens ? { max_tokens: maxTokens } : {}) }),
      });
      let r = await send(true);
      // Some providers refuse a large max_tokens: ask again with their default.
      if (r.status === 400 && maxTokens) {
        const msg = await r.clone().text().catch(() => "");
        if (/max_tokens|maximum.*tokens|context length/i.test(msg)) r = await send(false);
      }
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
      const problem = validate?.(out.text);
      if (problem) { lastErr = new Error(`${out.model || models[0]}: ${problem}`); skip.push(out.model || models[0]); continue; }
      return out;
    } catch (e) {
      if (e.fatal || signal?.aborted) throw e;
      lastErr = e.name === "TimeoutError" || timeout.aborted ? new Error(`${models[0]} took too long`) : e;
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
        if (ev.error) throw Object.assign(new Error(ev.error.message ?? "stream error"), { sse: true });
        model ||= ev.model;
        const delta = ev.choices?.[0]?.delta?.content ?? "";
        if (delta) { text += delta; onDelta(delta); }
      } catch (e) { if (e.sse) throw e; }
    }
  }
  return { text, model };
}

export function status() {
  return { cachedModels: cache.models.length, cooling: [...cooling.entries()].filter(([, t]) => t > Date.now()).map(([id]) => id) };
}

// ---------- provider chain: Groq and Mistral (OpenAI-compatible, free tiers) before/after OpenRouter ----------

const COMPAT = {
  groq: {
    label: "Groq", env: "GROQ_API_KEY", api: () => process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    models: { quick: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"], default: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"], complex: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"] },
    vision: ["meta-llama/llama-4-scout-17b-16e-instruct"], modelsEnv: "GROQ_MODELS",
  },
  mistral: {
    label: "Mistral", env: "MISTRAL_API_KEY", api: () => process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1",
    models: { quick: ["mistral-small-latest"], default: ["mistral-small-latest", "mistral-large-latest"], complex: ["mistral-large-latest", "mistral-small-latest"] },
    vision: ["mistral-small-latest", "pixtral-12b-latest"], modelsEnv: "MISTRAL_MODELS",
  },
};
const ORDER = () => (settings()?.order || process.env.AI_PROVIDERS || "groq,mistral,openrouter").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
/** Keys saved in the dashboard (db.settings.ai) win over .env. */
let settings = () => ({});
export function configureAi(fn) { settings = fn; }
const SAVED = { groq: "groqKey", mistral: "mistralKey", openrouter: "openrouterKey" };
const saved = (name) => String(settings()?.[SAVED[name]] ?? "").trim();
const compatKey = (name) => saved(name) || (process.env[COMPAT[name].env] ?? "");
export const openrouterKey = () => saved("openrouter") || (process.env.OPENROUTER_API_KEY ?? "");
/** Where each provider's key comes from, for the dashboard: "saved", "env" or "" (none). */
export function keySources() {
  return Object.fromEntries(Object.keys(SAVED).map((n) => [n, saved(n) ? "saved" : (n === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env[COMPAT[n].env]) ? "env" : ""]));
}

/** True when at least one text provider has a key. */
export function aiConfigured() {
  return !!openrouterKey() || Object.keys(COMPAT).some((n) => compatKey(n));
}

/** Truthy key for the callers' "is AI set up?" checks: the OpenRouter key, or a placeholder when only Groq/Mistral are set. */
export function aiKey() {
  return openrouterKey() || (aiConfigured() ? "-" : "");
}

/** Which providers will be tried, in order. */
export function providerNames() {
  return ORDER().filter((n) => (n === "openrouter" ? !!openrouterKey() : COMPAT[n] && compatKey(n)));
}

async function viaCompat(name, { prompt, system, tier = "default", json = false, images = [], onDelta, signal, fetchImpl = fetch, maxTokens, timeoutMs, validate }) {
  const c = COMPAT[name];
  const custom = (process.env[c.modelsEnv] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const list = images.length ? c.vision : custom.length ? custom : c.models[tier] ?? c.models.default;
  const messages = [...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: images.length ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] : prompt }];
  let lastErr;
  for (const model of list) {
    const id = `${name}:${model}`;
    if ((cooling.get(id) ?? 0) > Date.now()) continue;
    const timeout = AbortSignal.timeout(timeoutMs ?? TIMEOUT());
    try {
      const r = await fetchImpl(`${c.api()}/chat/completions`, {
        method: "POST",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { Authorization: `Bearer ${compatKey(name)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: !!onDelta && !json, temperature: json ? 0.2 : 0.7, ...(maxTokens ? { max_tokens: maxTokens } : {}) }),
      });
      if (!r.ok) {
        const msg = await r.text().catch(() => "");
        if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`${c.label} refused the key (${r.status})`), { fatal: true });
        cooling.set(id, Date.now() + (r.status === 429 ? 60e3 : COOLDOWN)); // per-minute limits clear fast
        lastErr = new Error(`${c.label} ${r.status}: ${msg.slice(0, 200)}`);
        if (r.status === 429) break; // the whole key is limited, move on to the next provider
        continue;
      }
      const out = onDelta && !json ? await readStream(r, onDelta) : await readOnce(r);
      out.model ||= `${name}/${model}`;
      if (!out.text.trim()) { cooling.set(id, Date.now() + COOLDOWN); lastErr = new Error("Empty reply"); continue; }
      if (json) {
        try { return { json: extractJson(out.text), text: out.text, model: out.model }; }
        catch (e) { lastErr = e; continue; }
      }
      const problem = validate?.(out.text);
      if (problem) { lastErr = new Error(`${out.model}: ${problem}`); continue; }
      return out;
    } catch (e) {
      if (e.fatal || signal?.aborted) throw e;
      lastErr = e.name === "TimeoutError" || timeout.aborted ? new Error(`${c.label} ${model} took too long`) : e;
      cooling.set(id, Date.now() + COOLDOWN);
    }
  }
  throw lastErr ?? new Error(`${c.label} has no model for this request`);
}

/**
 * Run one chat completion. Tries each configured provider in order (default Groq, Mistral, then
 * OpenRouter free models; set AI_PROVIDERS to change it) and moves on when one is rate-limited,
 * refuses its key or fails. Returns { text, model } (plus json when asked).
 */
export async function complete(opts) {
  const names = ORDER().filter((n) => n === "openrouter" ? !!opts.key && opts.key !== "-" : COMPAT[n] && compatKey(n));
  if (!names.length) throw new Error("No AI provider key set (GROQ_API_KEY, MISTRAL_API_KEY or OPENROUTER_API_KEY)");
  let lastErr, fatal;
  for (const n of names) {
    try {
      return n === "openrouter" ? await viaOpenRouter(opts) : await viaCompat(n, opts);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (e.fatal) fatal ??= e;
      lastErr = e;
    }
  }
  throw names.length === 1 ? (fatal ?? lastErr) : lastErr;
}
