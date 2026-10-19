// The plans and prices shown on the public landing page. The owner edits them in the dashboard's
// "Plans & prices" (kept in the browser's store); the dashboard sends a copy here so the landing page
// always shows the current prices. Same defaults as src/core/offer.ts.
import { db } from "./store.mjs";

export const DEFAULT_OFFER = {
  trialDays: 14,
  plans: {
    basic: { name: "Básico", price: 49, setup: 0, postsPerWeek: 3, videosPerWeek: 0 },
    pro: { name: "Pro", price: 99, setup: 0, postsPerWeek: 5, videosPerWeek: 2 },
  },
};

const num = (v, min, max, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : dflt; };
const int = (v, min, max, dflt) => { const n = Number(v); return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : dflt; };

/** Keep only what the landing page needs, with sane limits. */
export function cleanOffer(b = {}) {
  const plan = (id) => {
    const p = b.plans?.[id] ?? {}, d = DEFAULT_OFFER.plans[id];
    return {
      name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 40) : d.name,
      price: num(p.price, 0, 100000, d.price), setup: num(p.setup, 0, 100000, d.setup),
      postsPerWeek: int(p.postsPerWeek, 0, 100, d.postsPerWeek), videosPerWeek: int(p.videosPerWeek, 0, 100, d.videosPerWeek),
    };
  };
  return { trialDays: int(b.trialDays, 0, 365, DEFAULT_OFFER.trialDays), plans: { basic: plan("basic"), pro: plan("pro") } };
}

/** What the landing page shows: the owner's saved offer, or the defaults. */
export const publicOffer = () => cleanOffer(db.settings?.offer ?? DEFAULT_OFFER);
