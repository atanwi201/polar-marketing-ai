// Shared helpers for the receptionist screens: collections, tier rules and booking creation.
import { put, create, today, now } from "../core/store";
import type { Client, Task, Lang } from "../core/types";
import {
  type Bot, type Booking, type Block, type Chat, type QState, type ChannelId, type Handoff,
  slotInfo, bookingTotal, bookingCode, scheduleReminders,
} from "./receptionist-engine";

export const COL = {
  bots: "receptionist_bots",
  bookings: "receptionist_bookings",
  blocks: "receptionist_blocks",
  chats: "receptionist_chats",
  handoffs: "receptionist_handoffs",
  audits: "receptionist_audits",
  reports: "receptionist_reports",
} as const;

export type Tier = "Starter" | "Pro" | "Multi";
export const tierOf = (c?: Client): Tier => (c?.subs.find((s) => s.plan === "p6")?.tier as Tier) ?? "Starter";
export const LANG_LIMIT: Record<Tier, number> = { Starter: 3, Pro: 6, Multi: 7 };
export const channelAllowed = (tier: Tier, ch: ChannelId) => tier !== "Starter" || ch === "whatsapp" || ch === "web";
export const CHANNEL_LABEL: Record<ChannelId, string> = { whatsapp: "WhatsApp", instagram: "Instagram DMs", web: "Web form", google: "Google Business chat" };

export interface Audit {
  id: string;
  createdAt: string;
  example?: boolean;
  business: string;
  town: string;
  contact: string;
  phone: string;
  requested: boolean; // the prospect asked for the audit (LSSI: no unsolicited outreach)
  days: { day: string; enquiries: number; unanswered: number; avgMin: number }[];
  bookingValue: number;
  convFast: number; // % of enquiries that book when answered within 5 minutes
  text?: string;
  live?: boolean;
}

export interface WeekReport { id: string; createdAt: string; example?: boolean; clientId: string; weekEnd: string; text: string; live: boolean }

/** Book from a completed qualification state. Returns the booking or a reason it failed. */
export async function bookFromState(args: {
  bot: Bot; client: Client; chat: Chat; state: QState; lang: Lang; bookings: Booking[]; blocks: Block[];
}): Promise<Booking | string> {
  const { bot, client, chat, state, lang, bookings, blocks } = args;
  const trip = bot.trips.find((t) => t.id === state.tripId);
  if (!trip || !state.date || !state.time || state.adults == null) return "incomplete";
  const group = state.adults + (state.children ?? 0);
  const info = slotInfo(bot, bookings, blocks, trip.id, state.date, state.time);
  if (info.left < group) return "full";
  const zone = bot.zones.find((z) => z.name === state.zone);
  const code = bookingCode(client.name);
  return create<Booking>(COL.bookings, {
    clientId: client.id,
    tripId: trip.id,
    tripName: trip.name,
    date: state.date,
    time: state.time,
    adults: state.adults,
    children: state.children ?? 0,
    guestName: chat.guestName,
    guestPhone: chat.guestPhone,
    lang,
    hotel: state.hotel,
    zone: zone?.name,
    total: bookingTotal(trip, state.adults, state.children ?? 0, zone),
    status: "awaiting payment",
    code,
    paymentLink: `https://pay.example/isla/${code}`,
    channel: chat.channel,
    chatId: chat.id,
    reminders: scheduleReminders(bot, state.date, state.time),
  });
}

export async function openHandoff(args: { client: Client; chat: Chat; lang: Lang; reason: string; summary: string; live: boolean }) {
  const { client, chat, lang, reason, summary, live } = args;
  const task = await create<Task>("tasks", {
    title: `Reply to ${chat.guestName} (${lang.toUpperCase()}) for ${client.name}: ${reason}`,
    module: "receptionist",
    clientId: client.id,
    due: today(),
    done: false,
  });
  return create<Handoff>(COL.handoffs, {
    clientId: client.id, chatId: chat.id, guestName: chat.guestName, guestPhone: chat.guestPhone,
    lang, reason, summary, status: "open", taskId: task.id, live,
  });
}

export async function closeTask(taskId: string | undefined, tasks: Task[]) {
  const t = tasks.find((x) => x.id === taskId);
  if (t && !t.done) await put("tasks", { ...t, done: true });
}

export const stamp = () => now();
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
