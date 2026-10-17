export type PlanId = "p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7" | "p8" | "p9" | "p10";
export type Stage = "lead" | "pilot" | "paid" | "churned";
export type Lang = "es" | "en" | "de" | "it" | "nl" | "sv" | "fr";

export interface Rec {
  id: string;
  createdAt: string;
  example?: boolean; // seeded example data, safe to wipe
}

export interface Subscription {
  plan: PlanId;
  tier: string;
  price: number; // monthly, EUR, excl. IGIC
  setup?: number; // one-off, EUR, excl. IGIC
  annual?: boolean; // 12 months for the price of 10
  startedAt: string;
}

export interface Consent {
  channel: "email" | "whatsapp";
  date: string;
  source: string; // e.g. "QR at counter", "web form"
}

export interface Client extends Rec {
  name: string;
  kind: string; // restaurant, dive school, estate agent...
  town: string;
  contact: string;
  phone: string;
  email?: string;
  stage: Stage;
  subs: Subscription[];
  consents: Consent[];
  referredBy?: string;
  notes?: string;
  languages: Lang[];
}

export interface Visit extends Rec {
  venue: string;
  town: string;
  date: string;
  outcome: "no-one" | "interested" | "pilot" | "signed" | "not now";
  followUp?: string; // ISO date
  clientId?: string;
  note?: string;
}

export interface InvoiceLine {
  description: string;
  amount: number; // EUR excl. IGIC
}

export interface Invoice extends Rec {
  number: string; // 2026-0001
  clientId: string;
  date: string;
  lines: InvoiceLine[];
  igicRate: number; // 0.07
  status: "draft" | "sent" | "paid";
}

export interface Task extends Rec {
  title: string;
  module: string; // route id that created it
  clientId?: string;
  due?: string;
  done: boolean;
}
