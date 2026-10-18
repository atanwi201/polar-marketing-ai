import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { googleStatus, saveUrl, pushGoogle, buildObject, buildClass, fallbackLogoPng } from "./gwallet.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const env = {
  GOOGLE_WALLET_ISSUER_ID: "3388000000012345",
  GOOGLE_WALLET_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "svc@x.iam.gserviceaccount.com", private_key: pem }),
  PUBLIC_URL: "https://cards.example.com",
};
const program = { id: "p1", type: "stamps", updatedAt: "t1", name: "Cafe card", stamps: { goal: 8 }, design: { background: "#123456", cardTitle: "Cafe", layout: "minimal" }, rewards: [{ id: "r", name: "Free coffee", kind: "stamps", cost: 8, active: true }] };
const customer = { id: "c1", programId: "p1", name: "Ana", cardToken: "tok", stamps: 3, points: 0, tier: "" };

test("status lists what is missing", () => {
  assert.deepEqual(googleStatus({}).missing, ["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON", "PUBLIC_URL"]);
  assert.equal(googleStatus(env).configured, true);
});

test("save link is a valid RS256 JWT with class and object", () => {
  const url = saveUrl({ program, customer, client: { name: "Cafe Test" }, baseUrl: "https://cards.example.com", env });
  const jwt = url.replace("https://pay.google.com/gp/v/save/", "");
  const [h, b, s] = jwt.split(".");
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, s, "base64url"));
  const c = JSON.parse(Buffer.from(b, "base64url"));
  assert.equal(c.aud, "google"); assert.equal(c.typ, "savetowallet");
  assert.equal(c.payload.loyaltyObjects[0].barcode.value, "LC1-c1");
  assert.equal(c.payload.loyaltyObjects[0].loyaltyPoints.balance.string, "3 / 8");
  assert.equal(c.payload.loyaltyClasses[0].id, "3388000000012345.lc_p1");
});

test("unconfigured save link throws 404", () => assert.throws(() => saveUrl({ program, customer, env: {} }), { status: 404 }));

test("points and custom objects", () => {
  const o = buildObject({ program: { ...program, type: "custom" }, customer: { ...customer, points: 42.4, tier: "Gold" }, base: "https://x", issuer: "i" });
  assert.equal(o.loyaltyPoints.balance.string, "3 / 8");
  assert.equal(o.secondaryLoyaltyPoints.balance.int, 42);
  assert.equal(buildObject({ program: { ...program, type: "points" }, customer: { ...customer, points: 7 }, base: "https://x", issuer: "i" }).loyaltyPoints.balance.int, 7);
  assert.match(buildClass({ program, client: {}, base: "https://x", issuer: "i" }).programLogo.sourceUri.uri, /\/loyalty\/logo\/p1\.png$/);
});

test("push patches class and object; 404 means not saved", async () => {
  const calls = [];
  const fetchImpl = async (u, o) => {
    calls.push([u, o?.method]);
    if (u.includes("oauth2")) return { ok: true, json: async () => ({ access_token: "t", expires_in: 3600 }) };
    if (u.includes("loyaltyObject")) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const r = await pushGoogle(customer, { env, fetchImpl, program });
  assert.equal(r.skipped, "not saved yet");
  assert.ok(calls.some(([u, m]) => u.includes("loyaltyClass/") && m === "PATCH"));
  const ok = await pushGoogle(customer, { env, program, fetchImpl: async (u) => (u.includes("oauth2") ? { ok: true, json: async () => ({ access_token: "t" }) } : { ok: true, status: 200, json: async () => ({}) }) });
  assert.equal(ok.sent, 1);
});

test("fallback logo is a PNG", () => assert.equal(fallbackLogoPng(program).subarray(1, 4).toString(), "PNG"));
