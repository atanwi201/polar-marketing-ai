// Keeps Clients and the Content Studio in step. Businesses that sign up on the sign-up page (or are
// added in the studio) appear in Clients on a free trial, and the plan you pick in Clients sets how
// many posts and videos the studio makes for them.
import { useEffect, useState } from "react";
import { getAll, put, now, loadCollection } from "./store";
import { call, type StudioData, type SClient } from "../screens/studio-api";
import { mergeOffer, DEFAULT_OFFER, type Offer, type PaidPlanId } from "./offer";
import type { Client, Lang } from "./types";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

let inFlight: Promise<StudioData | null> | null = null;

/** Read the studio and add any studio client that Clients doesn't have yet. Null when the server isn't running. */
export function syncFromStudio(): Promise<StudioData | null> {
  // One sync at a time, so two screens can't add the same business twice.
  inFlight ??= doSync().finally(() => { inFlight = null; });
  return inFlight;
}

async function doSync(): Promise<StudioData | null> {
  const r = await call<StudioData>("GET", "");
  if (r.kind !== "ok") return null;
  await loadCollection("clients");
  const crm = getAll<Client>("clients");
  for (const s of r.data.clients) {
    if (!s.name || crm.some((c) => c.studioId === s.id)) continue;
    // Added by hand in both places: link them instead of making a duplicate.
    const same = crm.find((c) => !c.studioId && norm(c.name) === norm(s.name));
    if (same) { await put<Client>("clients", { ...same, studioId: s.id }); continue; }
    await put<Client>("clients", fromStudio(s));
  }
  await syncOffer(r.data.offer ?? null);
  return r.data;
}

// ---------- Prices on the public landing page ----------

type PublicOffer = NonNullable<StudioData["offer"]>;
/** The part of Plans & prices the landing page shows. */
export const publicOffer = (o: Offer): PublicOffer => ({
  trialDays: o.trialDays,
  plans: Object.fromEntries((["basic", "pro"] as PaidPlanId[]).map((id) => {
    const p = o.plans[id];
    return [id, { name: p.name, price: p.price, setup: p.setup, postsPerWeek: p.postsPerWeek, videosPerWeek: p.videosPerWeek }];
  })) as PublicOffer["plans"],
});

/** Send the prices to the server so the landing page shows them. */
export const publishOffer = (o: Offer) => call("POST", "/settings/offer", publicOffer(o));

/**
 * Keep this browser's Plans & prices and the landing page in step: prices saved here are sent to the
 * server; a browser that never saved any takes the server's copy (so it never pushes the defaults over it).
 */
async function syncOffer(server: PublicOffer | null) {
  await loadCollection("settings");
  const saved = getAll<Offer>("settings").find((s) => s.id === "offer");
  if (saved) {
    if (JSON.stringify(publicOffer(mergeOffer(saved))) !== JSON.stringify(server)) await publishOffer(mergeOffer(saved));
  } else if (server) {
    const d = DEFAULT_OFFER.plans;
    await put<Offer>("settings", mergeOffer({ trialDays: server.trialDays, plans: { basic: { ...d.basic, ...server.plans.basic }, pro: { ...d.pro, ...server.plans.pro } }, id: "offer", createdAt: now() }));
  }
}

function fromStudio(s: SClient): Client {
  const started = (s.createdAt || now()).slice(0, 10);
  const consent = s.marketingConsent && typeof s.marketingConsent === "object" ? s.marketingConsent : null;
  return {
    // Same id in every browser, so links to a business work anywhere.
    id: `s-${s.id}`, createdAt: s.createdAt || now(), name: s.name, kind: s.kind || "", town: s.town || "", contact: "", phone: s.phone || "",
    email: s.email || undefined, stage: s.plan ? "paid" : "pilot", plan: s.plan || "basic", customPrice: s.customPrice ?? undefined,
    trialStart: s.plan ? undefined : started, planSince: s.plan ? started : undefined, studioId: s.id,
    subs: [], consents: consent ? [{ channel: "email", date: consent.at.slice(0, 10), source: consent.source }] : [],
    languages: (s.languages?.length ? s.languages : ["es", "en"]) as Lang[],
    notes: s.offer || undefined,
  };
}

/** Send a client's plan to the studio: paid plan, custom price and the plan's posts and videos per week. */
export async function pushPlanToStudio(c: Client, offer: Offer) {
  if (!c.studioId) return;
  const p = c.plan ? offer.plans[c.plan] : null;
  const active = c.stage === "paid" || c.stage === "pilot";
  await call("POST", "/clients", {
    id: c.studioId,
    plan: c.stage === "paid" && c.plan ? c.plan : "",
    customPrice: c.stage === "paid" ? c.customPrice ?? null : null,
    autopilot: active,
    ...(p && active ? { postsPerWeek: p.postsPerWeek, videosPerWeek: p.videosPerWeek } : {}),
  });
}

/** Sync once when a screen opens (and every minute while it stays open); returns the studio data. */
export function useStudio(): StudioData | null {
  const [data, setData] = useState<StudioData | null>(null);
  useEffect(() => {
    let alive = true;
    const run = async () => { const d = await syncFromStudio(); if (alive) setData(d); };
    void run();
    const t = setInterval(run, 60e3);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return data;
}

export const useStudioSync = () => void useStudio();
