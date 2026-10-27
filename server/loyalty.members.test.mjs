import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "loyalty-members-"));
process.env.DATA_DIR = join(root, "data"); process.env.SITES_DIR = join(root, "sites");
const { db } = await import("./store.mjs");
const L = await import("./loyalty.mjs");

const shopA = { id: "shop-a", name: "Casa Mar", token: "ta", languages: ["es"] };
const shopB = { id: "shop-b", name: "Bar Solo", token: "tb", languages: ["es"] };
db.clients.push(shopA, shopB);
const live = (client, fields = {}) => { const p = L.createProgram(client, { type: "stamps", welcomeBonus: { stamps: 0, points: 0 }, ...fields }); p.status = "live"; return p; };
const progA = live(shopA);
const progB = live(shopB);

test("one person, however they type their number", () => {
  const a = L.findOrCreateMember({ phone: "612 345 678", name: "Ana" });
  assert.equal(a.created, true);
  assert.equal(a.member.phone, "+34612345678");
  for (const way of ["+34 612345678", "0034612345678", "(+34) 612-345-678", "+34612345678"]) {
    const again = L.findOrCreateMember({ phone: way });
    assert.equal(again.member.id, a.member.id, way);
    assert.equal(again.created, false, way);
  }
  assert.equal(L.ldb().members.length, 1);
  assert.equal(L.memberByPhone("0034 612 345 678").id, a.member.id);
});

test("a number that cannot exist is refused, not guessed", () => {
  const before = L.ldb().members.length;
  for (const bad of ["12345", "abcdefghi", "+34 512 345 678", "+340 612 345 678", ""]) {
    assert.throws(() => L.findOrCreateMember({ phone: bad }), (e) => e.status === 400 && /phone number/.test(e.message), bad);
  }
  assert.equal(L.ldb().members.length, before, "no half-made member was left behind");
  assert.equal(L.memberByPhone("nonsense"), undefined);
});

test("the card is created once and reused: no second welcome bonus, no second join", () => {
  const shop = { id: "shop-c", name: "Café", token: "tc" }; db.clients.push(shop);
  const p = live(shop, { welcomeBonus: { stamps: 2, points: 0 } });
  const { member } = L.findOrCreateMember({ phone: "+34 600 111 222" });

  const first = L.cardForMember(member, p);
  assert.equal(first.created, true);
  assert.equal(first.customer.stamps, 2, "welcome bonus applied");
  assert.equal(first.customer.memberId, member.id);
  assert.equal(first.customer.email, "", "phone-first cards need no email");

  const second = L.cardForMember(member, p);
  assert.equal(second.created, false);
  assert.equal(second.customer.id, first.customer.id);
  assert.equal(second.customer.stamps, 2, "the bonus was not applied twice");

  const joins = L.txnsOf(first.customer).filter((t) => t.type === "join");
  assert.equal(joins.length, 1);
  assert.equal(L.ldb().customers.filter((c) => c.memberId === member.id).length, 1);
});

test("one member, two shops: two cards with balances that never mix", () => {
  const a = { id: "shop-d", name: "Uno", token: "td" }, b = { id: "shop-e", name: "Dos", token: "te" };
  db.clients.push(a, b);
  const pa = live(a), pb = live(b);
  const { member } = L.findOrCreateMember({ phone: "+34 600 333 444", name: "Bea" });

  const cardA = L.cardForMember(member, pa).customer;
  const cardB = L.cardForMember(member, pb).customer;
  assert.notEqual(cardA.id, cardB.id);
  assert.equal(cardA.programId, pa.id);
  assert.equal(cardB.programId, pb.id);
  assert.equal(L.memberOf(cardA).id, member.id);

  L.record(cardA, pa, { kind: "visit" });
  assert.equal(cardA.stamps, 1);
  assert.equal(cardB.stamps, 0, "a stamp at one shop is invisible at the other");
  assert.equal(L.ldb().customers.filter((c) => c.memberId === member.id).length, 2);
});

test("cards from before this change are left exactly as they are", () => {
  const before = L.ldb().customers.length;
  const c = L.joinCustomer(progA, { name: "Vieja", email: "vieja@example.com" });
  assert.equal(c.memberId, undefined, "no member is invented for an email card");
  assert.equal(L.memberOf(c), undefined);
  assert.equal(c.email, "vieja@example.com");
  assert.equal(L.ldb().customers.length, before + 1);
  assert.equal(L.ldb().members.some((m) => m.id === c.memberId), false);
  // and it still scans, stamps and shows as before
  assert.equal(L.record(c, progA, { kind: "visit" }).customer.stamps, 1);
  assert.equal(L.lookupByCode(L.codeOf(c)).customer.id, c.id);
});

test("a programme that is not live still refuses cards, member or not", () => {
  const shop = { id: "shop-f", name: "Draft", token: "tf" }; db.clients.push(shop);
  const p = L.createProgram(shop, { type: "stamps" });
  const { member } = L.findOrCreateMember({ phone: "+34 600 555 666" });
  assert.throws(() => L.cardForMember(member, p), (e) => e.status === 409);
  p.status = "live";
  assert.equal(L.cardForMember(member, p).created, true);
});

test("the device token is long, random and unique per member", () => {
  const tokens = new Set();
  for (let i = 0; i < 20; i++) {
    const { member } = L.findOrCreateMember({ phone: `+34 7${String(10000000 + i)}` });
    assert.ok(member.memberToken.length >= 16);
    assert.match(member.memberToken, /^[A-Za-z0-9_-]+$/);
    tokens.add(member.memberToken);
    assert.equal(L.memberByToken(member.memberToken).id, member.id);
  }
  assert.equal(tokens.size, 20);
  assert.equal(L.memberByToken("short"), undefined);
  assert.equal(L.memberByToken(undefined), undefined);
});

test("a name given later fills an empty member; locale is only es or en", () => {
  const { member } = L.findOrCreateMember({ phone: "+34 600 777 888", locale: "fr" });
  assert.equal(member.name, "");
  assert.equal(member.locale, "es", "unsupported locales fall back to Spanish");
  const { member: same } = L.findOrCreateMember({ phone: "+34 600 777 888", name: "Carla", locale: "en" });
  assert.equal(same.id, member.id);
  assert.equal(same.name, "Carla");
  assert.equal(same.locale, "es", "an existing member keeps their language");
});
