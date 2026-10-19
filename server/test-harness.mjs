// Shared helpers for tests that spawn a real server: isolated env, free ports, readiness polling.
// Note: index.mjs's loadEnv only fills vars that are NOT `in process.env`, so an empty string counts as set
// and blocks the real .env value from leaking into a test server.
import net from "node:net";

export const PROVIDER_KEYS = [
  "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "SILICONFLOW_API_KEY",
  "DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "OPENAI_API_KEY", "PUTER_AUTH_TOKEN", "PEXELS_API_KEY", "POLLINATIONS_KEY",
  "RESEND_API_KEY", "BOOKING_FROM_EMAIL", "ADMIN_TOKEN", "ADMIN_PASSWORD", "AI_PROVIDERS",
];
export const blankedEnv = () => Object.fromEntries(PROVIDER_KEYS.map((k) => [k, ""]));

export const freePort = () => new Promise((ok, fail) => {
  const s = net.createServer();
  s.once("error", fail);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
});

// Poll until the server answers any HTTP response (or the child exits / time runs out).
export async function waitReady(base, child, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  let exited = false;
  child?.once("exit", () => { exited = true; });
  while (Date.now() < end) {
    if (exited) throw new Error("test server exited before becoming ready");
    try { await fetch(base + "/api/signup", { method: "GET", signal: AbortSignal.timeout(1000) }); return; } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  throw new Error("test server did not become ready in time");
}
