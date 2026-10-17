// One entry point for every AI feature. On claude.ai the page asks Claude through the `sample`
// capability; anywhere else (or if the viewer declines) it falls back to the module's demo output,
// so every screen works without API keys.
import { useEffect, useState } from "react";
import { useCapability } from "./claude";

// Providers, in order: Claude via the artifact runtime (on claude.ai), then OpenRouter free models
// through the local API in server/ (npm run dev with OPENROUTER_API_KEY set), then demo output.
type Provider = "claude" | "openrouter" | null;
let sample: any = null;
let provider: Provider = null;
let mode: "checking" | "live" | "demo" = "checking";
let lastModel = "";
const modeListeners = new Set<() => void>();
const notify = () => modeListeners.forEach((l) => l());

async function openRouterReady(): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2500);
    const r = await fetch("/api/ai/status", { signal: ac.signal });
    clearTimeout(t);
    return r.ok && (await r.json()).configured === true;
  } catch {
    return false;
  }
}

Promise.all([useCapability("sample"), location.protocol.startsWith("http") ? openRouterReady() : false]).then(([s, or]) => {
  sample = s;
  provider = s ? "claude" : or ? "openrouter" : null;
  mode = provider ? "live" : "demo";
  notify();
});

export function useAiMode() {
  const [m, setM] = useState(mode);
  useEffect(() => {
    const l = () => setM(mode);
    modeListeners.add(l);
    l();
    return () => void modeListeners.delete(l);
  }, []);
  return m;
}

/** Which AI is answering and, for OpenRouter, the free model that answered last. */
export function useAiProvider() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((x) => x + 1);
    modeListeners.add(l);
    return () => void modeListeners.delete(l);
  }, []);
  return { provider, model: lastModel };
}

async function orJson(task: string, tier: string, signal?: AbortSignal) {
  const r = await fetch("/api/ai", {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: task, tier, json: true }),
  });
  const d = await r.json();
  if (!r.ok) throw { code: "provider_error", message: d.error };
  lastModel = d.model ?? "";
  notify();
  return d.data;
}

async function orText(task: string, tier: string, onText?: (t: string) => void, signal?: AbortSignal) {
  const r = await fetch("/api/ai", {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: task, tier, stream: true }),
  });
  if (!r.ok || !r.body) throw { code: "provider_error", message: (await r.json().catch(() => ({}))).error };
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += dec.decode(value, { stream: true });
    onText?.(raw.split("\u0000")[0]);
  }
  const [text, tail = ""] = raw.split("\u0000");
  if (tail.startsWith("error:")) throw { code: "provider_error", message: tail.slice(6) };
  lastModel = tail;
  notify();
  return text;
}

export const BUSINESS_CONTEXT =
  "You work for a one-person AI marketing studio in Tenerife (Canary Islands, Spain) serving local tourism and small businesses. " +
  "Prices are in EUR; invoices carry 7% IGIC. Spanish law (LSSI) bans unsolicited commercial email, so never suggest cold email. " +
  "Write natural, native-quality text in each requested language. Never invent prices, facts or availability that are not in the data given.";

export interface AiResult<T> { data: T; live: boolean; error?: string }

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask for structured JSON. `demo` must return a realistic result of the same shape. */
export async function aiJson<T>(
  task: string,
  demo: () => T,
  opts: { tier?: "quick" | "default" | "complex"; signal?: AbortSignal } = {},
): Promise<AiResult<T>> {
  if (provider === "openrouter") {
    try {
      return { data: (await orJson(`${BUSINESS_CONTEXT}\n\n${task}\n\nReply with JSON only, no prose.`, opts.tier ?? "default", opts.signal)) as T, live: true };
    } catch (e: any) {
      if (e?.name === "AbortError") throw { code: "cancelled" };
      return { data: demo(), live: false, error: aiError(e) };
    }
  }
  if (sample) {
    try {
      const data = await sample.json(
        `${BUSINESS_CONTEXT}\n\n${task}\n\nReply with JSON only, no prose.`,
        { modelTier: opts.tier ?? "default", signal: opts.signal, cache: false },
      );
      return { data: data as T, live: true };
    } catch (e: any) {
      if (e?.code === "cancelled") throw e;
      await delay(300);
      return { data: demo(), live: false, error: aiError(e) };
    }
  }
  await delay(600);
  return { data: demo(), live: false };
}

/** Ask for free text, streamed into onText when live. */
export async function aiText(
  task: string,
  demo: () => string,
  opts: { tier?: "quick" | "default" | "complex"; onText?: (t: string) => void; signal?: AbortSignal } = {},
): Promise<AiResult<string>> {
  if (provider === "openrouter") {
    try {
      const text = await orText(`${BUSINESS_CONTEXT}\n\n${task}`, opts.tier ?? "default", opts.onText, opts.signal);
      return { data: text, live: true };
    } catch (e: any) {
      if (e?.name === "AbortError") throw { code: "cancelled" };
      const d = demo();
      opts.onText?.(d);
      return { data: d, live: false, error: aiError(e) };
    }
  }
  if (sample) {
    try {
      const r = await sample(`${BUSINESS_CONTEXT}\n\n${task}`, {
        modelTier: opts.tier ?? "default",
        signal: opts.signal,
        cache: false,
        onText: opts.onText ? (u: any) => opts.onText!(u.text) : undefined,
      });
      return { data: r.text, live: true };
    } catch (e: any) {
      if (e?.code === "cancelled") throw e;
      const d = demo();
      opts.onText?.(d);
      return { data: d, live: false, error: aiError(e) };
    }
  }
  await delay(500);
  const d = demo();
  opts.onText?.(d);
  return { data: d, live: false };
}

function aiError(e: any): string {
  if (e?.code === "not_granted") return "AI access was declined, so this is demo output. Allow it from the page's Permissions menu.";
  if (e?.code === "provider_error") return `OpenRouter couldn't answer (${e.message ?? "no free model available"}), so this is demo output.`;
  if (e?.code === "rate_limited") return "AI is rate limited right now, so this is demo output. Try again in a minute.";
  return "The AI call failed, so this is demo output.";
}

/** Small deterministic pick for demo generators. */
export function pick<T>(arr: T[], seed: string | number): T {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return arr[Math.abs(h) % arr.length];
}
