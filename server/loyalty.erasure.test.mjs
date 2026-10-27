// Erasure and retention for phone-keyed members (plan L9): one person out, or one shop out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "loyalty-erase-"));
process.env.DATA_DIR = join(root, "data");
const { db, DATA_DIR } = await import("./store.mjs");
const L = await import("./loyalty.mjs");
const { purgeExpired } = await import("./retention.mjs");

const shopA = { id: "ea", name: "Casa Uno", token: "pa" }, shopB = { id: "eb", name: "Bar Dos", token: "pb" };
db.clients.push(shopA, shopB);
const live = (client) => { const p = L.createProgram(client, { type: "stamps" }); p.status = "live"; return p; };
const progA = live(shopA), progB = live(shopB);

const person = (phone, name) => {
  const { member } = L.findOrCreateMember({ phone, name });
  return { member, a: L.cardForMember(member, progA).customer, b: L.cardForMember(member, progB).customer };
};
const old = L.joinCustomer(progA, { name: "Vieja", email: "vieja@example.com", phone: "622 333 444" });
let anaId = "";

const auditLines = () => {
  const f = join(DATA_DIR, "erasure-audit.log");
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test("erasing a phone removes every card of that person, at every shop, and nothing else", async () => {
  const ana = person("+34 655 111 222", "Ana");
  anaId = ana.member.id;
  const bea = { member: L.findOrCreateMember({ phone: "+34 655 333 444", name: "Bea" }).member };
  bea.a = L.cardForMember(bea.member, progA).customer;
  L.ldb().consents.push(
    { id: "c1", memberId: ana.member.id, clientId: shopA.id, programId: progA.id, channel: "whatsapp", granted: true },
    { id: "c2", memberId: ana.member.id, clientId: shopB.id, programId: progB.id, channel: "email", granted: true },
    { id: "c3", memberId: bea.member.id, clientId: shopA.id, programId: progA.id, channel: "email", granted: true },
  );
  L.ldb().devices.push(
    { deviceId: "d1", pushToken: "t1", serial: ana.a.id, passTypeId: "p", at: Date.now() },
    { deviceId: "d2", pushToken: "t2", serial: bea.a.id, passTypeId: "p", at: Date.now() },
  );
  L.record(ana.a, progA, { kind: "visit" });
  L.record(ana.b, progB, { kind: "visit" }); // two cards, a join and a visit each

  const cardsBefore = L.ldb().customers.length, txnsBefore = L.ldb().txns.length;
  const r = await L.eraseMember("0034 655 111 222");
  assert.deepEqual(r, { found: true, cards: 2, txns: 4, shops: 2 });

  assert.equal(L.memberByPhone("+34655111222"), undefined, "the person is gone");
  assert.equal(L.ldb().customers.some((c) => c.memberId === ana.member.id), false, "both cards");
  assert.equal(L.ldb().customers.length, cardsBefore - 2);
  assert.equal(L.ldb().txns.length, txnsBefore - 4, "their transactions");
  assert.equal(L.ldb().devices.some((d) => d.serial === ana.a.id), false, "their wallet registrations");
  assert.equal(L.ldb().consents.some((x) => x.memberId === ana.member.id), false, "their consent records");

  // the other person and the old email card are untouched
  assert.equal(L.memberByPhone("+34655333444").id, bea.member.id);
  assert.ok(L.ldb().customers.some((c) => c.id === bea.a.id));
  assert.ok(L.ldb().customers.some((c) => c.id === old.id));
  assert.ok(L.ldb().consents.some((x) => x.id === "c3"));
  assert.ok(L.ldb().devices.some((d) => d.serial === bea.a.id));
});

test("the audit line proves the erasure without keeping what was erased", () => {
  const line = auditLines().at(-1);
  assert.equal(line.event, "member_erased");
  assert.deepEqual({ cards: line.cards, txns: line.txns, shops: line.shops }, { cards: 2, txns: 4, shops: 2 });
  assert.ok(line.at);
  const raw = JSON.stringify(line);
  for (const secret of ["655", "Ana", "111", anaId]) assert.equal(raw.includes(secret), false, secret);
});

test("asking twice is not an error, and an impossible number is", async () => {
  assert.deepEqual(await L.eraseMember("+34 655 111 222"), { found: false, cards: 0, txns: 0, shops: 0 });
  for (const bad of ["12345", "abcdef", "", "+340 655 111 222"]) {
    await assert.rejects(() => L.eraseMember(bad), (e) => e.status === 400 && /phone number/.test(e.message), bad);
  }
});

test("deleting a business removes its cards and consents and leaves the person's other cards alone", async () => {
  const dana = person("+34 655 555 666", "Dana");
  const eve = { member: L.findOrCreateMember({ phone: "+34 655 777 999", name: "Eve" }).member };
  eve.a = L.cardForMember(eve.member, progA).customer;
  L.ldb().consents.push(
    { id: "c4", memberId: dana.member.id, clientId: shopA.id, programId: progA.id, channel: "email", granted: true },
    { id: "c5", memberId: dana.member.id, clientId: shopB.id, programId: progB.id, channel: "email", granted: true },
  );

  const counts = await L.removeClientData(shopA.id);
  assert.equal(counts.customers, 4, "two cards from this test, Bea's from the first, and the old email card");
  assert.equal(counts.members, 2, "Bea and Eve had no other shop, so they go with it");
  assert.equal(counts.programs, 1);

  assert.equal(L.memberByPhone("+34655777999"), undefined, "Eve is gone");
  assert.ok(L.memberByPhone("+34655555666"), "Dana also holds a card at the other shop, so she stays");
  assert.ok(L.ldb().customers.some((c) => c.id === dana.b.id), "and keeps that card");
  assert.equal(L.ldb().customers.some((c) => c.id === old.id), false, "the old email card went with the shop");
  assert.equal(L.ldb().consents.some((x) => x.clientId === shopA.id), false, "shop A's consents are gone");
  assert.ok(L.ldb().consents.some((x) => x.id === "c5"), "shop B's consent is not");
  assert.equal(L.ldb().devices.some((d) => d.serial === eve.a.id), false);
  assert.equal(L.ldb().programs.some((p) => p.clientId === shopA.id), false);
});

test("the inactivity purge takes the cards and, with them, the person left with none", async () => {
  const shop = { id: "ec", name: "Tres", token: "pc" }; db.clients.push(shop);
  const prog = live(shop);
  const { member } = L.findOrCreateMember({ phone: "+34 655 000 111", name: "Carla" });
  const stale = L.cardForMember(member, prog).customer;
  const long = new Date(Date.now() - 800 * 864e5).toISOString();
  stale.createdAt = stale.updatedAt = stale.lastVisitAt = long;
  const keep = L.ldb().customers.find((c) => c.memberId && c.programId === progB.id && c.id !== stale.id);
  assert.ok(keep, "Dana's card at the shop that was not deleted");
  keep.lastVisitAt = ""; keep.updatedAt = keep.createdAt = new Date().toISOString();

  const dry = await purgeExpired({ loyaltyInactiveDays: 730, dryRun: true });
  assert.equal(dry.loyaltyCustomers, 1);
  assert.equal(dry.loyaltyMembers, 1);
  assert.ok(L.ldb().customers.some((c) => c.id === stale.id), "a dry run changes nothing");

  const real = await purgeExpired({ loyaltyInactiveDays: 730 });
  assert.equal(real.loyaltyCustomers, 1);
  assert.equal(real.loyaltyMembers, 1);
  assert.equal(L.ldb().customers.some((c) => c.id === stale.id), false);
  assert.equal(L.memberByPhone("+34655000111"), undefined, "no name and number kept for a shop that can no longer use them");
  assert.ok(L.memberByPhone("+34655555666"), "an active person is not touched");
  assert.ok(L.ldb().customers.some((c) => c.id === keep.id));
});
