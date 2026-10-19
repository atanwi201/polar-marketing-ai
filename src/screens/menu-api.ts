// Types and fetch helpers for the digital menu (owner scope: /api/studio/menu..., see server/menu-routes.mjs).
import { call, type Result } from "./studio-api";

export type MenuLang = "es" | "en" | "de" | "fr";
export type TextMap = Partial<Record<MenuLang, string>>;
export interface MenuItem { id: string; name: TextMap; description: TextMap; priceCents: number | null; allergens: string[]; photo: string; available: boolean }
export interface MenuCategory { id: string; name: TextMap; items: MenuItem[] }
export interface MenuConfig { enabled: boolean; code?: string; url?: string; languages?: MenuLang[]; currency?: string; allergens?: string[] }
export interface MenuData { config: MenuConfig; categories: MenuCategory[] }

export const MENU_LANGS: { id: MenuLang; label: string }[] = [
  { id: "es", label: "Spanish" }, { id: "en", label: "English" }, { id: "de", label: "German" }, { id: "fr", label: "French" },
];

/** Owner scope call: everything lives under /api/studio/menu. */
export const mcall = <T,>(method: string, path: string, body?: unknown): Promise<Result<T>> => call<T>(method, "/menu" + path, body);

export const merr = (r: Exclude<Result<unknown>, { kind: "ok" }>) =>
  r.kind === "error" ? r.message : r.kind === "auth" ? "Please sign in again." : "The server is not reachable. Check it is running and try again.";
