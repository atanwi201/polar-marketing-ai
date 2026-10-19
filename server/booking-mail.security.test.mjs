import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bms-"));
process.env.DATA_DIR = tmp; process.env.SITES_DIR = tmp; process.env.RESEND_API_KEY = "";
const { db } = await import("./store.mjs");
const B = await import("./bookings.mjs");
const M = await import("./booking-mail.mjs");

const future = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
db.clients.push({ id: "ok", name: "Bar Uno", kind: "restaurant", phone: "600", email: "bar@x.es" }, { id: "pen", name: "Bar Dos", kind: "restaurant", email: "dos@x.es", approval: { status: "pending" } }, { id: "dec", name: "Bar Tres", kind: "restaurant", email: "tres@x.es", approval: { status: "declined" } });
for (const c of db.clients) B.ensureConfig(c);
const mk = (clientId, o = {}) => ({ id: "b" + Math.random(), clientId, kind: "table", status: "pending", name: "Ana", email: "ana@example.com", lang: "en", date: future(3), time: "20:00", party: 2, ...o });
const run = async (b, ev = "created") => { const sent = []; await M.bookingMailer({ baseUrl: () => "https://x.test", sender: async (m) => sent.push(m) })(b, ev); return sent; };

test("strict email validation", () => {
  for (const e of ["a@b.es", "ana.o+t@example.com"]) assert.equal(M.validEmail(e), true);
  for (const e of ["a@b", "a,b@c.es", "a@b.es,c@d.es", "a b@c.es", "<a>@c.es", "a@b.es\nBcc: x@y.z", "a@@b.es", "a..b@c.es", "a@b..es"]) assert.equal(M.validEmail(e), false, e);
});
test("cleanText strips CRLF, links and angle brackets", () => {
  const t = M.cleanText("Eve\r\nBcc: x@y.z https://evil.example/x <b>hi</b> www.evil.com", 200);
  assert.doesNotMatch(t, /[\r\n<>]|https?:|www\./);
  assert.ok(M.cleanText("x".repeat(500), 40).length <= 40);
});
test("greeting does not echo URLs or markup; footer has identity and /privacy", async () => {
  process.env.LEGAL_NAME = "Test SL"; process.env.LEGAL_NIF = "B00000000";
  const [m] = await run(mk("ok", { name: "Click http://phish.example <script>x</script>" }));
  assert.doesNotMatch(m.text + m.html, /phish\.example|<script>/);
  assert.match(m.text, /Test SL/); assert.match(m.text, /\/privacy/); assert.match(m.html, /href="https:\/\/x\.test\/privacy"/);
  delete process.env.LEGAL_NAME; delete process.env.LEGAL_NIF;
});
test("a recipient gets at most 3 confirmations per day", async () => {
  M._resetMailLimits();
  let n = 0; const b = mk("ok", { email: "victim@example.com" });
  for (let i = 0; i < 6; i++) n += (await run(b)).filter((m) => m.to === "victim@example.com").length;
  assert.equal(n, M.MAX_PER_RECIPIENT);
  assert.equal(b.mail.at(-1).state, "rate-limited");
});
test("invalid recipient gets nothing; owner mail has no CRLF in subject", async () => {
  M._resetMailLimits();
  const sent = await run(mk("ok", { email: "bad@x", name: "A\r\nBcc: z@z.zz" }));
  assert.deepEqual(sent.map((m) => m.to), ["bar@x.es"]);
  assert.doesNotMatch(sent[0].subject, /[\r\n]/);
});
test("pending/declined businesses never email their customers; declined not even the owner", async () => {
  M._resetMailLimits();
  const p = mk("pen"); assert.deepEqual((await run(p)).map((m) => m.to), ["dos@x.es"]); assert.equal(p.mail.at(-1).state, "skipped-unapproved");
  const d = mk("dec"); assert.deepEqual(await run(d), []); assert.equal(d.mail.at(-1).state, "skipped-unapproved");
});
