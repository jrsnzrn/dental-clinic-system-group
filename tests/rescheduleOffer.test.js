import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const handlers = source.slice(
  source.indexOf("exports.approveReschedule ="),
  source.indexOf("exports.declineReschedule =")
);
const emailShell = source.slice(source.indexOf("function createEmailShell("), source.indexOf("function createBookingDetailsHtml("));

test("reschedule availability excludes the current time and overlapping bookings for the same dentist", () => {
  const context = {
    BOOKING_SLOT_INTERVAL_MINUTES: 45,
    getDentistDaySchedule: () => ({ active: true, start: "09:00", end: "12:00" }),
    getManilaNowContext: () => ({ date: "2099-04-09", minutes: 0 }),
    timeToMinutes: (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3)),
    minutesToTime: (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`,
    generateSlots: () => ["09:00", "09:45", "10:30", "11:15"],
    isActiveBooking: (booking) => booking.status !== "cancelled",
    getStoredBookingDurationMinutes: (booking) => booking.estimatedDurationMinutes,
    doIntervalsOverlap: (start, end, otherStart, otherEnd) => start < otherEnd && end > otherStart,
    formatTimeLabel: (time) => time,
  };
  const builder = source.slice(source.indexOf("function buildAvailabilityResponse("), source.indexOf("async function assertRateLimit("));
  const availability = vm.runInNewContext(`${builder}\nbuildAvailabilityResponse`, context);
  const date = "2099-04-10";
  const rescheduleBooking = { id: "own", date, time: "09:00", dentistId: "dentist", estimatedDurationMinutes: 60 };
  const { availableSlots } = availability({
    date,
    dentist: { id: "dentist" },
    rescheduleBooking,
    bookings: [
      rescheduleBooking,
      { dentistId: "dentist", time: "10:30", estimatedDurationMinutes: 45, status: "pending" },
      { dentistId: "other", time: "09:45", estimatedDurationMinutes: 45, status: "approved" },
    ],
  });
  assert.deepEqual([...availableSlots], []);
  const otherDentistOnly = availability({
    date, dentist: { id: "dentist" }, rescheduleBooking,
    bookings: [{ dentistId: "other", time: "09:45", estimatedDurationMinutes: 45, status: "approved" }],
  });
  assert.deepEqual([...otherDentistOnly.availableSlots], ["09:45", "10:30"]);
});

function setup({ slotTaken = false, requestedSlotTaken = false, emailFails = false, now = Date.parse("2099-04-08T09:00:00+08:00") } = {}) {
  const timestamp = (value) => ({ toMillis: () => value, toDate: () => new Date(value) });
  const booking = {
    uid: "patient",
    email: "patient@example.com",
    fullName: "Pat & Lee",
    status: "pending",
    dentistId: "dentist",
    date: "2099-04-10",
    time: "09:00",
    rescheduleRequest: { status: "pending", requestedDate: "2099-04-10", requestedTime: "10:00" },
  };
  const writes = [];
  const emails = [];
  const exports = {};
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  vm.runInNewContext(emailShell + handlers, {
    exports,
    Date: class extends Date { static now() { return now; } },
    HttpsError,
    onCall: (...args) => args.at(-1),
    gmailEmail: {},
    gmailAppPassword: {},
    crypto: { randomUUID: () => "offer" },
    admin: { firestore: { Timestamp: { fromMillis: timestamp }, FieldValue: { serverTimestamp: () => "now" } } },
    db: {
      collection: () => ({
        doc: (id) => ({ id, get: async () => ({ id, exists: true, data: () => ({ ...booking }) }) }),
      }),
      runTransaction: async (callback) => callback({
        get: async () => ({ exists: true, data: () => ({ ...booking }) }),
        update: (_, changes) => Object.assign(booking, changes),
        set: (ref) => writes.push(ref.id),
      }),
    },
    getStaffContextFromRequest: async () => ({ uid: "staff" }),
    loadRescheduleSlots: async () => ["08:00", "10:00", "11:00"],
    getLockSnapshots: async () => ({ lockRefs: [], lockSnaps: [] }),
    deleteOwnedLocks: () => writes.push("released original slot"),
    validateStaffBookingSlot: async (_, { nextDate, nextTime }) => {
      if (slotTaken && emails.length) throw new HttpsError("already-exists", "Taken");
      if (requestedSlotTaken && nextTime === booking.rescheduleRequest.requestedTime) {
        throw new HttpsError("already-exists", "Taken");
      }
      return {
        appointmentAt: timestamp(Date.parse(`${nextDate}T${nextTime}:00+08:00`)),
        lockRefs: [{ id: "alternate slot" }],
        window: { dentistId: booking.dentistId, date: nextDate, time: nextTime },
      };
    },
    createManilaAppointmentDate: (date, time) => new Date(`${date}T${time}:00+08:00`),
    createTransporter: () => ({
      senderEmail: "clinic@example.com",
      transporter: { sendMail: async (message) => {
        emails.push(message);
        if (emailFails) throw new Error("SMTP unavailable");
      } },
    }),
    console: { error() {} },
  });
  return {
    booking, writes, emails,
    offer: (time = "11:00", date = booking.date) => exports.offerReschedule({ data: { bookingId: "booking", date, time } }),
    getOfferAvailability: (date = booking.date) => exports.getRescheduleOfferAvailability({ data: { bookingId: "booking", date } }),
    approveRequest: () => exports.approveReschedule({ data: { bookingId: "booking" } }),
    respond: (accept, uid = booking.uid) => exports.respondToRescheduleOffer({
      auth: { uid }, data: { bookingId: "booking", offerId: "offer", accept },
    }),
  };
}

test("an offer emails the booking owner and preserves the original slot until acceptance", async () => {
  const flow = setup();
  assert.equal((await flow.offer()).emailSent, true);
  assert.equal(flow.emails[0].to, flow.booking.email);
  const { expiresAt, offeredAt } = flow.booking.rescheduleOffer;
  assert.equal(expiresAt.toMillis() - offeredAt.toMillis(), 2 * 60 * 60 * 1000);
  assert.match(flow.emails[0].text, /original appointment.*remains scheduled/);
  assert.doesNotMatch(flow.emails[0].text, /already been booked/);
  assert.match(flow.emails[0].html, /Hello Pat &amp; Lee/);
  assert.match(flow.emails[0].html, /If this time works for you, please let us know by/);
  assert.match(flow.emails[0].html, /href="https:\/\/topdent\.website\/my-appointments"/);
  assert.match(flow.emails[0].text, /https:\/\/topdent\.website\/my-appointments/);
  assert.equal(flow.booking.time, "09:00");
  assert.deepEqual(flow.writes, []);

  await flow.respond(true);
  await flow.respond(true);
  assert.equal(flow.booking.time, "11:00");
  assert.equal(flow.booking.rescheduleOffer.status, "accepted");
  assert.deepEqual(flow.writes, ["released original slot", "alternate slot"]);
});

test("the email explains when the patient's requested slot is already booked", async () => {
  const flow = setup({ requestedSlotTaken: true });
  assert.equal((await flow.offer()).emailSent, true);
  assert.match(flow.emails[0].text, /That slot has already been booked/);
  assert.match(flow.emails[0].html, /That slot has already been booked/);
});

test("an offer expires one hour before the earlier appointment when that is sooner", async () => {
  const now = Date.parse("2099-04-10T07:00:00+08:00");
  const originalFirst = setup({ now });
  await originalFirst.offer();
  assert.equal(originalFirst.booking.rescheduleOffer.expiresAt.toMillis(), Date.parse("2099-04-10T08:00:00+08:00"));

  const alternateFirst = setup({ now });
  await alternateFirst.offer("08:30");
  assert.equal(alternateFirst.booking.rescheduleOffer.expiresAt.toMillis(), Date.parse("2099-04-10T07:30:00+08:00"));
});

test("staff can offer only alternative times on the requested date", async () => {
  const flow = setup({ now: Date.parse("2099-04-10T07:30:00+08:00") });
  const { availableSlots } = await flow.getOfferAvailability();
  assert.deepEqual([...availableSlots], ["11:00"]);
  await assert.rejects(flow.getOfferAvailability("2099-04-11"), { code: "failed-precondition" });
  await assert.rejects(flow.offer("11:00", "2099-04-11"), { code: "failed-precondition" });
  await assert.rejects(flow.offer("10:00"), { code: "invalid-argument" });
  assert.deepEqual(flow.emails, []);
});

test("an offer is rejected when the original appointment starts within one hour", async () => {
  const flow = setup({ now: Date.parse("2099-04-10T08:30:00+08:00") });
  await assert.rejects(flow.offer(), { code: "failed-precondition" });
  assert.equal(flow.booking.rescheduleOffer, undefined);
  assert.deepEqual(flow.emails, []);
});

test("a conflict or an expired offer keeps the original booking intact", async () => {
  const flow = setup({ slotTaken: true });
  await flow.offer();
  await assert.rejects(flow.respond(true), { code: "already-exists" });
  flow.booking.rescheduleOffer.expiresAt = { toMillis: () => 0 };
  await assert.rejects(flow.respond(true), { code: "failed-precondition" });
  assert.equal(flow.booking.time, "09:00");
  assert.deepEqual(flow.writes, []);
});

test("email failure leaves the in-app offer visible and only the owner can decline it", async () => {
  const flow = setup({ emailFails: true });
  assert.equal((await flow.offer()).emailSent, false);
  await assert.rejects(flow.respond(false, "other-patient"), { code: "permission-denied" });
  await flow.respond(false);
  assert.equal(flow.booking.time, "09:00");
  assert.equal(flow.booking.rescheduleOffer.status, "declined");
  assert.deepEqual(flow.writes, []);
});

test("staff cannot approve a request for the current time or while cancellation is pending", async () => {
  const flow = setup();
  flow.booking.rescheduleRequest.requestedTime = flow.booking.time;
  await assert.rejects(flow.approveRequest(), /same as the current appointment/);
  flow.booking.rescheduleRequest.requestedTime = "10:00";
  flow.booking.cancellationRequest = { status: "pending" };
  await assert.rejects(flow.approveRequest(), { code: "failed-precondition" });
  assert.deepEqual(flow.writes, []);
});
