import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisePhone, canReceiveCode, maskPhone } from "./phone.mjs";

test("every way a Spanish customer writes the same mobile gives one E.164", () => {
  const ways = [
    "612 345 678",
    "612345678",
    "612-345-678",
    "612.345.678",
    "+34 612 345 678",
    "+34-612-345-678",
    "(+34) 612345678",
    "0034 612345678",
    "0034612345678",
    "  +34612345678  ",
  ];
  for (const raw of ways) {
    assert.deepEqual(normalisePhone(raw), { e164: "+34612345678", country: "ES", kind: "mobile" }, raw);
  }
});

test("Spanish mobiles and landlines are told apart, because only mobiles get a code", () => {
  assert.equal(normalisePhone("+34 612 345 678").kind, "mobile");
  assert.equal(normalisePhone("+34 712 345 678").kind, "mobile");
  assert.equal(normalisePhone("+34 912 345 678").kind, "landline");
  assert.equal(normalisePhone("+34 812 345 678").kind, "landline");
  assert.equal(canReceiveCode(normalisePhone("+34 912 345 678")), false);
  assert.equal(canReceiveCode(normalisePhone("+34 612 345 678")), true);
});

test("tourists are first-class: foreign numbers keep their own country", () => {
  const cases = [
    ["+44 7700 900123", "+447700900123", "GB", "mobile"],
    ["07700 900123", "+447700900123", "GB", "mobile", "GB"],
    ["+49 151 2233 4455", "+4915122334455", "DE", "mobile"],
    ["0151 2233 4455", "+4915122334455", "DE", "mobile", "DE"],
    ["+351 912 345 678", "+351912345678", "PT", "mobile"],
    ["+33 6 12 34 56 78", "+33612345678", "FR", "mobile"],
    ["06 12 34 56 78", "+33612345678", "FR", "mobile", "FR"],
    ["+39 333 210 7788", "+393332107788", "IT", "mobile"],
    ["+39 06 1234 5678", "+390612345678", "IT", "landline"],
    ["+31 6 1234 5678", "+31612345678", "NL", "mobile"],
    ["+1 415 555 2671", "+14155552671", "US", "mobile"],
    ["1 415 555 2671", "+14155552671", "US", "mobile", "US"],
    ["+46 70 123 4567", "+46701234567", "SE", "mobile"],
    ["+48 512 345 678", "+48512345678", "PL", "mobile"],
  ];
  for (const [raw, e164, country, kind, defaultCountry] of cases) {
    assert.deepEqual(normalisePhone(raw, defaultCountry ? { defaultCountry } : {}), { e164, country, kind }, raw);
  }
});

test("a country we have no table for still normalises, and only length-checks", () => {
  const r = normalisePhone("+55 11 91234 5678");
  assert.equal(r.e164, "+5511912345678");
  assert.equal(r.country, null);
  assert.equal(r.kind, "unknown");
  assert.equal(canReceiveCode(r), true, "unknown is worth trying, landline is not");
});

test("what must be refused", () => {
  const bad = [
    "abcdefghi",              // letters
    "612 345 67",             // 8 digits: too short for Spain
    "+34 612 345 678 9",      // 10 digits: too long for Spain
    "+340 612 345 678",       // +340 is not a thing
    "+3400 612345678",
    "+34 512 345 678",        // 5xx is not an allocated Spanish prefix
    "+34 012 345 678",
    "+34 612+345678",         // + only at the start
    "",                       // empty
    "   ",
    "+",
    "+999 1234 5678 9012 3456", // over E.164's 15 digits
    null,
    undefined,
    {},
    [],
  ];
  for (const raw of bad) assert.equal(normalisePhone(raw), null, JSON.stringify(raw));
});

test("the default country is Spain but never overrides an explicit prefix", () => {
  assert.equal(normalisePhone("612 345 678").country, "ES");
  assert.equal(normalisePhone("612 345 678", { defaultCountry: "GB" }).country, "GB", "8 digits is a valid UK nsn");
  assert.equal(normalisePhone("+44 7700 900123", { defaultCountry: "ES" }).country, "GB");
  assert.equal(normalisePhone("612345678", { defaultCountry: "XX" }), null, "unknown default country cannot parse");
});

test("a masked number keeps the country, the first digit and the last three", () => {
  assert.equal(maskPhone("+34612345678"), "+34 6 ••• •• 678");
  assert.equal(maskPhone("+447700900123"), "+44 7 ••• ••• 123");
  assert.equal(maskPhone("+351912345678"), "+351 9 ••• •• 678");
  for (const junk of ["", null, undefined, "612345678", "+", {}, 42]) assert.equal(maskPhone(junk), "");
});
