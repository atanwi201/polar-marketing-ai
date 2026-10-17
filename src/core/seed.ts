// Example data so every screen opens in a working state. Every record has example: true.
import { put, now } from "./store";
import type { Client, Visit, Invoice, Task } from "./types";

const d = (offsetDays: number) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);
const ex = <T extends object>(id: string, r: T) => ({ ...r, id, createdAt: now(), example: true });

/** Fixed ids so module seeds can point at these clients. */
export const EX = {
  tasca: "ex-tasca",     // restaurant, Los Cristianos: Maps & Reviews + AI Visibility
  whale: "ex-whale",     // whale-watching boat, Los Cristianos: Maps & Reviews + Receptionist
  dive: "ex-dive",       // dive school, Puerto de la Cruz: pilot, Receptionist + Activity Pages
  casa: "ex-casa",       // estate agent, Costa Adeje: Listing Kits
  surf: "ex-surf",       // surf school, El Médano: lead, Video Ads
  bodega: "ex-bodega",   // winery, Tacoronte: Makers Online lead
  salon: "ex-salon",     // salon, La Laguna: Retention Flows
  coach: "ex-coach",     // coach, Santa Cruz: Clip Engine
  agency: "ex-agency",   // agency, Santa Cruz: Agency Social
} as const;

export const EXAMPLE_CLIENTS: Client[] = [
  ex(EX.tasca, { name: "Tasca El Puerto", kind: "Restaurant", town: "Los Cristianos", contact: "Marta Díaz", phone: "+34 922 000 101", stage: "paid",
    subs: [{ plan: "p1", tier: "Plus", price: 169, startedAt: d(-75) }, { plan: "p8", tier: "Add-on", price: 39, startedAt: d(-40) }],
    consents: [], languages: ["es", "en", "de"], notes: "Seafood, terrace on the promenade. Owner approves low ratings on WhatsApp." }),
  ex(EX.whale, { name: "Atlántico Whale Trips", kind: "Boat excursions", town: "Los Cristianos", contact: "Iván Rodríguez", phone: "+34 922 000 102", stage: "paid",
    subs: [{ plan: "p1", tier: "Basic", price: 99, startedAt: d(-60) }, { plan: "p6", tier: "Pro", price: 249, setup: 290, startedAt: d(-20) }],
    consents: [], languages: ["es", "en", "de", "it"], notes: "2 trips a day, 10:00 and 14:00. 3 h. Adults €45, kids €25. Hotel pickup in the south." }),
  ex(EX.dive, { name: "Azul Profundo Dive Centre", kind: "Dive school", town: "Puerto de la Cruz", contact: "Lucía Hernández", phone: "+34 922 000 103", stage: "pilot",
    subs: [{ plan: "p6", tier: "Starter", price: 149, startedAt: d(-10) }, { plan: "p3", tier: "Starter", price: 99, startedAt: d(-10) }],
    consents: [], languages: ["es", "en", "de", "nl"], notes: "Free 30-day pilot ends soon." }),
  ex(EX.casa, { name: "Casa Sur Inmobiliaria", kind: "Estate agent", town: "Costa Adeje", contact: "Sven Larsson", phone: "+34 922 000 104", stage: "paid",
    subs: [{ plan: "p4", tier: "Agent", price: 149, startedAt: d(-35) }],
    consents: [], languages: ["es", "en", "de", "nl", "sv"], notes: "Many Swedish and Dutch buyers." }),
  ex(EX.surf, { name: "Médano Surf School", kind: "Surf school", town: "El Médano", contact: "Dani Pérez", phone: "+34 922 000 105", stage: "lead",
    subs: [], consents: [], languages: ["es", "en", "de"], notes: "Liked the sample reel. Call back next week." }),
  ex(EX.bodega, { name: "Bodega Las Lajas", kind: "Winery", town: "Tacoronte", contact: "Carmen Afonso", phone: "+34 922 000 106", stage: "lead",
    subs: [], consents: [], languages: ["es", "en", "de"], notes: "Wants to sell to the mainland. Already has sanitary registration." }),
  ex(EX.salon, { name: "Salón Nube", kind: "Beauty salon", town: "La Laguna", contact: "Andrea Mesa", phone: "+34 922 000 107", stage: "paid",
    subs: [{ plan: "p10", tier: "Local Plus", price: 300, startedAt: d(-50) }],
    consents: [], languages: ["es", "en"], notes: "QR opt-in at the counter since August." }),
  ex(EX.coach, { name: "Coach Raúl Torres", kind: "Business coach", town: "Santa Cruz", contact: "Raúl Torres", phone: "+34 922 000 108", stage: "paid",
    subs: [{ plan: "p7", tier: "Starter", price: 200, startedAt: d(-30) }],
    consents: [], languages: ["es", "en"], notes: "Weekly podcast in Spanish." }),
  ex(EX.agency, { name: "Nordeste Social Studio", kind: "Agency", town: "Santa Cruz", contact: "Paula Gil", phone: "+34 922 000 109", stage: "pilot",
    subs: [{ plan: "p5", tier: "Base", price: 250, startedAt: d(-5) }],
    consents: [], languages: ["es", "en"], notes: "Free first brand month. White-label." }),
];

const visits: Visit[] = [
  ex("ex-v1", { venue: "Bar La Ola", town: "Puerto de la Cruz", date: d(-2), outcome: "interested", followUp: d(1), note: "Owner back Thursday. Left printed audit." }),
  ex("ex-v2", { venue: "Pizzería Bella Vista", town: "Puerto de la Cruz", date: d(-2), outcome: "no-one" }),
  ex("ex-v3", { venue: "Médano Surf School", town: "El Médano", date: d(-4), outcome: "interested", followUp: d(2), clientId: EX.surf, note: "Showed sample reel." }),
  ex("ex-v4", { venue: "Guachinche Tío Pepe", town: "La Orotava", date: d(-6), outcome: "not now", note: "Busy season. Retry in January." }),
  ex("ex-v5", { venue: "Azul Profundo Dive Centre", town: "Puerto de la Cruz", date: d(-12), outcome: "pilot", clientId: EX.dive }),
];

const invoices: Invoice[] = [
  ex("ex-i1", { number: "2026-0011", clientId: EX.tasca, date: d(-16), lines: [{ description: "Maps & Reviews · Plus", amount: 169 }, { description: "AI Visibility · Add-on", amount: 39 }], igicRate: 0.07, status: "paid" }),
  ex("ex-i2", { number: "2026-0012", clientId: EX.whale, date: d(-16), lines: [{ description: "Maps & Reviews · Basic", amount: 99 }, { description: "WhatsApp Receptionist · Pro", amount: 249 }, { description: "WhatsApp Receptionist setup", amount: 290 }], igicRate: 0.07, status: "sent" }),
  ex("ex-i3", { number: "2026-0013", clientId: EX.casa, date: d(-16), lines: [{ description: "Listing Kits · Agent", amount: 149 }], igicRate: 0.07, status: "paid" }),
];

const tasks: Task[] = [
  ex("ex-t1", { title: "Convert Azul Profundo pilot to paid (pilot ends in 20 days)", module: "clients", clientId: EX.dive, due: d(20), done: false }),
  ex("ex-t2", { title: "Call back Médano Surf School", module: "visits", clientId: EX.surf, due: d(2), done: false }),
];

export async function seedCore() {
  for (const c of EXAMPLE_CLIENTS) await put("clients", c);
  for (const v of visits) await put("visits", v);
  for (const i of invoices) await put("invoices", i);
  for (const t of tasks) await put("tasks", t);
}

export { d as dayOffset, ex as example };
