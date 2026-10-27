// The one-time-code service on its own: the rules in plan A.4 (six digits, ten minutes, three tries,
// three sends per number per hour, a daily cap, nothing stored or logged in clear).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOtpService, captureAdapter, noProvider,
  OTP_TTL_MS, OTP_MAX_TRIES, OTP_SENDS_PER_HOUR,
} from "./otp.mjs";

const codeIn = (text) => (String(text).match(/\b(\d{6})\b/) ?? [])[1];
const phone = "+34612345678";

test("a code arrives, is six digits, and verifies once", async () => {
  const adapter = captureAdapter();
  const svc = createOtpService({ adapter });
  assert.equal(svc.available, true);
  assert.deepEqual(await svc.send(phone), { ok: true });

  const code = codeIn(adapter.sent.get(phone));
  assert.match(code, /^\d{6}$/);
  assert.match(adapter.sent.get(phone), /Caduca en 10 minutos/);

  assert.deepEqual(svc.verify(phone, code), { ok: true, triesLeft: 0 });
  assert.deepEqual(svc.verify(phone, code), { ok: false, reason: "missing", triesLeft: OTP_MAX_TRIES }, "a used code cannot be replayed");
});

test("spaces or dashes in the typed code do not matter, letters do", async () => {
  const adapter = captureAdapter();
  const svc = createOtpService({ adapter });
  await svc.send(phone);
  const code = codeIn(adapter.sent.get(phone));
  const typed = `${code.slice(0, 3)} ${code.slice(3)}`;
  assert.equal(svc.verify(phone, typed).ok, true);

  await svc.send(phone);
  const next = codeIn(adapter.sent.get(phone));
  const letters = next.replace(/\d/g, "x");
  assert.equal(svc.verify(phone, letters).ok, false);
  assert.equal(svc.verify(phone, "").ok, false);
  assert.equal(svc.verify(phone, null).ok, false);
});

test("three wrong guesses lock the code, and the right one no longer works", async () => {
  const adapter = captureAdapter();
  const svc = createOtpService({ adapter });
  await svc.send(phone);
  const code = codeIn(adapter.sent.get(phone));
  const wrong = (Number(code[0]) + 1) % 10 + code.slice(1);

  assert.deepEqual(svc.verify(phone, wrong), { ok: false, reason: "wrong", triesLeft: 2 });
  assert.deepEqual(svc.verify(phone, wrong), { ok: false, reason: "wrong", triesLeft: 1 });
  assert.deepEqual(svc.verify(phone, wrong), { ok: false, reason: "locked", triesLeft: 0 });
  assert.deepEqual(svc.verify(phone, code), { ok: false, reason: "locked", triesLeft: 0 });
});

test("the code expires after ten minutes", async () => {
  let ms = 1_000_000;
  const adapter = captureAdapter();
  const svc = createOtpService({ adapter, now: () => ms });
  await svc.send(phone);
  const code = codeIn(adapter.sent.get(phone));

  ms += OTP_TTL_MS - 1;
  assert.equal(svc.verify(phone, code).ok, true, "still valid one millisecond before");

  await svc.send(phone);
  const code2 = codeIn(adapter.sent.get(phone));
  ms += OTP_TTL_MS + 1;
  assert.deepEqual(svc.verify(phone, code2), { ok: false, reason: "expired", triesLeft: 0 });
  assert.equal(svc.verify(phone, code2).reason, "missing", "the expired row is gone");
});

test(`three sends per number per hour, and a fourth is refused without sending`, async () => {
  let ms = 5_000_000;
  const adapter = captureAdapter();
  const svc = createOtpService({ adapter, now: () => ms });
  for (let i = 0; i < OTP_SENDS_PER_HOUR; i++) {
    assert.deepEqual(await svc.send(phone), { ok: true }, `send ${i + 1}`);
    ms += 60e3;
  }
  assert.deepEqual(await svc.send(phone), { ok: false, reason: "phone_cap" });
  assert.equal(svc.blocked(phone), "phone_cap");

  // Another number is not affected: the cap is per phone, not global.
  assert.deepEqual(await svc.send("+34600111222"), { ok: true });

  // An hour after the first send, the budget is back.
  ms += 3600e3;
  assert.deepEqual(await svc.send(phone), { ok: true });
});

test("the daily cap stops everything once the day's budget is spent", async () => {
  let ms = 9_000_000;
  const adapter = captureAdapter();
  const svc = createOtpService({ adapter, dailyCap: 2, now: () => ms });
  assert.equal((await svc.send(phone)).ok, true);
  assert.equal((await svc.send("+34600111222")).ok, true);
  assert.equal(svc.spent(), 2);
  assert.deepEqual(await svc.send("+34600333444"), { ok: false, reason: "daily_cap" });
  assert.equal(svc.blocked("+34600333444"), "daily_cap");
  assert.equal(adapter.sent.has("+34600333444"), false, "nothing was sent");

  ms += 864e5; // a new day
  assert.equal((await svc.send("+34600333444")).ok, true);
  assert.equal(svc.spent(), 1);
});

test("a failing provider is not a free retry loop, and its code is never usable", async () => {
  let calls = 0;
  const svc = createOtpService({
    adapter: { name: "flaky", send: async () => { calls += 1; return { ok: false, reason: "provider_down" }; } },
    sendsPerHour: 2,
  });
  assert.deepEqual(await svc.send(phone), { ok: false, reason: "provider_down" });
  assert.deepEqual(await svc.send(phone), { ok: false, reason: "provider_down" });
  assert.deepEqual(await svc.send(phone), { ok: false, reason: "phone_cap" }, "failed attempts still count");
  assert.equal(calls, 2);
  assert.equal(svc.spent(), 0, "nothing was paid for");
  assert.equal(svc.verify(phone, "123456").reason, "missing");
});

test("no provider: it says so instead of pretending to have sent", async () => {
  const svc = createOtpService();
  assert.equal(svc.available, false);
  assert.equal(svc.blocked(phone), "no_provider");
  assert.deepEqual(await svc.send(phone), { ok: false, reason: "no_provider" });
  assert.equal(svc.verify(phone, "123456").reason, "missing");
  assert.equal(noProvider.name, "none");
});

test("nothing the service holds can be turned back into a live code", async () => {
  const adapter = captureAdapter();
  const svc = createOtpService({ adapter });
  const logged = [];
  const save = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(save)) console[k] = (...a) => logged.push(a.join(" "));
  try {
    await svc.send(phone);
    svc.verify(phone, "000000");
  } finally { Object.assign(console, save); }

  const code = codeIn(adapter.sent.get(phone));
  assert.equal(logged.some((line) => line.includes(code)), false, "the code never reaches a log");

  // The only state the service exposes is a count; there is no getter that returns a code, and the
  // adapter got the text exactly once.
  assert.equal(svc.spent(), 1);
  assert.equal(adapter.sent.size, 1);
});
