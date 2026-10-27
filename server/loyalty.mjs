// Loyalty cards: programmes, customers and every balance calculation (stamps, points, tiers, rewards, expiry).
// Data lives in db.loyalty and is saved with the rest of the studio data.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { unlink, appendFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { db, save, id, token, now, MEDIA_DIR, DATA_DIR } from "./store.mjs";
import { normalisePhone, maskPhone } from "./phone.mjs";

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
  for (const k of ["programs", "customers", "txns", "devices", "templates", "members", "consents", "recoveries"]) l[k] ??= [];
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
const sameRef = (a, b) => typeof a === "string" && a.toLowerCase() === String(b).toLowerCase();
/** A card by its id, or by the id it had before a merge (so an already-printed QR still resolves). */
export const findCustomer = (cid) => ldb().customers.find((c) => sameRef(c.id, cid) || (c.oldIds ?? []).some((x) => sameRef(x, cid)));
/** A card by its URL token, or by a token it absorbed in a merge. */
export const findByToken = (t) => (typeof t === "string" && t.length >= 8 ? ldb().customers.find((c) => c.cardToken === t || (c.aliases ?? []).includes(t)) : undefined);
export const clientOf = (p) => db.clients.find((c) => c.id === p?.clientId);

// ---- staff link expiry (programme.staffTokenExpiresAt; programmes from before this field get one on first use) ----
export const STAFF_TOKEN_DAYS = () => { const n = Number(process.env.LOYALTY_STAFF_TOKEN_DAYS); return Number.isFinite(n) && n > 0 ? n : 365; };
export const newStaffTokenExpiry = (at = Date.now()) => new Date(at + STAFF_TOKEN_DAYS() * 864e5).toISOString();
/** Rotate a programme's staff token (new secret, fresh expiry). */
export function rotateStaffToken(program) {
  program.staffToken = token();
  program.staffTokenExpiresAt = newStaffTokenExpiry();
  program.updatedAt = now();
  return program.staffToken;
}
/** Is the staff link still usable? A legacy programme without an expiry is stamped now (backwards compatible). */
export function staffTokenValid(program, at = Date.now()) {
  if (!program?.staffToken) return false;
  if (!program.staffTokenExpiresAt) { program.staffTokenExpiresAt = newStaffTokenExpiry(at); void save(); return true; }
  return Date.parse(program.staffTokenExpiresAt) > at;
}

/** Remember who uploaded a card picture ("" = the studio owner), so designs can only use their own pictures. */
export function recordUpload(file, clientId = "") {
  if (typeof file !== "string" || !file) return;
  (ldb().uploads ??= {})[file] = clientId ?? "";
  void save();
}

// ---- design picture files: loy-<programStamp>-... belong to one programme ----
export const designStamp = (programId) => String(programId ?? "x").replace(/[^\w-]/g, "").slice(0, 24) || "x";
export const designFilePrefix = (programId) => `loy-${designStamp(programId)}-`;
/** Is `file` still referenced by a programme (other than `exceptProgramId`) or a template? */
export function fileStillUsed(file, exceptProgramId) {
  const l = ldb();
  const hit = (d) => d && [d.logoFile, d.stripFile, d.backgroundFile].includes(file);
  return l.programs.some((p) => p.id !== exceptProgramId && hit(p.design)) || l.templates.some((t) => hit(t.design))
    || db.clients.some((c) => c.logoFile === file || (c.photos ?? []).some((x) => x.file === file));
}
/** A tenant may only point its design at pictures it owns: its own loy- files, its logo/photos, files already in the design, or visible templates. */
function guardDesign(next, prev, program) {
  if (!next.design) return next;
  const client = clientOf(program);
  const visibleTemplates = ldb().templates.filter((t) => t.clientId === program.clientId || t.clientId === "");
  const okFile = (field, f) => {
    if (!f) return true;
    if (f === prev?.[field]) return true;
    if (field !== "logoFile" && f.startsWith(designFilePrefix(program.id))) return true;
    if (field === "logoFile" && (f === client?.logoFile || (client?.photos ?? []).some((x) => x.file === f))) return true;
    const up = ldb().uploads?.[f]; // pictures uploaded through the loyalty editor: by this business, or by the owner (admin)
    if (up !== undefined && (up === "" || up === program.clientId)) return true;
    return visibleTemplates.some((t) => t.design?.[field] === f);
  };
  const design = { ...next.design };
  for (const field of ["logoFile", "stripFile", "backgroundFile"]) if (!okFile(field, design[field])) design[field] = prev?.[field] ?? "";
  return { ...next, design };
}

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
    joinCode: uniqueJoinCode(), staffToken: token(), staffTokenExpiresAt: newStaffTokenExpiry(),
    design: defaultDesign(client, type),
    stamps: { goal: 8, perVisit: 1, minSpendEur: 0 }, points: { perEuro: 1, perVisit: 0 },
    tiers: type === "custom" ? [{ name: "Bronze", minPoints: 0, perk: "" }, { name: "Silver", minPoints: 500, perk: "" }, { name: "Gold", minPoints: 1500, perk: "" }] : [],
    rewards: [], pointsExpireDays: null, terms: "", welcomeBonus: { stamps: 0, points: 0 },
  };
  const { rewards, status, ...rest } = fields; // new programmes always start as draft
  const p = guardDesign(applyFields(base, rest), base.design, base);
  p.rewards = Array.isArray(rewards) ? sanitizeRewards(rewards, p.stamps.goal) : starterRewards(p.type, p.stamps.goal);
  ldb().programs.push(p);
  void save();
  return p;
}

const PUSH_KEYS = ["design", "rewards", "name", "terms", "tiers", "stamps", "points"];
/** Edit a programme. `changed` says whether the cards on phones should refresh. */
export function updateProgram(program, fields = {}) {
  const next = guardDesign(applyFields(program, fields), program.design, program);
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

/** Erase everything a business has in loyalty: programmes (and their staff tokens), customers, transactions, wallet device registrations, templates, card pictures, consent records. */
export async function removeClientData(clientId) {
  const l = ldb();
  const progs = l.programs.filter((p) => p.clientId === clientId);
  const progIds = new Set(progs.map((p) => p.id));
  const mine = l.customers.filter((c) => c.clientId === clientId || progIds.has(c.programId));
  const custIds = new Set(mine.map((c) => c.id));
  const memberIds = new Set(mine.map((c) => c.memberId).filter(Boolean));
  const files = new Set();
  for (const p of progs) for (const f of [p.design?.stripFile, p.design?.backgroundFile]) if (f && f.startsWith(designFilePrefix(p.id))) files.add(f);
  const counts = { programs: progs.length, customers: custIds.size, txns: l.txns.filter((t) => t.clientId === clientId || progIds.has(t.programId) || custIds.has(t.customerId)).length };
  l.programs = l.programs.filter((p) => p.clientId !== clientId);
  l.customers = l.customers.filter((c) => !custIds.has(c.id));
  l.txns = l.txns.filter((t) => !(t.clientId === clientId || progIds.has(t.programId) || custIds.has(t.customerId)));
  l.devices = l.devices.filter((d) => !custIds.has(d.serial));
  l.consents = l.consents.filter((x) => x.clientId !== clientId && !custIds.has(x.customerId) && !progIds.has(x.programId));
  l.recoveries = l.recoveries.filter((r) => r.clientId !== clientId && !progIds.has(r.programId) && !memberIds.has(r.memberId));
  // The person may still hold cards at other shops; only the ones left with nothing are removed.
  const stillHasCard = new Set(l.customers.map((c) => c.memberId));
  const orphans = [...memberIds].filter((m) => !stillHasCard.has(m));
  counts.members = orphans.length;
  if (orphans.length) { const gone = new Set(orphans); l.members = l.members.filter((m) => !gone.has(m.id)); l.consents = l.consents.filter((x) => !gone.has(x.memberId)); }
  l.templates = l.templates.filter((t) => t.clientId !== clientId);
  for (const [f, owner] of Object.entries(l.uploads ?? {})) if (owner === clientId) { files.add(f); delete l.uploads[f]; }
  for (const f of files) if (!fileStillUsed(f)) await unlink(join(MEDIA_DIR, f)).catch(() => {});
  return counts;
}

/**
 * Erase one person, by the number they gave: every card they hold, at every shop, with its
 * transactions, wallet registrations and consents. Answers a subject erasure request; the shops
 * are not told who it was. One audit line is appended (counts only — no number, no name, no id),
 * because "we deleted it" has to be provable without keeping the thing deleted.
 *
 * An invalid number is an error (400), a valid number nobody uses is `found: false`, so a caller
 * can tell "wrong input" from "already gone".
 */
export async function eraseMember(rawPhone, { audit = true, dataDir = DATA_DIR } = {}) {
  const phone = normalisePhone(rawPhone);
  if (!phone) throw new LoyaltyError("That phone number does not look right.", 400);
  const l = ldb();
  const member = l.members.find((m) => m.phone === phone.e164);
  if (!member) return { found: false, cards: 0, txns: 0, shops: 0 };
  const cards = l.customers.filter((c) => c.memberId === member.id);
  const ids = new Set(cards.map((c) => c.id));
  const shops = new Set(cards.map((c) => c.clientId));
  const txns = l.txns.filter((t) => ids.has(t.customerId)).length;
  l.customers = l.customers.filter((c) => !ids.has(c.id));
  l.txns = l.txns.filter((t) => !ids.has(t.customerId));
  l.devices = l.devices.filter((d) => !ids.has(d.serial));
  l.consents = l.consents.filter((x) => x.memberId !== member.id && !ids.has(x.customerId));
  l.recoveries = l.recoveries.filter((r) => r.memberId !== member.id);
  l.members = l.members.filter((m) => m.id !== member.id);
  await save();
  if (audit) await appendAudit(dataDir, { event: "member_erased", cards: cards.length, txns, shops: shops.size });
  return { found: true, cards: cards.length, txns, shops: shops.size };
}

/** One line per erasure, owner-only (0600), no personal data. Same file as the client audit. */
export async function appendAudit(dataDir, entry) {
  const file = join(dataDir, "erasure-audit.log");
  await appendFile(file, JSON.stringify({ at: now(), ...entry }) + "\n", { mode: 0o600 }).catch(() => {});
  await chmod(file, 0o600).catch(() => {});
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

/** Create the per-programme card. The only place a customer record is born, so the welcome bonus
 *  rule lives here once: whoever calls it (join by email, join by phone) gets the same behaviour. */
function newCard(program, { name = "", email = "", phone = "", memberId = "", marketingConsent = false } = {}, { by = "system" } = {}) {
  const t = now();
  const c = {
    id: id(), programId: program.id, clientId: program.clientId, cardToken: randomBytes(18).toString("base64url"), authToken: randomBytes(16).toString("hex"),
    name, email, phone, createdAt: t, updatedAt: t, stamps: 0, points: 0, lifetimePoints: 0, visits: 0, tier: tierFor(program, 0).name, lastVisitAt: "",
    redemptions: [], marketingConsent: marketingConsent === true,
  };
  // Optional link to the person. Old cards never get it, which is what keeps the migration additive.
  if (memberId) c.memberId = memberId;
  const wb = program.welcomeBonus ?? {};
  if (program.type !== "points" && wb.stamps) c.stamps = Math.min(wb.stamps, program.stamps.goal);
  if (program.type !== "stamps" && wb.points) { c.points = wb.points; c.lifetimePoints = wb.points; c.tier = tierFor(program, c.lifetimePoints).name; }
  ldb().customers.push(c);
  addTxn(c, program, { type: "join", stamps: c.stamps, points: c.points, note: c.stamps || c.points ? "Welcome bonus" : "Joined", by });
  return c;
}

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
  const c = newCard(program, { name: nm, email: em, phone: ph, marketingConsent }, { by });
  void save();
  return c;
}

// ---- members: a person keyed by their phone number, with one card per shop (plan A.2) ----
// A member is the *person*; a customer record is the *card*. Keeping them apart is what lets someone
// hold cards at five shops while each shop only ever sees its own card.
//
// Lookups are linear scans on purpose. The list is small, and an in-memory index would have to be
// invalidated on every write and every erasure; a stale index here does not throw, it silently gives
// one person another person's stamps. The exported names are the index: swap the implementation later.

/** The member with this phone, however it is written. */
export function memberByPhone(phone) {
  const n = normalisePhone(phone);
  return n ? ldb().members.find((m) => m.phone === n.e164) : undefined;
}

/** The member that owns a device, from the long-lived token the browser holds. */
export const memberByToken = (t) => (typeof t === "string" && t.length >= 16 ? ldb().members.find((m) => m.memberToken === t) : undefined);

/** The member behind a card, if it has one (old email cards do not). */
export const memberOf = (customer) => (customer?.memberId ? ldb().members.find((m) => m.id === customer.memberId) : undefined);

/**
 * Find the person by phone, or create them. Never creates a second member for the same number.
 * Throws a 400 LoyaltyError when the number cannot be parsed, so the route can say what to fix.
 */
export function findOrCreateMember({ phone, name, locale } = {}) {
  const n = normalisePhone(phone);
  if (!n) throw new LoyaltyError("That phone number does not look right.", 400);
  const t = now();
  const existing = ldb().members.find((m) => m.phone === n.e164);
  if (existing) {
    const nm = str(name, 80);
    if (nm) existing.name = nm;
    existing.lastSeenAt = t;
    existing.updatedAt = t;
    return { member: existing, created: false };
  }
  const member = {
    id: id(), phone: n.e164, phoneVerifiedAt: "", name: str(name, 80), memberToken: randomBytes(18).toString("base64url"),
    createdAt: t, updatedAt: t, lastSeenAt: t, locale: locale === "en" ? "en" : "es",
  };
  ldb().members.push(member);
  void save();
  return { member, created: true };
}

/**
 * The member's card for this shop, created on first use and the same one afterwards. Idempotent by
 * (member, programme): a second visit from the same device must never mint a second card, a second
 * welcome bonus or a second "join" transaction.
 */
export function cardForMember(member, program, { by = "system" } = {}) {
  livecheck(program);
  const existing = ldb().customers.find((c) => c.memberId === member.id && c.programId === program.id);
  if (existing) return { customer: existing, created: false };
  const c = newCard(program, { name: member.name, phone: member.phone, memberId: member.id }, { by });
  void save();
  return { customer: c, created: true };
}

// ---- claiming an old card and merging duplicates (plan A.6, steps 3 and 4) ----

/**
 * Attach an old card to a member. The card keeps its email, its token and every balance; it gains
 * the member link and the canonical number. Nothing is created and nothing is merged: a member who
 * already holds another card here is a 409, because choosing which balance wins is the owner's job
 * (`mergeCards`), not a side effect of somebody typing a number.
 */
export function linkCardToMember(customer, member) {
  if (!customer || !member) throw new LoyaltyError("Card not found", 404);
  if (customer.memberId === member.id) return customer;
  if (customer.memberId) throw new LoyaltyError("This card is already linked to another number.", 409);
  const other = ldb().customers.find((c) => c.id !== customer.id && c.memberId === member.id && c.programId === customer.programId);
  if (other) throw new LoyaltyError("That number already has a card at this shop. Ask the staff to merge them.", 409);
  const t = now();
  customer.memberId = member.id;
  customer.phone = member.phone;
  if (!str(customer.name, 80)) customer.name = member.name;
  if (!str(member.name, 80)) member.name = customer.name;
  customer.updatedAt = t;
  member.updatedAt = t;
  void save();
  return customer;
}

/** A card of this programme, by id, pre-merge id or card token. */
export function cardInProgram(program, ref) {
  if (typeof ref !== "string" || !ref) return undefined;
  const c = findByToken(ref) ?? findCustomer(ref);
  return c && c.programId === program.id ? c : undefined;
}

/**
 * Fold `mergeId` into `keepId` (both cards of `program`), the action the duplicate report points
 * at. Balances add up, the transactions, wallet devices and consent rows move, and the absorbed
 * card's token and id stay resolvable as aliases so the old link and an already-printed QR keep
 * working. The cards must belong to the same person or to nobody: merging two numbers would give
 * one person the other's stamps, so it is refused.
 */
export function mergeCards(program, keepRef, mergeRef, { by = "owner" } = {}) {
  const keep = cardInProgram(program, keepRef);
  const gone = cardInProgram(program, mergeRef);
  if (!keep || !gone) throw new LoyaltyError("Card not found", 404);
  if (keep.id === gone.id) throw new LoyaltyError("Choose two different cards.", 400);
  const km = memberOf(keep), gm = memberOf(gone);
  if (km && gm && km.id !== gm.id) throw new LoyaltyError("These cards belong to two different numbers.", 409);

  keep.stamps = (keep.stamps ?? 0) + (gone.stamps ?? 0);
  keep.points = (keep.points ?? 0) + (gone.points ?? 0);
  keep.lifetimePoints = (keep.lifetimePoints ?? 0) + (gone.lifetimePoints ?? 0);
  keep.visits = (keep.visits ?? 0) + (gone.visits ?? 0);
  keep.tier = tierFor(program, keep.lifetimePoints).name;
  if (String(gone.lastVisitAt ?? "") > String(keep.lastVisitAt ?? "")) keep.lastVisitAt = gone.lastVisitAt;
  if (String(gone.createdAt ?? "") < String(keep.createdAt ?? "")) keep.createdAt = gone.createdAt;
  if (!str(keep.name, 80)) keep.name = gone.name;
  if (!str(keep.email, 120)) keep.email = gone.email;
  if (!str(keep.phone, 30)) keep.phone = gone.phone;
  keep.marketingConsent = keep.marketingConsent === true || gone.marketingConsent === true;
  if (!km && gm) { keep.memberId = gm.id; keep.phone = gm.phone; }
  keep.redemptions = [...(keep.redemptions ?? []), ...(gone.redemptions ?? [])];

  const l = ldb();
  for (const t of l.txns) if (t.customerId === gone.id) t.customerId = keep.id;
  for (const d of l.devices) if (d.serial === gone.id) d.serial = keep.id;
  for (const x of l.consents) if (x.customerId === gone.id) x.customerId = keep.id;
  l.customers = l.customers.filter((c) => c.id !== gone.id);

  keep.aliases = [...new Set([...(keep.aliases ?? []), gone.cardToken, ...(gone.aliases ?? [])])];
  keep.oldIds = [...new Set([...(keep.oldIds ?? []), gone.id, ...(gone.oldIds ?? [])])];
  keep.updatedAt = now();
  addTxn(keep, program, { type: "adjust", note: `Merged card ${gone.id}`, by });
  void save();
  return { keep, gone };
}

// ---- recovery: proving a number on a new device (plan A.4, tiers 1 and 2) ----
// A request is the question "is this the person whose number that is?", asked from a device that has
// no member cookie. It holds no balance and grants nothing until somebody proves the number: an OTP
// to that phone (tier 1) or the staff, who see a first name and a masked number and confirm it in
// person (tier 2). The device that asked holds the secret in a short-lived HttpOnly cookie; the row
// keeps only its hash, so a leaked data file cannot be replayed as a device.
export const RECOVERY_TTL_MS = 15 * 60e3;
const RECOVERY_KEEP_MS = 24 * 3600e3; // how long a finished row stays before it is pruned

const sha = (s) => createHash("sha256").update(String(s)).digest("hex");

export const recoveries = () => ldb().recoveries;

export const memberById = (mid) => ldb().members.find((m) => m.id === mid);

/** Drop rows nobody can use any more; called before every write so the array cannot grow forever. */
function pruneRecoveries(ms) {
  const rows = recoveries();
  for (let i = rows.length - 1; i >= 0; i--) if (Date.parse(rows[i].expiresAt) + RECOVERY_KEEP_MS < ms) rows.splice(i, 1);
}

/**
 * Start a recovery for `phone` at `program`. Returns `undefined` when nobody has that number, which
 * is the same answer the route gives either way: a recovery route that says "no such member" is a
 * free way to ask whether a number is registered.
 */
export function newRecovery({ program, phone }) {
  const member = memberByPhone(phone);
  if (!member) return undefined;
  const ms = Date.now();
  pruneRecoveries(ms);
  const secret = randomBytes(18).toString("base64url");
  const t = now();
  const row = {
    id: id(), secretHash: sha(secret), memberId: member.id, clientId: program.clientId, programId: program.id,
    phone: member.phone, state: "pending", method: "", createdAt: t,
    expiresAt: new Date(ms + RECOVERY_TTL_MS).toISOString(), confirmedAt: "", confirmedBy: "",
  };
  recoveries().push(row);
  void save();
  return { row, secret };
}

/** The pending or confirmed request behind the device's cookie, expired on the way out. */
export function recoveryBySecret(secret) {
  if (typeof secret !== "string" || secret.length < 16) return undefined;
  const h = sha(secret);
  const row = recoveries().find((r) => r.secretHash === h);
  if (!row) return undefined;
  if (row.state === "pending" && Date.parse(row.expiresAt) <= Date.now()) row.state = "expired";
  return row;
}

/** Pending, unexpired requests for this programme, oldest first. Staff see these at the till. */
export function waitingRecoveries(program, { limit = 20 } = {}) {
  const ms = Date.now();
  const out = [];
  for (const r of recoveries()) {
    if (r.programId !== program.id || r.state !== "pending") continue;
    if (Date.parse(r.expiresAt) <= ms) { r.state = "expired"; continue; }
    out.push(r);
  }
  out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return out.slice(0, Math.max(1, limit));
}

/** Mark a request as proved. Returns false when it was never pending or has run out. */
export function confirmRecovery(row, { by = "staff" } = {}) {
  if (!row || row.state !== "pending") return false;
  if (Date.parse(row.expiresAt) <= Date.now()) { row.state = "expired"; return false; }
  row.state = "confirmed";
  row.confirmedAt = now();
  row.confirmedBy = by;
  void save();
  return true;
}

/** The card this recovery unlocks. Undefined when the person or the programme has gone since. */
export function cardForRecovery(row) {
  const member = memberById(row?.memberId);
  const program = findProgram(row?.programId);
  if (!member || !program || program.status !== "live") return undefined;
  return cardForMember(member, program).customer;
}

/** What a staff screen may see: a first name, a masked number and when it was asked. */
export function recoveryView(row) {
  const m = memberById(row.memberId);
  const first = String(m?.name ?? "").trim().split(/\s+/)[0] ?? "";
  return { id: row.id, name: first, phone: maskPhone(row.phone), at: row.createdAt };
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

/**
 * Cards at this programme whose number the staff member is looking at. Three or more digits is a
 * suffix search (the last digits are what a customer reads out); a full number must match exactly,
 * so "612 345 678" cannot quietly return the six numbers that end in 345678.
 * Old email cards are included: their free-text phone is normalised on the fly, so a card from
 * before the phone-first join is still findable at the till.
 */
export function findCardsByPhone(program, raw, { limit = 5 } = {}) {
  const typed = String(raw ?? "").trim();
  const digits = typed.replace(/\D/g, "");
  if (digits.length < 3) return [];
  const full = normalisePhone(typed)?.e164 ?? "";
  const hits = [];
  for (const c of ldb().customers) {
    if (c.programId !== program.id) continue;
    const phone = c.memberId ? (memberOf(c)?.phone ?? "") : (normalisePhone(c.phone ?? "")?.e164 ?? "");
    if (!phone) continue;
    if (full ? phone !== full : !phone.endsWith(digits)) continue;
    hits.push({ customer: c, phone });
  }
  hits.sort((a, b) => String(b.customer.lastVisitAt).localeCompare(String(a.customer.lastVisitAt)));
  return hits.slice(0, Math.max(1, limit));
}

/** A search result for the staff screen: first name, masked number, and the balances to pick from. */
export function staffMatch(customer, program, phone) {
  const first = String(customer.name ?? "").trim().split(/\s+/)[0] ?? "";
  return { ...staffCustomer(customer, program), name: first, phone: maskPhone(phone) };
}

/** `phone` is what was typed (old cards) or the member's number; `phoneE164` is the canonical form
 *  for a dialler, an export or a match. They differ only for cards that predate the phone join. */
export function customerRow(c) {
  const phoneE164 = c.memberId ? (memberOf(c)?.phone ?? "") : (normalisePhone(c.phone ?? "")?.e164 ?? "");
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, phoneE164, stamps: c.stamps, points: c.points, lifetimePoints: c.lifetimePoints, tier: c.tier, visits: c.visits, lastVisitAt: c.lastVisitAt, createdAt: c.createdAt, walletDevices: ldb().devices.filter((d) => d.serial === c.id).length };
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
