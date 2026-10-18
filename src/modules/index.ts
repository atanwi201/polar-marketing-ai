import "./polar-modules.css";
import type { ComponentType } from "react";
import type { PlanId } from "../core/types";
import Dashboard from "../screens/dashboard";
import Clients from "../screens/clients";
import Visits from "../screens/visits";
import Billing from "../screens/billing";
import Reports from "../screens/reports";
import Settings from "../screens/settings";
import Studio from "../screens/studio";
import Plans from "../screens/plans";
import Business from "../screens/business";
import Loyalty from "../screens/loyalty";
import * as reviews from "./reviews";
import * as visibility from "./visibility";
import * as receptionist from "./receptionist";
import * as listings from "./listings";
import * as retention from "./retention";
import * as video from "./video";
import * as pages from "./pages";
import * as clips from "./clips";
import * as social from "./social";
import * as makers from "./makers";

export interface Route { id: string; label: string; Screen: ComponentType; plan?: PlanId; group: "business" | "core" | "more"; hidden?: boolean; navAs?: string }

/** The extra tools (the older one-service-per-screen offer) are hidden unless switched on in Settings. */
export const isExtraTool = (r: Route) => r.group !== "business";

export const ROUTES: Route[] = [
  { id: "dashboard", label: "Today", Screen: Dashboard, group: "business" },
  { id: "clients", label: "Businesses", Screen: Clients, group: "business" },
  { id: "business", label: "Business", Screen: Business, group: "business", hidden: true, navAs: "clients" },
  { id: "loyalty", label: "Loyalty cards", Screen: Loyalty, group: "business" },
  { id: "studio", label: "All posts & videos", Screen: Studio, group: "business" },
  { id: "plans", label: "Plans & prices", Screen: Plans, group: "business" },
  { id: "billing", label: "Billing", Screen: Billing, group: "business" },
  { id: "visits", label: "Visits & follow-ups", Screen: Visits, group: "business" },
  { id: "reports", label: "Client reports", Screen: Reports, group: "business" },
  { id: "settings", label: "Settings", Screen: Settings, group: "business" },
  { id: "reviews", label: "Maps & Reviews", Screen: reviews.default, plan: "p1", group: "core" },
  { id: "visibility", label: "AI Visibility", Screen: visibility.default, plan: "p8", group: "core" },
  { id: "receptionist", label: "WhatsApp Receptionist", Screen: receptionist.default, plan: "p6", group: "core" },
  { id: "listings", label: "Listing Kits", Screen: listings.default, plan: "p4", group: "core" },
  { id: "retention", label: "Retention Flows", Screen: retention.default, plan: "p10", group: "more" },
  { id: "video", label: "Video Ads", Screen: video.default, plan: "p2", group: "more" },
  { id: "pages", label: "Activity Pages", Screen: pages.default, plan: "p3", group: "more" },
  { id: "clips", label: "Clip Engine", Screen: clips.default, plan: "p7", group: "more" },
  { id: "social", label: "Agency Social", Screen: social.default, plan: "p5", group: "more" },
  { id: "makers", label: "Makers Online", Screen: makers.default, plan: "p9", group: "more" },
];

export const MODULE_SEEDS = [reviews, visibility, receptionist, listings, retention, video, pages, clips, social, makers].map((m) => m.seed);
