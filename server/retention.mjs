// Erasure of a whole client and an opt-in retention purge. Nothing here is scheduled by default.
import { rm, unlink, appendFile, chmod } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { db, save, now, MEDIA_DIR, DATA_DIR } from "./store.mjs";
import * as bookings from "./bookings.mjs";
import * as expenses from "./expenses.mjs";
import * as menuData from "./menu.mjs";
import * as loyalty from "./loyalty.mjs";

const SAFE_FILE = /^[\w][\w.-]{0,160}$/;
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** Every media-file name mentioned anywhere inside `obj` (keys ending in file/cover/image, and {file} entries). */
function collectFiles(obj, out = new Set(), key = "") {
  if (typeof obj === "string") {
    if (/(file|cover|image)$/i.test(key) && SAFE_FILE.test(obj)) out.add(obj);
  } else if (Array.isArray(obj)) for (const v of obj) collectFiles(v, out, key);
  else if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) collectFiles(v, out, k);
  return out;
}

/** Remove `<root>/<name>` only when it resolves strictly inside root. */
async function rmInside(root, name) {
  const base = resolve(root), target = resolve(base, name);
  if (!target.startsWith(base + sep)) return false;
  await rm(target, { recursive: true, force: true });
  return true;
}

/**
 * Erase a client and everything that belongs to it: loyalty (programmes, staff tokens, customers, transactions,
 * Apple Wallet registrations and push tokens), bookings, menu, expenses, briefs, posts, videos, messages,
 * media files it owns (unless another record still uses them), sites/<slug> and data/site-src/<slug>.
 * Appends one audit line without personal data. Returns the counts.
 */
export async function eraseClient(clientId, { sitesDir = process.env.SITES_DIR, dataDir = DATA_DIR, videoFiles = () => [], audit = true } = {}) {
  const client = db.clients.find((c) => c.id === clientId);
  const mine = (x) => x.clientId === clientId;
  const files = collectFiles({ client, posts: db.posts.filter(mine), briefs: db.briefs.filter(mine), messages: db.messages.filter(mine) });
  for (const v of db.videos.filter(mine)) for (const f of videoFiles(v)) if (f) files.add(f);
  for (const m of db.messages.filter(mine)) for (const a of m.attachments ?? []) if (a.file) files.add(`${a.file}.frame.jpg`);
  const slug = client?.siteSlug;
  const counts = { posts: db.posts.filter(mine).length, briefs: db.briefs.filter(mine).length, videos: db.videos.filter(mine).length, messages: db.messages.filter(mine).length };

  db.clients = db.clients.filter((x) => x.id !== clientId);
  db.briefs = db.briefs.filter((x) => !mine(x));
  db.posts = db.posts.filter((x) => !mine(x));
  db.videos = db.videos.filter((x) => !mine(x));
  db.messages = db.messages.filter((x) => !mine(x));
  const b = bookings.bdb(), e = expenses.edb();
  counts.bookings = b.items.filter(mine).length;
  counts.expenses = e.items.filter(mine).length;
  bookings.removeClientData(clientId);
  await expenses.removeClientData(clientId);
  await menuData.removeClientData(clientId);
  Object.assign(counts, { loyalty: await loyalty.removeClientData(clientId) });

  const remaining = JSON.stringify(db);
  let removedFiles = 0;
  for (const f of files) {
    if (remaining.includes(JSON.stringify(f))) continue; // another record still uses it
    if (await rmInside(MEDIA_DIR, f).catch(() => false)) removedFiles++;
  }
  counts.mediaFiles = removedFiles;

  if (slug && SAFE_SLUG.test(slug) && !db.clients.some((c) => c.siteSlug === slug)) {
    if (sitesDir) for (const n of [slug, `.${slug}.building`, `.${slug}.previous`, `.${slug}.uploading`]) await rmInside(sitesDir, n).catch(() => {});
    await rmInside(join(dataDir, "site-src"), slug).catch(() => {});
    counts.site = true;
  }
  await save();
  if (audit) {
    const file = join(dataDir, "erasure-audit.log");
    await appendFile(file, JSON.stringify({ at: now(), event: "client_erased", clientId, counts }) + "\n", { mode: 0o600 }).catch(() => {});
    await chmod(file, 0o600).catch(() => {});
  }
  return counts;
}

/** Retention settings from env; every value is days and 0 / unset means off. */
export const retentionFromEnv = (env = process.env) => ({
  declinedDays: Number(env.RETENTION_DECLINED_DAYS) || 0,
  bookingDays: Number(env.RETENTION_BOOKING_DAYS) || 0,
  loyaltyInactiveDays: Number(env.RETENTION_LOYALTY_INACTIVE_DAYS) || 0,
});

/**
 * Purge old data. All limits default to 0 (off). declinedDays: erase clients declined longer ago than that;
 * bookingDays: delete bookings whose last day is older; loyaltyInactiveDays: delete customers (and their
 * transactions and wallet registrations) with no activity for that long. `dryRun` only counts.
 */
export async function purgeExpired({ declinedDays = 0, bookingDays = 0, loyaltyInactiveDays = 0, at = Date.now(), dryRun = false, sitesDir, dataDir } = {}) {
  const cut = (d) => at - d * 864e5;
  const out = { clients: 0, bookings: 0, loyaltyCustomers: 0 };
  if (declinedDays > 0) {
    const old = db.clients.filter((c) => c.approval?.status === "declined" && Date.parse(c.approval.at) < cut(declinedDays));
    out.clients = old.length;
    if (!dryRun) for (const c of old) await eraseClient(c.id, { sitesDir, dataDir });
  }
  if (bookingDays > 0) {
    const b = bookings.bdb();
    const old = b.items.filter((x) => Date.parse(`${x.checkOut || x.date}T00:00:00Z`) < cut(bookingDays));
    out.bookings = old.length;
    if (!dryRun && old.length) { const gone = new Set(old); b.items = b.items.filter((x) => !gone.has(x)); }
  }
  if (loyaltyInactiveDays > 0) {
    const l = loyalty.ldb();
    const old = l.customers.filter((c) => Date.parse(c.lastVisitAt || c.updatedAt || c.createdAt) < cut(loyaltyInactiveDays));
    out.loyaltyCustomers = old.length;
    if (!dryRun && old.length) {
      const ids = new Set(old.map((c) => c.id));
      l.customers = l.customers.filter((c) => !ids.has(c.id));
      l.txns = l.txns.filter((t) => !ids.has(t.customerId));
      l.devices = l.devices.filter((d) => !ids.has(d.serial));
    }
  }
  if (!dryRun && (out.bookings || out.loyaltyCustomers)) await save();
  return out;
}
