import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";

process.env.DATA_DIR = mkdtempSync(pjoin(tmpdir(), "loy-"));
const L = await import("./loyalty.mjs");
const { db } = await import("./store.mjs");

db.clients.push({ id: "c1", name: "Cafe Uno", token: "tok1" }, { id: "c2", name: "Bar Dos", token: "tok2" });
const c1 = db.clients[0];
const live = (fields) => { const p = L.createProgram(c1, fields); L.updateProgram(p, { status: "live" }); return p; };
const join = (p, name = "Ana") => L.joinCustomer(p, { name, email: "ana@example.com" });
const T0 = Date.parse("2026-01-01T10:00:00Z"), MIN = 60e3, DAY = 864e5;
let changed = [];
L.setOnCardChanged((c) => changed.push(c.id));

test("createProgram: draft, codes, default design, starter reward", () => {
  const p = L.createProgram(c1, { type: "stamps", status: "live", design: { background: "nope", layout: "weird" } });
  assert.equal(p.status, "draft");
  assert.match(p.joinCode, /^[a-z0-9]{6}$/);
  assert.ok(p.staffToken.length >= 12);
  assert.match(p.design.background, /^#[0-9a-f]{6}$/);
  assert.ok(["stripe", "minimal", "full"].includes(p.design.layout));
  assert.equal(p.rewards.length, 1);
  assert.equal(p.rewards[0].cost, p.stamps.goal);
});

test("draft and paused programmes refuse join and record", () => {
  const p = L.createProgram(c1, {});
  assert.throws(() => L.joinCustomer(p, { name: "A", email: "a@b.co" }), /not open yet/);
  const q = live({}); const c = join(q);
  L.updateProgram(q, { status: "paused" });
  assert.throws(() => L.record(c, q, { kind: "visit" }), (e) => e.status === 409 && /not open yet/.test(e.message));
});

test("join validates input and applies welcome bonus", () => {
  const p = live({ welcomeBonus: { stamps: 2, points: 0 } });
  assert.throws(() => L.joinCustomer(p, { name: " ", email: "a@b.co" }), /name/);
  assert.throws(() => L.joinCustomer(p, { name: "A", email: "bad" }), /email/);
  assert.throws(() => L.joinCustomer(p, { name: "A" }), /email/);
  const c = L.joinCustomer(p, { name: "Ana", email: "a@b.co", marketingConsent: true });
  assert.equal(c.stamps, 2);
  assert.equal(c.marketingConsent, true);
  assert.ok(c.cardToken.length >= 20 && c.authToken);
  assert.equal(L.codeOf(c), `LC1-${c.id}`);
  assert.equal(L.lookupByCode(L.codeOf(c)).customer, c);
  assert.equal(L.lookupByCode("LC1-nope"), null);
});

test("stamps: visit adds stamps, caps at goal, 10 minute guard, redeem carries over", () => {
  const p = live({ stamps: { goal: 3, perVisit: 2 } });
  const c = join(p);
  L.record(c, p, { kind: "visit", at: T0 });
  assert.equal(c.stamps, 2);
  assert.throws(() => L.record(c, p, { kind: "visit", at: T0 + 5 * MIN }), (e) => e.status === 409 && /Try again/.test(e.message));
  const r = L.record(c, p, { kind: "visit", at: T0 + 11 * MIN });
  assert.equal(c.stamps, 3); // capped
  assert.match(r.message, /3 of 3/);
  assert.throws(() => L.record(c, p, { kind: "visit", at: T0 + 30 * MIN }), /full/);
  const rid = p.rewards[0].id;
  const red = L.record(c, p, { kind: "redeem", rewardId: rid, at: T0 + 31 * MIN });
  assert.equal(c.stamps, 0);
  assert.equal(c.redemptions.length, 1);
  assert.equal(red.txn.stamps, -3);
  assert.throws(() => L.record(c, p, { kind: "redeem", rewardId: rid }), /Not enough/);
});

test("stamps: purchase needs minSpend; extra stamps carry over", () => {
  const p = live({ stamps: { goal: 5, perVisit: 1, minSpendEur: 5 } });
  L.updateProgram(p, { rewards: [{ name: "Cheap", kind: "stamps", cost: 2 }] });
  const c = join(p);
  assert.throws(() => L.record(c, p, { kind: "purchase", amountEur: 3, at: T0 }), /at least/);
  assert.throws(() => L.record(c, p, { kind: "purchase", amountEur: 0, at: T0 }), /amount/);
  L.record(c, p, { kind: "purchase", amountEur: 5, at: T0 });
  L.record(c, p, { kind: "visit", at: T0 + 20 * MIN });
  L.record(c, p, { kind: "visit", at: T0 + 40 * MIN });
  assert.equal(c.stamps, 3);
  L.record(c, p, { kind: "redeem", rewardId: p.rewards[0].id });
  assert.equal(c.stamps, 1);
});

test("points: purchase = floor(eur*perEuro)+perVisit, redeem keeps lifetime", () => {
  const p = live({ type: "points", points: { perEuro: 2, perVisit: 1 }, rewards: [{ name: "Coffee", kind: "points", cost: 10 }] });
  const c = join(p);
  const r = L.record(c, p, { kind: "purchase", amountEur: 4.75, at: T0 });
  assert.equal(r.txn.points, 10); // floor(9.5)+1
  assert.equal(c.points, 10);
  L.record(c, p, { kind: "visit", at: T0 + MIN }); // points have no stamp guard
  assert.equal(c.points, 11);
  const rid = p.rewards[0].id;
  L.record(c, p, { kind: "redeem", rewardId: rid });
  assert.equal(c.points, 1);
  assert.equal(c.lifetimePoints, 11);
  assert.equal(c.stamps, 0);
  assert.equal(c.visits, 2);
});

test("tiers: by lifetime points, gate rewards, nextTier", () => {
  const p = live({ type: "custom", tiers: [{ name: "Gold", minPoints: 100 }, { name: "Base", minPoints: 7 }, { name: "Silver", minPoints: 50 }], points: { perEuro: 1, perVisit: 0 },
    rewards: [{ name: "Gold gift", kind: "points", cost: 10, minTier: "Gold" }, { name: "Basic", kind: "points", cost: 10 }] });
  assert.deepEqual(p.tiers.map((t) => [t.name, t.minPoints]), [["Base", 0], ["Silver", 50], ["Gold", 100]]);
  const c = join(p);
  assert.equal(c.tier, "Base");
  L.record(c, p, { kind: "purchase", amountEur: 60, at: T0 });
  assert.equal(c.tier, "Silver");
  const gold = p.rewards.find((r) => r.minTier === "Gold");
  assert.throws(() => L.record(c, p, { kind: "redeem", rewardId: gold.id }), /Gold tier/);
  assert.equal(L.rewardStatus(c, p, gold).available, false);
  L.record(c, p, { kind: "redeem", rewardId: p.rewards[1].id }); // spends points, tier stays on lifetime
  assert.equal(c.tier, "Silver");
  assert.deepEqual(L.cardView(c, p).customer.nextTier, { name: "Gold", pointsToGo: 40 });
  L.record(c, p, { kind: "purchase", amountEur: 40, at: T0 + 20 * MIN });
  assert.equal(c.tier, "Gold");
  assert.equal(L.cardView(c, p).customer.nextTier, null);
  assert.equal(L.record(c, p, { kind: "redeem", rewardId: gold.id }).customer.points, 80);
});

test("custom type earns stamps and points together", () => {
  const p = live({ type: "custom", stamps: { goal: 4, perVisit: 1, minSpendEur: 10 }, points: { perEuro: 1, perVisit: 0 } });
  const c = join(p);
  L.record(c, p, { kind: "purchase", amountEur: 3, at: T0 });
  assert.equal(c.stamps, 0); assert.equal(c.points, 3);
  L.record(c, p, { kind: "purchase", amountEur: 12, at: T0 + MIN });
  assert.equal(c.stamps, 1); assert.equal(c.points, 15);
});

test("redemption voucher expiry and inactive rewards", () => {
  const p = live({ rewards: [{ name: "Gift", kind: "stamps", cost: 1, expiresDays: 14 }, { name: "Old", kind: "stamps", cost: 1, active: false }] });
  const c = join(p);
  L.record(c, p, { kind: "visit", at: T0 });
  assert.throws(() => L.record(c, p, { kind: "redeem", rewardId: p.rewards[1].id }), /not available/);
  L.record(c, p, { kind: "redeem", rewardId: p.rewards[0].id, at: T0 });
  assert.equal(c.redemptions[0].expiresAt, new Date(T0 + 14 * DAY).toISOString());
  assert.match(c.redemptions[0].code, /^[A-Z0-9]{6}$/);
  assert.equal(L.staffCustomer(c, p).rewards.length, 1);
});

test("points expire lazily and are recorded as an adjust txn", () => {
  const p = live({ type: "points", points: { perEuro: 1, perVisit: 0 }, pointsExpireDays: 30, rewards: [{ name: "R", kind: "points", cost: 5 }] });
  const c = join(p);
  L.record(c, p, { kind: "purchase", amountEur: 20, at: T0 });
  L.record(c, p, { kind: "purchase", amountEur: 10, at: T0 + 40 * DAY }); // first 20 are now 40 days old
  assert.equal(c.points, 10);
  assert.equal(c.lifetimePoints, 30);
  const t = L.txnsOf(c).find((x) => x.type === "adjust");
  assert.equal(t.points, -20);
  assert.equal(t.by, "system");
  assert.equal(L.expirePoints(c, p, T0 + 41 * DAY), 0); // idempotent
  // spending first consumes the oldest points
  const c2 = join(p, "Bo");
  L.record(c2, p, { kind: "purchase", amountEur: 10, at: T0 });
  L.record(c2, p, { kind: "redeem", rewardId: p.rewards[0].id, at: T0 + DAY });
  assert.equal(L.expirePoints(c2, p, T0 + 40 * DAY), 5);
  assert.equal(c2.points, 0);
});

test("adjust: clamps, keeps lifetime, notes, notifies", () => {
  const p = live({ stamps: { goal: 5, perVisit: 1 }, type: "custom" });
  const c = join(p);
  changed = [];
  L.adjust(c, p, { stamps: 9, points: 20, note: "gift" });
  assert.equal(c.stamps, 5); assert.equal(c.points, 20); assert.equal(c.lifetimePoints, 20);
  L.adjust(c, p, { stamps: -9, points: -50 });
  assert.equal(c.stamps, 0); assert.equal(c.points, 0); assert.equal(c.lifetimePoints, 20);
  assert.throws(() => L.adjust(c, p, {}), /Enter/);
  assert.ok(changed.length >= 2);
  assert.ok(c.updatedAt);
  assert.equal(L.txnsOf(c).at(-2).note, "gift");
});

test("onCardChanged fires on every card change and never breaks recording", () => {
  const p = live({});
  const c = join(p);
  changed = [];
  L.record(c, p, { kind: "visit", at: T0 });
  assert.deepEqual(changed, [c.id]);
  L.setOnCardChanged(() => { throw new Error("push failed"); });
  assert.doesNotThrow(() => L.record(c, p, { kind: "visit", at: T0 + 20 * MIN }));
  L.setOnCardChanged((x) => changed.push(x.id));
});

test("cardView and programView shape; scoping by programme", () => {
  const p = live({});
  const c = join(p);
  const v = L.cardView(c, p, { baseUrl: "https://x.test", walletConfigured: true });
  assert.equal(v.business.name, "Cafe Uno");
  assert.equal(v.code, `LC1-${c.id}`);
  assert.equal(v.wallet.available, true);
  assert.equal(v.installUrl, `https://x.test/card/${c.cardToken}`);
  assert.equal(v.history[0].type, "join");
  assert.ok(!("staffToken" in v.program));
  const pv = L.programView(p, { baseUrl: "https://x.test" });
  assert.equal(pv.joinUrl, `https://x.test/join/${p.joinCode}`);
  assert.equal(pv.stats.customers, 0 + L.ldb().customers.filter((x) => x.programId === p.id).length);
  const other = live({});
  assert.throws(() => L.record(c, other, { kind: "visit" }), (e) => e.status === 404);
});

test("stats count txns; removeProgram cleans up customers, txns, devices", () => {
  const p = live({});
  const c = join(p);
  L.record(c, p, { kind: "visit", at: T0 });
  const s = L.stats(p);
  assert.equal(s.customers, 1); assert.equal(s.visits, 1); assert.equal(s.stampsGiven, 1);
  L.ldb().devices.push({ deviceId: "d", pushToken: "t", serial: c.id, passTypeId: "x", at: "" });
  assert.equal(L.customerRow(c).walletDevices, 1);
  L.removeProgram(p);
  assert.equal(L.findCustomer(c.id), undefined);
  assert.equal(L.ldb().txns.some((t) => t.programId === p.id), false);
  assert.equal(L.ldb().devices.some((d) => d.serial === c.id), false);
});

test("sanitize: rewards, design files and bounds", () => {
  const p = L.createProgram(c1, { stamps: { goal: 6 }, rewards: [{ name: "  ", cost: 1 }, { name: "Big", kind: "stamps", cost: 99 }, { name: "P", kind: "points", cost: -4 }] });
  assert.equal(p.rewards.length, 2);
  assert.equal(p.rewards[0].cost, 6); // capped at goal
  assert.equal(p.rewards[1].cost, 1);
  const { program } = L.updateProgram(p, { design: { logoFile: "../../etc/passwd", stripFile: "a.png", accent: "#ABCDEF", stampIcon: "🍕🍕🍕" } });
  assert.equal(program.design.logoFile, "");
  assert.equal(program.design.stripFile, "a.png");
  assert.equal(program.design.accent, "#abcdef");
  assert.equal([...program.design.stampIcon].length, 2);
});

test("updateProgram reports whether cards must refresh", () => {
  const p = live({});
  assert.equal(L.updateProgram(p, { status: "paused" }).changed, false);
  assert.equal(L.updateProgram(p, { design: { accent: "#123456" } }).changed, true);
  assert.equal(L.updateProgram(p, { design: { accent: "#123456" } }).changed, false);
});

test("duplicate copies settings with fresh ids and draft status", () => {
  const p = live({ name: "Orig", terms: "t" });
  const d = L.duplicateProgram(p);
  assert.notEqual(d.id, p.id); assert.notEqual(d.joinCode, p.joinCode); assert.notEqual(d.staffToken, p.staffToken);
  assert.equal(d.status, "draft"); assert.equal(d.terms, "t");
  assert.notEqual(d.rewards[0].id, p.rewards[0].id);
});
