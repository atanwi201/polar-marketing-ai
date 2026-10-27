// Types and fetch helpers for the loyalty cards (owner scope: /api/studio/loyalty/..., see server/loyalty-routes.mjs).
import { call, mediaUrl, readToken, type Result } from "./studio-api";

export type LType = "stamps" | "points" | "custom";
export type LStatus = "draft" | "live" | "paused";
export type FontStyle = "modern" | "serif" | "rounded" | "mono";
export type Layout = "stripe" | "minimal" | "full";

export interface Design {
  prompt: string; background: string; foreground: string; label: string; accent: string; fontStyle: FontStyle; layout: Layout;
  cardTitle: string; tagline: string; stampIcon: string; stampEmptyIcon: string; logoFile: string; stripFile: string; backgroundFile: string;
  generatedBy?: { model: string; at: string };
}
export interface Reward { id: string; name: string; description: string; kind: "stamps" | "points"; cost: number; expiresDays: number | null; minTier: string; active: boolean }
export interface Tier { name: string; minPoints: number; perk: string }
export interface Stats { customers: number; activeLast30d: number; stampsGiven: number; pointsGiven: number; rewardsRedeemed: number; visits: number }
export interface Program {
  id: string; clientId: string; name: string; type: LType; status: LStatus; createdAt: string; updatedAt: string; joinCode: string; staffToken: string;
  design: Design; stamps: { goal: number; perVisit: number; minSpendEur: number }; points: { perEuro: number; perVisit: number };
  tiers: Tier[]; rewards: Reward[]; pointsExpireDays: number | null; terms: string; welcomeBonus: { stamps: number; points: number }; consentBonus: number;
}
export interface ProgramView extends Program { joinUrl: string; staffUrl: string; stats: Stats; clientName: string }
export interface CustomerRow {
  id: string; name: string; email: string; phone: string; phoneE164?: string; stamps: number; points: number; lifetimePoints: number; tier: string; visits: number;
  lastVisitAt?: string; createdAt: string; walletDevices: number;
}
export interface Txn {
  id: string; programId?: string; customerId?: string; clientId?: string; at: string; type: "join" | "visit" | "purchase" | "redeem" | "adjust";
  stamps: number; points: number; amountEur: number; note: string; by: string; rewardId?: string;
}
export interface Template { id: string; clientId: string; name: string; design: Design; createdAt: string }
export interface WalletStatus { configured: boolean; missing: string[]; passTypeId: string; pushReady: boolean; publicUrlHttps: boolean; google?: { configured: boolean; missing: string[] } }
export interface LoyaltyList { programs: ProgramView[]; templates: Template[]; wallet: WalletStatus; publicUrl: string; baseUrl: string; clients?: { id: string; name: string }[] }
export interface ProgramDetail extends ProgramView { customers: CustomerRow[]; txns: Txn[] }
export interface CustomerDetail extends CustomerRow { txns: Txn[]; redemptions?: { rewardId: string; name: string; at: string; code: string }[]; marketingConsent?: boolean }

/** Owner scope call: everything lives under /api/studio/loyalty. */
export const lcall = <T,>(method: string, path: string, body?: unknown): Promise<Result<T>> => call<T>(method, "/loyalty" + path, body);

export const errText = (r: Exclude<Result<unknown>, { kind: "ok" }>) =>
  r.kind === "error" ? r.message : r.kind === "auth" ? "Please sign in again." : "The server is not reachable. Check it is running and try again.";

/** A design image: an uploaded data URL (not saved yet) or a file in /media. */
export const designImg = (v: string) => (!v ? "" : v.startsWith("data:") ? v : mediaUrl(v));

/** Read an image, scaled down. PNG stays PNG (keeps a logo's transparency). */
export function readImage(file: File, max = 1400): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Could not read the file"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not a usable image"));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        const ctx = cv.getContext("2d");
        if (!ctx) return reject(new Error("Canvas is not available"));
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(file.type === "image/png" ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.88));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

/** Fetch an owner-scope binary (the QR PNG) as an object URL. */
export async function fetchBlobUrl(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const tok = readToken();
  if (tok) headers["x-admin-token"] = tok;
  const r = await fetch("/api/studio/loyalty" + path, { headers });
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  return URL.createObjectURL(await r.blob());
}

export async function downloadBlob(path: string, filename: string) {
  const url = await fetchBlobUrl(path);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "loyalty";

export const TYPE_INFO: Record<LType, { label: string; blurb: string }> = {
  stamps: { label: "Stamp card", blurb: "Buy 8, get the 9th free. Each visit adds a stamp; when the card is full they earn a reward. Easiest for cafes, barbers and bakeries." },
  points: { label: "Points", blurb: "Customers earn points for every euro spent and swap them for rewards. Good when baskets vary, like shops and restaurants." },
  custom: { label: "Custom", blurb: "Mix stamps and points, add member tiers like Silver and Gold with perks, and set welcome bonuses. For businesses who want more control." },
};

export const FONT_STACK: Record<FontStyle, string> = {
  modern: `"Figtree", system-ui, -apple-system, "Segoe UI", sans-serif`,
  serif: `"Iowan Old Style", "Palatino Linotype", Georgia, serif`,
  rounded: `ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif`,
  mono: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
};

export const fmtWhen = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never";
