// What you sell: two paid plans, editable in "Plans & prices". Stored in the settings collection
// (record "offer") so the same prices drive clients, the dashboard and billing.
import { useCollection, put, now } from "./store";
import type { Client, Rec } from "./types";

export type PaidPlanId = "basic" | "pro";
export const PLAN_IDS: PaidPlanId[] = ["basic", "pro"];

export interface PaidPlan {
  id: PaidPlanId;
  name: string;
  price: number; // monthly, EUR, excl. IGIC
  setup: number; // one-off, EUR, excl. IGIC (0 = none)
  tagline: string;
  features: string[];
  postsPerWeek: number;
  videosPerWeek: number;
}

export interface Offer extends Rec {
  plans: Record<PaidPlanId, PaidPlan>;
  goal: number; // monthly earnings goal, EUR excl. IGIC
  trialDays: number;
}

export const DEFAULT_OFFER: Offer = {
  id: "offer", createdAt: "",
  goal: 3000,
  trialDays: 14,
  plans: {
    basic: {
      id: "basic", name: "Básico", price: 49, setup: 0, tagline: "Website and social posts on autopilot",
      features: ["SEO website in their customers' languages", "3 AI posts a week with new images", "Client portal to ask for posts"],
      postsPerWeek: 3, videosPerWeek: 0,
    },
    pro: {
      id: "pro", name: "Pro", price: 99, setup: 0, tagline: "Everything in Básico, plus video ads and auto-publishing",
      features: ["Everything in Básico", "5 AI posts a week", "2 short video ads a week (Reels, Shorts)", "Posts straight to Instagram, Facebook, X and YouTube"],
      postsPerWeek: 5, videosPerWeek: 2,
    },
  },
};

/** The saved offer, with defaults for anything missing. */
export function useOffer(): Offer {
  const saved = useCollection<Offer>("settings").find((s) => s.id === "offer");
  return mergeOffer(saved);
}

export function mergeOffer(saved?: Partial<Offer>): Offer {
  return {
    ...DEFAULT_OFFER, ...saved,
    plans: {
      basic: { ...DEFAULT_OFFER.plans.basic, ...saved?.plans?.basic, id: "basic" },
      pro: { ...DEFAULT_OFFER.plans.pro, ...saved?.plans?.pro, id: "pro" },
    },
  };
}

export const saveOffer = (o: Offer) => put<Offer>("settings", { ...o, id: "offer", createdAt: o.createdAt || now() });

// ---------- What a client pays ----------

/** List price, or the custom price you agreed with this business. */
export const clientPrice = (c: Client, o: Offer) => (c.plan ? c.customPrice ?? o.plans[c.plan].price : 0);

/** Monthly value: annual billing is 12 months for the price of 10. */
export const clientMonthly = (c: Client, o: Offer) => {
  const p = clientPrice(c, o);
  return c.annual ? (p * 10) / 12 : p;
};

/** Earnings per month from paying clients (excl. IGIC). */
export const monthlyIncome = (cs: Client[], o: Offer) =>
  cs.filter((c) => c.stage === "paid").reduce((n, c) => n + clientMonthly(c, o), 0);

/** What trials would add if they all became paying on the plan they're trying (Básico if none). */
export const trialPotential = (cs: Client[], o: Offer) =>
  cs.filter((c) => c.stage === "pilot").reduce((n, c) => n + (c.customPrice ?? o.plans[c.plan ?? "basic"].price), 0);

export const planLabel = (c: Client, o: Offer) => {
  if (!c.plan) return c.stage === "pilot" ? "Free trial" : "No plan";
  const custom = c.customPrice != null && c.customPrice !== o.plans[c.plan].price;
  return `${o.plans[c.plan].name}${custom ? " (custom price)" : ""}${c.annual ? " · annual" : ""}`;
};

/** Days left on a free trial (null when not on trial). */
export function trialDaysLeft(c: Client, o: Offer, today = new Date()): number | null {
  if (c.stage !== "pilot") return null;
  const start = new Date((c.trialStart ?? c.createdAt.slice(0, 10)) + "T12:00:00");
  return Math.ceil(o.trialDays - (today.getTime() - start.getTime()) / 864e5);
}
