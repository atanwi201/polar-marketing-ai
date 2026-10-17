// Access to the claude.ai artifact runtime. Every capability may be absent (local dev, no grant).
type Use = (name: string) => Promise<any>;
const w = window as any;

export async function useCapability<T = any>(name: string): Promise<T | null> {
  const use: Use | undefined = w.claude?.use;
  if (!use) return null;
  try {
    return (await Promise.race([use(name), new Promise((r) => setTimeout(() => r(null), 10000))])) as T | null;
  } catch {
    return null;
  }
}
