// The info/hours/photos manager (plan G7). The point of this module is the *diff*: a shop that fixes
// its closing time should send one field, not a whole location object. Google's update mask is what
// decides, and a wrong mask silently overwrites a field the owner never touched, so the mask is built
// here from the comparison and nothing else.
//
// Reading is done from Google, not from our cached copy: the owner may have edited the profile in the
// GBP app, and a preview that compares against stale data would offer to "change" a value that is
// already right.
//
// Photos: Google supports bytes for locations (not for posts), so a photo already in the client's own
// library is read from disk and uploaded. Type and size are checked here before a byte leaves the
// server, because Google's own limits are stricter than ours when the file was saved.
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { MEDIA_DIR } from "./store.mjs";
import { GbpError, clamp } from "./gbp-kit.mjs";
import { gbpClient } from "./gbp.mjs";
import { accessToken } from "./gbp-auth.mjs";
import { ensureGoogle, requireApi } from "./gbp-google.mjs";
import { normalisePhone } from "./phone.mjs";
import { now } from "./store.mjs";

export const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
export const PHOTO_CATEGORIES = ["COVER", "LOGO", "EXTERIOR", "INTERIOR", "PRODUCT", "FOOD_AND_DRINK", "MENU", "TEAM", "ADDITIONAL"];
/** Google's photo limit for locations. Our own uploader allows 8 MB, so this check is real. */
export const PHOTO_MAX_BYTES = 5e6;
export const DESCRIPTION_MAX = 750;
export const READ_MASK_FIELDS = [
  "name", "title", "phoneNumbers", "storefrontAddress", "websiteUri",
  "regularHours", "categories", "profile",
].join(",");

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const time = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? "")) ? String(v).slice(0, 5) : "");
const isLocation = (v) => /^locations\/[A-Za-z0-9_-]+$/.test(String(v ?? ""));
const isAccount = (v) => /^accounts\/[A-Za-z0-9_-]+$/.test(String(v ?? ""));
const slug = (v) => String(v ?? "").trim().replace(/\/+$/, "").toLowerCase();

function requireLinked(client) {
  const x = ensureGoogle(client);
  if (!isLocation(x.location)) throw new GbpError("Link or create a profile first.", 409, "not_linked");
  return x;
}

async function apiFor(client, api) {
  if (api) return api;
  requireApi(client);
  const token = await accessToken(client);
  if (!token) throw new GbpError("Connect your Google profile again.", 401, "reconnect");
  return gbpClient({ accessToken: token });
}

// --- hours ---------------------------------------------------------------------------------------
/** Google's periods -> the {DAY:{open,close}} map the form edits. The first period of a day wins. */
export function hoursFromPeriods(periods) {
  const out = {};
  for (const day of DAYS) out[day] = null;
  if (!Array.isArray(periods)) return out;
  for (const p of periods) {
    const day = str(p?.openDay, 20).toUpperCase();
    if (!DAYS.includes(day) || out[day]) continue;
    const open = time(p?.openTime);
    const close = time(p?.closeTime);
    if (open && close) out[day] = { open, close };
  }
  return out;
}

/** The form's map -> Google's periods. A close time at or before the open time crosses midnight. */
export function periodsFromHours(hours) {
  const out = [];
  for (const day of DAYS) {
    const h = hours?.[day];
    if (!h || h.closed === true || h.open === "" || h.close === "") continue;
    const open = time(h?.open);
    const close = time(h?.close);
    if (!open || !close) continue;
    const next = close <= open;
    out.push({
      openDay: day,
      openTime: open,
      closeDay: next ? DAYS[(DAYS.indexOf(day) + 1) % 7] : day,
      closeTime: close,
    });
  }
  return out;
}



// --- current profile -----------------------------------------------------------------------------
function addressParts(a) {
  const lines = Array.isArray(a?.addressLines) ? a.addressLines.filter((x) => typeof x === "string" && x.trim()) : [];
  return {
    address: str(lines[0], 200),
    town: str(a?.locality, 100),
    postcode: str(a?.postalCode, 20),
    province: str(a?.administrativeArea, 100),
    regionCode: str(a?.regionCode, 10) || "ES",
  };
}

/** What Google currently has, shaped like the form. Empty strings, never undefined. */
export function profileFromLocation(loc) {
  const a = addressParts(loc?.storefrontAddress);
  return {
    title: str(loc?.title, 200),
    phone: str(loc?.phoneNumbers?.primaryPhone, 40),
    website: str(loc?.websiteUri, 300),
    description: str(loc?.profile?.description, DESCRIPTION_MAX),
    category: str(loc?.categories?.primaryCategory?.name, 120),
    categoryName: str(loc?.categories?.primaryCategory?.displayName, 120),
    address: a.address,
    town: a.town,
    postcode: a.postcode,
    province: a.province,
    regionCode: a.regionCode,
    hours: hoursFromPeriods(loc?.regularHours?.periods),
  };
}

export async function readProfile(client, api) {
  const x = requireLinked(client);
  const a = await apiFor(client, api);
  const loc = await a.locations.get(x.location, { readMask: READ_MASK_FIELDS });
  return profileFromLocation(loc);
}

// --- the diff ------------------------------------------------------------------------------------
/** Validate the form the owner submitted and shape it exactly like `profileFromLocation`. */
export function normaliseForm(form = {}) {
  const title = str(form.title, 200);
  if (title.length < 2) throw new GbpError("Give the business a name.", 400, "bad_title");
  const phone = normalisePhone(str(form.phone, 40), { defaultCountry: "ES" })?.e164 ?? "";
  if (!phone) throw new GbpError("That phone number does not look right.", 400, "bad_phone");
  const address = str(form.address, 300);
  const town = str(form.town, 100);
  if (!address || !town) throw new GbpError("Add a street address and a town.", 400, "bad_address");
  const category = str(form.category, 120);
  if (!category.startsWith("categories/")) throw new GbpError("Choose a category.", 400, "bad_category");
  const website = str(form.website, 300);
  if (website && !/^https?:\/\//i.test(website)) throw new GbpError("The website must start with https://.", 400, "bad_website");
  const hours = {};
  for (const day of DAYS) {
    const h = form.hours?.[day];
    if (!h || h.closed === true) { hours[day] = null; continue; }
    const open = h.open === "" ? "" : time(h.open);
    const close = h.close === "" ? "" : time(h.close);
    if (!open || !close) throw new GbpError("Check the opening hours: use 09:00 for nine in the morning.", 400, "bad_hours");
    hours[day] = { open, close };
  }
  return {
    title,
    phone,
    website,
    description: clamp(str(form.description, 2000), DESCRIPTION_MAX),
    category,
    categoryName: str(form.categoryName, 120),
    address,
    town,
    postcode: str(form.postcode, 20),
    province: str(form.province, 100) || "Santa Cruz de Tenerife",
    regionCode: "ES",
    hours,
  };
}

/**
 * The patch body and mask, plus one readable line per change. Only fields that really differ appear,
 * so the mask can never touch something the owner did not edit.
 */
export function diffProfile(current, form) {
  const next = normaliseForm(form);
  const changes = [];
  const body = {};
  const mask = [];
  const add = (field, from, to, set) => {
    changes.push({ field, from: String(from ?? ""), to: String(to ?? "") });
    set(body);
    mask.push(field);
  };

  if (current.title !== next.title) add("title", current.title, next.title, (b) => { b.title = next.title; });
  if (current.phone !== next.phone) add("phoneNumbers.primaryPhone", current.phone, next.phone, (b) => { b.phoneNumbers = { primaryPhone: next.phone }; });
  if (slug(current.website) !== slug(next.website)) add("websiteUri", current.website, next.website, (b) => { b.websiteUri = next.website; });
  if (current.description !== next.description) add("profile.description", current.description, next.description, (b) => { b.profile = { description: next.description }; });
  if (current.category !== next.category) {
    add("categories.primaryCategory.name", current.categoryName || current.category, next.categoryName || next.category, (b) => {
      b.categories = { primaryCategory: { name: next.category } };
    });
  }

  // The address is one update-mask field; the change list is still per line, because that is what the
  // owner recognises in the preview.
  const address = [
    ["storefrontAddress.addressLines", current.address, next.address],
    ["storefrontAddress.locality", current.town, next.town],
    ["storefrontAddress.postalCode", current.postcode, next.postcode],
    ["storefrontAddress.administrativeArea", current.province, next.province],
  ].filter(([, a, b]) => a !== b);
  if (address.length) {
    for (const [field, from, to] of address) changes.push({ field, from, to });
    body.storefrontAddress = {
      regionCode: "ES",
      languageCode: "es",
      addressLines: [next.address],
      locality: next.town,
      ...(next.postcode ? { postalCode: next.postcode } : {}),
      administrativeArea: next.province,
    };
    mask.push("storefrontAddress");
  }

  const hours = DAYS.filter((day) => String(current.hours?.[day]?.open ?? "") !== String(next.hours?.[day]?.open ?? "")
    || String(current.hours?.[day]?.close ?? "") !== String(next.hours?.[day]?.close ?? ""));
  if (hours.length) {
    for (const day of hours) {
      const a = current.hours?.[day], b = next.hours?.[day];
      changes.push({
        field: `regularHours.periods.${day}`,
        from: a ? `${a.open}-${a.close}` : "",
        to: b ? `${b.open}-${b.close}` : "",
      });
    }
    body.regularHours = { periods: periodsFromHours(next.hours) };
    mask.push("regularHours.periods");
  }

  return { next, body, updateMask: mask.join(","), changes };
}

/** Dry run by default. `saveProfile(..., { apply: true })` is the only thing that writes. */
export async function saveProfile(client, api, form, { apply = false } = {}) {
  const x = requireLinked(client);
  const a = await apiFor(client, api);
  const loc = await a.locations.get(x.location, { readMask: READ_MASK_FIELDS });
  const current = profileFromLocation(loc);
  const plan = diffProfile(current, form);
  if (!apply || plan.changes.length === 0) return { ...plan, applied: false, profile: current };

  const patched = await a.locations.patch(x.location, plan.body, { updateMask: plan.updateMask });
  const after = profileFromLocation(patched);
  // The local copy is a cache for the portal, so keep it in step with what Google now says.
  Object.assign(x, {
    title: after.title || plan.next.title,
    address: [after.address, after.town, after.postcode, after.province].filter(Boolean).join(", "),
    phone: after.phone || plan.next.phone,
    website: after.website || plan.next.website,
    updatedAt: now(),
  });
  return { ...plan, applied: true, profile: after };
}

// --- photos --------------------------------------------------------------------------------------
const MEDIA_CATEGORY = new Set(PHOTO_CATEGORIES);
const normaliseMedia = (m) => ({
  name: str(m?.name, 300),
  category: str(m?.locationAssociation?.category, 40),
  googleUrl: str(m?.googleUrl, 1000),
  thumbnailUrl: str(m?.thumbnailUrl || m?.googleUrl, 1000),
  createTime: str(m?.createTime, 40),
});

export async function listPhotos(client, api) {
  const x = requireLinked(client);
  if (!isAccount(x.account)) throw new GbpError("Link the profile again to manage its photos.", 409, "not_linked");
  const a = await apiFor(client, api);
  const out = await a.media.list(x.account, x.location, { pageSize: 100 });
  return (Array.isArray(out?.mediaItems) ? out.mediaItems : []).map(normaliseMedia).filter((m) => m.name);
}

/** The bytes and MIME type of one of the client's own photos, after every check that costs nothing. */
export async function readPhoto(client, file) {
  const name = basename(String(file ?? ""));
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.(jpe?g|png)$/i.test(name) || name !== String(file ?? "")) {
    throw new GbpError("Choose one of your photos.", 400, "bad_photo");
  }
  if (!(client.photos ?? []).some((p) => p?.file === name)) throw new GbpError("Choose one of your photos.", 400, "bad_photo");
  const path = join(MEDIA_DIR, name);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new GbpError("That photo is no longer there.", 404, "not_found");
  if (info.size === 0) throw new GbpError("That photo is empty.", 400, "bad_photo");
  if (info.size > PHOTO_MAX_BYTES) throw new GbpError("That photo is over 5 MB. Google will not take it.", 413, "too_large");
  const buffer = await readFile(path);
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!jpeg && !png) throw new GbpError("Google only takes JPEG or PNG photos.", 400, "bad_photo");
  return { buffer, contentType: jpeg ? "image/jpeg" : "image/png", fileName: name };
}

export async function uploadPhoto(client, api, { file, category = "ADDITIONAL" } = {}) {
  const x = requireLinked(client);
  if (!isAccount(x.account)) throw new GbpError("Link the profile again to manage its photos.", 409, "not_linked");
  const cat = String(category ?? "ADDITIONAL").toUpperCase();
  if (!MEDIA_CATEGORY.has(cat)) throw new GbpError("Choose a photo type.", 400, "bad_category");
  const photo = await readPhoto(client, file);
  const a = await apiFor(client, api);
  const out = await a.media.uploadBytes(x.account, x.location, {
    buffer: photo.buffer,
    contentType: photo.contentType,
    fileName: photo.fileName,
    mediaFormat: "PHOTO",
    category: cat,
  });
  x.updatedAt = now();
  return normaliseMedia(out);
}
