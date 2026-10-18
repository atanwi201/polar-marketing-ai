// Types and fetch helper for reservations (owner scope: /api/studio/bookings/..., see server/bookings-routes.mjs).
import { call, type Result } from "./studio-api";

export type BKind = "table" | "room";
export type BStatus = "pending" | "confirmed" | "cancelled" | "no_show" | "completed";
export type BLang = "es" | "en";

export interface WeekDay { day: number; ranges: [string, string][] }
export interface TableCfg { week: WeekDay[]; seats: number; slotMinutes: number; durationMinutes: number; minParty: number; maxParty: number; minNoticeMinutes: number }
export interface RoomType { id: string; name: string; count: number; maxGuests: number; priceEur: number; description: string }
export interface RoomCfg { roomTypes: RoomType[]; minNights: number; maxNights: number; checkIn: string; checkOut: string }
export interface BStats { total: number; pending: number; upcoming: number; today: number; noShows: number; cancelled: number }
export interface BConfig {
  clientId: string; kind: BKind; enabled: boolean; code: string; timezone: string; langs: BLang[]; autoConfirm: boolean; advanceDays: number;
  notice: string; closedDates: string[]; table: TableCfg; room: RoomCfg; bookingUrl: string; clientName: string; stats: BStats;
}
export interface Booking {
  id: string; clientId: string; kind: BKind; status: BStatus; name: string; email: string; phone: string; lang: string; notes: string; source: string;
  createdAt: string; updatedAt: string; date?: string; time?: string; party?: number;
  checkIn?: string; checkOut?: string; guests?: number; roomName?: string; nights?: number; roomTypeId?: string;
}
export interface BookingsData { config: BConfig; bookings: Booking[] }

/** Owner scope call: everything lives under /api/studio/bookings. */
export const bcall = <T,>(method: string, path: string, body?: unknown): Promise<Result<T>> => call<T>(method, "/bookings" + path, body);

export const berr = (r: Exclude<Result<unknown>, { kind: "ok" }>) =>
  r.kind === "error" ? r.message : r.kind === "auth" ? "Please sign in again." : "The server is not reachable. Check it is running and try again.";

/** Owner status moves, mirrors OWNER_MOVES in server/bookings.mjs (the server stays the judge). */
export const MOVES: Record<BStatus, BStatus[]> = { pending: ["confirmed", "cancelled"], confirmed: ["cancelled", "no_show"], no_show: ["confirmed"], completed: [], cancelled: ["confirmed"] };
