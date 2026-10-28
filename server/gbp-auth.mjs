// Google Business Profile OAuth: connect a client's profile, keep the tokens encrypted, refresh them and
// disconnect. This is only the token half; the API calls live in G5 and stay behind GBP_API_ENABLED.
// Everything here is built and tested against a fake Google server, because the real endpoints need
// Basic API Access approval (docs/gbp-api-notes.md) and the app stays in Testing until G2.
//
// Rules that matter:
// - Tokens are encrypted at rest with TOKEN_ENC_KEY (AES-256-GCM, client id as AAD), never logged and never
//   returned by a route. Losing the key only costs a reconnect; that is the intended failure mode.
// - `state` is single-use, expires in 10 minutes, is pinned in an HttpOnly cookie and the exchange uses
//   PKCE S256. A callback we did not start changes nothing.
// - While the OAuth app is in Testing, refresh tokens die after 7 days: invalid_grant clears the
//   connection and asks the owner to reconnect, it never throws token material.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { db, save, now } from "./store.mjs";
import { ensureGbp, GbpError } from "./gbp-kit.mjs";
import { approval } from "./limits.mjs";
import { gbpApiEnabled } from "./gbp.mjs";

export const SCOPE = "https://www.googleapis.com/auth/business.manage";
export const PENDING_TTL = 10 * 60e3;
/** Refresh a little before Google says the token is dead, so an API call never races the expiry. */
const REFRESH_MARGIN = 60e3;
const MAX_PENDING = 500;

const authUrl = () => process.env.GBP_OAUTH_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const tokenUrl = () => process.env.GBP_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token";
const revokeUrl = () => process.env.GBP_OAUTH_REVOKE_URL || "https://oauth2.googleapis.com/revoke";
const clientId = () => process.env.GOOGLE_OAUTH_CLIENT_ID || "";
const clientSecret = () => process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";

/** Where Google sends the owner back. Explicit in production; PUBLIC_URL is the fallback. */
export function redirectUri() {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  return base ? `${base}/api/gbp/callback` : "";
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");

/** 32 bytes derived from the operator's secret, so any long random string works and short ones do not. */
function encKey() {
  const raw = process.env.TOKEN_ENC_KEY ?? "";
  if (raw.length < 32) return null;
  try { return Buffer.from(hkdfSync("sha256", Buffer.from(raw, "utf8"), Buffer.from("polar-gbp-tokens"), Buffer.from("v1"), 32)); }
  catch { return null; }
}

/** Everything the connect flow needs is present. Without it, connect says so and nothing else breaks. */
export function gbpOAuthConfigured() {
  return Boolean(clientId() && clientSecret() && redirectUri() && encKey());
}

function encrypt(clientIdValue, payload) {
  const key = encKey();
  if (!key) throw new GbpError("Google access is not configured yet.", 503, "not_configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`gbp:${clientIdValue}`, "utf8"));
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `v1.${b64u(iv)}.${b64u(cipher.getAuthTag())}.${b64u(ct)}`;
}

/** null for anything that was not written by us for this same client: wrong key, edited, moved. */
function decrypt(clientIdValue, blob) {
  try {
    const [v, iv, tag, ct] = String(blob ?? "").split(".");
    if (v !== "v1" || !iv || !tag || !ct) return null;
    const key = encKey();
    if (!key) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(`gbp:${clientIdValue}`, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const json = Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
    const t = JSON.parse(json);
    return t && typeof t === "object" && typeof t.accessToken === "string" ? t : null;
  } catch { return null; }
}

/** The stored tokens for this client, or null. Never cached, so a key rotation fails closed. */
export function readTokens(client) {
  return client?.gbp?.auth?.enc ? decrypt(client.id, client.gbp.auth.enc) : null;
}

function storeTokens(client, response, previous) {
  const prev = previous ?? {};
  const secs = Number(response.expires_in);
  const payload = {
    accessToken: String(response.access_token ?? ""),
    // A refresh response has no refresh_token: keep the one we already have.
    refreshToken: String(response.refresh_token ?? prev.refreshToken ?? ""),
    // 0 is honoured (an already-expired token); a missing value falls back to Google's usual hour.
    expiresAt: Date.now() + (Number.isFinite(secs) && secs >= 0 ? secs : 3600) * 1000,
    tokenType: "Bearer",
    scope: String(response.scope ?? prev.scope ?? SCOPE),
  };
  const g = ensureGbp(client);
  g.auth = {
    enc: encrypt(client.id, payload),
    connectedAt: g.auth?.connectedAt || now(),
    updatedAt: now(),
    expiresAt: payload.expiresAt,
    scope: payload.scope,
    lastError: "",
  };
  g.mode = "api";
  return payload;
}

/** Forget the connection but keep why, so the portal can say "reconnect" instead of "not connected". */
function clearAuth(client, reason = "") {
  const g = ensureGbp(client);
  const had = !!g.auth?.enc;
  g.auth = { enc: "", connectedAt: had ? g.auth.connectedAt : "", updatedAt: now(), expiresAt: 0, scope: "", lastError: reason };
  g.mode = "manual";
}

/** What a route may show. No token, no ciphertext, no scope details beyond the string. */
export function gbpAuthView(client) {
  const a = ensureGbp(client).auth ?? {};
  const tokens = a.enc ? decrypt(client.id, a.enc) : null;
  return {
    configured: gbpOAuthConfigured(),
    // The portal swaps the manual kit for the API screens only when the owner turns the flag on (G5/G10).
    enabled: gbpApiEnabled(),
    connected: !!(a.enc && tokens),
    connectedAt: a.connectedAt || "",
    expiresAt: tokens ? tokens.expiresAt : 0,
    scope: tokens ? tokens.scope : "",
    lastError: a.lastError || (a.enc && !tokens ? "reconnect" : ""),
  };
}

// --- pending authorisations: unguessable, single use, short lived -------------------------------------
const pending = new Map(); // state -> { clientId, verifier, at }
const sweep = () => { const t = Date.now(); for (const [k, v] of pending) if (t - v.at > PENDING_TTL) pending.delete(k); };

/** Start a connection: the URL to send the owner to, plus the state for the cookie. */
export function connectUrl(client) {
  if (!gbpOAuthConfigured()) throw new GbpError("Google access is not configured yet.", 503, "not_configured");
  sweep();
  if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
  const state = b64u(randomBytes(32));
  const verifier = b64u(randomBytes(48));
  pending.set(state, { clientId: client.id, verifier, at: Date.now() });
  const u = new URL(authUrl());
  u.searchParams.set("client_id", clientId());
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("access_type", "offline");       // we need a refresh token, not just an hour
  u.searchParams.set("prompt", "consent");            // and again on reconnect, or Google omits it
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", b64u(createHash("sha256").update(verifier).digest()));
  u.searchParams.set("code_challenge_method", "S256");
  return { url: u.toString(), state };
}

/** Drop a pending authorisation (the owner pressed "cancel" on Google's screen). */
export function cancelPending(state) { if (state) pending.delete(state); }

/** The client a fresh, unused state belongs to, for the "owner cancelled" redirect. Consumes it. */
export function pendingClient(state, cookieState) {
  sweep();
  const entry = state ? pending.get(state) : null;
  if (!entry || !cookieState || cookieState !== state) return null;
  pending.delete(state);
  return db.clients.find((c) => c.id === entry.clientId) ?? null;
}

async function postForm(url, fields) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(15000),
  });
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return { ok: r.ok, status: r.status, body };
}

/** Google's error names only: never echo a response body, it can carry a token. */
const googleError = (body) => (body && typeof body.error === "string" ? body.error.slice(0, 40) : "");

/** Finish the flow. The state must be ours, unused, fresh and match the cookie. */
export async function finishConnect({ state, code, cookieState }) {
  sweep();
  const entry = state ? pending.get(state) : null;
  if (!entry) throw new GbpError("This connection link has expired. Start again.", 400, "state");
  pending.delete(state);                              // single use, even when the rest fails
  if (!cookieState || cookieState !== state) throw new GbpError("This connection link has expired. Start again.", 400, "state");
  if (!gbpOAuthConfigured()) throw new GbpError("Google access is not configured yet.", 503, "not_configured");
  if (!code) throw new GbpError("Google did not send an authorisation code.", 400, "code");
  const client = db.clients.find((c) => c.id === entry.clientId);
  if (!client) throw new GbpError("This business no longer exists.", 400, "client");
  // A business suspended while the owner was on Google's screen does not get a token stored.
  if (approval(client) !== "approved") throw new GbpError("This link is not active.", 403, "inactive");

  let r;
  try {
    r = await postForm(tokenUrl(), {
      client_id: clientId(), client_secret: clientSecret(), code,
      code_verifier: entry.verifier, redirect_uri: redirectUri(), grant_type: "authorization_code",
    });
  } catch { throw new GbpError("Could not reach Google. Try again.", 502, "network"); }
  if (!r.ok || !r.body?.access_token) {
    console.warn(`[gbp] token exchange failed: ${r.status} ${googleError(r.body)}`); // never the body
    throw new GbpError("Google did not accept the connection. Try again.", 400, "exchange");
  }
  storeTokens(client, r.body);
  await save();
  return client;
}

// One refresh per client at a time: two screens opening at once must not race the rotation.
const inflight = new Map();

async function refresh(client) {
  const t = readTokens(client);
  if (!t) return "";
  if (!t.refreshToken) { clearAuth(client, "reconnect"); await save(); return ""; }
  let r;
  try {
    r = await postForm(tokenUrl(), {
      client_id: clientId(), client_secret: clientSecret(), grant_type: "refresh_token", refresh_token: t.refreshToken,
    });
  } catch { return ""; }                             // network: keep the connection, try again next time
  if (!r.ok || !r.body?.access_token) {
    // invalid_grant means the grant is gone (revoked, or 7 days in Testing): ask for a reconnect.
    if (googleError(r.body) === "invalid_grant" || r.status === 400 || r.status === 401) clearAuth(client, "reconnect");
    await save();
    return "";
  }
  storeTokens(client, r.body, t);
  await save();
  return r.body.access_token;
}

/** A usable access token, refreshed if needed, or "" when the client has to reconnect. */
export async function accessToken(client) {
  const t = readTokens(client);
  if (!t?.accessToken) return "";
  if (t.expiresAt - Date.now() > REFRESH_MARGIN) return t.accessToken;
  if (!gbpOAuthConfigured()) return "";
  const key = client.id;
  if (inflight.has(key)) return inflight.get(key);
  const p = refresh(client).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Disconnect: forget locally first, then ask Google to revoke the grant. Never fails the owner. */
export async function disconnect(client) {
  const t = readTokens(client);
  clearAuth(client, "");
  await save();
  const token = t?.refreshToken || t?.accessToken;
  if (token) {
    try { await postForm(revokeUrl(), { token }); } catch { /* the local side is already clean */ }
  }
  return client;
}

/** For tests and the admin screen: how many authorisations are waiting. */
export const pendingCount = () => { sweep(); return pending.size; };
