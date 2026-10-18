import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "bk-"));
const B = await import("./bookings.mjs");
const M = await import("./booking-mail.mjs");
const { db } = await import("./store.mjs");

db.clients.push({ id: "r1", name: "Bar Uno", kind: "restaurant", phone: "600", email: "bar@x.es" }, { id: "h1", name: "Hotel Mar", kind: "small hotel" });
const rest = B.ensureConfig(db.clients[0]), hotel = B.ensureConfig(db.clients[1]);
B.updateConfig(rest, { enabled: true, table: { seats: 10, maxParty: 6, week: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, ranges: [["20:00", "22:00"]] })) } });
B.updateConfig(hotel, { enabled: true, room: { roomTypes: [{ name: "Double", count: 1, maxGuests: 2 }] } });
const future = (n) => B.addDays(B.localNow().date, n);
let mails = [];
B.setOnBookingChange((b, ev) => mails.push([b.id, ev]));
const T = (o = {}) => ({ name: "Ana", email: "ana@example.com", date: future(3), time: "20:00", party: 4, ...o });

test("kind defaults: hotels get rooms, others tables", () => {
  assert.equal(rest.kind, "table"); assert.equal(hotel.kind, "room");
});
test("email is required and validated", () => {
  assert.throws(() => B.createBooking(rest, T({ email: "" })), /email/i);
  assert.throws(() => B.createBooking(rest, T({ email: "nope" })), /email/i);
});
test("slots respect hours, party limits and capacity", () => {
  const s = B.tableSlots(rest, future(3), 4);
  assert.deepEqual(s.map((x) => x.time), ["20:00", "20:30", "21:00", "21:30"]);
  assert.throws(() => B.tableSlots(rest, future(3), 9), /Parties of/);
  const b = B.createBooking(rest, T());
  assert.equal(b.status, "confirmed");
  assert.equal(B.tableSlots(rest, future(3), 6).find((x) => x.time === "20:00").available, true); // 4 + 6 = 10 seats fits
  assert.equal(B.tableSlots(rest, future(3), 6).find((x) => x.time === "21:30").available, true); // 90 min later, no overlap
});
test("overbooking is refused with a 409", () => {
  B.createBooking(rest, T({ party: 6 })); // 4 + 6 = 10, full at 20:00
  assert.throws(() => B.createBooking(rest, T({ party: 2, time: "20:30" })), (e) => e.status === 409);
});
test("past dates and closed dates", () => {
  assert.throws(() => B.tableSlots(rest, B.addDays(B.localNow().date, -1), 2), /past/);
  B.updateConfig(rest, { closedDates: [future(9)] });
  assert.deepEqual(B.tableSlots(rest, future(9), 2), []);
});
test("cancel frees capacity; no-show only after time; transitions", () => {
  const b = B.createBooking(rest, T({ date: future(5), party: 6 }));
  B.createBooking(rest, T({ date: future(5), party: 4 })); // 6 + 4 = full
  assert.equal(B.tableSlots(rest, future(5), 1).find((x) => x.time === "20:00").available, false);
  assert.throws(() => B.setStatus(b, "no_show"), /time/);
  B.setStatus(b, "cancelled", { by: "customer" });
  assert.equal(B.tableSlots(rest, future(5), 6).find((x) => x.time === "20:00").available, true);
  assert.throws(() => B.setStatus(b, "no_show", { by: "customer" }), /cancelled online/);
  B.setStatus(b, "confirmed"); // re-confirming re-checks capacity
  assert.equal(b.status, "confirmed");
});
test("manual approval mode creates pending bookings", () => {
  B.updateConfig(rest, { autoConfirm: false });
  const b = B.createBooking(rest, T({ date: future(6), party: 2 }));
  assert.equal(b.status, "pending");
  B.setStatus(b, "confirmed");
  B.updateConfig(rest, { autoConfirm: true });
});
test("disabled business refuses public bookings", () => {
  B.updateConfig(rest, { enabled: false });
  assert.throws(() => B.createBooking(rest, T()), (e) => e.status === 409);
  B.updateConfig(rest, { enabled: true });
});
test("rooms: date ranges, overlap and capacity", () => {
  const rt = hotel.room.roomTypes[0];
  const a = B.roomAvailability(hotel, future(10), future(12), 2);
  assert.equal(a[0].available, true);
  const bk = B.createBooking(hotel, { name: "Bo", email: "bo@example.com", checkIn: future(10), checkOut: future(12), guests: 2, roomTypeId: rt.id });
  assert.equal(bk.nights, 2);
  assert.equal(B.roomAvailability(hotel, future(11), future(13), 2)[0].available, false);
  assert.equal(B.roomAvailability(hotel, future(12), future(13), 2)[0].available, true); // check-out day is free
  assert.equal(B.roomAvailability(hotel, future(10), future(11), 3).length, 0); // too many guests
  assert.throws(() => B.createBooking(hotel, { name: "Cy", email: "cy@example.com", checkIn: future(11), checkOut: future(12), guests: 1, roomTypeId: rt.id }), (e) => e.status === 409);
  assert.throws(() => B.roomAvailability(hotel, future(12), future(10), 1), /nights/);
  B.setStatus(bk, "cancelled", { by: "customer" });
  assert.equal(B.roomAvailability(hotel, future(11), future(13), 2)[0].available, true);
});
test("mail: ES/EN, manage link, transactional footer, no send when unconfigured", async () => {
  const b = B.createBooking(rest, T({ date: future(7), lang: "en" }));
  const en = M.renderEmail(b, "created", { baseUrl: "https://x.test", biz: "Bar Uno", phone: "600" });
  assert.match(en.subject, /confirmed/); assert.match(en.text, /\/booking\//); assert.match(en.text, /not advertising/);
  b.lang = "es";
  assert.match(M.renderEmail(b, "cancelled", { baseUrl: "https://x.test", biz: "Bar Uno" }).subject, /cancelada/);
  assert.equal(M.renderEmail(b, "no_show", { baseUrl: "x", biz: "y" }), null);
  delete process.env.RESEND_API_KEY;
  await M.bookingMailer({ baseUrl: () => "https://x.test" })(b, "created");
  assert.equal(b.mail.at(-1).state, "not-configured");
  const sent = [];
  await M.bookingMailer({ baseUrl: () => "https://x.test", sender: async (m) => sent.push(m.to) })(b, "created");
  assert.deepEqual(sent, [b.email, "bar@x.es"]);
});
