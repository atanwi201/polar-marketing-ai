// Business-wide calculations shared by dashboard, clients and billing.
import type { Client, Subscription, PlanId } from "./types";
import { planById, IGIC } from "./plans";

/** Monthly recurring value of a subscription (annual plans: 12 months for the price of 10). */
export const subMrr = (s: Subscription) => (s.annual ? (s.price * 10) / 12 : s.price);

export const clientMrr = (c: Client) => (c.stage === "paid" ? c.subs.reduce((n, s) => n + subMrr(s), 0) : 0);

export const pilotMrr = (c: Client) => (c.stage === "pilot" ? c.subs.reduce((n, s) => n + subMrr(s), 0) : 0);

export const totalMrr = (cs: Client[]) => cs.reduce((n, c) => n + clientMrr(c), 0);

export const withIgic = (n: number) => Math.round(n * (1 + IGIC) * 100) / 100;

export const hasPlan = (c: Client, p: PlanId) => c.subs.some((s) => s.plan === p);

export const subLabel = (s: Subscription) => `${planById(s.plan).name} · ${s.tier}`;

/** The launch path from the plans doc: P1 with the P8 hook, then P6 from month 3, then P4. */
export function upsellFor(c: Client): { plan: PlanId; why: string } | null {
  if (c.stage !== "paid") return null;
  const tourism = /restaurant|bar|boat|excursion|dive|surf|tour|hotel|activity/i.test(c.kind);
  if (hasPlan(c, "p1") && !hasPlan(c, "p8")) return { plan: "p8", why: "Add AI Visibility tracking for €39/mo to their Maps plan." };
  if (tourism && hasPlan(c, "p1") && !hasPlan(c, "p6") && /boat|excursion|dive|surf|tour|activity/i.test(c.kind))
    return { plan: "p6", why: "They take bookings: the WhatsApp Receptionist answers while they're at sea." };
  if (tourism && !hasPlan(c, "p1")) return { plan: "p1", why: "Tourism business without Maps & Reviews yet." };
  if (/estate|rental|agent/i.test(c.kind) && !hasPlan(c, "p4")) return { plan: "p4", why: "Property business: sell Listing Kits." };
  return null;
}
