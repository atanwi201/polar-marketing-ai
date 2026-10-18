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

/** Forget which models are cooling down (tests). */
export const resetCooling = () => cooling.clear();

export function status() {
  return { cachedModels: cache.models.length, cooling: [...cooling.entries()].filter(([, t]) => t > Date.now()).map(([id]) => id) };
}

import { AsyncLocalStorage } from "node:async_hooks";
const pinned = new AsyncLocalStorage();
/** Run fn with every AI call inside it (including background work it starts) using only this provider. */
/**
 * Wrap fn(client, ...) so AI calls inside it use the client's own provider (client.aiProvider),
 * unless the owner already picked one from the dashboard for this request.
 */
export const withClientAi = (fn) => (client, ...rest) =>
  pinned.getStore() || !client?.aiProvider ? fn(client, ...rest) : pinned.run(client.aiProvider, () => fn(client, ...rest));
export const runWithProvider = (name, fn) => (name && name !== "auto" ? pinned.run(name, fn) : fn());

// ---------- provider chain: Groq and Mistral (OpenAI-compatible, free tiers) before/after OpenRouter ----------

const COMPAT = {
  groq: {
    label: "Groq", env: "GROQ_API_KEY", saved: "groqKey", hint: "Free at console.groq.com/keys", api: () => process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    models: { quick: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"], default: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "meta-llama/llama-4-scout-17b-16e-instruct", "llama-3.1-8b-instant"], complex: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "meta-llama/llama-4-scout-17b-16e-instruct"] },
    // Free-tier tokens per minute: a request bigger than this is refused (413), so it is not even sent.
    tpm: { "llama-3.1-8b-instant": 6000, "openai/gpt-oss-120b": 8000, "llama-3.3-70b-versatile": 12000, "meta-llama/llama-4-scout-17b-16e-instruct": 30000 },
    vision: ["meta-llama/llama-4-scout-17b-16e-instruct"], modelsEnv: "GROQ_MODELS",
  },
  mistral: {
    label: "Mistral", env: "MISTRAL_API_KEY", saved: "mistralKey", hint: "Free at console.mistral.ai/api-keys", api: () => process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1",
    models: { quick: ["mistral-small-latest"], default: ["mistral-small-latest", "mistral-large-latest"], complex: ["mistral-large-latest", "mistral-small-latest"] },
    vision: ["mistral-small-latest", "pixtral-12b-latest"], modelsEnv: "MISTRAL_MODELS",
  },
  google: {
    label: "Google AI Studio", env: "GEMINI_API_KEY", envAlt: "GOOGLE_API_KEY", saved: "geminiKey", hint: "Free at aistudio.google.com/apikey",
    api: () => process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai",
    models: { quick: ["gemini-flash-lite-latest", "gemini-flash-latest"], default: ["gemini-flash-latest", "gemini-flash-lite-latest"], complex: ["gemini-flash-latest", "gemini-pro-latest"] }, // "-latest" aliases survive model retirements
    vision: ["gemini-flash-latest"], modelsEnv: "GEMINI_MODELS",
  },
  deepseek: {
    label: "DeepSeek", env: "DEEPSEEK_API_KEY", saved: "deepseekKey", hint: "platform.deepseek.com/api_keys",
    api: () => process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
    models: { quick: ["deepseek-chat"], default: ["deepseek-chat"], complex: ["deepseek-reasoner", "deepseek-chat"] },
    maxOut: { "deepseek-chat": 8000 }, vision: [], modelsEnv: "DEEPSEEK_MODELS",
  },
  siliconflow: {
    label: "SiliconFlow", env: "SILICONFLOW_API_KEY", saved: "siliconflowKey", hint: "cloud.siliconflow.com/account/ak (China: set SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1)",
    api: () => process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.com/v1",
    models: { quick: ["Qwen/Qwen2.5-7B-Instruct", "Qwen/Qwen2.5-72B-Instruct"], default: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"], complex: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-235B-A22B-Instruct-2507"] },
    vision: ["Qwen/Qwen2.5-VL-72B-Instruct"], modelsEnv: "SILICONFLOW_MODELS",
  },
  alibaba: {
    label: "Alibaba Cloud (Qwen)", env: "DASHSCOPE_API_KEY", saved: "alibabaKey", hint: "Model Studio key (China: set ALIBABA_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1)",
    api: () => process.env.ALIBABA_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    models: { quick: ["qwen-turbo", "qwen-plus"], default: ["qwen-plus", "qwen-max"], complex: ["qwen-max", "qwen-plus"] },
    vision: ["qwen-vl-max"], modelsEnv: "ALIBABA_MODELS",
  },
  puter: {
    label: "Puter", puter: true, env: "PUTER_AUTH_TOKEN", saved: "puterKey", hint: "Auth token from your Puter account (puter.com, Settings; or run getAuthToken from @heyputer/puter.js). Models are paid from your Puter account's free allowance.",
    api: () => "", models: { quick: [], default: [], complex: [] }, vision: [], modelsEnv: "PUTER_MODELS",
  },
  openai: {
    label: "OpenAI", paid: true, env: "OPENAI_API_KEY", saved: "openaiKey", hint: "platform.openai.com/api-keys (paid)",
    api: () => process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    models: { quick: ["gpt-4.1-mini"], default: ["gpt-4.1-mini", "gpt-4.1"], complex: ["gpt-4.1", "gpt-4.1-mini"] },
    vision: ["gpt-4.1-mini"], modelsEnv: "OPENAI_MODELS",
  },
};
const DEFAULT_ORDER = "groq,google,mistral,siliconflow,deepseek,alibaba,puter,openai,openrouter";
/** Chosen order first, then every other known provider in the default order (new ones are never silently left out). */
const ORDER = () => {
  const given = (settings()?.order || process.env.AI_PROVIDERS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const all = [...new Set([...given, ...DEFAULT_ORDER.split(",")])].filter((n) => n === "openrouter" || COMPAT[n]);
  const pick = pinned.getStore();
  if (pick && (pick === "openrouter" || COMPAT[pick])) return [pick]; // chosen in the dashboard: only this one
  return all.filter((n) => !COMPAT[n]?.paid); // automatic mode never spends money: paid providers only run when picked
};
/** Keys saved in the dashboard (db.settings.ai) win over .env. */
let settings = () => ({});
export function configureAi(fn) { settings = fn; }
const savedField = (name) => (name === "openrouter" ? "openrouterKey" : COMPAT[name].saved);
const saved = (name) => String(settings()?.[savedField(name)] ?? "").trim();
const envKey = (name) => (name === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env[COMPAT[name].env] || (COMPAT[name].envAlt && process.env[COMPAT[name].envAlt])) ?? "";
const compatKey = (name) => saved(name) || envKey(name);
/** Providers the dashboard can set up: id, label, where the key comes from, and the field name saved in settings. */
/** Model ids a provider offers (its /models endpoint), for the dashboard's model picker. */
export async function listModels(name, fetchImpl = fetch) {
  if (!COMPAT[name] || !compatKey(name)) throw new Error("Add this provider's API key first");
  if (name === "puter") {
    const list = await (await puterApi()).ai.listModels();
    return (Array.isArray(list) ? list : []).map((m) => String(m.id ?? m)).filter(Boolean).sort();
  }
  const r = await fetchImpl(`${COMPAT[name].api()}/models`, { headers: { Authorization: `Bearer ${compatKey(name)}` }, signal: AbortSignal.timeout(20e3) });
  if (!r.ok) throw new Error(`${COMPAT[name].label} ${r.status}: ${(await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 140)}`);
  const d = await r.json();
  return (d.data ?? d.models ?? []).map((m) => String(m.id ?? m.name ?? "").replace(/^models\//, "")).filter(Boolean).sort();
}
export const providerList = () => [...Object.entries(COMPAT).map(([id, c]) => ({ id, label: c.label, hint: c.hint, field: c.saved, paid: !!c.paid })), { id: "openrouter", label: "OpenRouter", hint: "Free at openrouter.ai/keys. Only free models are used.", field: "openrouterKey", paid: false }];
export const openrouterKey = () => saved("openrouter") || (process.env.OPENROUTER_API_KEY ?? "");
/** Where each provider's key comes from, for the dashboard: "saved", "env" or "" (none). */
export function keySources() {
  return Object.fromEntries([...Object.keys(COMPAT), "openrouter"].map((n) => [n, saved(n) ? "saved" : envKey(n) ? "env" : ""]));
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

let puterClient = { token: "", puter: null };
/** The Puter.js client for the saved auth token (null without one). Shared by text, images, speech and transcription. */
export async function puterApi() {
  const token = compatKey("puter");
  if (!token) return null;
  if (puterClient.token !== token) {
    const mod = await import("@heyputer/puter.js/src/init.cjs");
    puterClient = { token, puter: (mod.init ?? mod.default.init)(token) };
  }
  return puterClient.puter;
}
/** Sign in to Puter in the browser of the computer running this server and keep the token. Returns the token. */
export async function puterSignIn() {
  const mod = await import("@heyputer/puter.js/src/init.cjs");
  const token = await Promise.race([
    (mod.getAuthToken ?? mod.default.getAuthToken)(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("Puter sign-in was not finished within 5 minutes")), 5 * 60e3).unref?.()),
  ]);
  if (typeof token !== "string" || !token) throw new Error("Puter did not return a token");
  return token;
}
export const puterConfigured = () => !!compatKey("puter");
/** Dashboard AI settings (db.settings.ai), for the Puter image / voice choices. */
export const aiSettings = () => settings() ?? {};

/** Puter.js (puter.ai.chat) from Node, with the owner's Puter auth token. Models: the Model box, else Puter's default. */
async function viaPuter({ prompt, system, tier = "default", json = false, images = [], onDelta, signal, timeoutMs, validate }) {
  const puter = await puterApi();
  const custom = (settings()?.models?.puter || process.env.PUTER_MODELS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const list = custom.length ? custom : [""];
  const full = system ? `${system}\n\n${prompt}` : prompt;
  const errs = [];
  for (const model of list) {
    const id = `puter:${model}`;
    if ((cooling.get(id) ?? 0) > Date.now()) continue;
    try {
      const opts = { ...(model ? { model } : {}), stream: false, temperature: json ? 0.2 : 0.7 };
      const call = images.length ? puter.ai.chat(full, images, opts) : puter.ai.chat([...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }], opts);
      const res = await Promise.race([
        call,
        new Promise((_, rej) => setTimeout(() => rej(new Error("took too long")), timeoutMs ?? TIMEOUT()).unref?.()),
        ...(signal ? [new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))))] : []),
      ]);
      const c = res?.message?.content ?? res?.text ?? (typeof res === "string" ? res : "");
      const text = Array.isArray(c) ? c.map((x) => x?.text ?? "").join("") : String(c ?? "");
      if (!text.trim()) { errs.push(`${model || "default"}: empty reply`); cooling.set(id, Date.now() + COOLDOWN); continue; }
      const out = { text, model: `puter/${model || res?.model || "default"}` };
      if (onDelta && !json) onDelta(text);
      if (json) {
        try { return { json: extractJson(text), text, model: out.model }; } catch (e) { errs.push(`${model || "default"}: ${e.message}`); continue; }
      }
      const problem = validate?.(text);
      if (problem) { errs.push(`${model || "default"}: ${problem}`); continue; }
      return out;
    } catch (e) {
      if (signal?.aborted) throw e;
      const msg = e?.error?.message ?? e?.message ?? JSON.stringify(e).slice(0, 160);
      errs.push(`${model || "default"}: ${msg}`);
      cooling.set(id, Date.now() + COOLDOWN);
    }
  }
  throw new Error(`Puter: ${errs.join("; ") || "every model is cooling down"}`);
}

async function viaCompat(name, { prompt, system, tier = "default", json = false, images = [], onDelta, signal, fetchImpl = fetch, maxTokens, timeoutMs, validate }) {
  const c = COMPAT[name];
  const custom = (settings()?.models?.[name] || process.env[c.modelsEnv] || "").split(",").map((x) => x.trim()).filter(Boolean);
  const list = images.length ? c.vision : custom.length ? custom : c.models[tier] ?? c.models.default;
  const messages = [...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: images.length ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] : prompt }];
  let lastErr;
  const errs = [];
  const fail = (e) => { lastErr = e; errs.push(e.message); };
  for (const model of list) {
    const id = `${name}:${model}`;
    if ((cooling.get(id) ?? 0) > Date.now()) continue;
    const need = Math.ceil((prompt.length + (system?.length ?? 0)) / 3) + (maxTokens ?? 1000);
    if (c.tpm?.[model] && need > c.tpm[model]) { fail(new Error(`${model} needs ~${need} tokens, over its free ${c.tpm[model]}/min`)); continue; }
    const timeout = AbortSignal.timeout(timeoutMs ?? TIMEOUT());
    try {
      const r = await fetchImpl(`${c.api()}/chat/completions`, {
        method: "POST",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { Authorization: `Bearer ${compatKey(name)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: !!onDelta && !json, temperature: json ? 0.2 : 0.7, ...(maxTokens ? { max_tokens: Math.min(maxTokens, c.maxOut?.[model] ?? maxTokens) } : {}) }),
      });
      if (!r.ok) {
        const msg = await r.text().catch(() => "");
        if (r.status === 401) throw Object.assign(new Error(`${c.label} refused the key (401): ${msg.replace(/\s+/g, " ").slice(0, 140)}`), { fatal: true });
        // 403 is usually about this model ("Model disabled", "tier_not_allowed"), not the key: try the next model.
        cooling.set(id, Date.now() + (r.status === 429 ? 60e3 : r.status === 413 ? 5 * 60e3 : COOLDOWN)); // per-minute limits clear fast
        fail(new Error(`${model} ${r.status}: ${msg.replace(/\s+/g, " ").slice(0, 120)}`));
        // 429 is per model on free tiers (a Pro model can have no free quota while Flash does): try the next model
        continue;
      }
      const out = onDelta && !json ? await readStream(r, onDelta) : await readOnce(r);
      out.model ||= `${name}/${model}`;
      if (!out.text.trim()) { cooling.set(id, Date.now() + COOLDOWN); fail(new Error(`${model}: empty reply`)); continue; }
      if (json) {
        try { return { json: extractJson(out.text), text: out.text, model: out.model }; }
        catch (e) { fail(new Error(`${model}: ${e.message}`)); continue; }
      }
      const problem = validate?.(out.text);
      if (problem) { fail(new Error(`${model}: ${problem}`)); continue; }
      return out;
    } catch (e) {
      if (e.fatal || signal?.aborted) throw e;
      fail(e.name === "TimeoutError" || timeout.aborted ? new Error(`${c.label} ${model} took too long`) : e);
      cooling.set(id, Date.now() + COOLDOWN);
    }
  }
  throw errs.length ? new Error(`${c.label}: ${errs.join("; ")}`) : lastErr ?? new Error(`${c.label}: every model is cooling down after recent errors`);
}

/**
 * Run one chat completion. Tries each configured provider in order (default Groq, Mistral, then
 * OpenRouter free models; set AI_PROVIDERS to change it) and moves on when one is rate-limited,
 * refuses its key or fails. Returns { text, model } (plus json when asked).
 */
export async function complete(opts) {
  const names = ORDER().filter((n) => n === "openrouter" ? !!opts.key && opts.key !== "-" : COMPAT[n] && compatKey(n));
  if (!names.length) {
    const pick = pinned.getStore();
    throw new Error(pick ? `The ${pick} provider you chose has no API key. Add it in AI providers or choose Auto.` : "No AI provider key set (GROQ_API_KEY, MISTRAL_API_KEY or OPENROUTER_API_KEY)");
  }
  const failures = [];
  let lastErr, fatal;
  for (const n of names) {
    try {
      return n === "openrouter" ? await viaOpenRouter(opts) : n === "puter" ? await viaPuter(opts) : await viaCompat(n, opts);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (e.fatal) fatal ??= e;
      lastErr = e;
      failures.push(`${n}: ${String(e.message).replace(/\s+/g, " ").slice(0, 160)}`);
      console.warn(`AI provider ${n} failed, trying the next: ${failures.at(-1)}`);
    }
  }
  // Say what every provider did, not just the last one.
  const err = Object.assign(new Error(failures.length > 1 ? `All AI providers failed. ${failures.join(" | ")}` : (fatal ?? lastErr).message), { fatal: names.length === 1 ? !!fatal : false });
  throw err;
}
