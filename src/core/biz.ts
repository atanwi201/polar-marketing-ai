// Business-wide calculations shared by dashboard, clients and billing.
import type { Client } from "./types";
import { IGIC } from "./plans";

export const withIgic = (n: number) => Math.round(n * (1 + IGIC) * 100) / 100;

export { clientPrice, clientMonthly, monthlyIncome, trialPotential, planLabel, trialDaysLeft } from "./offer";

/** Stage names in plain words. */
export const STAGE_LABEL: Record<Client["stage"], string> = { lead: "Lead", pilot: "Free trial", paid: "Paying", churned: "Left" };
