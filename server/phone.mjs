// Phone numbers are the identity key for loyalty members (one member per number, shared across
// shops), so two spellings of the same number MUST produce the same string or a customer ends up
// with two cards. This module is the only place that parses them: `normalisePhone` returns the
// canonical E.164 value, the country and whether the line can receive SMS.
//
// Deliberately dependency-free (ATD's call): a table for the countries that actually walk into a
// Tenerife shop, and a generic E.164 length check for the rest. The return shape is the contract, so
// swapping in libphonenumber-js later means changing this file only. It must never throw, never
// return a partial result, and never guess a country for a number typed without a prefix unless a
// default is given.
//
// Not a validator of whether a number is *assigned* (that needs HLR lookups); it rejects only what
// is structurally impossible: letters, too few or too many digits, and a national length that cannot
// exist for that calling code.

/**
 * Calling codes we parse properly. `nsn` is the national significant number length range (digits
 * after the calling code). `trunk` is the prefix people dial at home and that must be dropped in
 * E.164 ("0" for most of Europe, null where there is none). Italy keeps its leading 0.
 * `mobile`/`landline` classify where the national numbering plan is stable enough to be trusted;
 * when neither matches the kind is "unknown" rather than a guess.
 */
const CC = [
  { iso: "ES", cc: "34", nsn: [9, 9], trunk: null, mobile: /^[67]/, landline: /^[89]/, valid: /^[6-9]/ },
  { iso: "PT", cc: "351", nsn: [9, 9], trunk: null, mobile: /^9/, landline: /^2/ },
  { iso: "FR", cc: "33", nsn: [9, 9], trunk: "0", mobile: /^[67]/, landline: /^[1-59]/ },
  { iso: "DE", cc: "49", nsn: [6, 11], trunk: "0", mobile: /^1[5-7]/, landline: /^[2-9]/ },
  { iso: "GB", cc: "44", nsn: [9, 10], trunk: "0", mobile: /^7/, landline: /^[1-3]/ },
  { iso: "IE", cc: "353", nsn: [7, 9], trunk: "0", mobile: /^8/, landline: /^[1-7]/ },
  { iso: "IT", cc: "39", nsn: [6, 11], trunk: null, mobile: /^3/, landline: /^0/ },
  { iso: "NL", cc: "31", nsn: [9, 9], trunk: "0", mobile: /^6/, landline: /^[1-57]/ },
  { iso: "BE", cc: "32", nsn: [8, 9], trunk: "0", mobile: /^4/, landline: /^[1-3]/ },
  { iso: "CH", cc: "41", nsn: [9, 9], trunk: "0", mobile: /^7/, landline: /^[2-6]/ },
  { iso: "AT", cc: "43", nsn: [7, 13], trunk: "0", mobile: /^6/, landline: /^[1-5]/ },
  { iso: "SE", cc: "46", nsn: [7, 9], trunk: "0", mobile: /^7/, landline: /^[1-6]/ },
  { iso: "NO", cc: "47", nsn: [8, 8], trunk: null, mobile: /^[49]/, landline: /^[2-8]/ },
  { iso: "DK", cc: "45", nsn: [8, 8], trunk: null, mobile: /^[2-9]/, landline: /^[1-9]/ },
  { iso: "FI", cc: "358", nsn: [6, 10], trunk: "0", mobile: /^[45]/, landline: /^[1-3]/ },
  { iso: "PL", cc: "48", nsn: [9, 9], trunk: null, mobile: /^[5-8]/, landline: /^[1-4]/ },
  // +1 covers US and Canada; the area code is needed to tell them apart, so "US" here means NANP.
  { iso: "US", cc: "1", nsn: [10, 10], trunk: null, mobile: /^\d{10}$/, landline: null },
];

const BY_ISO = new Map(CC.map((c) => [c.iso, c]));
// Longest calling code first, so "358" is not read as "35" + junk.
const BY_CC = [...CC].sort((a, b) => b.cc.length - a.cc.length);

const DIGITS_ONLY = /^\d+$/;
const E164_MAX = 15;
const E164_MIN = 8;

const clean = (raw) => String(raw).replace(/[\s().\-/]/g, "");

/**
 * Parse a phone number to E.164.
 *
 * @param {string|number} raw  what the customer or staff typed
 * @param {{defaultCountry?: string}} [opts] ISO code used when there is no + or 00 prefix
 * @returns {{e164: string, country: string|null, kind: "mobile"|"landline"|"unknown"}|null}
 */
export function normalisePhone(raw, { defaultCountry = "ES" } = {}) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = clean(raw);
  if (!s) return null;
  // Reject letters and stray "+" early; a phone number has no other characters.
  const international = s.startsWith("+") ? s.slice(1) : s.startsWith("00") ? s.slice(2) : null;
  if (international !== null && !DIGITS_ONLY.test(international)) return null;

  let ccEntry = null;
  let cc = "";
  let nsn = "";

  if (international !== null) {
    if (!DIGITS_ONLY.test(international)) return null;
    ccEntry = BY_CC.find((c) => international.startsWith(c.cc)) ?? null;
    if (ccEntry) {
      cc = ccEntry.cc;
      nsn = international.slice(ccEntry.cc.length);
    } else {
      // Unknown calling code: keep every digit (E.164 stays exact) and only length-check it.
      cc = international.slice(0, international.startsWith("1") ? 1 : 2);
      nsn = international.slice(cc.length);
    }
  } else {
    if (!DIGITS_ONLY.test(s)) return null;
    ccEntry = BY_ISO.get(String(defaultCountry).toUpperCase()) ?? null;
    if (!ccEntry) return null;
    cc = ccEntry.cc;
    nsn = s;
    if (ccEntry.trunk && nsn.startsWith(ccEntry.trunk)) nsn = nsn.slice(ccEntry.trunk.length);
    // US/Canada: people type the long-distance 1 before the area code.
    if (cc === "1" && nsn.length === 11 && nsn.startsWith("1")) nsn = nsn.slice(1);
  }

  if (!nsn || !DIGITS_ONLY.test(nsn)) return null;

  const [min, max] = ccEntry?.nsn ?? [6, 12];
  if (nsn.length < min || nsn.length > max) return null;
  if (ccEntry?.valid && !ccEntry.valid.test(nsn)) return null;

  const e164 = `+${cc}${nsn}`;
  const digits = e164.slice(1);
  if (digits.length < E164_MIN || digits.length > E164_MAX) return null;

  const kind = !ccEntry
    ? "unknown"
    : ccEntry.mobile && ccEntry.mobile.test(nsn)
      ? "mobile"
      : ccEntry.landline && ccEntry.landline.test(nsn)
        ? "landline"
        : "unknown";

  return { e164, country: ccEntry?.iso ?? null, kind };
}

/** True when this number can receive an SMS/WhatsApp code. Unknown is treated as "try it". */
export const canReceiveCode = (phone) => !!phone && phone.kind !== "landline";
