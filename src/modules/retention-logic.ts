// Retention Flows: types, consent rules, segments, send simulation and reporting.
import type { Client, Rec } from "../core/types";

export type Channel = "whatsapp" | "email";
export type MsgLang = "es" | "en" | "de";
export const MSG_LANGS: MsgLang[] = ["es", "en", "de"];

export interface ConsentRec { channel: Channel; date: string; source: string; wording: string }
export interface OptOut { channel: Channel; date: string; via: string }
export interface Visit { date: string; amount: number }
export interface Send { at: string; ref: string; label: string; channel: Channel; cost: number; marketing: boolean }

export interface Customer extends Rec {
  clientId: string;
  name: string;
  phone?: string;
  email?: string;
  lang: MsgLang;
  birthday?: string; // MM-DD
  visits: Visit[];
  consents: ConsentRec[];
  optOuts: OptOut[];
  sends: Send[];
  nextAppointment?: string; // ISO date
  cartAbandonedAt?: string; // ISO datetime
}

export interface RetSetup extends Rec {
  clientId: string;
  tone: string;
  offer: Record<MsgLang, string>; // approved standing offer, per language
  capWeek: number;
  capMonth: number;
  lapsedDays: number;
  vipVisits: number;
  vipSpend: number;
  waCost: number; // EUR per marketing message, billed at cost
  slug: string;
  wording: Record<"es" | "en", string>;
  store: "" | "Shopify" | "WooCommerce";
}

export type FlowKind = "birthday" | "winback" | "review" | "reminder" | "cart" | "postpurchase" | "vip";
export interface Flow extends Rec {
  clientId: string;
  kind: FlowKind;
  on: boolean;
  channel: Channel;
  message: Record<MsgLang, string>;
  live?: boolean;
  lastRun?: string;
}

export type Segment = "new" | "vip" | "lapsed" | "regular";
export type Audience = Segment | "all" | "birthday";
export interface Campaign extends Rec {
  clientId: string;
  title: string;
  goal: string;
  brief: string;
  audience: Audience;
  channel: Channel;
  drafts: Record<MsgLang, string>;
  live: boolean;
  status: "draft" | "approved" | "sent";
  sentAt?: string;
  recipients?: number;
  excluded?: Exclusions;
  cost?: number;
  taskId?: string;
}
export interface MonthReport extends Rec { clientId: string; month: string; text: string; live: boolean }

export const COL = {
  customers: "retention_customers",
  setup: "retention_setup",
  flows: "retention_flows",
  campaigns: "retention_campaigns",
  reports: "retention_reports",
} as const;

/* ---------- Time ---------- */

const DAY = 864e5;
export const daysAgo = (iso: string, nowMs = Date.now()) => Math.floor((nowMs - new Date(iso.length === 10 ? iso + "T12:00:00" : iso).getTime()) / DAY);
export const isoDate = (offset = 0) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

/* ---------- Consent ---------- */

export type ConsentState = "in" | "out" | "none";
export function consentState(c: Customer, ch: Channel): ConsentState {
  const lastIn = c.consents.filter((x) => x.channel === ch).map((x) => x.date).sort().pop();
  const lastOut = c.optOuts.filter((x) => x.channel === ch).map((x) => x.date).sort().pop();
  if (lastOut && (!lastIn || lastOut >= lastIn)) return "out";
  return lastIn ? "in" : "none";
}

export const STOP_RE = /^\s*(stop|baja|unsubscribe|abmelden|cancelar|para|basta|no m[aá]s|stopp)\b/i;

export const defaultWording = (biz: string): Record<"es" | "en", string> => ({
  es: `Acepto recibir ofertas y recordatorios de ${biz} por el canal marcado. Puedo darme de baja en cualquier momento respondiendo BAJA.`,
  en: `I agree to receive offers and reminders from ${biz} on the channel I ticked. I can opt out at any time by replying STOP.`,
});

/* ---------- Segments ---------- */

export const spend = (c: Customer) => c.visits.reduce((s, v) => s + v.amount, 0);
export const lastVisit = (c: Customer) => c.visits.map((v) => v.date).sort().pop();
export const firstVisit = (c: Customer) => c.visits.map((v) => v.date).sort()[0];

export function segments(c: Customer, s: Pick<RetSetup, "lapsedDays" | "vipVisits" | "vipSpend">, nowMs = Date.now()): Segment[] {
  const out: Segment[] = [];
  const first = firstVisit(c);
  const last = lastVisit(c);
  if (first && daysAgo(first, nowMs) <= 30) out.push("new");
  if (c.visits.length >= s.vipVisits || spend(c) >= s.vipSpend) out.push("vip");
  if (last && daysAgo(last, nowMs) > s.lapsedDays && !out.includes("new")) out.push("lapsed");
  if (!out.length) out.push("regular");
  return out;
}

export const SEGMENT_LABEL: Record<Segment, string> = { new: "New", vip: "VIP", lapsed: "Lapsed", regular: "Regular" };
export const AUDIENCE_LABEL: Record<Audience, string> = { all: "Everyone", new: "New", vip: "VIP", lapsed: "Lapsed", regular: "Regular", birthday: "Birthday this month" };

export function inAudience(c: Customer, a: Audience, s: RetSetup): boolean {
  if (a === "all") return true;
  if (a === "birthday") return !!c.birthday && c.birthday.slice(0, 2) === isoDate().slice(5, 7);
  return segments(c, s).includes(a);
}

/* ---------- Sending rules ---------- */

export type Exclusion = "noContact" | "optedOut" | "noConsent" | "capped";
export type Exclusions = Record<Exclusion, number>;
export const EXCLUSION_LABEL: Record<Exclusion, string> = {
  noContact: "No phone or email",
  optedOut: "Opted out",
  noConsent: "No recorded consent",
  capped: "Frequency cap reached",
};

export function checkSend(c: Customer, ch: Channel, s: RetSetup, marketing: boolean, nowMs = Date.now()): Exclusion | null {
  if (ch === "whatsapp" ? !c.phone : !c.email) return "noContact";
  const st = consentState(c, ch);
  if (st === "out") return "optedOut";
  if (st === "none") return "noConsent";
  if (marketing) {
    const mk = c.sends.filter((x) => x.marketing);
    const week = mk.filter((x) => nowMs - new Date(x.at).getTime() < 7 * DAY).length;
    const month = mk.filter((x) => nowMs - new Date(x.at).getTime() < 30 * DAY).length;
    if (week >= s.capWeek || month >= s.capMonth) return "capped";
  }
  return null;
}

export interface SendPlan { ok: Customer[]; excluded: Exclusions; byLang: Record<MsgLang, number>; cost: number }
export function planSend(list: Customer[], ch: Channel, s: RetSetup, marketing: boolean): SendPlan {
  const excluded: Exclusions = { noContact: 0, optedOut: 0, noConsent: 0, capped: 0 };
  const ok: Customer[] = [];
  for (const c of list) {
    const r = checkSend(c, ch, s, marketing);
    if (r) excluded[r]++;
    else ok.push(c);
  }
  const byLang: Record<MsgLang, number> = { es: 0, en: 0, de: 0 };
  ok.forEach((c) => byLang[c.lang]++);
  return { ok, excluded, byLang, cost: ch === "whatsapp" ? ok.length * s.waCost : 0 };
}

export const personalise = (text: string, c: Customer) => text.replace(/\{(nombre|name|vorname)\}/g, c.name.split(" ")[0]);

/* ---------- Flows ---------- */

export interface FlowDef { label: string; trigger: string; marketing: boolean; tiers: string[]; goal: string }
export const FLOW_DEFS: Record<FlowKind, FlowDef> = {
  birthday: { label: "Birthday", trigger: "Birthday in the next 7 days", marketing: true, tiers: ["Local Basic", "Local Plus", "Store Pro"], goal: "birthday treat" },
  winback: { label: "Win-back", trigger: "No visit for longer than the lapsed threshold, once every 60 days", marketing: true, tiers: ["Local Basic", "Local Plus", "Store Pro"], goal: "win back a lapsed customer" },
  review: { label: "Review request", trigger: "Visit in the last 2 days, once a month", marketing: true, tiers: ["Local Plus"], goal: "ask for a Google review" },
  reminder: { label: "Booking reminder", trigger: "Appointment in the next 2 days (utility template, outside the cap)", marketing: false, tiers: ["Local Plus"], goal: "appointment reminder" },
  cart: { label: "Abandoned cart", trigger: "Cart left in the last 48 hours (needs Shopify or WooCommerce)", marketing: true, tiers: ["Store Pro"], goal: "recover an abandoned cart" },
  postpurchase: { label: "Post-purchase", trigger: "Order in the last 3 days (order update, outside the cap)", marketing: false, tiers: ["Store Pro"], goal: "post-purchase thank you and care tips" },
  vip: { label: "VIP", trigger: "Tagged VIP, once a month", marketing: true, tiers: ["Store Pro"], goal: "VIP early access" },
};
export const FLOW_ORDER: FlowKind[] = ["birthday", "winback", "review", "reminder", "cart", "postpurchase", "vip"];

function sentRecently(c: Customer, ref: string, days: number) {
  return c.sends.some((x) => x.ref === ref && Date.now() - new Date(x.at).getTime() < days * DAY);
}

export function flowTriggered(f: Flow, c: Customer, s: RetSetup): boolean {
  const today = isoDate();
  switch (f.kind) {
    case "birthday": {
      if (!c.birthday) return false;
      for (let i = 0; i <= 7; i++) if (isoDate(i).slice(5) === c.birthday) return !sentRecently(c, f.id, 300);
      return false;
    }
    case "winback": return segments(c, s).includes("lapsed") && !sentRecently(c, f.id, 60);
    case "review": { const l = lastVisit(c); return !!l && daysAgo(l) <= 2 && !sentRecently(c, f.id, 30); }
    case "reminder": return !!c.nextAppointment && c.nextAppointment >= today && c.nextAppointment <= isoDate(2) && !sentRecently(c, f.id, 3);
    case "cart": return !!s.store && !!c.cartAbandonedAt && daysAgo(c.cartAbandonedAt) <= 2 && !sentRecently(c, f.id, 7);
    case "postpurchase": { const l = lastVisit(c); return !!s.store && !!l && daysAgo(l) <= 3 && !sentRecently(c, f.id, 7); }
    case "vip": return segments(c, s).includes("vip") && !sentRecently(c, f.id, 30);
  }
}

/* ---------- Reporting ---------- */

export interface MonthStats {
  month: string;
  revenue: number;
  returningRevenue: number;
  newRevenue: number;
  returningCustomers: number;
  newCustomers: number;
  attributed: number;
  attributedVisits: number;
  messages: number;
  cost: number;
  byRef: { ref: string; label: string; sent: number; visits: number; revenue: number; cost: number }[];
}

/** Revenue from returning customers, and visits within 7 days of a message (attributed). */
export function monthStats(customers: Customer[], month: string): MonthStats {
  const st: MonthStats = { month, revenue: 0, returningRevenue: 0, newRevenue: 0, returningCustomers: 0, newCustomers: 0, attributed: 0, attributedVisits: 0, messages: 0, cost: 0, byRef: [] };
  const refs = new Map<string, MonthStats["byRef"][number]>();
  const ref = (id: string, label: string) => refs.get(id) ?? refs.set(id, { ref: id, label, sent: 0, visits: 0, revenue: 0, cost: 0 }).get(id)!;
  for (const c of customers) {
    const vs = [...c.visits].sort((a, b) => a.date.localeCompare(b.date));
    let returning = false, isNew = false;
    vs.forEach((v, i) => {
      if (!v.date.startsWith(month)) return;
      st.revenue += v.amount;
      if (i > 0) { st.returningRevenue += v.amount; returning = true; } else { st.newRevenue += v.amount; isNew = true; }
      const t = new Date(v.date + "T12:00:00").getTime();
      const trig = c.sends.filter((s) => { const d = t - new Date(s.at).getTime(); return d >= 0 && d <= 7 * DAY; }).sort((a, b) => b.at.localeCompare(a.at))[0];
      if (trig) {
        st.attributed += v.amount; st.attributedVisits++;
        const r = ref(trig.ref, trig.label); r.visits++; r.revenue += v.amount;
      }
    });
    if (returning) st.returningCustomers++;
    if (isNew) st.newCustomers++;
    for (const s of c.sends) {
      if (!s.at.startsWith(month)) continue;
      st.messages++; st.cost += s.cost;
      const r = ref(s.ref, s.label); r.sent++; r.cost += s.cost;
    }
  }
  st.byRef = [...refs.values()].sort((a, b) => b.revenue - a.revenue);
  return st;
}

export const lastMonths = (n: number) => {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 15);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
};
export const monthLabel = (m: string) => new Date(m + "-15T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

export const tierOf = (c?: Client) => c?.subs.find((s) => s.plan === "p10")?.tier ?? "Local Basic";
export const flowIncluded = (tier: string, kind: FlowKind) => FLOW_DEFS[kind].tiers.includes(tier);

export function defaultSetup(c: Client): Omit<RetSetup, "id" | "createdAt"> {
  return {
    clientId: c.id,
    tone: "Warm and close, uses tú, short sentences",
    offer: { es: "un 10% en tu próxima visita", en: "10% off your next visit", de: "10 % auf deinen nächsten Besuch" },
    capWeek: 1,
    capMonth: 4,
    lapsedDays: 60,
    vipVisits: 8,
    vipSpend: 400,
    waCost: 0.06,
    slug: c.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    wording: defaultWording(c.name),
    store: "",
  };
}
