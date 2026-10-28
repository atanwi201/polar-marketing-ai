// The Google Business Profile API, wrapped: one place for the hosts, the read masks, retry/backoff, the
// per-location edit budget and Google's errors turned into codes the UI can translate.
//
// Nothing here decides policy. It does not sanitise post text, does not choose fields, and does not know
// about clients: callers pass resource names (`accounts/123`, `locations/456`) and get plain objects back.
// It is built against the endpoints verified in docs/gbp-api-notes.md (checked 2026-10-27), and against a
// fake server in tests, because the real API needs Basic API Access approval.
//
// Two rules that are easy to get wrong and are enforced here:
// - `readMask` is mandatory on location reads, and `updateMask` on writes: every helper supplies one.
// - Locations are capped at 10 edits per minute by Google, "cannot be increased", so the guard refuses
//   locally with `edit_limit` instead of burning the budget and getting a 429 mid-workflow.
import { randomUUID } from "node:crypto";

export const READ_MASK = [
  "name", "title", "storeCode", "phoneNumbers", "storefrontAddress", "websiteUri",
  "regularHours", "specialHours", "categories", "profile", "labels", "latlng", "metadata",
].join(",");

/** Edits per location per minute, from Google. Hard cap; the docs say it cannot be raised. */
export const EDITS_PER_MINUTE = 10;
const EDIT_WINDOW = 60e3;
const DEFAULT_TIMEOUT = 20e3;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** The flag the UI reads. Off by default: the fallback kit is the product until access is approved. */
export function gbpApiEnabled() {
  return ["1", "true", "yes", "on"].includes(String(process.env.GBP_API_ENABLED ?? "").toLowerCase());
}

const base = (name, fallback) => (process.env[name] || fallback).replace(/\/$/, "");
const bi = () => base("GBP_BI_BASE", "https://mybusinessbusinessinformation.googleapis.com/v1");
const am = () => base("GBP_AM_BASE", "https://mybusinessaccountmanagement.googleapis.com/v1");
const v4 = () => base("GBP_V4_BASE", "https://mybusiness.googleapis.com/v4");
const verif = () => base("GBP_VERIF_BASE", "https://mybusinessverifications.googleapis.com/v1");
const perf = () => base("GBP_PERF_BASE", "https://mybusinessperformance.googleapis.com/v1");
const upload = () => base("GBP_UPLOAD_BASE", "https://mybusiness.googleapis.com/upload/v1");

export class GbpApiError extends Error {
  constructor(message, status = 0, code = "unknown", extra = {}) {
    super(message);
    this.name = "GbpApiError";
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

/** Google's error body -> our code. The reason lives in `error.details[].reason`, not the message. */
function reasonOf(body) {
  const details = body?.error?.details;
  if (Array.isArray(details)) for (const d of details) if (d?.reason) return String(d.reason);
  return String(body?.error?.status ?? "");
}

function codeFor(status, reason) {
  if (status === 401) return "reconnect";
  if (status === 403) return /SERVICE_DISABLED|ACCESS_NOT_CONFIGURED|API_NOT_ENABLED|accessNotConfigured/i.test(reason) ? "access_pending" : "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "google_down";
  if (status === 400) return "invalid";
  return "google_error";
}

const safeJson = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

function retryAfterMs(headers) {
  const raw = headers?.get?.("retry-after");
  if (!raw) return 0;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

function errorFrom(status, body, headers) {
  const reason = reasonOf(body);
  const message = String(body?.error?.message ?? `Google returned ${status}`).slice(0, 400);
  return new GbpApiError(message, status, codeFor(status, reason), { reason, retryAfter: retryAfterMs(headers) });
}

const ES = {
  reconnect: "La conexión con Google ha caducado. Vuelve a conectar tu ficha.",
  access_pending: "Google todavía no nos ha dado acceso a la API de fichas. Podemos seguir con el modo manual.",
  forbidden: "Google no nos deja hacer esto con tu ficha. Comprueba que nos has añadido como gestor.",
  not_found: "No encontramos esa ficha en Google.",
  rate_limited: "Google ha pedido esperar un momento. Inténtalo en un minuto.",
  edit_limit: "Has hecho muchos cambios seguidos. Espera un minuto y vuelve a intentarlo.",
  invalid: "Google no acepta esos datos. Revisa lo que has escrito.",
  google_down: "Google no responde ahora mismo. Inténtalo más tarde.",
  network: "No pudimos conectar con Google. Inténtalo de nuevo.",
  unknown: "Algo ha ido mal con Google. Inténtalo de nuevo.",
};
const EN = {
  reconnect: "The connection to Google has expired. Connect your profile again.",
  access_pending: "Google hasn't given us API access yet. We can carry on with manual mode.",
  forbidden: "Google won't let us do this with your profile. Check that you've added us as a manager.",
  not_found: "We couldn't find that profile on Google.",
  rate_limited: "Google asked us to wait a moment. Try again in a minute.",
  edit_limit: "That's a lot of changes in a row. Wait a minute and try again.",
  invalid: "Google won't accept that data. Check what you typed.",
  google_down: "Google isn't answering right now. Try again later.",
  network: "We couldn't reach Google. Try again.",
  unknown: "Something went wrong with Google. Try again.",
};

/** One sentence a shop owner can act on. The code comes from the wrapper, never from Google's prose. */
export function friendly(error, lang = "es") {
  const dict = lang === "en" ? EN : ES;
  return dict[error?.code] ?? dict.unknown;
}

// --- the per-location edit budget ---------------------------------------------------------------
const edits = new Map(); // location name -> timestamps, oldest first
export function resetEditLimits() { edits.clear(); }

function spendEdit(location, at) {
  const recent = (edits.get(location) ?? []).filter((t) => at - t < EDIT_WINDOW);
  if (recent.length >= EDITS_PER_MINUTE) {
    const retryAt = recent[0] + EDIT_WINDOW;
    throw new GbpApiError("Too many edits for this location.", 429, "edit_limit", { retryAt });
  }
  recent.push(at);
  edits.set(location, recent);
}

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

/**
 * A client for one connection. `accessToken` comes from `gbp-auth.mjs`; everything else is injectable so
 * tests never wait: `fetchImpl`, `sleep`, `now`, `maxAttempts`, `baseDelay`.
 */
export function gbpClient({ accessToken = "", fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), maxAttempts = 3, baseDelay = 500 } = {}) {
  if (!accessToken) throw new GbpApiError("Not connected to Google.", 401, "reconnect");

  async function request(method, url, { body, idempotent = method !== "POST", headers = {} } = {}) {
    let last;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt) {
        const wait = Math.min(10000, Math.max(last?.retryAfter ?? 0, baseDelay * 2 ** (attempt - 1)));
        await sleep(wait + Math.floor(Math.random() * 150));
      }
      let res;
      try {
        res = await fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        });
      } catch {
        last = new GbpApiError("Could not reach Google.", 0, "network");
        if (idempotent) continue;                   // a dropped GET/PATCH is worth another try
        throw last;                                 // a create might have been applied: never replay it blind
      }
      const text = await res.text().catch(() => "");
      if (res.ok) return text ? safeJson(text) : null;
      last = errorFrom(res.status, safeJson(text), res.headers);
      // 429 means the request was not applied, so retrying a POST is safe. A 5xx might have been applied:
      // only retry those when the call is idempotent (GET, PATCH, PUT, DELETE, or a create with requestId).
      const retryable = last.status === 429 || (last.status >= 500 && idempotent);
      if (!retryable) throw last;
    }
    throw last;
  }

  const send = (method, url, opts) => request(method, url, opts);
  const listReviews = (account, location, { pageSize = 50, pageToken = "", orderBy = "updateTime desc" } = {}) =>
    send("GET", `${v4()}/${account}/${location}/reviews${qs({ pageSize, pageToken, orderBy })}`);

  return {
    accounts: {
      async list({ pageSize = 20, pageToken = "" } = {}) {
        return send("GET", `${am()}/accounts${qs({ pageSize, pageToken })}`);
      },
    },

    locations: {
      /** Every field we might show, so callers never forget the mandatory mask. */
      async list(account, { readMask = READ_MASK, pageSize = 100, pageToken = "" } = {}) {
        return send("GET", `${bi()}/${account}/locations${qs({ readMask, pageSize, pageToken })}`);
      },
      async get(name, { readMask = READ_MASK } = {}) {
        return send("GET", `${bi()}/${name}${qs({ readMask })}`);
      },
      /** Only the fields in `updateMask` are touched. Counts against the 10/min budget. */
      async patch(name, location, { updateMask } = {}) {
        if (!updateMask) throw new GbpApiError("updateMask is required.", 400, "invalid");
        spendEdit(name, now());
        return send("PATCH", `${bi()}/${name}${qs({ updateMask })}`, { body: location });
      },
      /** validateOnly is the only sandbox Google has. A unique requestId makes the real call retry-safe. */
      async create(account, location, { validateOnly = true, requestId = randomUUID() } = {}) {
        return send("POST", `${bi()}/${account}/locations${qs({ validateOnly, requestId })}`, { body: location, idempotent: true });
      },
    },

    googleLocations: {
      /** Look for an existing listing before creating a duplicate (300 searches/day). */
      async search(query, { pageSize = 10, pageToken = "" } = {}) {
        return send("POST", `${bi()}/googleLocations:search${qs({ pageSize, pageToken })}`, { body: { query }, idempotent: true });
      },
    },

    verifications: {
      /** Whatever options Google returns: ADDRESS, EMAIL, PHONE_CALL, SMS, AUTO. Never assume a set. */
      async options(locationName, { languageCode = "es" } = {}) {
        return send("POST", `${verif()}/${locationName}:fetchVerificationOptions`, { body: { languageCode }, idempotent: true });
      },
      async verify(locationName, body) {
        return send("POST", `${verif()}/${locationName}:verify`, { body });
      },
      async complete(verificationName, pin) {
        return send("POST", `${verif()}/${verificationName}:complete`, { body: { pin } });
      },
      async state(locationName) {
        return send("GET", `${verif()}/${locationName}:getVoiceOfMerchantState`);
      },
    },

    reviews: {
      async list(account, location, opts = {}) {
        return listReviews(account, location, opts);
      },
      /** Every page, capped: a shop with 5,000 reviews should not stall a request. */
      async listAll(account, location, { max = 500 } = {}) {
        const out = [];
        let pageToken = "";
        do {
          const page = await listReviews(account, location, { pageToken, pageSize: Math.min(50, max - out.length) });
          out.push(...(page?.reviews ?? []));
          pageToken = page?.nextPageToken ?? "";
        } while (pageToken && out.length < max);
        return out.slice(0, max);
      },
      async reply(account, location, reviewId, comment) {
        return send("PUT", `${v4()}/${account}/${location}/reviews/${encodeURIComponent(reviewId)}/reply`, { body: { comment } });
      },
      async deleteReply(account, location, reviewId) {
        return send("DELETE", `${v4()}/${account}/${location}/reviews/${encodeURIComponent(reviewId)}/reply`);
      },
    },

    posts: {
      /** Local posts only: product posts cannot be created by the API. */
      async create(account, location, post) {
        return send("POST", `${v4()}/${account}/${location}/localPosts`, { body: post });
      },
      async list(account, location, { pageSize = 50, pageToken = "" } = {}) {
        return send("GET", `${v4()}/${account}/${location}/localPosts${qs({ pageSize, pageToken })}`);
      },
      async remove(account, location, name) {
        return send("DELETE", `${v4()}/${name.split("/").map(encodeURIComponent).join("/")}`);
      },
    },

    media: {
      /** A photo already on a public URL: one call, and the only way to attach media to a local post. */
      async createFromUrl(account, location, { sourceUrl, mediaFormat = "PHOTO", category = "ADDITIONAL" }) {
        return send("POST", `${v4()}/${account}/${location}/media`, {
          body: { sourceUrl, mediaFormat, locationAssociation: { category } },
        });
      },
      /** Bytes: startUpload -> raw upload -> media.create. Supported for locations, not for posts. */
      async uploadBytes(account, location, { buffer, contentType = "image/jpeg", fileName = "photo.jpg", mediaFormat = "PHOTO", category = "ADDITIONAL" }) {
        if (!buffer?.length) throw new GbpApiError("Empty file.", 400, "invalid");
        const start = await send("POST", `${v4()}/media:startUpload`, { body: { fileName }, idempotent: true });
        const resourceName = String(start?.resourceName ?? "");
        if (!resourceName) throw new GbpApiError("Google did not return an upload reference.", 502, "google_down");
        const target = `${upload()}/media/${resourceName.split("/").map(encodeURIComponent).join("/")}${qs({ upload_type: "media" })}`;
        const res = await fetchImpl(target, {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "content-type": contentType },
          body: buffer,
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw errorFrom(res.status, safeJson(text), res.headers);
        }
        return send("POST", `${v4()}/${account}/${location}/media`, {
          body: { resourceName, mediaFormat, locationAssociation: { category } },
        });
      },
    },

    performance: {
      /** v4 `locations:reportInsights` is deprecated: this is the current call. */
      async daily(locationName, { metrics = ["CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS"], from, to } = {}) {
        const spread = (list) => list.map((m) => `dailyMetrics=${encodeURIComponent(m)}`).join("&");
        const range = qs({
          "dailyRange.start_date.year": from?.year, "dailyRange.start_date.month": from?.month, "dailyRange.start_date.day": from?.day,
          "dailyRange.end_date.year": to?.year, "dailyRange.end_date.month": to?.month, "dailyRange.end_date.day": to?.day,
        });
        const query = `${spread(metrics)}${range ? `&${range.slice(1)}` : ""}`;
        return send("GET", `${perf()}/${locationName}:fetchMultiDailyMetricsTimeSeries${query ? `?${query}` : ""}`);
      },
    },
  };
}
