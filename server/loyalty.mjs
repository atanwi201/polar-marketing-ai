// Loyalty cards: programmes, customers and every balance calculation (stamps, points, tiers, rewards, expiry).
// Data lives in db.loyalty and is saved with the rest of the studio data.
import { randomBytes, randomInt } from "node:crypto";
import { db, save, id, token, now } from "./store.mjs";

export class LoyaltyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const TYPES = ["stamps", "points", "custom"];
export const STATUSES = ["draft", "live", "paused"];
export const FONTS = ["modern", "serif", "rounded", "mono"];
export const LAYOUTS = ["stripe", "minimal", "full"];
export const STAMP_GAP_MS = 10 * 60e3; // one stamp-earning visit per customer per 10 minutes

/** The data root, created on first use. */
export function ldb() {
  const l = (db.loyalty ??= {});
  for (const k of ["programs", "customers", "txns", "devices", "templates"]) l[k] ??= [];
  return l;
}

// ---- hook: every mutation that changes a card calls this (index.mjs wires it to the wallet push) ----
let onCardChanged = () => {};
export const setOnCardChanged = (fn) => { onCardChanged = typeof fn === "function" ? fn : () => {}; };
export function notify(customer) {
  if (customer) customer.updatedAt = now();
  try { const r = onCardChanged(customer); if (r && typeof r.catch === "function") r.catch(() => {}); } catch { /* a failed push never breaks a stamp */ }
}

// ---- small helpers ----
const num = (v, min, max, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const hex = (v, d) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : d);
const file = (v) => (typeof v === "string" && /^[\w][\w.-]{0,119}$/.test(v) ? v : "");
const ALNUM = "abcdefghjkmnpqrstuvwxyz23456789";
const code = (n, alphabet = ALNUM) => Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join("");
const eur = (n) => Math.round(Number(n) * 100) / 100;
const bool = (v, d) => (typeof v === "boolean" ? v : d);

export const findProgram = (pid) => ldb().programs.find((p) => p.id === pid);
export const findCustomer = (cid) => ldb().customers.find((c) => c.id === cid || c.id.toLowerCase() === String(cid).toLowerCase());
export const findByToken = (t) => (typeof t === "string" && t.length >= 8 ? ldb().customers.find((c) => c.cardToken === t) : undefined);
export const clientOf = (p) => db.clients.find((c) => c.id === p?.clientId);

// ---- design ----
const PALETTES = [
  ["#14532d", "#ffffff", "#bbf7d0", "#f59e0b"], ["#1e3a8a", "#ffffff", "#bfdbfe", "#fbbf24"], ["#7c2d12", "#fff7ed", "#fed7aa", "#fde047"],
  ["#581c87", "#faf5ff", "#e9d5ff", "#f472b6"], ["#0f172a", "#f8fafc", "#94a3b8", "#22d3ee"], ["#831843", "#fff1f2", "#fecdd3", "#fde68a"],
];
/** A clean starting design from the business name; the AI designer or the owner changes it. */
export function defaultDesign(client = {}, type = "stamps") {
  const h = [...String(client.name ?? "x")].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const [background, foreground, label, accent] = PALETTES[h % PALETTES.length];
  return {
    prompt: "", background, foreground, label, accent, fontStyle: "modern", layout: "minimal",
    cardTitle: str(client.name, 40) || "Loyalty card", tagline: type === "points" ? "Earn points, get rewards" : "Collect stamps, get rewards",
    stampIcon: "★", stampEmptyIcon: "○", logoFile: file(client.logoFile), stripFile: "", backgroundFile: "", generatedBy: { model: "", at: "" },
  };
}

/** Clean up a design from the AI or the editor: colours, enums and file names are checked. */
export function sanitizeDesign(d = {}, base = {}) {
  d = d && typeof d === "object" ? d : {};
  const pick = (k, max) => (k in d ? str(d[k], max) : base[k] ?? "");
  return {
    prompt: pick("prompt", 600),
    background: hex(d.background, base.background ?? "#14532d"), foreground: hex(d.foreground, base.foreground ?? "#ffffff"),
    label: hex(d.label, base.label ?? "#bbf7d0"), accent: hex(d.accent, base.accent ?? "#f59e0b"),
    fontStyle: FONTS.includes(d.fontStyle) ? d.fontStyle : base.fontStyle ?? "modern",
    layout: LAYOUTS.includes(d.layout) ? d.layout : base.layout ?? "minimal",
    cardTitle: pick("cardTitle", 40), tagline: pick("tagline", 80),
    stampIcon: ("stampIcon" in d ? [...str(d.stampIcon, 16)].slice(0, 2).join("") : base.stampIcon) || "★",
    stampEmptyIcon: ("stampEmptyIcon" in d ? [...str(d.stampEmptyIcon, 16)].slice(0, 2).join("") : base.stampEmptyIcon) || "○",
    logoFile: "logoFile" in d ? file(d.logoFile) : base.logoFile ?? "", stripFile: "stripFile" in d ? file(d.stripFile) : base.stripFile ?? "",
    backgroundFile: "backgroundFile" in d ? file(d.backgroundFile) : base.backgroundFile ?? "",
    generatedBy: d.generatedBy && typeof d.generatedBy === "object" ? { model: str(d.generatedBy.model, 80), at: str(d.generatedBy.at, 40) } : base.generatedBy ?? { model: "", at: "" },
  };
}

// ---- programme fields ----
export function sanitizeRewards(list, goal, prev = []) {
  if (!Array.isArray(list)) return prev;
  const seen = new Set();
  return list.slice(0, 20).map((r) => {
    const name = str(r?.name, 60);
    if (!name) return null;
    const kind = r.kind === "points" ? "points" : "stamps";
    let rid = typeof r.id === "string" && /^[\w-]{3,40}$/.test(r.id) && !seen.has(r.id) ? r.id : id();
    seen.add(rid);
    const cost = num(r.cost, 1, 1e6, kind === "stamps" ? goal : 100);
    return {
      id: rid, name, description: str(r.description, 200), kind, cost: kind === "stamps" ? Math.min(cost, goal) : cost,
      expiresDays: r.expiresDays == null || r.expiresDays === "" ? null : num(r.expiresDays, 1, 3650, null),
      minTier: str(r.minTier, 40), active: bool(r.active, true),
    };
  }).filter(Boolean);
}

export function sanitizeTiers(list, prev = []) {
  if (!Array.isArray(list)) return prev;
  const t = list.slice(0, 8).map((x) => ({ name: str(x?.name, 40), minPoints: num(x?.minPoints, 0, 1e7, 0), perk: str(x?.perk, 120) })).filter((x) => x.name);
  t.sort((a, b) => a.minPoints - b.minPoints);
  if (t[0]) t[0].minPoints = 0;
  return t;
}

/** Apply the editable programme fields from `f` onto a copy of `base`; unknown or bad values are ignored. */
export function applyFields(base, f = {}) {
  const p = { ...base };
  if (typeof f.name === "string" && str(f.name, 60)) p.name = str(f.name, 60);
  if (TYPES.includes(f.type)) p.type = f.type;
  if (STATUSES.includes(f.status)) p.status = f.status;
  if (f.stamps && typeof f.stamps === "object") {
    p.stamps = { goal: num(f.stamps.goal, 1, 50, p.stamps.goal), perVisit: num(f.stamps.perVisit, 1, 10, p.stamps.perVisit), minSpendEur: Math.max(0, Math.min(1000, eur(f.stamps.minSpendEur ?? p.stamps.minSpendEur) || 0)) };
  }
  if (f.points && typeof f.points === "object") {
    p.points = { perEuro: Math.max(0, Math.min(1000, Number(f.points.perEuro ?? p.points.perEuro) || 0)), perVisit: num(f.points.perVisit, 0, 10000, p.points.perVisit) };
  }
  if ("pointsExpireDays" in f) p.pointsExpireDays = f.pointsExpireDays == null || f.pointsExpireDays === "" ? null : num(f.pointsExpireDays, 1, 3650, null);
  if ("terms" in f) p.terms = str(f.terms, 1000);
  if (f.welcomeBonus && typeof f.welcomeBonus === "object") p.welcomeBonus = { stamps: num(f.welcomeBonus.stamps, 0, 50, 0), points: num(f.welcomeBonus.points, 0, 10000, 0) };
  if ("tiers" in f) p.tiers = sanitizeTiers(f.tiers, p.tiers);
  if ("rewards" in f || f.stamps) p.rewards = sanitizeRewards("rewards" in f ? f.rewards : p.rewards, p.stamps.goal, p.rewards);
  if (f.design && typeof f.design === "object") p.design = sanitizeDesign(f.design, p.design);
  return p;
}

const starterRewards = (type, goal) => type === "points"
  ? [{ id: id(), name: "Free treat", description: "", kind: "points", cost: 100, expiresDays: 30, minTier: "", active: true }]
  : type === "custom"
    ? [{ id: id(), name: "Free treat", description: "", kind: "points", cost: 100, expiresDays: 30, minTier: "", active: true }, { id: id(), name: "Free reward", description: "", kind: "stamps", cost: goal, expiresDays: 30, minTier: "", active: true }]
    : [{ id: id(), name: "Free reward", description: "", kind: "stamps", cost: goal, expiresDays: 30, minTier: "", active: true }];

const uniqueJoinCode = () => { for (;;) { const c = code(6); if (!ldb().programs.some((p) => p.joinCode === c)) return c; } };

/** A new draft programme for a business, with a default design and a starter reward. */
export function createProgram(client, fields = {}) {
  const type = TYPES.includes(fields.type) ? fields.type : "stamps";
  const t = now();
  const base = {
    id: id(), clientId: client.id, name: type === "points" ? "Rewards club" : "Loyalty card", type, status: "draft", createdAt: t, updatedAt: t,
    joinCode: uniqueJoinCode(), staffToken: token(),
    design: defaultDesign(client, type),
    stamps: { goal: 8, perVisit: 1, minSpendEur: 0 }, points: { perEuro: 1, perVisit: 0 },
    tiers: type === "custom" ? [{ name: "Bronze", minPoints: 0, perk: "" }, { name: "Silver", minPoints: 500, perk: "" }, { name: "Gold", minPoints: 1500, perk: "" }] : [],
    rewards: [], pointsExpireDays: null, terms: "", welcomeBonus: { stamps: 0, points: 0 },
  };
  const { rewards, status, ...rest } = fields; // new programmes always start as draft
  const p = applyFields(base, rest);
  p.rewards = Array.isArray(rewards) ? sanitizeRewards(rewards, p.stamps.goal) : starterRewards(p.type, p.stamps.goal);
  ldb().programs.push(p);
  void save();
  return p;
}

const PUSH_KEYS = ["design", "rewards", "name", "terms", "tiers", "stamps", "points"];
/** Edit a programme. `changed` says whether the cards on phones should refresh. */
export function updateProgram(program, fields = {}) {
  const next = applyFields(program, fields);
  const changed = PUSH_KEYS.some((k) => JSON.stringify(next[k]) !== JSON.stringify(program[k]));
  Object.assign(program, next, { updatedAt: now() });
  for (const c of ldb().customers) if (c.programId === program.id) c.tier = tierFor(program, c.lifetimePoints).name;
  void save();
  return { program, changed };
}

export function removeProgram(program) {
  const l = ldb();
  const ids = new Set(l.customers.filter((c) => c.programId === program.id).map((c) => c.id));
  l.programs = l.programs.filter((p) => p !== program);
  l.customers = l.customers.filter((c) => c.programId !== program.id);
  l.txns = l.txns.filter((t) => t.programId !== program.id);
  l.devices = l.devices.filter((d) => !ids.has(d.serial));
  void save();
}

export function duplicateProgram(program, { name, clientId, design } = {}) {
  const client = db.clients.find((c) => c.id === (clientId ?? program.clientId));
  const copy = createProgram(client, { ...structuredClone({ type: program.type, stamps: program.stamps, points: program.points, tiers: program.tiers, pointsExpireDays: program.pointsExpireDays, terms: program.terms, welcomeBonus: program.welcomeBonus }), name: name ?? `${program.name} copy`, rewards: structuredClone(program.rewards).map((r) => ({ ...r, id: undefined })), design: design ?? structuredClone(program.design) });
  return copy;
}

// ---- tiers and rewards ----
const sortedTiers = (p) => [...(p.tiers ?? [])].sort((a, b) => a.minPoints - b.minPoints);
/** Highest tier whose minPoints is reached by lifetime points; the first is the base tier. */
export function tierFor(program, lifetimePoints = 0) {
  const t = sortedTiers(program);
  let cur = t[0];
  for (const x of t) if (x.minPoints <= lifetimePoints) cur = x;
  return cur ?? { name: "", minPoints: 0, perk: "" };
}
const nextTierFor = (program, lifetimePoints) => {
  const n = sortedTiers(program).find((t) => t.minPoints > lifetimePoints);
  return n ? { name: n.name, pointsToGo: n.minPoints - lifetimePoints } : null;
};
const tierRank = (program, name) => sortedTiers(program).findIndex((t) => t.name === name);

/** Can this customer redeem this reward right now? `remaining` is how much is still missing. */
export function rewardStatus(customer, program, r) {
  const bal = r.kind === "points" ? customer.points : customer.stamps;
  const need = tierRank(program, r.minTier);
  const tierOk = !r.minTier || need < 0 || tierRank(program, customer.tier) >= need;
  return { id: r.id, name: r.name, description: r.description ?? "", cost: r.cost, kind: r.kind, available: r.active !== false && tierOk && bal >= r.cost, remaining: Math.max(0, r.cost - bal), minTier: r.minTier ?? "", tierOk, expiresDays: r.expiresDays ?? null };
}

// ---- points expiry (lazy) ----
/** Points earned longer ago than pointsExpireDays and not yet spent are taken off, recorded as an adjust txn. */
export function expirePoints(customer, program, at = Date.now()) {
  const days = program.pointsExpireDays;
  if (!days || customer.points <= 0) return 0;
  const cutoff = at - days * 864e5;
  let old = 0, used = 0;
  for (const t of ldb().txns) {
    if (t.customerId !== customer.id) continue;
    if (t.points < 0) used += -t.points;
    else if (t.points > 0 && Date.parse(t.at) < cutoff) old += t.points;
  }
  const gone = Math.min(customer.points, Math.max(0, old - used));
  if (gone <= 0) return 0;
  customer.points -= gone;
  addTxn(customer, program, { type: "adjust", points: -gone, note: "Points expired", by: "system", at: new Date(at).toISOString() });
  void save();
  notify(customer);
  return gone;
}

// ---- customers and transactions ----
function addTxn(customer, program, t) {
  const x = { id: id(), programId: program.id, customerId: customer.id, clientId: program.clientId, at: now(), stamps: 0, points: 0, amountEur: 0, note: "", by: "system", ...t };
  ldb().txns.push(x);
  return x;
}
export const txnsOf = (customer) => ldb().txns.filter((t) => t.customerId === customer.id);

const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
const livecheck = (program) => {
  if (program.status !== "live") throw new LoyaltyError("This card is not open yet. Please ask the staff.", 409);
};

/** A customer joins a live programme from the join link. */
export function joinCustomer(program, { name, email, phone, marketingConsent } = {}, { by = "system" } = {}) {
  livecheck(program);
  const nm = str(name, 80);
  if (!nm) throw new LoyaltyError("Please enter your name.", 400);
  const em = str(email, 120);
  if (!em) throw new LoyaltyError("Please enter your email address.", 400);
  if (!EMAIL.test(em)) throw new LoyaltyError("That email address does not look right.", 400);
  const ph = str(phone, 30);
  if (ph && !/^[\d+\s().-]{5,30}$/.test(ph)) throw new LoyaltyError("That phone number does not look right.", 400);
  const t = now();
  const c = {
    id: id(), programId: program.id, clientId: program.clientId, cardToken: randomBytes(18).toString("base64url"), authToken: randomBytes(16).toString("hex"),
    name: nm, email: em, phone: ph, createdAt: t, updatedAt: t, stamps: 0, points: 0, lifetimePoints: 0, visits: 0, tier: tierFor(program, 0).name, lastVisitAt: "",
    redemptions: [], marketingConsent: marketingConsent === true,
  };
  const wb = program.welcomeBonus ?? {};
  if (program.type !== "points" && wb.stamps) c.stamps = Math.min(wb.stamps, program.stamps.goal);
  if (program.type !== "stamps" && wb.points) { c.points = wb.points; c.lifetimePoints = wb.points; c.tier = tierFor(program, c.lifetimePoints).name; }
  ldb().customers.push(c);
  addTxn(c, program, { type: "join", stamps: c.stamps, points: c.points, note: c.stamps || c.points ? "Welcome bonus" : "Joined", by });
  void save();
  return c;
}

/** "LC1-<id>" (or a bare id) to the customer and programme. */
export function lookupByCode(codeText) {
  // Accepts what a scanner or a person may give: "LC1-<id>", the bare id, any case, stray spaces or a pasted line around it.
  const s = String(codeText ?? "").trim().slice(0, 200);
  const found = /LC1-?\s*([a-z0-9]+)/i.exec(s);
  const cid = (found ? found[1] : s.replace(/[^a-z0-9]/gi, "")).toLowerCase();
  if (!cid || cid.length > 60) return null;
  const customer = findCustomer(cid);
  const program = customer && findProgram(customer.programId);
  return customer && program ? { customer, program } : null;
}
export const codeOf = (customer) => `LC1-${customer.id}`;

const voucherCode = () => code(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");

/**
 * Record a visit, a purchase or a redemption. Returns { customer, txn, message }.
 * Rule problems throw a LoyaltyError (400/409/422) with a message staff can read out.
 */
export function record(customer, program, { kind, amountEur, rewardId, by = "staff", at = Date.now() } = {}) {
  if (customer.programId !== program.id) throw new LoyaltyError("This card belongs to a different programme.", 404);
  livecheck(program);
  if (!["visit", "purchase", "redeem"].includes(kind)) throw new LoyaltyError("Unknown action.", 400);
  expirePoints(customer, program, at);
  const iso = new Date(at).toISOString();
  const earnsStamps = program.type !== "points", earnsPoints = program.type !== "stamps";
  let txn, message;

  if (kind === "redeem") {
    const r = program.rewards.find((x) => x.id === rewardId);
    if (!r || r.active === false) throw new LoyaltyError("That reward is not available.", 404);
    const st = rewardStatus(customer, program, r);
    if (!st.tierOk) throw new LoyaltyError(`This reward needs the ${r.minTier} tier.`, 422);
    if (!st.available) throw new LoyaltyError(`Not enough ${r.kind} yet: ${st.remaining} more to go.`, 422);
    if (r.kind === "stamps") customer.stamps -= r.cost; else customer.points -= r.cost;
    const vc = voucherCode();
    const red = { rewardId: r.id, name: r.name, at: iso, code: vc, ...(r.expiresDays ? { expiresAt: new Date(at + r.expiresDays * 864e5).toISOString() } : {}) };
    customer.redemptions.push(red);
    txn = addTxn(customer, program, { type: "redeem", stamps: r.kind === "stamps" ? -r.cost : 0, points: r.kind === "points" ? -r.cost : 0, note: `${r.name} (${vc})`, by, rewardId: r.id, at: iso });
    message = `Reward given: ${r.name}.${r.expiresDays ? ` Voucher ${vc}, valid ${r.expiresDays} days.` : ` Voucher ${vc}.`}`;
  } else {
    const amt = kind === "purchase" ? eur(amountEur) : 0;
    if (kind === "purchase" && !(amt > 0 && amt <= 100000)) throw new LoyaltyError("Enter the amount spent.", 400);
    const qualifies = kind === "visit" || amt >= (program.stamps.minSpendEur ?? 0);
    let addStamps = earnsStamps && qualifies ? program.stamps.perVisit : 0;
    let addPoints = 0;
    if (earnsPoints) addPoints = (kind === "purchase" ? Math.floor(amt * program.points.perEuro + 1e-9) : 0) + program.points.perVisit;
    if (program.type === "stamps" && !addStamps) throw new LoyaltyError(`Spend at least €${program.stamps.minSpendEur} to earn a stamp.`, 422);
    if (addStamps) {
      if (customer.lastStampAt && at - Date.parse(customer.lastStampAt) < STAMP_GAP_MS) {
        const mins = Math.max(1, Math.ceil((STAMP_GAP_MS - (at - Date.parse(customer.lastStampAt))) / 60e3));
        throw new LoyaltyError(`Already stamped a moment ago. Try again in ${mins} min.`, 409);
      }
      const room = program.stamps.goal - customer.stamps;
      if (room <= 0 && program.type === "stamps") throw new LoyaltyError("The card is full. Give a reward first to start a new one.", 409);
      addStamps = Math.max(0, Math.min(addStamps, room));
      if (addStamps) customer.lastStampAt = iso;
    }
    customer.stamps += addStamps;
    customer.points += addPoints;
    customer.lifetimePoints += addPoints;
    customer.visits += 1;
    customer.lastVisitAt = iso;
    const before = customer.tier;
    customer.tier = tierFor(program, customer.lifetimePoints).name;
    txn = addTxn(customer, program, { type: kind, stamps: addStamps, points: addPoints, amountEur: amt, note: "", by, at: iso });
    const bits = [];
    if (addStamps) bits.push(`+${addStamps} stamp${addStamps > 1 ? "s" : ""} (${customer.stamps} of ${program.stamps.goal})`);
    if (earnsPoints) bits.push(`+${addPoints} points (balance ${customer.points})`);
    message = bits.length ? bits.join(", ") : "Visit recorded.";
    if (customer.tier && customer.tier !== before && tierRank(program, customer.tier) > tierRank(program, before)) message += `. Now ${customer.tier}!`;
  }
  void save();
  notify(customer);
  return { customer, txn, message };
}

/** Manual correction by the owner or the business. Balances never go below zero; lifetime points only grow. */
export function adjust(customer, program, { stamps = 0, points = 0, note = "", by = "owner" } = {}) {
  const ds = num(stamps, -1e5, 1e5, 0), dp = num(points, -1e6, 1e6, 0);
  if (!ds && !dp) throw new LoyaltyError("Enter a number of stamps or points to add or remove.", 400);
  const s = Math.min(program.stamps.goal, Math.max(0, customer.stamps + ds)) - customer.stamps;
  const p = Math.max(0, customer.points + dp) - customer.points;
  customer.stamps += s;
  customer.points += p;
  if (p > 0) customer.lifetimePoints += p;
  customer.tier = tierFor(program, customer.lifetimePoints).name;
  const txn = addTxn(customer, program, { type: "adjust", stamps: s, points: p, note: str(note, 200) || "Manual correction", by });
  void save();
  notify(customer);
  return { customer, txn };
}

// ---- views ----
export function staffCustomer(customer, program) {
  return {
    id: customer.id, name: customer.name, stamps: customer.stamps, points: customer.points, tier: customer.tier, visits: customer.visits, lastVisitAt: customer.lastVisitAt,
    rewards: program.rewards.filter((r) => r.active !== false).map((r) => { const s = rewardStatus(customer, program, r); return { id: s.id, name: s.name, cost: s.cost, kind: s.kind, available: s.available }; }),
  };
}

export function customerRow(c) {
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, stamps: c.stamps, points: c.points, lifetimePoints: c.lifetimePoints, tier: c.tier, visits: c.visits, lastVisitAt: c.lastVisitAt, createdAt: c.createdAt, walletDevices: ldb().devices.filter((d) => d.serial === c.id).length };
}

export function stats(program) {
  const l = ldb();
  const cs = l.customers.filter((c) => c.programId === program.id);
  const cutoff = Date.now() - 30 * 864e5;
  const tx = l.txns.filter((t) => t.programId === program.id);
  return {
    customers: cs.length, activeLast30d: cs.filter((c) => c.lastVisitAt && Date.parse(c.lastVisitAt) >= cutoff).length,
    stampsGiven: tx.reduce((a, t) => a + (t.type !== "adjust" && t.stamps > 0 ? t.stamps : 0), 0),
    pointsGiven: tx.reduce((a, t) => a + (t.type !== "adjust" && t.points > 0 ? t.points : 0), 0),
    rewardsRedeemed: tx.filter((t) => t.type === "redeem").length, visits: tx.filter((t) => t.type === "visit" || t.type === "purchase").length,
  };
}

/** Public address of the join page. `baseUrl` has no trailing slash. */
export const joinUrl = (program, baseUrl) => `${baseUrl}/join/${program.joinCode}`;
export const staffUrl = (program, baseUrl) => `${baseUrl}/staff/${program.staffToken}`;

export function programView(program, { baseUrl = "" } = {}) {
  return { ...program, joinUrl: joinUrl(program, baseUrl), staffUrl: staffUrl(program, baseUrl), stats: stats(program), clientName: clientOf(program)?.name ?? "" };
}

/** What the customer sees on their card. Expires old points first. */
export function cardView(customer, program, { baseUrl = "", walletConfigured = false, googleConfigured = false } = {}) {
  expirePoints(customer, program);
  const history = txnsOf(customer).slice(-20).reverse().map((t) => ({ at: t.at, type: t.type, stamps: t.stamps, points: t.points, note: t.note }));
  return {
    business: { name: clientOf(program)?.name ?? "" },
    program: { id: program.id, name: program.name, type: program.type, design: program.design, stamps: { goal: program.stamps.goal }, points: program.points, tiers: program.tiers, rewards: program.rewards.filter((r) => r.active !== false), terms: program.terms, status: program.status },
    customer: { id: customer.id, name: customer.name, stamps: customer.stamps, points: customer.points, lifetimePoints: customer.lifetimePoints, tier: customer.tier, nextTier: nextTierFor(program, customer.lifetimePoints), visits: customer.visits },
    code: codeOf(customer),
    rewards: program.rewards.filter((r) => r.active !== false).map((r) => { const s = rewardStatus(customer, program, r); return { id: s.id, name: s.name, cost: s.cost, kind: s.kind, available: s.available, remaining: s.remaining }; }),
    redemptions: (customer.redemptions ?? []).slice(-5).reverse(),
    history,
    wallet: { available: !!walletConfigured, url: `${baseUrl}/card/${customer.cardToken}/pass.pkpass`, google: { available: !!googleConfigured, url: `${baseUrl}/card/${customer.cardToken}/google-wallet` } },
    installUrl: `${baseUrl}/card/${customer.cardToken}`,
  };
}
