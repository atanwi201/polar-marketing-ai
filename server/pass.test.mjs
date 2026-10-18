import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";

const dir = mkdtempSync(join(tmpdir(), "pass-"));
process.env.DATA_DIR = dir;
const { walletStatus, buildPass, passJson } = await import("./pass.mjs");

// Throwaway self-signed cert/key and a fake WWDR. Apple would reject the chain; we only check structure.
const ssl = (name) => {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.pem`), "-days", "2", "-subj", `/CN=${name}`], { stdio: "ignore" });
};
ssl("signer"); ssl("wwdr");
export const env = {
  APPLE_PASS_TYPE_ID: "pass.test.loyalty", APPLE_TEAM_ID: "TEAM123456", PUBLIC_URL: "https://cards.example.com",
  APPLE_PASS_CERT_PATH: join(dir, "signer.pem"), APPLE_PASS_KEY_PATH: join(dir, "signer.key"), APPLE_WWDR_PATH: join(dir, "wwdr.pem"),
};

const program = {
  id: "p1", clientId: "c1", name: "Coffee club", type: "stamps", terms: "One stamp per visit.",
  design: { background: "#2b1d14", foreground: "#ffffff", label: "#e0c9a6", accent: "#d97a2b", layout: "stripe", cardTitle: "Coffee club", tagline: "Every 8th is on us", stampIcon: "☕", stampEmptyIcon: "○", logoFile: "", stripFile: "", backgroundFile: "" },
  stamps: { goal: 8 }, rewards: [{ id: "r1", name: "Free coffee", kind: "stamps", cost: 8, active: true }],
};
const customer = { id: "cust1", programId: "p1", clientId: "c1", cardToken: "tok", authToken: "auth-token-0123456789", name: "Ana", stamps: 3, points: 0, visits: 3 };
const client = { id: "c1", name: "Cafe Luna" };

test("walletStatus lists what is missing", () => {
  const s = walletStatus({});
  assert.equal(s.configured, false);
  assert.ok(s.missing.includes("APPLE_PASS_TYPE_ID") && s.missing.includes("APPLE_WWDR_PATH"));
  const ok = walletStatus(env);
  assert.deepEqual([ok.configured, ok.missing, ok.pushReady, ok.publicUrlHttps, ok.passTypeId], [true, [], true, true, "pass.test.loyalty"]);
  const http = walletStatus({ ...env, PUBLIC_URL: "http://x.test" });
  assert.deepEqual([http.configured, http.pushReady, http.publicUrlHttps], [true, false, false]);
  assert.equal(walletStatus({ ...env, APPLE_PASS_CERT_PATH: "/nope" }).configured, false);
});

test("buildPass refuses when not configured", async () => {
  await assert.rejects(buildPass({ program, customer, client, baseUrl: "http://x", env: {} }), /not set up/);
});

test("buildPass returns a zip with pass.json, matching manifest and a signature", async () => {
  const buf = await buildPass({ program, customer, client, baseUrl: "https://cards.example.com", env });
  const z = unzipSync(new Uint8Array(buf));
  for (const f of ["pass.json", "manifest.json", "signature", "icon.png", "icon@2x.png", "strip.png", "strip@2x.png"]) assert.ok(z[f], `${f} missing`);
  const pass = JSON.parse(strFromU8(z["pass.json"]));
  assert.equal(pass.serialNumber, "cust1");
  assert.equal(pass.passTypeIdentifier, "pass.test.loyalty");
  assert.equal(pass.teamIdentifier, "TEAM123456");
  assert.equal(pass.webServiceURL, "https://cards.example.com/wallet");
  assert.equal(pass.authenticationToken, customer.authToken);
  assert.equal(pass.barcodes[0].message, "LC1-cust1");
  assert.equal(pass.barcodes[0].format, "PKBarcodeFormatQR");
  assert.equal(pass.backgroundColor, "rgb(43, 29, 20)");
  assert.ok(pass.storeCard.secondaryFields.find((f) => f.key === "stampRow").value.startsWith("☕ ☕ ☕ ○"));
  assert.ok(pass.storeCard.backFields.find((f) => f.key === "terms").value.includes("One stamp"));
  const manifest = JSON.parse(strFromU8(z["manifest.json"]));
  for (const [name, sha] of Object.entries(manifest)) assert.equal(createHash("sha1").update(z[name]).digest("hex"), sha, name);
  assert.ok(manifest["pass.json"] && manifest["strip.png"]);
  assert.ok(z.signature.length > 100);
  assert.deepEqual([...z["strip.png"].slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test("points card shows balance and tier, no web service on http", () => {
  const p = { ...program, type: "custom", points: { perEuro: 1 }, stamps: { goal: 0 }, rewards: [{ id: "r", name: "Cake", kind: "points", cost: 100, active: true }] };
  const j = passJson({ program: p, customer: { ...customer, points: 40, tier: "Silver" }, client, baseUrl: "http://localhost:1", env: { ...env, PUBLIC_URL: "" } });
  assert.equal(j.webServiceURL, undefined);
  const all = Object.values(j.storeCard).flat();
  assert.ok(all.find((f) => f.key === "points" && f.value === "40"));
  assert.ok(all.find((f) => f.key === "tier" && f.value === "Silver"));
  assert.match(all.find((f) => f.key === "nextReward").value, /60 points to go/);
});
