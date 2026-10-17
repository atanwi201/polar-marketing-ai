import type { PlanId, Lang } from "./types";

export const IGIC = 0.07;

export interface Tier { name: string; price: number; detail: string }
export interface Plan {
  id: PlanId;
  name: string;
  route: string;
  who: string;
  tiers: Tier[];
  setup?: number;
  priority: "start" | "next" | "later" | "year 2" | "skip for now";
}

export const PLANS: Plan[] = [
  { id: "p1", name: "Maps & Reviews", route: "reviews", priority: "start",
    who: "Restaurants, bars, tour operators",
    tiers: [
      { name: "Basic", price: 99, detail: "Profile clean-up, 4 posts, reply to every review in the reviewer's language" },
      { name: "Plus", price: 169, detail: "8 posts, review-request QR and WhatsApp link, monthly report" },
      { name: "Pro", price: 249, detail: "2 locations or 12 posts, menus and offers in 4 languages, quarterly photo refresh" },
    ] },
  { id: "p8", name: "AI Visibility", route: "visibility", priority: "start",
    who: "Restaurants, hotels, activities",
    tiers: [
      { name: "One-off check", price: 0, detail: "€49 once: does ChatGPT recommend you?" },
      { name: "Add-on", price: 39, detail: "Monthly tracking added to Maps & Reviews" },
      { name: "Check", price: 49, detail: "15 questions, 2 languages, 3 competitors" },
      { name: "Grow", price: 99, detail: "30 questions, 4 languages, monthly fix pack" },
      { name: "Pro", price: 149, detail: "50 questions, 5 languages, weekly tracking" },
    ] },
  { id: "p6", name: "WhatsApp Receptionist", route: "receptionist", priority: "next", setup: 290,
    who: "Tour, excursion, dive and surf operators",
    tiers: [
      { name: "Starter", price: 149, detail: "WhatsApp + web form, 3 languages, FAQ and lead capture" },
      { name: "Pro", price: 249, detail: "Adds Instagram and Google, 6 languages, live booking and reminders" },
      { name: "Multi", price: 349, detail: "Several boats or locations, review requests, weekly report" },
    ] },
  { id: "p4", name: "Listing Kits", route: "listings", priority: "next",
    who: "Estate agents, holiday-rental managers",
    tiers: [
      { name: "Rental", price: 79, detail: "Up to 3 rental listings in 5 languages, 4 social posts" },
      { name: "Agent", price: 149, detail: "8 property kits a month, 1 reel and 2 posts each" },
      { name: "Agency", price: 299, detail: "25 kits a month, branded templates, portal limits" },
    ] },
  { id: "p10", name: "Retention Flows", route: "retention", priority: "later",
    who: "Restaurants, gyms, salons, online stores",
    tiers: [
      { name: "Local Basic", price: 150, detail: "Monthly campaign, birthday and win-back flows" },
      { name: "Local Plus", price: 300, detail: "Weekly campaigns, review requests, reminders, QR opt-in" },
      { name: "Store Pro", price: 600, detail: "Cart, post-purchase, win-back and VIP flows" },
    ] },
  { id: "p2", name: "Video Ads", route: "video", priority: "later",
    who: "Excursion, dive, surf businesses and Canarian brands",
    tiers: [
      { name: "Starter", price: 199, detail: "4 videos in 2 languages" },
      { name: "Growth", price: 399, detail: "8 videos in 4 languages + monthly shoot" },
      { name: "Pro", price: 599, detail: "12 videos, Meta ad variants and testing" },
    ] },
  { id: "p3", name: "Activity Pages", route: "pages", priority: "later",
    who: "Excursion operators, dive and surf schools",
    tiers: [
      { name: "Starter", price: 99, detail: "30 pages, 3 languages, booking button" },
      { name: "Growth", price: 199, detail: "80 pages, 5 languages, monthly refresh" },
      { name: "Pro", price: 349, detail: "150+ pages, 7 languages, ranking report" },
    ] },
  { id: "p7", name: "Clip Engine", route: "clips", priority: "later",
    who: "Creators, coaches, consultants, event organisers",
    tiers: [
      { name: "Starter", price: 200, detail: "1 episode a week, 8 clips" },
      { name: "Growth", price: 380, detail: "2 episodes a week, 16 clips, posts, newsletter" },
      { name: "Pro", price: 600, detail: "3 episodes a week, 2 to 4 languages, thumbnails" },
    ] },
  { id: "p5", name: "Agency Social", route: "social", priority: "year 2",
    who: "Agencies and freelancers (white-label)",
    tiers: [
      { name: "Base", price: 250, detail: "12 posts, ES + EN captions" },
      { name: "Standard", price: 400, detail: "20 posts, 4 reels, 3 languages" },
      { name: "Premium", price: 600, detail: "30 posts, 8 reels, 5 languages" },
    ] },
  { id: "p9", name: "Makers Online", route: "makers", priority: "skip for now",
    who: "Canarian food, cosmetic and craft makers",
    tiers: [
      { name: "Starter", price: 150, detail: "One channel, listing upkeep, monthly report" },
      { name: "Growth", price: 300, detail: "Two channels, ads, review requests" },
      { name: "Pro", price: 500, detail: "Adds customs-agent coordination" },
    ] },
];

export const planById = (id: PlanId) => PLANS.find((p) => p.id === id)!;

export const LANGS: Record<Lang, string> = {
  es: "Spanish", en: "English", de: "German", it: "Italian", nl: "Dutch", sv: "Swedish", fr: "French",
};

export const TOWNS = [
  "Los Cristianos", "Costa Adeje", "Playa de las Américas", "Puerto de la Cruz", "La Laguna",
  "Santa Cruz", "Los Gigantes", "El Médano", "La Orotava", "Tacoronte", "Icod de los Vinos", "Güímar",
];

export const eur = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
