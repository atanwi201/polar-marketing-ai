// Types and fetch helpers for expenses (owner scope: /api/studio/expenses/..., see server/expenses-routes.mjs).
import { call, readToken, type Result } from "./studio-api";

export type Currency = "EUR" | "USD" | "GBP";
export interface ELocation { id: string; name: string }
export interface EConfig { enabled: boolean; currency: Currency; locations: ELocation[]; categories: string[] }
export interface EItem { name: string; qty: number; priceCents: number }
export interface Expense {
  id: string; locationId: string; date: string; store: string; category: string; items: EItem[];
  totalCents: number; taxCents: number | null; notes: string; source: string; hasPhoto?: boolean;
  createdAt?: string; updatedAt?: string;
}
export interface ESummary {
  totalCents: number; count: number;
  byCategory: { category: string; totalCents: number }[];
  byLocation: { locationId: string; name: string; totalCents: number }[];
}
export interface ExpensesData { config: EConfig; expenses: Expense[]; summary: ESummary; months: string[]; month?: string; locationId?: string }
/** Body for POST/PATCH /items (amounts in major units). */
export interface ExpenseInput { date: string; store: string; locationId: string; category: string; items?: { name: string; qty: number; price: number }[]; total: number | string; tax?: number | string | null; notes: string }

/** The answer to a question about the expenses. The model reads the question; the server does the maths. */
export interface EAsk {
  answer: string; totalCents: number; count: number; period: string; byProduct: boolean;
  matches: { id: string; date: string; store: string; totalCents: number; hasPhoto: boolean }[];
}

/** Owner scope call: everything lives under /api/studio/expenses. */
export const ecall = <T,>(method: string, path: string, body?: unknown): Promise<Result<T>> => call<T>(method, "/expenses" + path, body);

/** Ask a question about this business's expenses. */
export const askExpenses = (clientId: string, question: string, history: { q: string; a: string }[] = []) =>
  ecall<EAsk>("POST", `/ask?clientId=${encodeURIComponent(clientId)}`, { question, history });

/** The receipt photo. The admin token cannot travel in a link, so it is fetched and shown as a blob. */
export async function receiptBlob(clientId: string, expenseId: string): Promise<string> {
  const headers: Record<string, string> = {};
  const tok = readToken();
  if (tok) headers["x-admin-token"] = tok;
  const r = await fetch(`/api/studio/expenses/photo/${encodeURIComponent(expenseId)}?clientId=${encodeURIComponent(clientId)}`, { headers });
  if (!r.ok) return "";
  return URL.createObjectURL(await r.blob());
}

export const eerr = (r: Exclude<Result<unknown>, { kind: "ok" }>) =>
  r.kind === "error" ? r.message : r.kind === "auth" ? "Please sign in again." : "The server is not reachable. Check it is running and try again.";

export const fmtMoney = (cents: number, currency: string) => {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100); } catch { return (cents / 100).toFixed(2) + " " + currency; }
};

/** Authenticated file download (the admin token travels in a header, so a plain link would not work). */
export async function downloadExpenses(clientId: string, format: "ods" | "csv", month: string, locationId: string, filename: string) {
  const headers: Record<string, string> = {};
  const tok = readToken();
  if (tok) headers["x-admin-token"] = tok;
  const qs = new URLSearchParams({ clientId, format, lang: "en" });
  if (month) qs.set("month", month);
  if (locationId) qs.set("locationId", locationId);
  const r = await fetch("/api/studio/expenses/export?" + qs.toString(), { headers });
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url; a.download = `${filename}.${format}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
