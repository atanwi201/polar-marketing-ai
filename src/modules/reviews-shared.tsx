// Small shared pieces for the Maps & Reviews screens.
import { getAll, put, create, now, today, useCollection } from "../core/store";
import { aiJson } from "../core/ai";
import { Badge, toast } from "../core/ui";
import { StarRow } from "./polar-icons";
import type { Client, Task } from "../core/types";
import { COL, defaultSettings, demoReply, replyPrompt, type ReplyDraft, type Review, type ReviewSettings, type ReviewStatus } from "./reviews-data";

export function Stars(props: { n: number }) {
  const tone = props.n >= 4 ? "good" : props.n === 3 ? "warn" : "bad";
  return <Badge tone={tone}><span aria-label={`${props.n} out of 5 stars`}><StarRow n={props.n} /></span></Badge>;
}

const STATUS: Record<ReviewStatus, { label: string; tone: "neutral" | "good" | "warn" | "bad" | "info" | "accent" }> = {
  new: { label: "Needs reply", tone: "info" },
  "auto-posted": { label: "Auto-posted", tone: "good" },
  "awaiting-owner": { label: "Waiting for owner", tone: "warn" },
  posted: { label: "Approved and posted", tone: "good" },
  rejected: { label: "Rejected", tone: "neutral" },
};
export function StatusBadge(props: { s: ReviewStatus }) {
  const s = STATUS[props.s];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function settingsFor(c: Client | undefined, all: ReviewSettings[]): ReviewSettings {
  const found = all.find((s) => s.clientId === c?.id);
  if (found) return found;
  return { id: "set-" + (c?.id ?? "none"), createdAt: now(), ...(c ? defaultSettings(c) : { clientId: "", voice: "", signoff: "", ownerWhatsapp: "", placeId: "", reviewUrl: "" }) };
}

export function useSettings() {
  return useCollection<ReviewSettings>(COL.settings);
}

/** Detect language, draft a reply, then route it: 4-5 stars auto-post, 1-3 stars go to the owner. */
export async function draftAndRoute(r: Review, c: Client | undefined, s: ReviewSettings): Promise<Review> {
  const res = await aiJson<ReplyDraft>(replyPrompt(r, c, s), () => demoReply(r, c, s), { tier: "quick" });
  const d = res.data;
  const base: Review = {
    ...r, lang: (d.lang || r.lang).toLowerCase().slice(0, 2), reply: d.reply, replyEs: d.replyEs,
    sentiment: d.sentiment, topics: d.topics, live: res.live,
  };
  if (r.rating >= 4) {
    const out = await put(COL.reviews, { ...base, status: "auto-posted" as const, postedAt: now() });
    toast("Auto-posted. Marked as posted (Google not connected yet).");
    return out;
  }
  const existing = r.taskId ? getAll<Task>("tasks").find((t) => t.id === r.taskId && !t.done) : undefined;
  const task = existing ?? await create<Task>("tasks", {
    title: `Owner approval: reply to ${r.rating}-star review from ${r.reviewer}${c ? ` (${c.name})` : ""}`,
    module: "reviews", clientId: r.clientId, due: today(), done: false,
  });
  const out = await put(COL.reviews, { ...base, status: "awaiting-owner" as const, taskId: task.id, sentToOwnerAt: now() });
  toast("Sent to owner on WhatsApp for approval (simulated, WhatsApp not connected yet).");
  return out;
}

export async function closeTask(id?: string) {
  if (!id) return;
  const t = getAll<Task>("tasks").find((x) => x.id === id);
  if (t && !t.done) await put("tasks", { ...t, done: true });
}
