import test from "node:test";
import assert from "node:assert/strict";
const L = await import("./legal.mjs");
const keys = ["LEGAL_NAME", "LEGAL_NIF", "LEGAL_ADDRESS", "LEGAL_EMAIL", "LEGAL_PHONE", "NODE_ENV", "PUBLIC_URL"];
const clear = () => keys.forEach((k) => delete process.env[k]);

test("no personal gmail in legal pages and warning shown in non-production", () => {
  clear();
  for (const k of ["privacy", "legal"]) for (const l of ["es", "en"]) {
    const h = L.legalPage(k, l);
    assert.doesNotMatch(h, /gmail\.com/); assert.match(h, /role="alert"/); assert.match(h, /LEGAL_NAME/); assert.match(h, /PENDIENTE|PENDING/);
  }
});
test("production: no banner, configured identity rendered with escaping", () => {
  clear(); process.env.NODE_ENV = "production";
  Object.assign(process.env, { LEGAL_NAME: "Acme <b>SL", LEGAL_NIF: "B12345678", LEGAL_ADDRESS: "Calle 1", LEGAL_EMAIL: "privacidad@acme.test", LEGAL_PHONE: "+34 900" });
  const h = L.legalPage("privacy", "es");
  assert.doesNotMatch(h, /role="alert"/); assert.match(h, /Acme &lt;b&gt;SL/); assert.match(h, /mailto:privacidad@acme\.test/);
  assert.equal(L.contactEmail(), "privacidad@acme.test"); clear();
});
test("production without LEGAL_EMAIL exposes no fallback address", () => {
  clear(); process.env.NODE_ENV = "production"; assert.equal(L.contactEmail(), ""); clear();
});
test("policy covers controller, bases, retention, sub-processors, AEPD, breach, cookies", () => {
  clear();
  const h = L.legalPage("privacy", "es");
  for (const re of [/Responsable/, /Base jur|Base jurídica/, /conservación/, /Resend/, /OpenRouter/, /Gemini/, /Groq/, /Mistral/, /SiliconFlow/, /Puter/, /Pollinations/, /Meta, X, YouTube/, /Wallet/, /AEPD|aepd\.es/, /72 horas/, /encargado del tratamiento/, /Cookies/]) assert.match(h, re);
  assert.match(L.legalPage("legal", "es"), /LSSI-CE/);
  assert.match(L.legalPage("privacy", "en"), /72 hours/);
});
