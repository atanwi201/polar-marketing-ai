// What a business may use: new sign-ups wait for the owner's approval, and every business has a
// weekly limit of posts and videos (the owner's default, or a number set for that business). What the
// owner makes from the dashboard never counts and is never blocked.
import { db } from "./store.mjs";

const WEEK = 7 * 864e5;
export const DEFAULT_WEEKLY = 7; // autopilot makes one a day
const OWNER_REASONS = new Set(["owner"]);

/** "approved" (also every business from before approvals existed), "pending" or "declined". */
export const approval = (c) => c.approval?.status ?? "approved";
export const isApproved = (c) => approval(c) === "approved";

/** The weekly limit for this business: its own number, else the owner's default. */
export function weeklyCap(c) {
  if (Number.isInteger(c.postCap) && c.postCap >= 0) return c.postCap;
  const d = db.settings?.limits?.postsPerWeek;
  return Number.isInteger(d) && d >= 0 ? d : DEFAULT_WEEKLY;
}

/** Posts and videos made for this business in the last 7 days (not counting the owner's own). */
export function usedThisWeek(c, at = Date.now()) {
  const recent = (x) => x.clientId === c.id && !OWNER_REASONS.has(x.reason) && at - Date.parse(x.createdAt) < WEEK && x.status !== "failed";
  return db.posts.filter(recent).length + db.videos.filter(recent).length;
}

/** When the oldest counted item drops out of the 7 days (so one more can be made). */
export function nextFreeAt(c, at = Date.now()) {
  const items = [...db.posts, ...db.videos].filter((x) => x.clientId === c.id && !OWNER_REASONS.has(x.reason) && at - Date.parse(x.createdAt) < WEEK && x.status !== "failed");
  const oldest = items.map((x) => Date.parse(x.createdAt)).sort((a, b) => a - b)[0];
  return oldest ? new Date(oldest + WEEK).toISOString() : null;
}

export const usage = (c) => ({ used: usedThisWeek(c), cap: weeklyCap(c), custom: Number.isInteger(c.postCap), nextFreeAt: nextFreeAt(c) });

const say = (c, es, en) => ((c.languages?.[0] ?? "es") === "es" ? es : en);

/**
 * May this business get a new post or video right now? Returns null when yes, or an error
 * ({ status, code, error }) in the business's language.
 */
export function blockReason(c) {
  const a = approval(c);
  if (a === "pending") return { status: 403, code: "pending", error: say(c, "Tu cuenta está pendiente de aprobación. Te avisaremos en cuanto esté activa.", "Your account is waiting for approval. We'll let you know as soon as it's active.") };
  if (a === "declined") return { status: 403, code: "declined", error: say(c, "Tu cuenta no está activa. Escríbenos si crees que es un error.", "Your account isn't active. Write to us if you think this is a mistake.") };
  const cap = weeklyCap(c), used = usedThisWeek(c);
  if (used >= cap) {
    const when = nextFreeAt(c);
    const day = when ? new Date(when).toLocaleDateString(say(c, "es-ES", "en-GB"), { weekday: "long", day: "numeric", month: "long" }) : "";
    return { status: 429, code: "cap", error: say(c, `Ya has usado tus ${cap} publicaciones de esta semana.${day ? ` Podrás crear otra el ${day}.` : ""}`, `You've used your ${cap} posts for this week.${day ? ` You can make another on ${day}.` : ""}`) };
  }
  return null;
}
