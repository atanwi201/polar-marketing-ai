// Google Wallet loyalty cards: a class per programme, an object per customer, a signed "Save to Google Wallet" link,
// and PATCH updates after every card change. Issuer ID and service account come from .env (see .env.example).
import { createSign } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { ldb } from "./loyalty.mjs";

const API = "https://walletobjects.googleapis.com/walletobjects/v1";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const b64u = (x) => Buffer.from(x).toString("base64url");

/** The service account JSON from GOOGLE_WALLET_SERVICE_ACCOUNT_JSON (raw or base64) or _PATH. Returns {client_email, private_key} or null. */
export function serviceAccount(env = process.env) {
  let raw = env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON?.trim() ?? "";
  if (raw && !raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
  const path = env.GOOGLE_WALLET_SERVICE_ACCOUNT_PATH;
  if (!raw && path && existsSync(path)) raw = readFileSync(path, "utf8");
  try {
    const j = JSON.parse(raw);
    return j?.client_email && j?.private_key ? { client_email: j.client_email, private_key: j.private_key } : null;
  } catch { return null; }
}

export function googleStatus(env = process.env) {
  const missing = [];
  if (!env.GOOGLE_WALLET_ISSUER_ID) missing.push("GOOGLE_WALLET_ISSUER_ID");
  if (!serviceAccount(env)) missing.push("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON");
  const publicUrlHttps = /^https:\/\//i.test(env.PUBLIC_URL ?? "");
  if (!publicUrlHttps) missing.push("PUBLIC_URL");
  return { configured: missing.length === 0, missing, issuerId: env.GOOGLE_WALLET_ISSUER_ID ?? "" };
}

export function signJwt(claims, privateKey) {
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey, "base64url");
  return `${head}.${body}.${sig}`;
}

const safeId = (s) => String(s).replace(/[^\w.-]/g, "_");
export const classId = (issuer, program) => `${issuer}.lc_${safeId(program.id)}`;
export const objectId = (issuer, customer) => `${issuer}.lc_${safeId(customer.id)}`;
const hexOr = (h, d) => (/^#[0-9a-f]{6}$/i.test(h ?? "") ? h : d);
const img = (base, file) => (file ? { sourceUri: { uri: `${base}/media/${basename(file)}` } } : null);

export function buildClass({ program, client, base, issuer }) {
  const d = program.design ?? {};
  const logo = d.logoFile ? img(base, d.logoFile) : { sourceUri: { uri: `${base}/loyalty/logo/${safeId(program.id)}.png` } };
  const hero = d.layout !== "minimal" ? img(base, d.stripFile) : null;
  return {
    id: classId(issuer, program),
    issuerName: (client?.name || program.name).slice(0, 40),
    programName: (d.cardTitle || program.name).slice(0, 40),
    programLogo: logo,
    hexBackgroundColor: hexOr(d.background, "#14232b"),
    ...(hero ? { heroImage: hero } : {}),
    reviewStatus: "UNDER_REVIEW",
    countryCode: "ES",
    multipleDevicesAndHoldersAllowedStatus: "ONE_USER_ALL_DEVICES",
  };
}

const nextReward = (program, customer) => {
  const r = (program.rewards ?? []).filter((x) => x.active !== false).sort((a, b) => a.cost - b.cost)
    .find((x) => (x.kind === "stamps" ? customer.stamps : customer.points) < x.cost) ?? null;
  if (!r) return "Reward ready to claim";
  const have = r.kind === "stamps" ? customer.stamps : customer.points;
  return `${r.name}: ${r.cost - have} more ${r.kind}`;
};

export function buildObject({ program, customer, base, issuer }) {
  const stamps = program.type !== "points";
  const o = {
    id: objectId(issuer, customer),
    classId: classId(issuer, program),
    state: "ACTIVE",
    accountId: customer.id,
    accountName: customer.name || "Member",
    barcode: { type: "QR_CODE", value: `LC1-${customer.id}`, alternateText: `LC1-${customer.id}` },
    loyaltyPoints: stamps
      ? { label: "Stamps", balance: { string: `${customer.stamps} / ${program.stamps?.goal ?? 8}` } }
      : { label: "Points", balance: { int: Math.max(0, Math.round(customer.points)) } },
    textModulesData: [{ id: "next", header: "Next reward", body: nextReward(program, customer) }],
    linksModuleData: { uris: [{ uri: `${base}/card/${customer.cardToken}`, description: "Open your web card" }] },
  };
  if (program.type === "custom") o.secondaryLoyaltyPoints = { label: customer.tier || "Tier", balance: { int: Math.max(0, Math.round(customer.points)) } };
  return o;
}

/** The "Save to Google Wallet" link: class and object travel inside the signed token, so nothing needs creating first. */
export function saveUrl({ program, customer, client, baseUrl, env = process.env, now = Date.now() }) {
  const st = googleStatus(env);
  if (!st.configured) throw Object.assign(new Error("Google Wallet is not set up yet. Use the web card."), { status: 404 });
  const sa = serviceAccount(env);
  const base = (baseUrl || env.PUBLIC_URL).replace(/\/$/, "");
  const claims = {
    iss: sa.client_email, aud: "google", typ: "savetowallet", iat: Math.floor(now / 1000), origins: [base],
    payload: { loyaltyClasses: [buildClass({ program, client, base, issuer: st.issuerId })], loyaltyObjects: [buildObject({ program, customer, base, issuer: st.issuerId })] },
  };
  return `https://pay.google.com/gp/v/save/${signJwt(claims, sa.private_key)}`;
}

let tokenCache = { value: "", exp: 0 };
async function accessToken(sa, fetchImpl, now) {
  if (tokenCache.value && tokenCache.exp > now + 60e3) return tokenCache.value;
  const iat = Math.floor(now / 1000);
  const jwt = signJwt({ iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }, sa.private_key);
  const r = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google token: ${j.error_description || j.error || r.status}`);
  tokenCache = { value: j.access_token, exp: now + (j.expires_in ?? 3600) * 1000 };
  return tokenCache.value;
}

const classSeen = new Map(); // programme id -> updatedAt last sent
/** Push the new balance to a customer's saved Google Wallet card (a 404 just means they never saved it). */
export async function pushGoogle(customer, { env = process.env, fetchImpl = fetch, now = Date.now(), program, client } = {}) {
  const st = googleStatus(env);
  if (!st.configured) return { skipped: "not configured" };
  program ??= ldb().programs.find((p) => p.id === customer.programId);
  if (!program) return { skipped: "no programme" };
  const sa = serviceAccount(env), base = env.PUBLIC_URL.replace(/\/$/, "");
  const tok = await accessToken(sa, fetchImpl, now);
  const call = (path, body) => fetchImpl(`${API}/${path}`, { method: "PATCH", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (classSeen.get(program.id) !== program.updatedAt) {
    const c = await call(`loyaltyClass/${classId(st.issuerId, program)}`, buildClass({ program, client, base, issuer: st.issuerId }));
    if (c.ok) classSeen.set(program.id, program.updatedAt);
  }
  const r = await call(`loyaltyObject/${objectId(st.issuerId, customer)}`, buildObject({ program, customer, base, issuer: st.issuerId }));
  if (r.status === 404) return { skipped: "not saved yet" };
  if (!r.ok) throw new Error(`Google Wallet update failed (${r.status})`);
  return { sent: 1 };
}

/** A plain initial-letter logo for programmes without one (Google needs a public https image). */
export function fallbackLogoPng(program) {
  const d = program.design ?? {}, size = 256, cv = createCanvas(size, size), g = cv.getContext("2d");
  g.fillStyle = hexOr(d.accent, "#f59e0b"); g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = hexOr(d.background, "#14232b"); g.font = "700 140px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(((d.cardTitle || program.name || "?").trim()[0] || "?").toUpperCase(), size / 2, size / 2 + 8);
  return cv.toBuffer("image/png");
}
