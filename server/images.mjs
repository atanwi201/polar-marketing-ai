// Free image generation through Pollinations (no key). A fresh random seed every call, so the
// same prompt never returns the same picture twice.
import { writeFile } from "node:fs/promises";

const BASE = process.env.POLLINATIONS_BASE_URL ?? "https://image.pollinations.ai";

export function imageUrl(prompt, { seed = randomSeed(), width = 1080, height = 1080, model = process.env.IMAGE_MODEL ?? "flux" } = {}) {
  const q = new URLSearchParams({ width: String(width), height: String(height), seed: String(seed), model, nologo: "true", enhance: "true", safe: "true" });
  return `${BASE}/prompt/${encodeURIComponent(prompt.slice(0, 1500))}?${q}`;
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

/** Generate and save an image. Retries with a new seed, since the free service is sometimes busy. */
export async function generateImage(prompt, file, { size = [1080, 1080], fetchImpl = fetch, attempts = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const seed = randomSeed();
    try {
      const r = await fetchImpl(imageUrl(prompt, { seed, width: size[0], height: size[1] }), { signal: AbortSignal.timeout(120e3) });
      const type = r.headers.get("content-type") ?? "";
      if (!r.ok || !type.startsWith("image/")) throw new Error(`Image service answered ${r.status} ${type}`);
      await writeFile(file, Buffer.from(await r.arrayBuffer()));
      return { seed, type };
    } catch (e) {
      lastErr = e;
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}
